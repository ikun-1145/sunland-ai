import type {
  ConversationState,
  DialoguePlan,
  DialoguePrimaryGoal,
  DialogueTone,
  ConversationRhythm,
  ResponseAct,
  TurnUnderstanding,
} from "@/types";
import { stableUnitInterval } from "@/utils/deterministic";
import { planCommunityLanguage, planSocialResponse } from "@/community";
import {
  dialogueIntentFromTurn,
  userMoodFromTurn,
} from "@/understanding/compatibility";
import { planInitiative } from "./initiativePlanner";

export interface DialoguePlanner {
  plan(
    understanding: TurnUnderstanding,
    state?: ConversationState,
    policy?: DialoguePlanningPolicy,
  ): DialoguePlan;
}

export interface DialoguePlanningPolicy {
  readonly followUpFrequency?: number;
  /** Transient input seed used only for reproducible selection, never persisted. */
  readonly followUpSelectionSeed?: string;
  /** Small persona-specific bias; Frost uses this only inside furry context. */
  readonly communityGenerationBias?: number;
}

function followUpSample(
  understanding: TurnUnderstanding,
  state: ConversationState | undefined,
  selectionSeed: string | undefined,
): number {
  const fallbackSeed = [
    dialogueIntentFromTurn(understanding),
    understanding.conversationMode,
    understanding.topic,
    userMoodFromTurn(understanding),
  ].join(":");
  const familiarity = state?.relationship.familiarity ?? 0;
  return stableUnitInterval(
    `follow-up:${selectionSeed ?? fallbackSeed}:${familiarity}`,
  );
}

function rhythmFor(
  understanding: TurnUnderstanding,
  followUpFrequency: number,
): ConversationRhythm {
  const intent = dialogueIntentFromTurn(understanding);
  if (understanding.conversationMode === "technical") {
    return Object.freeze({
      targetSentenceCount: intent === "command" ? 4 : 3,
      allowFollowUp: intent === "command",
      followUpProbability: Math.min(0.3, followUpFrequency),
      allowTopicExpansion: true,
      allowNaturalEnding: true,
    });
  }
  switch (intent) {
    case "reaction":
    case "thanks":
    case "farewell":
      return Object.freeze({
        targetSentenceCount: 1,
        allowFollowUp: false,
        followUpProbability: 0,
        allowTopicExpansion: false,
        allowNaturalEnding: true,
      });
    case "greeting":
      return Object.freeze({
        targetSentenceCount: 1,
        allowFollowUp: false,
        followUpProbability: 0.2,
        allowTopicExpansion: false,
        allowNaturalEnding: true,
      });
    case "casual_chat":
      return Object.freeze({
        targetSentenceCount: 2,
        allowFollowUp: true,
        followUpProbability: followUpFrequency,
        allowTopicExpansion: true,
        allowNaturalEnding: true,
      });
    case "emotional_share":
      return Object.freeze({
        targetSentenceCount: 2,
        allowFollowUp: true,
        followUpProbability: followUpFrequency,
        allowTopicExpansion: false,
        allowNaturalEnding: true,
      });
    case "storytelling":
    case "opinion_request":
      return Object.freeze({
        targetSentenceCount: 2,
        allowFollowUp: true,
        followUpProbability: followUpFrequency,
        allowTopicExpansion: true,
        allowNaturalEnding: true,
      });
    case "command":
      return Object.freeze({
        targetSentenceCount: 4,
        allowFollowUp: true,
        followUpProbability: Math.min(0.35, followUpFrequency),
        allowTopicExpansion: true,
        allowNaturalEnding: false,
      });
    case "question":
      return Object.freeze({
        targetSentenceCount: 3,
        allowFollowUp: false,
        followUpProbability: 0,
        allowTopicExpansion: true,
        allowNaturalEnding: true,
      });
    case "unknown":
      return Object.freeze({
        targetSentenceCount: 1,
        allowFollowUp: false,
        followUpProbability: 0,
        allowTopicExpansion: false,
        allowNaturalEnding: true,
      });
  }
}

function primaryGoal(understanding: TurnUnderstanding): DialoguePrimaryGoal {
  if (understanding.topicContinuity.needsClarification) return "clarify";
  const intent = dialogueIntentFromTurn(understanding);
  switch (intent) {
    case "question":
    case "opinion_request":
      return "answer";
    case "command":
      return "help_task";
    case "emotional_share":
      return userMoodFromTurn(understanding) === "sad" ? "comfort" : "encourage";
    case "reaction":
      return "react";
    case "storytelling":
      return "continue_topic";
    case "unknown":
      return "clarify";
    case "greeting":
    case "farewell":
    case "thanks":
    case "casual_chat":
      return "chat";
  }
}

function toneFor(understanding: TurnUnderstanding): DialogueTone {
  if (understanding.conversationMode === "technical") return "technical";
  switch (userMoodFromTurn(understanding)) {
    case "sad":
    case "anxious":
      return "gentle";
    case "angry":
    case "frustrated":
    case "tired":
    case "confused":
      return "calm";
    case "happy":
    case "excited":
      return "enthusiastic";
    case "playful":
      return "playful";
    case "neutral":
    case "unknown":
      return "warm";
  }
}

