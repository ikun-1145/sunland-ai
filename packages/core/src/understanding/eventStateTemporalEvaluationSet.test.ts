import { describe, expect, it } from "vitest";
import {
  advanceConversationState,
  createEmptyConversationState,
  defaultDialoguePlanner,
} from "@/dialogue";
import type { ConversationState, TurnUnderstanding } from "@/types";
import { resolveDefaultTurnUnderstanding } from "./defaultResolver";
import { EVENT_STATE_TEMPORAL_EVALUATION_SET } from "./eventStateTemporalEvaluationSet";

function evaluate(turns: readonly string[]): {
  readonly state: ConversationState;
  readonly understanding: TurnUnderstanding;
  readonly understandings: readonly TurnUnderstanding[];
} {
  let state = createEmptyConversationState();
  let understanding: TurnUnderstanding | undefined;
  const understandings: TurnUnderstanding[] = [];
  for (const input of turns) {
    understanding = resolveDefaultTurnUnderstanding(input, state);
    understandings.push(understanding);
    const plan = defaultDialoguePlanner.plan(understanding, state, {
      followUpSelectionSeed: input,
    });
    state = advanceConversationState(state, understanding, plan);
  }
  if (understanding === undefined) throw new Error("evaluation case has no turns");
  return { state, understanding, understandings: Object.freeze(understandings) };
}

