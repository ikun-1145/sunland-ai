import type {
  ConversationState,
  ConversationUnderstanding,
  DialoguePlan,
  DialoguePrimaryGoal,
  DialogueTone,
  ConversationRhythm,
} from "@/types";
import { stableUnitInterval } from "@/utils/deterministic";
import { planCommunityLanguage, planSocialResponse } from "@/community";

export interface DialoguePlanner {
  plan(
    understanding: ConversationUnderstanding,
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
  understanding: ConversationUnderstanding,
  state: ConversationState | undefined,
  selectionSeed: string | undefined,
): number {
  const fallbackSeed = [
    understanding.intent,
    understanding.conversationMode,
    understanding.topic,
    understanding.userMood,
  ].join(":");
  const familiarity = state?.relationship.familiarity ?? 0;
  return stableUnitInterval(
    `follow-up:${selectionSeed ?? fallbackSeed}:${familiarity}`,
  );
}

function rhythmFor(
  understanding: ConversationUnderstanding,
  followUpFrequency: number,
): ConversationRhythm {
  if (understanding.conversationMode === "technical") {
    return Object.freeze({
      targetSentenceCount: understanding.intent === "command" ? 4 : 3,
      allowFollowUp: understanding.intent === "command",
      followUpProbability: Math.min(0.3, followUpFrequency),
      allowTopicExpansion: true,
      allowNaturalEnding: true,
    });
  }
  switch (understanding.intent) {
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

function primaryGoal(understanding: ConversationUnderstanding): DialoguePrimaryGoal {
  switch (understanding.intent) {
    case "question":
    case "opinion_request":
      return "answer";
    case "command":
      return "help_task";
    case "emotional_share":
      return understanding.userMood === "sad" ? "comfort" : "encourage";
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

function toneFor(understanding: ConversationUnderstanding): DialogueTone {
  if (understanding.conversationMode === "technical") return "technical";
  switch (understanding.userMood) {
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

export const defaultDialoguePlanner: DialoguePlanner = Object.freeze({
  plan(
    understanding: ConversationUnderstanding,
    state?: ConversationState,
    policy: DialoguePlanningPolicy = {},
  ): DialoguePlan {
    const knowledgeTurn =
      understanding.intent === "question" ||
      understanding.intent === "command" ||
      understanding.intent === "opinion_request";
    const rhythm = rhythmFor(
      understanding,
      Math.min(1, Math.max(0, policy.followUpFrequency ?? 0.45)),
    );
    const followUpAllowed =
      (state?.followUpCooldown ?? 0) === 0 &&
      (state?.recentFollowUpCount ?? 0) < 2 &&
      state?.lastAssistantAskedQuestion !== true;
    const shouldAskFollowUp =
      followUpAllowed &&
      rhythm.allowFollowUp &&
      followUpSample(
        understanding,
        state,
        policy.followUpSelectionSeed,
      ) < rhythm.followUpProbability &&
      understanding.expectsContinuation &&
      understanding.intent !== "farewell" &&
      understanding.intent !== "thanks" &&
      understanding.intent !== "reaction";
    const social = planSocialResponse(
      understanding.pragmatics,
      understanding.conversationMode,
      state,
    );

    return Object.freeze({
      primaryGoal: primaryGoal(understanding),
      useReasoning: knowledgeTurn,
      useKnowledge: knowledgeTurn,
      useMemory: understanding.intent === "greeting",
      acknowledgeEmotion:
        understanding.expectsEmotionalResponse ||
        social.strategy.acknowledgeEmotion,
      shouldAskFollowUp,
      conversationDrive: shouldAskFollowUp
        ? understanding.intent === "command"
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
    });
  },
});
