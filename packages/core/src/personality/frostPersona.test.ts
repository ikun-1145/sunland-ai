import { describe, expect, it } from "vitest";
import type { DialogueTurnContext } from "@/types";
import { createEmptyConversationState } from "@/dialogue/conversationState";
import { defaultConversationAnalyzer } from "@/dialogue/conversationAnalyzer";
import { defaultDialoguePlanner } from "@/dialogue/dialoguePlanner";
import {
  FROST_FURRY_EXPRESSION_POLICY,
  FROST_PERSONA_SPEC,
  chooseFurryExpression,
} from "./frostPersona";

function turn(raw: string, cooldown = 0): DialogueTurnContext {
  const understanding = defaultConversationAnalyzer.analyze(raw);
  const plan = defaultDialoguePlanner.plan(understanding);
  return {
    raw,
    understanding,
    plan,
    state: {
      ...createEmptyConversationState(),
      furryExpressionCooldown: cooldown,
    },
  };
}

describe("Frost persona policy", () => {
  it("centralizes the intended personality balance and avoided patterns", () => {
    expect(FROST_PERSONA_SPEC).toMatchObject({
      warmth: 0.85,
      curiosity: 0.72,
      playfulness: 0.48,
      cuteness: 0.28,
      formality: 0.18,
      furryExpressionFrequency: 0.08,
      humorFrequency: 0.25,
      followUpFrequency: 0.45,
    });
    expect(FROST_PERSONA_SPEC.avoidedPatterns).toEqual(
      expect.arrayContaining(["主人", "高频喵", "我来帮你", "总结一下"]),
    );
  });

  it("keeps furry actions low-frequency and completely off in technical mode", () => {
    const casualUses = Array.from({ length: 500 }, (_, index) =>
      chooseFurryExpression(turn(`我今天很开心-${index}`), "celebration"),
    ).filter((value) => value !== null).length;
    const technicalUses = Array.from({ length: 100 }, (_, index) =>
      chooseFurryExpression(turn(`bug 终于修好了-${index}`), "celebration"),
    ).filter((value) => value !== null).length;

    expect(casualUses).toBeGreaterThan(0);
    expect(casualUses / 500).toBeLessThanOrEqual(0.1);
    expect(technicalUses).toBe(0);
  });

  it("honors the explicit furry-expression cooldown", () => {
    const eligibleRaw = Array.from(
      { length: 500 },
      (_, index) => `终于搞定了，好开心-${index}`,
    ).find((raw) => chooseFurryExpression(turn(raw), "celebration") !== null);

    expect(eligibleRaw).toBeDefined();
    expect(
      chooseFurryExpression(turn(eligibleRaw ?? "", 1), "celebration"),
    ).toBeNull();
    expect(FROST_FURRY_EXPRESSION_POLICY.cooldownTurns).toBe(3);
  });
});
