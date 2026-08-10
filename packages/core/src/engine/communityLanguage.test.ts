import { describe, expect, it } from "vitest";
import {
  applySemanticContextUpdate,
  createEmptySemanticContext,
  type SemanticContext,
} from "@/semantic";
import { createSunlandEngine } from "./sunlandEngine";

describe("Sunland community language flow", () => {
  it.each([
    ["周末准备出毛", /周末|活动|出毛/],
    ["这个毛好想rua", /毛茸茸|摸|rua/],
    ["我推新谷终于到了", /终于|周边|钱包|开箱/],
    ["老师开稿了吗", /名额|委托|手速|开稿/],
    ["周末出角", /周末|角色|出角/],
  ] as const)("responds inside the user's context for %s", (input, expected) => {
    const response = createSunlandEngine().respond(input);

    expect(response).toMatch(expected);
    expect(response).not.toMatch(/是指|术语|你的意思是|翻译成/u);
  });

  it("explains a known term only when definition is explicitly requested", () => {
    const engine = createSunlandEngine();

    expect(engine.respond("准备出毛")).not.toMatch(/意思|指穿/u);
    expect(engine.respond("出毛是什么意思？")).toMatch(/穿着兽装|参加活动/u);
  });

  it("keeps technical ambiguity on the existing technical path", () => {
    const engine = createSunlandEngine();

    expect(engine.respond("推代码为什么失败")).not.toMatch(/我推|角色|周边/u);
    expect(engine.respond("数据库这一列不能为空")).not.toMatch(/扩列|好友/u);
  });

  it("persists only bounded community ids and applies generation cooldown", () => {
    const engine = createSunlandEngine({ semanticContextMode: "enabled" });
    let context: SemanticContext = createEmptySemanticContext();
    const first = engine.process("周末准备出毛", {
      semanticContext: context,
      turnId: "community-1",
    });
    context = applySemanticContextUpdate(context, first.semanticContextUpdate);

    expect(context.conversationState?.communityContext.activeDomains).toContain("furry");
    expect(context.conversationState?.communityContext.recentlyDetectedTerms).toContain("fursuit-activity");
    expect(JSON.stringify(context)).not.toContain("周末准备出毛");
    expect(context.conversationState?.communityLanguageCooldown).toBe(2);

    const second = engine.process("这个毛好想 rua", {
      semanticContext: context,
      turnId: "community-2",
    });
    context = applySemanticContextUpdate(context, second.semanticContextUpdate);

    expect(second.response).not.toContain("rua");
    expect(context.conversationState?.communityLanguageCooldown).toBe(1);
  });

  it("does not learn or persist an unknown slang guess", () => {
    const engine = createSunlandEngine({ semanticContextMode: "enabled" });
    const base = createEmptySemanticContext();
    const result = engine.process("今天准备去咕卡", {
      semanticContext: base,
      turnId: "unknown-community",
    });
    const context = applySemanticContextUpdate(base, result.semanticContextUpdate);

    expect(
      context.conversationState?.communityContext.recentlyDetectedTerms ?? [],
    ).toEqual([]);
    expect(engine.knowledgeStore.all()).toEqual([]);
    expect(JSON.stringify(context)).not.toContain("咕卡");
  });

  it("keeps Plain free of Frost-specific actions and emojis", () => {
    const response = createSunlandEngine({ personalityId: "plain" }).respond(
      "周末准备出毛",
    );

    expect(response).not.toMatch(/霜蓝|尾巴|耳朵|爪子|🐾|😂|👀/u);
    expect(response).not.toMatch(/术语|意思是/u);
  });
});
