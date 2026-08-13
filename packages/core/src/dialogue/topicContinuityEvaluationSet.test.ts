import { describe, expect, it } from "vitest";
import type { ConversationState, TopicContinuity } from "@/types";
import { advanceConversationState, createEmptyConversationState } from "./conversationState";
import { defaultDialoguePlanner } from "./dialoguePlanner";
import { resolveDefaultTurnUnderstanding } from "@/understanding";
import { TOPIC_CONTINUITY_EVALUATION_SET } from "./topicContinuityEvaluationSet";

function evaluate(turns: readonly string[]): {
  readonly state: ConversationState;
  readonly continuity: TopicContinuity;
} {
  let state = createEmptyConversationState();
  let continuity: TopicContinuity | undefined;
  for (const input of turns) {
    const understanding = resolveDefaultTurnUnderstanding(input, state);
    const plan = defaultDialoguePlanner.plan(understanding, state, {
      followUpSelectionSeed: input,
    });
    state = advanceConversationState(state, understanding, plan);
    continuity = understanding.topicContinuity;
  }
  if (continuity === undefined) throw new Error("evaluation case has no turns");
  return { state, continuity };
}

describe("Topic Continuity Evaluation Set", () => {
  it("contains 100 fixed cases with at least 30 multi-turn scenarios", () => {
    expect(TOPIC_CONTINUITY_EVALUATION_SET).toHaveLength(100);
    expect(new Set(TOPIC_CONTINUITY_EVALUATION_SET.map(({ id }) => id)).size).toBe(100);
    expect(TOPIC_CONTINUITY_EVALUATION_SET.filter(({ turns }) => turns.length > 1).length)
      .toBeGreaterThanOrEqual(30);
  });

  for (const candidate of TOPIC_CONTINUITY_EVALUATION_SET) {
    it(candidate.id, () => {
      const { state, continuity } = evaluate(candidate.turns);
      const latestTopic = [...state.workingMemory.topics]
        .sort((left, right) => right.lastMentionTurn - left.lastMentionTurn)[0];
      const expected = candidate.expected;
      if (expected.transition !== undefined) {
        expect(continuity.transition).toBe(expected.transition);
      }
      if (expected.topicCount !== undefined) {
        expect(state.workingMemory.topics).toHaveLength(expected.topicCount);
      }
      if (expected.activeLabel !== undefined) {
        expect(continuity.activeTopic?.label ?? latestTopic?.label).toBe(expected.activeLabel);
      }
      if (expected.needsClarification !== undefined) {
        expect(continuity.needsClarification).toBe(expected.needsClarification);
      }
      if (expected.finalStatus !== undefined) {
        expect(latestTopic?.status).toBe(expected.finalStatus);
      }
      if (expected.finalEvent !== undefined) {
        expect(latestTopic?.events.at(-1)?.type).toBe(expected.finalEvent);
      }
      if (expected.referenceResolved === true) {
        expect(continuity.references.some(({ confidence, targetType }) =>
          confidence >= 0.7 && targetType !== "unknown")).toBe(true);
      }
      if (expected.activeCleared === true) {
        expect(state.workingMemory.activeTopicId).toBeUndefined();
      }
    });
  }
});
