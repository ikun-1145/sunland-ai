import { describe, expect, it } from "vitest";
import { defaultDialoguePlanner } from "@/dialogue/dialoguePlanner";
import { createEmptyConversationState } from "@/dialogue/conversationState";
import { resolveDefaultTurnUnderstanding } from "@/understanding";

describe("Community generation policy", () => {
  it("separates comprehension from generation for familiar-only vocabulary", () => {
    const understanding = resolveDefaultTurnUnderstanding("这个毛好想 rua");
    const plan = defaultDialoguePlanner.plan(
      understanding,
      createEmptyConversationState(),
      { communityGenerationBias: 0.08 },
    );

    expect(understanding.community.matches).toContainEqual(
      expect.objectContaining({ semanticTag: "AFFECTIONATE_TOUCH" }),
    );
    expect(plan.communityLanguageMode).toBe("recognize");
  });

  it("allows conservative mirroring for safe vocabulary the user already used", () => {
    const understanding = resolveDefaultTurnUnderstanding("周末准备出毛");
    const plan = defaultDialoguePlanner.plan(
      understanding,
      createEmptyConversationState(),
      { communityGenerationBias: 0.08 },
    );

    expect(plan.communityLanguageMode).toBe("mirror");
  });

  it("suppresses mirroring during technical turns, definitions and cooldown", () => {
    const empty = createEmptyConversationState();
    const technical = resolveDefaultTurnUnderstanding("这个 bug 给我整破防了");
    const definition = resolveDefaultTurnUnderstanding("出毛是什么意思");
    const casual = resolveDefaultTurnUnderstanding("周末准备出毛");

    expect(defaultDialoguePlanner.plan(technical, empty).communityLanguageMode).toBe("recognize");
    expect(defaultDialoguePlanner.plan(definition, empty).communityLanguageMode).toBe("recognize");
    expect(defaultDialoguePlanner.plan(casual, {
      ...empty,
      communityLanguageCooldown: 1,
    }).communityLanguageMode).toBe("recognize");
  });
});
