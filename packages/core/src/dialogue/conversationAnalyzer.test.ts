import { describe, expect, it } from "vitest";
import { defaultConversationAnalyzer } from "./conversationAnalyzer";

describe("ConversationAnalyzer", () => {
  it.each([
    ["我刚吃完饭", "casual_chat", "meal", "neutral", "casual"],
    ["考试没考好，有点难受", "emotional_share", "exam", "sad", "emotional"],
    ["哈哈哈哈", "reaction", "unknown", "playful", "casual"],
    ["JWT 验签为什么失败？", "question", "technical_problem", "neutral", "technical"],
    ["晚安", "farewell", "sleep", "neutral", "casual"],
  ] as const)(
    "classifies %s",
    (input, intent, topic, mood, mode) => {
      expect(defaultConversationAnalyzer.analyze(input)).toMatchObject({
        intent,
        topic,
        userMood: mood,
        conversationMode: mode,
      });
    },
  );

  it("keeps task intent and emotion as separate signals", () => {
    expect(
      defaultConversationAnalyzer.analyze(
        "这个 bug 我搞了一下午还是不行，你帮我看看为什么",
      ),
    ).toMatchObject({
      intent: "command",
      userMood: "frustrated",
      conversationMode: "technical",
      expectsAnswer: true,
      expectsEmotionalResponse: true,
    });
  });

  it("does not reinterpret explicit knowledge teaching as casual chat", () => {
    expect(defaultConversationAnalyzer.analyze("猫属于动物")).toMatchObject({
      intent: "unknown",
      confidence: 0.25,
    });
  });
});
