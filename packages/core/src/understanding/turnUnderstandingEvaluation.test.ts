import { describe, expect, it } from "vitest";
import {
  advanceConversationState,
  createEmptyConversationState,
  defaultDialoguePlanner,
} from "@/dialogue";
import { createSunlandEngine } from "@/engine";
import type { ConversationState, TurnUnderstanding } from "@/types";
import { resolveDefaultTurnUnderstanding } from "./defaultResolver";

function conversation() {
  let state: ConversationState = createEmptyConversationState();
  return {
    turn(input: string): TurnUnderstanding {
      const understanding = resolveDefaultTurnUnderstanding(input, state);
      const plan = defaultDialoguePlanner.plan(understanding, state, {
        followUpSelectionSeed: input,
      });
      state = advanceConversationState(state, understanding, plan);
      return understanding;
    },
  };
}

describe("Stage 16.0 TurnUnderstanding evaluation", () => {
  it("merges recurrence, failure, frustration and possible user needs", () => {
    const understanding = resolveDefaultTurnUnderstanding(
      "我人麻了，这bug又活了",
    );
    const plan = defaultDialoguePlanner.plan(understanding, undefined, {
      followUpSelectionSeed: understanding.rawInput,
    });

    expect(understanding).toMatchObject({
      normalizedMeaning: "recurring_failure",
      speechAct: "emotional_expression",
      primaryIntent: "vent",
      emotionalState: { primary: "frustration" },
    });
    expect(understanding.events).toContainEqual(expect.objectContaining({
      type: "failure",
      target: expect.objectContaining({ label: "bug" }),
      recurrence: true,
      previousOccurrence: true,
      stateBefore: expect.objectContaining({ status: "inactive" }),
      stateAfter: expect.objectContaining({ status: "failed" }),
    }));
    expect(understanding.userNeeds).toEqual(expect.arrayContaining([
      expect.objectContaining({ need: "receive_acknowledgement" }),
      expect.objectContaining({ need: "solve_problem" }),
    ]));
    expect(understanding.confidence).toBeGreaterThanOrEqual(0.8);
    expect(plan.responseAct).toMatchObject({
      primary: "acknowledge",
      secondary: "offer_help",
    });
  });

  it("resolves wallet death as exaggerated spending pressure", () => {
    const understanding = resolveDefaultTurnUnderstanding("钱包已经死了");

    expect(understanding).toMatchObject({
      normalizedMeaning: "spending_pressure",
      literal: false,
      expression: "exaggerated",
      primaryIntent: "vent",
      emotionalState: { primary: "frustration" },
    });
    expect(understanding.implications).toContainEqual(expect.objectContaining({
      meaning: "spending_pressure",
      safeToReflect: true,
    }));
  });

  it("merges creator-community meaning, completion and excitement", () => {
    const understanding = resolveDefaultTurnUnderstanding("老师终于开稿了");

    expect(understanding).toMatchObject({
      normalizedMeaning: "creator_commission",
      primaryIntent: "share_experience",
      emotionalState: { primary: "excitement" },
      communityContext: { primaryDomain: "art" },
    });
    expect(understanding.events).toContainEqual(expect.objectContaining({
      type: "start",
      target: expect.objectContaining({ label: "creator_commission" }),
      stateBefore: expect.objectContaining({ status: "unavailable" }),
      stateAfter: expect.objectContaining({ status: "available" }),
    }));
    expect(understanding.temporalRelations).toContainEqual(
      expect.objectContaining({ type: "finally" }),
    );
  });

  it("preserves ambiguity when a reference can target multiple problems", () => {
    const chat = conversation();
    chat.turn("iPhone连不上");
    chat.turn("Watch也连不上");
    const understanding = chat.turn("这个还是不行");
    const plan = defaultDialoguePlanner.plan(understanding);

    expect(understanding.topicRelation).toMatchObject({
      relation: "ambiguous",
      ambiguous: true,
      candidateTopics: ["Apple Watch连接问题", "iPhone连接问题"],
    });
    expect(understanding.references).toContainEqual(expect.objectContaining({
      text: "这个",
      targetType: "unknown",
    }));
    expect(understanding.events).toContainEqual(expect.objectContaining({
      type: "failure",
      previousOccurrence: true,
    }));
    expect(plan.responseAct.primary).toBe("ask_clarification");
  });

  it("keeps the raw input on the transient result instead of persisted context", () => {
    const input = "我人麻了，这bug又活了";
    const result = createSunlandEngine({ semanticContextMode: "enabled" }).process(
      input,
      { turnId: "understanding-privacy" },
    );

    expect(result.understanding.rawInput).toBe(input);
    expect(JSON.stringify(result.semanticContextUpdate)).not.toContain("rawInput");
    expect(JSON.stringify(result.semanticContextUpdate)).not.toContain(input);
  });
});
