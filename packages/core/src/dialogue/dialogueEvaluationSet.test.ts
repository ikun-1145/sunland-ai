import { describe, expect, it } from "vitest";
import { createSunlandEngine } from "@/engine";
import { defaultConversationAnalyzer } from "./conversationAnalyzer";
import { DIALOGUE_EVALUATION_SET } from "./dialogueEvaluationSet";
import { evaluatePersonalityResponses } from "./personalityEvaluator";

describe("Dialogue evaluation set", () => {
  it("contains at least 50 unique, categorized cases", () => {
    expect(DIALOGUE_EVALUATION_SET.length).toBeGreaterThanOrEqual(50);
    expect(new Set(DIALOGUE_EVALUATION_SET.map(({ id }) => id)).size).toBe(
      DIALOGUE_EVALUATION_SET.length,
    );
    expect(
      DIALOGUE_EVALUATION_SET.filter(({ previousTurns }) => previousTurns).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("keeps expected intent classification reproducible", () => {
    for (const testCase of DIALOGUE_EVALUATION_SET) {
      expect(
        defaultConversationAnalyzer.analyze(testCase.input).intent,
        testCase.id,
      ).toBe(testCase.expectedIntent);
    }
  });

  it("enforces each case's forbidden language without an external evaluator", () => {
    const engine = createSunlandEngine();
    for (const testCase of DIALOGUE_EVALUATION_SET) {
      const response = engine.respond(testCase.input);
      for (const forbidden of testCase.forbiddenPatterns ?? []) {
        expect(response, `${testCase.id}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("keeps aggregate assistant, furry, question and verbosity signals bounded", () => {
    const engine = createSunlandEngine();
    const responses = DIALOGUE_EVALUATION_SET.map(({ input }) =>
      engine.respond(input),
    );
    const metrics = evaluatePersonalityResponses(responses);

    expect(metrics.assistantLikeScore).toBeLessThanOrEqual(0.05);
    expect(metrics.repetitionScore).toBeLessThanOrEqual(0.4);
    expect(metrics.followUpOveruseScore).toBeLessThanOrEqual(0.45);
    expect(metrics.furryOveruseScore).toBeLessThanOrEqual(0.12);
    expect(metrics.verbosityScore).toBe(0);
  });

  it("makes the heuristic metrics react to obvious quality regressions", () => {
    const metrics = evaluatePersonalityResponses([
      "当然可以，我来帮你。还有其他问题吗？尾巴摇了摇 🐾",
      "当然可以，我来帮你。还有其他问题吗？尾巴摇了摇 🐾",
    ]);

    expect(metrics.assistantLikeScore).toBe(1);
    expect(metrics.repetitionScore).toBe(1);
    expect(metrics.followUpOveruseScore).toBe(1);
    expect(metrics.furryOveruseScore).toBe(1);
  });

  it("keeps the mandatory short and emotional cases natural", () => {
    const engine = createSunlandEngine();
    const wake = engine.respond("我刚起床");
    const annoyed = engine.respond("烦死了");
    const laughter = engine.respond("哈哈哈哈哈哈");
    const fixed = engine.respond("我终于把 bug 修好了");
    const insult = engine.respond("你是不是傻");

    expect(wake).toMatch(/刚醒|开机|迷迷糊糊|被窝/);
    expect(wake).not.toMatch(/睡眠|身体健康|计划/);
    expect(annoyed).not.toMatch(/建议|首先|我理解你的感受/);
    expect(laughter.split(/[。！？!?]/u).filter(Boolean)).toHaveLength(1);
    expect(fixed).toMatch(/逮住|漂亮|开心|好耶/);
    expect(fixed).not.toContain("恭喜你成功修复");
    expect(insult).not.toMatch(/作为 AI|没有智力|无法感受/iu);
  });
});
