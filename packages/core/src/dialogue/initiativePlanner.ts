import type {
  ConversationRhythm,
  ConversationState,
  ConversationUnderstanding,
  InitiativeDecision,
  OpenLoop,
  TopicResumeCandidate,
} from "@/types";
import { stableUnitInterval } from "@/utils/deterministic";
import { createEmptyInitiativeState } from "./initiativeState";

function decision(
  action: InitiativeDecision["action"],
  intensity: number,
  reason: string,
  target?: { readonly topicId?: string; readonly openLoopId?: string },
): InitiativeDecision {
  return Object.freeze({
    action,
    intensity: Math.min(1, Math.max(0, intensity)),
    ...(target?.topicId === undefined ? {} : { targetTopicId: target.topicId }),
    ...(target?.openLoopId === undefined ? {} : { targetOpenLoopId: target.openLoopId }),
    reason,
  });
}

function isUnresolvedTopic(
  topic: ConversationState["workingMemory"]["topics"][number],
): boolean {
  return topic.events.some(({ type }) =>
    type === "problem_reported" || type === "failed" || type === "attempted",
  ) && !topic.events.some(({ type }) => type === "resolved");
}

export function rankTopicResumeCandidates(
  state: ConversationState,
): readonly TopicResumeCandidate[] {
  const currentTurn = state.workingMemory.currentTurn;
  return Object.freeze(
    state.workingMemory.topics
      .filter(({ status, relevance, lastMentionTurn }) =>
        (status === "paused" || status === "background") &&
        relevance >= 0.25 &&
        currentTurn - lastMentionTurn <= 12,
      )
      .map((topic) => {
        const age = Math.max(0, currentTurn - topic.lastMentionTurn);
        const recency = Math.max(0, 1 - age / 12);
        const latestEvent = topic.events.at(-1)?.type;
        const emotionalWeight = latestEvent === "failed" ? 0.9
          : latestEvent === "succeeded" ? 0.65
            : topic.domains.length > 0 ? 0.55
              : 0.25;
        const unresolvedWeight = isUnresolvedTopic(topic) ? 1 : 0;
        const resumeScore = Math.min(
          1,
          topic.relevance * 0.4 +
            recency * 0.25 +
            emotionalWeight * 0.15 +
            unresolvedWeight * 0.2,
        );
        return Object.freeze({
          topicId: topic.id,
          relevance: topic.relevance,
          recency,
          emotionalWeight,
          unresolvedWeight,
          resumeScore,
        });
      })
      .sort((left, right) => right.resumeScore - left.resumeScore),
  );
}

function bestOpenLoop(state: ConversationState | undefined): OpenLoop | undefined {
  if (state === undefined) return undefined;
  const currentTurn = state.workingMemory.currentTurn;
  return [...state.initiative.openLoops]
    .filter(({ status, relevance, lastUpdatedTurn }) =>
      status === "open" &&
      relevance >= 0.3 &&
      currentTurn - lastUpdatedTurn <= 12,
    )
    .sort((left, right) =>
      right.relevance - left.relevance ||
      right.lastUpdatedTurn - left.lastUpdatedTurn,
    )[0];
}

export function planInitiative(
  understanding: ConversationUnderstanding,
  state: ConversationState | undefined,
  rhythm: ConversationRhythm,
  proposedFollowUp: boolean,
  selectionSeed: string | undefined,
): InitiativeDecision {
  const initiative = state?.initiative ?? createEmptyInitiativeState();
  const signals = understanding.initiativeSignals;
  const canPush =
    initiative.initiativeCooldownTurns === 0 &&
    initiative.recentAssistantInitiativeCount < 3 &&
    initiative.consecutiveQuestionTurns < 2 &&
    initiative.followUpFatigue < 0.72 &&
    state?.lastAssistantAskedQuestion !== true;

  if (understanding.pragmatics.requiresSafetyHandling) {
    return decision("none", 0, "safety-yield");
  }
  if (signals.explicitClose || understanding.intent === "farewell") {
    return decision("close_topic", 0.15, "user-close");
  }
  if (signals.returned) {
    const loop = bestOpenLoop(state);
    if (loop !== undefined && canPush) {
      return decision("follow_up", 0.65, "open-loop-return", {
        openLoopId: loop.id,
      });
    }
    return decision("react", 0.25, "return-without-loop");
  }
  if (signals.plannedEvent !== undefined) {
    return decision("react", 0.25, "future-event-reaction");
  }
  if (signals.boredom) {
    const candidate = state === undefined ? undefined : rankTopicResumeCandidates(state)[0];
    const resumeProbability = 0.2 +
      (state?.relationship.familiarity ?? 0) * 0.15 +
      initiative.userInitiativePreference * 0.1;
    const sample = stableUnitInterval(`initiative-resume:${selectionSeed ?? "boredom"}`);
    if (
      canPush &&
      candidate !== undefined &&
      candidate.resumeScore >= 0.58 &&
      sample < resumeProbability
    ) {
      return decision("resume_topic", 0.55, "boredom-recent-topic", {
        topicId: candidate.topicId,
      });
    }
    return canPush
      ? decision("expand", 0.4, "boredom-chat")
      : decision("react", 0.2, "boredom-cooldown");
  }
  if (signals.storyContinuation) {
    return canPush
      ? decision("expand", 0.65, "story-open-loop")
      : decision("react", 0.3, "story-cooldown");
  }
  if (signals.lowEngagement || initiative.userEngagement < 0.24) {
    return decision("none", 0, "low-engagement");
  }
  if (understanding.topicContinuity.transition === "resolved" ||
      understanding.topicContinuity.transition === "abandoned") {
    return decision("close_topic", 0.25, "topic-finished");
  }
  if (proposedFollowUp && canPush) {
    return decision("follow_up", Math.min(0.7, initiative.drive + 0.1), "rhythm-follow-up");
  }
  if (
    signals.highEngagement &&
    rhythm.allowTopicExpansion &&
    initiative.topicMomentum >= 0.72 &&
    canPush
  ) {
    return decision("react", 0.35, "high-engagement-reaction-first");
  }
  return decision("none", 0, "natural-ending");
}
