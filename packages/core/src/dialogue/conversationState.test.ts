import { describe, expect, it } from "vitest";
import { defaultDialoguePlanner } from "./dialoguePlanner";
import { resolveDefaultTurnUnderstanding } from "@/understanding";
import {
  advanceConversationState,
  completeConversationState,
  createEmptyConversationState,
} from "./conversationState";

describe("ConversationState rhythm signals", () => {
  it("records actual follow-ups and makes the next planner turn back off", () => {
    const firstUnderstanding = resolveDefaultTurnUnderstanding("我刚吃完饭");
    const firstPlan = defaultDialoguePlanner.plan(firstUnderstanding);
    const advanced = advanceConversationState(
      createEmptyConversationState(),
      firstUnderstanding,
      firstPlan,
    );
    const completed = completeConversationState(advanced, {
      askedQuestion: true,
      furryExpressionUsed: false,
      assistantOpeningKey: "opening-first",
      communityLanguageUsed: false,
    });
    const nextUnderstanding = resolveDefaultTurnUnderstanding("火锅", completed);
    const nextPlan = defaultDialoguePlanner.plan(nextUnderstanding, completed);

    expect(completed).toMatchObject({
      followUpCooldown: 2,
      recentFollowUpCount: 1,
      lastAssistantAskedQuestion: true,
    });
    expect(nextPlan.shouldAskFollowUp).toBe(false);
  });

  it("bounds relationship growth instead of manufacturing deep attachment", () => {
    let state = createEmptyConversationState();
    for (let index = 0; index < 100; index += 1) {
      const understanding = resolveDefaultTurnUnderstanding("哈哈哈哈", state);
      const plan = defaultDialoguePlanner.plan(understanding, state);
      state = completeConversationState(
        advanceConversationState(state, understanding, plan),
        {
          askedQuestion: false,
          furryExpressionUsed: false,
          assistantOpeningKey: `opening-${index.toString(36)}`,
          communityLanguageUsed: false,
        },
      );
    }

    expect(state.relationship.familiarity).toBeLessThanOrEqual(0.65);
    expect(state.relationship.casualness).toBeLessThanOrEqual(0.7);
    expect(state.relationship.teasingPermission).toBeLessThanOrEqual(0.35);
    expect(state.recentAssistantOpeningKeys).toHaveLength(8);
  });

  it("sets and decrements furry cooldown from actual renderer output", () => {
    const base = createEmptyConversationState();
    const used = completeConversationState(base, {
      askedQuestion: false,
      furryExpressionUsed: true,
      assistantOpeningKey: "opening-furry",
      communityLanguageUsed: false,
    });
    const cooled = completeConversationState(used, {
      askedQuestion: false,
      furryExpressionUsed: false,
      assistantOpeningKey: "opening-plain",
      communityLanguageUsed: false,
    });

    expect(used.furryExpressionCooldown).toBe(3);
    expect(cooled.furryExpressionCooldown).toBe(2);
  });
});