function responseActFor(
  understanding: TurnUnderstanding,
  goal: DialoguePrimaryGoal,
  shouldAskFollowUp: boolean,
  joinJoke: boolean,
): ResponseAct {
  if (understanding.pragmatics.requiresSafetyHandling) {
    return Object.freeze({
      primary: "comfort",
      secondary: "acknowledge_emotion",
      confidence: 1,
    });
  }
  if (understanding.topicRelation.ambiguous || goal === "clarify") {
    return Object.freeze({ primary: "ask_clarification", confidence: 0.98 });
  }
  if (joinJoke) {
    return Object.freeze({ primary: "joke", confidence: understanding.confidence });
  }
  if (goal === "comfort") {
    return Object.freeze({
      primary: "comfort",
      secondary: understanding.userNeeds.some(({ need }) => need === "solve_problem")
        ? "offer_help"
        : "acknowledge_emotion",
      confidence: understanding.confidence,
    });
  }
  if (shouldAskFollowUp) {
    return Object.freeze({
      primary: "ask_followup",
      secondary: understanding.userNeeds.some(({ need }) => need === "solve_problem")
        ? "offer_help"
        : "continue_topic",
      confidence: understanding.confidence,
    });
  }
  if (goal === "encourage" || goal === "react" || goal === "chat") {
    return Object.freeze({
      primary: "acknowledge",
      ...(understanding.userNeeds.some(({ need }) => need === "solve_problem")
        ? { secondary: "offer_help" as const }
        : understanding.userNeeds.some(({ need }) => need === "share_emotion")
          ? { secondary: "acknowledge_emotion" as const }
          : {}),
      confidence: understanding.confidence,
    });
  }
  if (goal === "explain") {
    return Object.freeze({ primary: "explain", confidence: understanding.confidence });
  }
  if (goal === "help_task") {
    return Object.freeze({
      primary: "acknowledge",
      secondary: "offer_help",
      confidence: understanding.confidence,
    });
  }
  return Object.freeze({
    primary: "answer",
    secondary: "provide_information",
    confidence: understanding.confidence,
  });
}

export const defaultDialoguePlanner: DialoguePlanner = Object.freeze({
  plan(
    understanding: TurnUnderstanding,
    state?: ConversationState,
    policy: DialoguePlanningPolicy = {},
  ): DialoguePlan {
    const intent = dialogueIntentFromTurn(understanding);
    const knowledgeTurn = !understanding.topicContinuity.needsClarification && (
      intent === "question" ||
      intent === "command" ||
      intent === "opinion_request"
    );
    const rhythm = rhythmFor(
      understanding,
      Math.min(1, Math.max(0, policy.followUpFrequency ?? 0.45)),
    );
    const followUpAllowed =
      (state?.followUpCooldown ?? 0) === 0 &&
      (state?.recentFollowUpCount ?? 0) < 2 &&
      state?.lastAssistantAskedQuestion !== true;
    const proposedFollowUp =
      !understanding.topicContinuity.needsClarification &&
      followUpAllowed &&
      rhythm.allowFollowUp &&
      followUpSample(
        understanding,
        state,
        policy.followUpSelectionSeed,
      ) < rhythm.followUpProbability &&
      understanding.userNeeds.some(({ need }) =>
        need === "continue_chat" || need === "solve_problem",
      ) &&
      intent !== "farewell" &&
      intent !== "thanks" &&
      intent !== "reaction";
    const initiative = planInitiative(
      understanding,
      state,
      rhythm,
      proposedFollowUp,
      policy.followUpSelectionSeed,
    );
    const shouldAskFollowUp = initiative.action === "follow_up";
    const social = planSocialResponse(
      understanding.pragmatics,
      understanding.conversationMode,
      state,
    );
    const goal = primaryGoal(understanding);

    return Object.freeze({
      primaryGoal: goal,
      useReasoning: knowledgeTurn,
      useKnowledge: knowledgeTurn,
      useMemory: understanding.socialInteraction === "greeting",
      acknowledgeEmotion:
        understanding.userNeeds.some(({ need }) =>
          need === "receive_acknowledgement" || need === "share_emotion",
        ) ||
        social.strategy.acknowledgeEmotion,
      shouldAskFollowUp,
      conversationDrive: shouldAskFollowUp
        ? intent === "command"
          ? "guide"
          : "invite"
        : "respond",
      tone: toneFor(understanding),
      personalityIntensity:
        understanding.conversationMode === "technical" ? "low" : "medium",
      rhythm,
      communityLanguageMode: planCommunityLanguage(
        understanding.community,
        state,
        understanding.conversationMode,
        Math.min(0.15, Math.max(0, policy.communityGenerationBias ?? 0)),
      ),
      socialStrategy: social.strategy,
      secondaryGoals: social.secondaryGoals,
      initiative,
      responseAct: responseActFor(
        understanding,
        goal,
        shouldAskFollowUp,
        social.strategy.joinJoke,
      ),
    });
  },
});