describe("Stage 16.1 Event, State and Temporal Evaluation Set", () => {
  it("contains 160 fixed cases with at least 40 multi-turn scenarios", () => {
    expect(EVENT_STATE_TEMPORAL_EVALUATION_SET).toHaveLength(160);
    expect(new Set(EVENT_STATE_TEMPORAL_EVALUATION_SET.map(({ id }) => id)).size)
      .toBe(160);
    expect(EVENT_STATE_TEMPORAL_EVALUATION_SET.filter(({ turns }) => turns.length > 1))
      .toHaveLength(50);
  });

  for (const candidate of EVENT_STATE_TEMPORAL_EVALUATION_SET) {
    it(candidate.id, () => {
      const { state, understanding } = evaluate(candidate.turns);
      const expected = candidate.expected;
      const finalEvent = understanding.events.at(-1);
      const latestTopic = [...state.workingMemory.topics]
        .sort((left, right) => right.lastMentionTurn - left.lastMentionTurn)[0];

      if (expected.noEvent === true) expect(understanding.events).toEqual([]);
      if (expected.eventTypes !== undefined) {
        expect(understanding.events.map(({ type }) => type)).toEqual(expected.eventTypes);
      }
      if (expected.finalEvent !== undefined) expect(finalEvent?.type).toBe(expected.finalEvent);
      if (expected.recurrence !== undefined) {
        expect(finalEvent?.recurrence).toBe(expected.recurrence);
      }
      if (expected.previousOccurrence !== undefined) {
        expect(finalEvent?.previousOccurrence).toBe(expected.previousOccurrence);
      }
      if (expected.stateBefore !== undefined) {
        expect(finalEvent?.stateBefore?.status).toBe(expected.stateBefore);
      }
      if (expected.stateAfter !== undefined) {
        expect(finalEvent?.stateAfter?.status).toBe(expected.stateAfter);
        expect(understanding.stateTransitions.at(-1)?.to.status).toBe(expected.stateAfter);
      }
      for (const temporal of expected.temporalIncludes ?? []) {
        expect(understanding.temporalRelations.map(({ type }) => type)).toContain(temporal);
      }
      for (const temporal of expected.temporalExcludes ?? []) {
        expect(understanding.temporalRelations.map(({ type }) => type)).not.toContain(temporal);
      }
      for (const relation of expected.sequenceIncludes ?? []) {
        expect(understanding.eventSequence.relations.map(({ type }) => type)).toContain(relation);
      }
      if (expected.correction === true) {
        expect(understanding.correction).toEqual(expect.objectContaining({
          targetEventId: expect.any(String),
          replacement: expect.objectContaining({ type: "failure" }),
        }));
      }
      if (expected.ambiguous !== undefined) {
        expect(understanding.topicRelation.ambiguous).toBe(expected.ambiguous);
      }
      if (expected.topicEvent !== undefined) {
        expect(latestTopic?.events.at(-1)?.type).toBe(expected.topicEvent);
      }
      if (expected.topicStatus !== undefined) {
        expect(latestTopic?.status).toBe(expected.topicStatus);
      }
    });
  }

  it("distinguishes repeated failure, repeated action and community recurrence", () => {
    const failure = resolveDefaultTurnUnderstanding("bug又炸了");
    const action = resolveDefaultTurnUnderstanding("我又吃火锅了");
    const community = resolveDefaultTurnUnderstanding("我推又出谷了");

    expect(failure.events.at(-1)).toMatchObject({ type: "failure", recurrence: true });
    expect(action.events.at(-1)).toMatchObject({ type: "recur", recurrence: true });
    expect(community.events.at(-1)).toMatchObject({ type: "create", recurrence: true });
  });

  it("keeps topic activity separate from a pending deliverable state", () => {
    const { state, understanding } = evaluate(["老师还没返图"]);
    const topic = state.workingMemory.topics.at(-1);

    expect(understanding.events.at(-1)).toMatchObject({
      type: "wait",
      stateAfter: { status: "pending" },
    });
    expect(topic).toMatchObject({
      status: "active",
      semanticState: { status: "pending" },
    });
  });

  it("carries the exact login failure chain through attempts to resolution", () => {
    const { state, understandings } = evaluate([
      "登录坏了",
      "我改了cookie",
      "还是不行",
      "重启了一下",
      "好了",
    ]);
    expect(understandings.map((turn) => turn.events.at(-1)?.type)).toEqual([
      "failure", "update", "failure", "retry", "recover",
    ]);
    expect(understandings.map((turn) => turn.events.at(-1)?.stateAfter?.status)).toEqual([
      "failed", "working", "failed", "working", "resolved",
    ]);
    expect(state.workingMemory.topics.at(-1)?.events.map(({ type }) => type)).toEqual([
      "problem_reported", "attempted", "failed", "attempted", "resolved",
    ]);
  });

  it("uses context for already-completed send and receive events", () => {
    const sent = evaluate(["稿件还没发", "已经发了"]).understanding;
    const received = evaluate(["新谷还没到", "已经到了"]).understanding;

    expect(sent.events.at(-1)).toMatchObject({
      type: "send",
      stateBefore: { status: "pending" },
      stateAfter: { status: "available" },
    });
    expect(received.events.at(-1)).toMatchObject({
      type: "receive",
      stateBefore: { status: "pending" },
      stateAfter: { status: "available" },
    });
    expect(sent.temporalRelations).toContainEqual(expect.objectContaining({ type: "already" }));
    expect(received.temporalRelations).toContainEqual(expect.objectContaining({ type: "already" }));
  });

  it("resolves the exact already-completed problem example from context", () => {
    const understanding = evaluate(["登录坏了", "已经好了"]).understanding;

    expect(understanding.events.at(-1)).toMatchObject({
      type: "resolve",
      stateBefore: { status: "failed" },
      stateAfter: { status: "resolved" },
    });
    expect(understanding.temporalRelations).toContainEqual(expect.objectContaining({
      type: "already",
    }));
  });

  it("resolves the exact finally-returned deliverable example", () => {
    const understanding = resolveDefaultTurnUnderstanding("终于返图了");

    expect(understanding.events.at(-1)).toMatchObject({
      type: "receive",
      stateAfter: { status: "available" },
    });
    expect(understanding.temporalRelations).toContainEqual(expect.objectContaining({
      type: "finally",
    }));
  });

  it("corrects a resolved interpretation and reopens the same topic", () => {
    const { state, understanding } = evaluate([
      "登录坏了",
      "好了",
      "等等，好像还是不行",
    ]);

    expect(understanding.correction?.targetEventId).toEqual(expect.any(String));
    expect(understanding.events.at(-1)?.stateAfter?.status).toBe("failed");
    expect(state.workingMemory.topics).toHaveLength(1);
    expect(state.workingMemory.topics[0]).toMatchObject({
      status: "active",
      semanticState: { status: "failed" },
    });
  });

  it("resolves a failed topic on finally and keeps still as the same failure", () => {
    const resolved = evaluate(["登录坏了", "终于好了"]).understanding;
    const continuing = evaluate(["登录坏了", "还在转圈"]).understanding;

    expect(resolved.events.at(-1)).toMatchObject({
      type: "resolve",
      stateBefore: { status: "failed" },
      stateAfter: { status: "resolved" },
    });
    expect(resolved.temporalRelations).toContainEqual(expect.objectContaining({
      type: "finally",
    }));
    expect(continuing.events.at(-1)).toMatchObject({
      type: "failure",
      previousOccurrence: true,
      stateAfter: { status: "failed" },
    });
    expect(continuing.temporalRelations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "still" }),
      expect.objectContaining({ type: "continuing" }),
    ]));
  });

  it("keeps sequence order certain and possible causality low-confidence", () => {
    const understanding = resolveDefaultTurnUnderstanding("更新完就炸了");

    expect(understanding.events.map(({ type }) => type)).toEqual(["update", "failure"]);
    expect(understanding.eventSequence.relations).toContainEqual(expect.objectContaining({
      type: "before",
      confidence: 0.94,
    }));
    expect(understanding.eventSequence.relations).toContainEqual(expect.objectContaining({
      type: "possible_cause",
      confidence: 0.35,
    }));
  });
});
