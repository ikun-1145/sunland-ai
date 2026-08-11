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
      turnId: `topic-${index + 1}`,
    });
    responses.push(result.response);
    context = applySemanticContextUpdate(context, result.semanticContextUpdate);
  }
  return { context, responses };
}

describe("Sunland Topic Continuity integration", () => {
  it("understands a failed result after several unrelated turns", () => {
    const engine = createSunlandEngine({ semanticContextMode: "enabled" });
    const result = chat(engine, [
      "我的网站登录炸了",
      "我先去倒杯水",
      "今天有点冷",
      "刚才外面还下雨了",
      "顺手收了个快递",
      "结果还是没好",
    ]);

    expect(result.responses.at(-1)).toMatch(/还是没好|没有解决/u);
    expect(result.context.conversationState?.workingMemory.topics[0]).toMatchObject({
      label: "网站登录问题",
      status: "active",
      events: expect.arrayContaining([expect.objectContaining({ type: "failed" })]),
    });
    expect(engine.memory.list()).toEqual([]);
    expect(JSON.stringify(engine.knowledgeStore.all())).not.toMatch(/网站|登录/u);
  });

  it("renders a natural pronoun continuation for both Frost and Plain", () => {
    const frost = chat(
      createSunlandEngine({ semanticContextMode: "enabled" }),
      ["Mac上的Codex连不上", "它一直显示重新连接"],
    );
    const plain = chat(
      createSunlandEngine({ personalityId: "plain", semanticContextMode: "enabled" }),
      ["Mac上的Codex连不上", "它一直显示重新连接"],
    );

    expect(frost.responses[1]).toMatch(/重新连接|重连/u);
    expect(plain.responses[1]).toMatch(/重新连接/u);
    expect(plain.responses[1]).not.toMatch(/霜蓝|尾巴|耳朵|😂|🐾/u);
  });

  it("clarifies an ambiguous pronoun instead of guessing", () => {
    const result = chat(
      createSunlandEngine({ semanticContextMode: "enabled" }),
      ["iPhone连不上", "Watch也连不上", "它还是不行"],
    );

    expect(result.responses[2]).toMatch(/iPhone/u);
    expect(result.responses[2]).toMatch(/Watch/u);
    expect(result.responses[2]).toMatch(/[？?]/u);
  });

  it("returns to an earlier topic without creating a duplicate", () => {
    const result = chat(
      createSunlandEngine({ semanticContextMode: "enabled" }),
      ["网站登录炸了", "对了周末兽展几点", "回到刚才那个bug"],
    );
    const memory = result.context.conversationState?.workingMemory;

    expect(memory?.topics).toHaveLength(2);
    expect(memory?.topics.filter(({ label }) => label === "网站登录问题")).toHaveLength(1);
    expect(memory?.topics.find(({ id }) => id === memory.activeTopicId)?.label)
      .toBe("网站登录问题");
    expect(result.responses[2]).toMatch(/刚才|登录问题/u);
  });

  it("responds to an outcome reported while resuming instead of asking for it", () => {
    const result = chat(
      createSunlandEngine({ semanticContextMode: "enabled" }),
      ["网站登录炸了", "对了周末兽展几点", "回到刚才那个bug，还是没好"],
    );

    expect(result.responses.at(-1)).toMatch(/还是没好|没有解决/u);
    expect(result.responses.at(-1)).not.toMatch(/后来咋样|后续情况/u);
  });

  it("keeps caller-owned conversations isolated", () => {
    const engine = createSunlandEngine({ semanticContextMode: "enabled" });
    const base = createEmptySemanticContext();
    const a = chat(engine, ["网站登录炸了"], base).context;
    const b = chat(engine, ["周末准备出毛"], base).context;

    expect(a.conversationState?.workingMemory.topics[0]?.label).toBe("网站登录问题");
    expect(b.conversationState?.workingMemory.topics[0]?.label).toBe("毛装活动");
    expect(a).not.toEqual(b);
  });

  it("does not create topics for acknowledgement-only turns", () => {
    const result = chat(
      createSunlandEngine({ semanticContextMode: "enabled" }),
      ["哈哈哈", "行", "草", "嗯", "晚安"],
    );
    expect(result.context.conversationState?.workingMemory.topics).toEqual([]);
  });

  it("lets a stale topic decay out instead of resolving a distant pronoun", () => {
    const engine = createSunlandEngine({ semanticContextMode: "enabled" });
    const fillers = Array.from({ length: 18 }, (_, index) => `今天的普通闲聊 ${index}`);
    const result = chat(engine, ["网站登录炸了", ...fillers, "它怎么样了"]);
    const memory = result.context.conversationState?.workingMemory;

    expect(memory?.activeTopicId).toBeUndefined();
    expect(memory?.recentReferences.at(-1)).toMatchObject({
      text: "它",
      targetType: "unknown",
    });
  });

  it("keeps community outcomes attached to their topic", () => {
    const result = chat(
      createSunlandEngine({ semanticContextMode: "enabled" }),
      ["我推新谷出了", "真的好贵", "算了还是买", "终于到了"],
    );
    const topic = result.context.conversationState?.workingMemory.topics.find(
      ({ label }) => label === "周边",
    );

    expect(topic?.events.at(-1)?.type).toBe("succeeded");
    expect(result.responses.at(-1)).toMatch(/终于|到了|等到/u);
  });
});
