import { describe, expect, it } from "vitest";
import {
  applySemanticContextUpdate,
  createEmptySemanticContext,
  type SemanticContext,
} from "@/semantic";
import { createSunlandEngine } from "./sunlandEngine";

function questionCount(text: string): number {
  return text.match(/[？?]/gu)?.length ?? 0;
}

describe("Sunland chat-first companion flow", () => {
  it("handles everyday chat without calling the Reasoner or writing Knowledge", () => {
    const engine = createSunlandEngine({
      semanticContextMode: "enabled",
    });

    const result = engine.process("我刚吃完饭", {
      semanticContext: createEmptySemanticContext(),
      turnId: "meal-1",
      observationMode: "summary",
    });

    expect(result.response).toMatch(/吃完|吃了啥/);
    expect(result.response).not.toMatch(/补充背景|换一种说法|知识库/);
    expect(result.observationSummary?.reasonerDurationBucket).toBe("unavailable");
    expect(engine.knowledgeStore.all()).toEqual([]);
    expect(result.semanticContextUpdate).toMatchObject({
      kind: "replace",
      context: {
        conversationState: {
          recentTopic: "meal",
          lastUserIntent: "casual_chat",
        },
      },
    });
    expect(JSON.stringify(result.semanticContextUpdate)).not.toContain("我刚吃完饭");
  });

  it.each([
    ["考试没考好，有点难受", /难受|泄气/, /补充背景|换一种说法/],
    ["哈哈哈哈", /笑|哈哈|剧情/, /补充背景|换一种说法/],
    ["我终于搞定了，好开心", /开心|漂亮|好耶|顺下来了|尾巴/, /补充背景|换一种说法/],
    ["JWT 验签为什么失败？", /报错|上下文|配置/, /知识库|换一种说法/],
    ["这个 bug 我搞了一下午还是不行，你帮我看看为什么", /磨人|折腾/, /补充背景|换一种说法/],
    ["晚安", /晚安|休息/, /补充背景|换一种说法/],
  ] as const)("gives a companion-style response for %s", (input, expected, forbidden) => {
    const engine = createSunlandEngine();
    const response = engine.respond(input);

    expect(response).toMatch(expected);
    expect(response).not.toMatch(forbidden);
    expect(questionCount(response)).toBeLessThanOrEqual(1);
  });

  it("does not turn a continuing meal conversation into an interview", () => {
    const engine = createSunlandEngine({ semanticContextMode: "enabled" });
    let context: SemanticContext = createEmptySemanticContext();
    const replies: string[] = [];

    for (const [index, input] of [
      "我刚吃完饭",
      "火锅",
      "我吃得有点撑",
    ].entries()) {
      const result = engine.process(input, {
        semanticContext: context,
        turnId: `meal-${index + 1}`,
      });
      replies.push(result.response);
      context = applySemanticContextUpdate(context, result.semanticContextUpdate);
    }

    expect(replies[0]).toMatch(/吃了啥/);
    expect(replies[1]).toMatch(/火锅/);
    expect(replies.reduce((count, reply) => count + questionCount(reply), 0)).toBe(1);
    expect(context.conversationState).toMatchObject({
      recentTopic: "meal",
      followUpCooldown: 0,
      relationship: {
        familiarity: 0.12,
      },
    });
  });

  it("keeps Plain neutral and free of Frost-specific language", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    const response = engine.respond("我刚吃完饭");

    expect(response).toContain("吃完饭");
    expect(response).not.toMatch(/霜蓝|啦|～|🐾|✨|😂|👀|🌙/u);
  });

  it("keeps independent caller-owned conversation states isolated", () => {
    const engine = createSunlandEngine({ semanticContextMode: "enabled" });
    const base = createEmptySemanticContext();
    const a = engine.process("我刚吃完饭", { semanticContext: base, turnId: "a-1" });
    const b = engine.process("考试没考好，有点难受", { semanticContext: base, turnId: "b-1" });
    const contextA = applySemanticContextUpdate(base, a.semanticContextUpdate);
    const contextB = applySemanticContextUpdate(base, b.semanticContextUpdate);

    expect(contextA.conversationState).toMatchObject({ recentTopic: "meal" });
    expect(contextB.conversationState).toMatchObject({ recentTopic: "exam" });
    expect(contextA).not.toEqual(contextB);
  });

  it("varies repeated reactions using only privacy-safe opening signatures", () => {
    const engine = createSunlandEngine({ semanticContextMode: "enabled" });
    let context: SemanticContext = createEmptySemanticContext();
    const replies: string[] = [];

    for (let index = 0; index < 3; index += 1) {
      const result = engine.process("哈哈哈哈哈哈", {
        semanticContext: context,
        turnId: `laugh-${index}`,
      });
      replies.push(result.response);
      context = applySemanticContextUpdate(context, result.semanticContextUpdate);
    }

    expect(new Set(replies).size).toBeGreaterThan(1);
    expect(context.conversationState?.recentAssistantOpeningKeys).toHaveLength(3);
    expect(JSON.stringify(context)).not.toContain(replies[0]);
  });

  it("keeps seeded JWT knowledge on the factual Reasoner path without furry framing", () => {
    const engine = createSunlandEngine();
    engine.knowledgeStore.add(
      {
        subject: "JWT",
        relation: "是",
        object: "一种令牌格式",
        negated: false,
      },
      { source: "user" },
    );

    const response = engine.respond("JWT 是什么");

    expect(response).toContain("一种令牌格式");
    expect(response).not.toMatch(/尾巴|耳朵|爪子|🐾|喵/u);
  });
});
