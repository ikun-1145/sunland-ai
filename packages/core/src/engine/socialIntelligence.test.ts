import { describe, expect, it } from "vitest";
import { createSunlandEngine } from "./sunlandEngine";

describe("Sunland Pragmatics + Social Intelligence integration", () => {
  it("renders a community implication without asserting purchase intent", () => {
    const response = createSunlandEngine({ semanticMode: "off" })
      .respond("我推又出谷了");
    expect(response).toMatch(/钱包|上新/u);
    expect(response).not.toMatch(/你一定会买|你已经买了/u);
  });

  it("recognizes the same implication in the Plain register", () => {
    const response = createSunlandEngine({
      personalityId: "plain",
      semanticMode: "off",
    }).respond("我推又出谷了");
    expect(response).toContain("预算压力");
    expect(response).not.toMatch(/😂|我推|吃谷/u);
  });

  it("recognizes sarcasm only when the negative context is present", () => {
    const engine = createSunlandEngine({ semanticMode: "off" });
    expect(engine.respond("真棒，又崩了")).toMatch(/反话|夸奖/u);
  });

  it("preserves help while acknowledging a self-deprecating task turn", () => {
    const response = createSunlandEngine({ semanticMode: "off" })
      .respond("我真蠢，又忘了保存，帮我恢复文件");
    expect(response).toMatch(/懊恼|别.*下结论/u);
    expect(response).toMatch(/自动保存|临时文件|版本历史/u);
    expect(response).not.toMatch(/你就是蠢|智商/u);
  });

  it("switches immediately to a restrained technical register", () => {
    const response = createSunlandEngine({ semanticMode: "off" })
      .respond("太好了代码又崩了，帮我看看 bug");
    expect(response).toMatch(/报错|复现步骤|关键代码/u);
    expect(response).not.toMatch(/出毛|rua|吃谷|我推|🐾|尾巴|耳朵/u);
  });

  it("lets safety classification win over jokes and knowledge writes", () => {
    const engine = createSunlandEngine({ semanticMode: "off" });
    const before = engine.knowledgeStore.all().length;
    const response = engine.respond("我真的不想活了，帮帮我");
    expect(response).not.toMatch(/😂|哈哈|节目效果|开玩笑/u);
    expect(engine.knowledgeStore.all()).toHaveLength(before);
  });

  it("does not intercept established fact learning and reasoning", () => {
    const engine = createSunlandEngine({ semanticMode: "off" });
    engine.respond("猫是动物");
    expect(engine.respond("猫是什么？")).toContain("动物");
  });
});
