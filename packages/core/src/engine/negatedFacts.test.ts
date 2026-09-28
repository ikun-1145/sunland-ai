import { describe, expect, it } from "vitest";
import { createSunlandEngine } from "./sunlandEngine";

/**
 * B.7: negated facts must be teachable, storable, and queryable.
 *
 * Before this, every negation was refused at two gates, so
 * `KnowledgeRecord.negated` could never be true and a fact like "企鹅不会飞" --
 * the entire point of also knowing "鸟会飞" -- was unreachable. These tests pin
 * the reachability AND the safety boundary that must stay closed around it.
 */
function facts(engine: ReturnType<typeof createSunlandEngine>): string[] {
  return engine.knowledgeStore
    .all()
    .map((record) => `${record.subject}|${record.relation}|${record.object}|neg=${record.negated}`);
}

describe("negated facts are reachable end to end", () => {
  it("teaches and stores a complete negated statement", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    expect(engine.process("猫不会飞").response).toBe("已记录：猫 不会 飞");
    expect(facts(engine)).toEqual(["猫|会|飞|neg=true"]);
  });

  it("stores positive and negated forms side by side", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫会飞");
    engine.process("猫不会飞");

    // Both are kept: deciding between them is the ConflictResolver's job, and
    // it must never be done by discarding a fact at write time.
    expect(facts(engine).sort()).toEqual([
      "猫|会|飞|neg=false",
      "猫|会|飞|neg=true",
    ]);
  });

  it("handles the 喜欢 relation the same way", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫喜欢鱼");
    engine.process("猫不喜欢鱼");
    expect(facts(engine).sort()).toEqual([
      "猫|喜欢|鱼|neg=false",
      "猫|喜欢|鱼|neg=true",
    ]);
  });

  it("answers a query about a stored negated fact", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("企鹅不会飞");
    // No competing positive fact, so the negation is the answer.
    expect(engine.process("企鹅会什么").response).toContain("企鹅 不会 飞");
  });

  it("renders 不 correctly in the A.7 outcome text for all three outcomes", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    expect(engine.process("猫不会飞").response).toBe("已记录：猫 不会 飞");
    expect(engine.process("猫不会飞").response).toContain("已知，未重复记录：猫 不会 飞");
    // A related fact with a different object.
    expect(engine.process("猫不会游泳").response).toContain("已记录新的相关事实");
  });

  it("keeps negated 属于 edges out of transitive traversal", () => {
    // Existing invariant: a denial is not an edge to chain through.
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("企鹅属于鸟");
    engine.process("鸟属于动物");
    engine.process("企鹅不属于动物");

    expect(engine.process("企鹅属于什么").response).not.toContain("企鹅 不属于 动物；");
    expect(facts(engine)).toContain("企鹅|属于|动物|neg=true");
  });
});

describe("unsafe negations stay blocked", () => {
  it.each([
    ["猫不会", "missing object"],
    ["不会飞", "missing subject"],
    ["猫不会飞吗", "question structure"],
    ["猫会飞，猫不会", "a segment is incomplete"],
    ["猫不会飞，猫会游泳，狗喜欢肉，鸟会飞，鱼会游", "too many segments"],
    ["不要记住猫不会飞", "explicit prohibition"],
    ["不要记住猫会飞，猫不会飞", "explicit prohibition in one clause blocks the whole turn"],
    ["猫不会飞或者猫会游泳", "choice structure"],
    ["猫不会飞，而且会游泳", "unsupported sequence connector"],
    ["猫不会飞，，猫会游泳", "empty segment"],
    ["猫不会飞，我不是小明", "first-person denial"],
  ])("refuses '%s' (%s) and writes nothing", (input) => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process(input);
    expect(engine.knowledgeStore.all(), `${input} produced a write`).toEqual([]);
    expect(engine.memory.list()).toEqual([]);
  });

  it("accepts two complete negated sentences as two facts (B.8)", () => {
    // Multi-fact teaching applies the same per-segment rules, so two independent
    // negated statements are two valid facts rather than one compound refusal.
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫不会飞，鸟也不会飞");
    expect(facts(engine).sort()).toEqual([
      "猫|会|飞|neg=true",
      "鸟|会|飞|neg=true",
    ]);
  });

  it("still refuses a first-person denial", () => {
    // "我不是小明" is a complete negated statement about "我", but a denial is
    // not how knowledge about the account holder is established.
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("我不是小明");
    expect(engine.knowledgeStore.all()).toEqual([]);
    expect(engine.memory.list()).toEqual([]);
  });

  it("does not let a negation smuggle in a second fact", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫不会飞");
    expect(facts(engine)).toHaveLength(1);
  });
});
