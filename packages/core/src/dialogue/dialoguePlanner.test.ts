import { describe, expect, it } from "vitest";
import { defaultConversationAnalyzer } from "./conversationAnalyzer";
import { defaultDialoguePlanner } from "./dialoguePlanner";
import { createEmptyConversationState } from "./conversationState";

describe("DialoguePlanner", () => {
  it("keeps casual and emotional turns off the reasoning path", () => {
    for (const input of ["我刚吃完饭", "考试没考好，有点难受", "哈哈哈哈"]) {
      const understanding = defaultConversationAnalyzer.analyze(input);
      const plan = defaultDialoguePlanner.plan(understanding);

      expect(plan.useReasoning).toBe(false);
      expect(plan.useKnowledge).toBe(false);
    }
  });

  it("uses reasoning for technical questions while acknowledging mixed emotion", () => {
    const understanding = defaultConversationAnalyzer.analyze(
      "这个 bug 我搞了一下午还是不行，你帮我看看为什么",
    );

    expect(defaultDialoguePlanner.plan(understanding)).toMatchObject({
      primaryGoal: "help_task",
      useReasoning: true,
      useKnowledge: true,
      acknowledgeEmotion: true,
      tone: "technical",
    });
  });

  it("suppresses optional follow-ups during the cooldown window", () => {
    const understanding = defaultConversationAnalyzer.analyze("我刚吃完饭");

    expect(defaultDialoguePlanner.plan(understanding).shouldAskFollowUp).toBe(true);
    expect(
      defaultDialoguePlanner.plan(understanding, {
        ...createEmptyConversationState(),
        followUpCooldown: 1,
      }).shouldAskFollowUp,
    ).toBe(false);
  });

  it("uses follow-up frequency as a deterministic selection threshold", () => {
    const understanding = defaultConversationAnalyzer.analyze("我刚吃完饭");

    expect(
      defaultDialoguePlanner.plan(understanding, undefined, {
        followUpFrequency: 0.19,
        followUpSelectionSeed: "我刚吃完饭",
      }).shouldAskFollowUp,
    ).toBe(false);
    expect(
      defaultDialoguePlanner.plan(understanding, undefined, {
        followUpFrequency: 0.2,
        followUpSelectionSeed: "我刚吃完饭",
      }).shouldAskFollowUp,
    ).toBe(true);
  });

  it("assigns short rhythm to reactions and restrained rhythm to technical turns", () => {
    const reaction = defaultDialoguePlanner.plan(
      defaultConversationAnalyzer.analyze("哈哈哈哈"),
    );
    const technical = defaultDialoguePlanner.plan(
      defaultConversationAnalyzer.analyze("JWT 空算法为什么危险"),
    );

    expect(reaction.rhythm).toMatchObject({
      targetSentenceCount: 1,
      allowFollowUp: false,
      allowNaturalEnding: true,
    });
    expect(technical).toMatchObject({
      tone: "technical",
      personalityIntensity: "low",
      rhythm: {
        targetSentenceCount: 3,
        followUpProbability: 0.3,
      },
    });
  });
});
