import { describe, expect, it } from "vitest";
import {
  applySemanticContextUpdate,
  createEmptySemanticContext,
  type SemanticContext,
} from "@/semantic";
import { createSunlandEngine, type SunlandEngine } from "./sunlandEngine";

function chat(
  engine: SunlandEngine,
  inputs: readonly string[],
  initial = createEmptySemanticContext(),
): { readonly context: SemanticContext; readonly responses: readonly string[] } {
  let context = initial;
  const responses: string[] = [];
  for (const [index, input] of inputs.entries()) {
    const result = engine.process(input, {
      semanticContext: context,
      turnId: `initiative-${index}`,
    });
    context = applySemanticContextUpdate(context, result.semanticContextUpdate);
    responses.push(result.response);
  }
  return { context, responses };
}

describe("Sunland Initiative integration", () => {
  it("tracks a planned event and follows it up when the user returns", () => {
    const engine = createSunlandEngine({ semanticContextMode: "enabled" });
    const result = chat(
      engine,
      ["我要去考试了", "我回来了"],
    );

    expect(result.responses[0]).not.toMatch(/[？?]/u);
    expect(result.responses[1]).toMatch(/考试|考得/u);
    expect(result.responses[1]).toMatch(/[？?]/u);
    expect(result.context.conversationState?.initiative.openLoops[0]).toMatchObject({
      summary: "考试",
      status: "open",
    });
    expect(engine.memory.list()).toEqual([]);
    expect(JSON.stringify(engine.knowledgeStore.all())).not.toMatch(/考试/u);
  });

  it("keeps initiative and open loops isolated in caller-owned conversations", () => {
    const engine = createSunlandEngine({ semanticContextMode: "enabled" });
    const base = createEmptySemanticContext();
    const exam = chat(engine, ["我要去考试了"], base).context;
    const interview = chat(engine, ["我要去面试了"], base).context;

    expect(exam.conversationState?.initiative.openLoops[0]?.summary).toBe("考试");
    expect(interview.conversationState?.initiative.openLoops[0]?.summary).toBe("面试");
    expect(exam).not.toEqual(interview);
  });

  it("does not invent an event when the user returns without an open loop", () => {
    const result = chat(
      createSunlandEngine({ semanticContextMode: "enabled" }),
      ["我回来了"],
    );

    expect(result.responses[0]).toMatch(/回来/u);
    expect(result.responses[0]).not.toMatch(/考试|面试|吃饭|兽展|更新/u);
  });

  it("resolves an open loop and does not ask about it again", () => {
    const result = chat(
      createSunlandEngine({ semanticContextMode: "enabled" }),
      ["我要去考试了", "考试考完了", "我回来了"],
    );

    expect(result.context.conversationState?.initiative.openLoops.some(
      ({ summary, status }) => summary === "考试" && status === "open",
    )).toBe(false);
    expect(result.responses.at(-1)).not.toMatch(/考试|考得/u);
  });

  it("backs off across repeated low-engagement acknowledgements", () => {
    const result = chat(
      createSunlandEngine({ semanticContextMode: "enabled" }),
      ["今天上课", "嗯", "哦", "行"],
    );

    expect(result.responses.slice(1).filter((response) => /[？?]/u.test(response)))
      .toHaveLength(0);
    expect(result.context.conversationState?.initiative.userEngagement).toBeLessThan(0.3);
  });

  it("handles boredom as chat instead of a recommendation list", () => {
    const result = chat(
      createSunlandEngine({ semanticContextMode: "enabled" }),
      ["好无聊"],
    );

    expect(result.responses[0]).toMatch(/聊|扯|放空/u);
    expect(result.responses[0]).not.toMatch(/以下|建议|1[.、]|首先/u);
  });

  it("accepts an explicit ending without asking another question", () => {
    const result = chat(
      createSunlandEngine({ semanticContextMode: "enabled" }),
      ["行，那先这样吧"],
    );

    expect(result.responses[0]).toMatch(/先|到这|这样/u);
    expect(result.responses[0]).not.toMatch(/[？?]/u);
    expect(result.context.conversationState?.initiative.drive).toBe(0);
  });

  it("uses reaction-first wording for an unfinished story", () => {
    const result = chat(
      createSunlandEngine({ semanticContextMode: "enabled" }),
      ["然后更离谱的来了"],
    );

    expect(result.responses[0]).toMatch(/继续|离谱|高手/u);
    expect(result.responses[0]).not.toMatch(/以下是|建议如下/u);
  });

  it("keeps technical resolution concise without an assistance upsell", () => {
    const result = chat(
      createSunlandEngine({ semanticContextMode: "enabled" }),
      ["代码又崩了", "好了"],
    );

    expect(result.responses.at(-1)).not.toMatch(/还可以|其他文件|其他问题|需要我/u);
    expect(result.responses.at(-1)).not.toMatch(/[？?]/u);
  });

  it("lets a community follow-up land as a reaction instead of another question", () => {
    const result = chat(
      createSunlandEngine({ semanticContextMode: "enabled" }),
      ["我推新谷到了", "没翻，很好看"],
    );

    expect(result.responses.at(-1)).not.toMatch(/[？?]/u);
    expect(result.responses.at(-1)).not.toMatch(/还有什么|要不要/u);
  });

  it("gives Plain the same basic behavior without Frost traits", () => {
    const result = chat(
      createSunlandEngine({ personalityId: "plain", semanticContextMode: "enabled" }),
      ["我要去面试了", "我回来了"],
    );

    expect(result.responses[1]).toMatch(/面试/u);
    expect(result.responses.join(" ")).not.toMatch(/😂|👀|尾巴|耳朵|霜蓝/u);
  });

  it("does not revive an expired open loop", () => {
    const fillers = Array.from({ length: 16 }, (_, index) => `普通聊天 ${index}`);
    const result = chat(
      createSunlandEngine({ semanticContextMode: "enabled" }),
      ["我要去考试了", ...fillers, "我回来了"],
    );

    expect(result.responses.at(-1)).not.toMatch(/考试|考得/u);
  });
});
