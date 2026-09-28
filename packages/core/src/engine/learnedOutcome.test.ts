import { describe, expect, it } from "vitest";
import { createSunlandEngine } from "./sunlandEngine";
import { FrostPersonality } from "@/personality";

/**
 * A teaching turn must describe what actually happened.
 *
 * `KnowledgeStore.add` is idempotent per fact identity and returns the existing
 * record, so before this change the engine could not distinguish a first
 * teaching from a duplicate and Frost/Plain both announced "记下了" either way.
 * These tests pin the three outcomes and, just as importantly, pin what must NOT
 * change (the stored record, its provenance, and the fact that nothing is
 * deleted when a fact is superseded).
 */
describe("teaching turns report the real outcome", () => {
  it("reports a first teaching as recorded", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    expect(engine.process("猫属于哺乳动物").response).toBe("已记录：猫 属于 哺乳动物");
  });

  it("reports an exact duplicate as already known, not as newly recorded", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫属于哺乳动物");

    const reply = engine.process("猫属于哺乳动物").response;

    expect(reply).toContain("未重复记录");
    expect(reply).not.toContain("已记录");
  });

  it("treats an alias spelling of a known fact as already known", () => {
    // A.3 canonicalization makes `是一种` and `属于` the same fact, so the
    // second turn must not claim a new write.
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫属于哺乳动物");

    const reply = engine.process("猫是一种哺乳动物").response;

    expect(reply).toContain("未重复记录");
    expect(engine.knowledgeStore.all()).toHaveLength(1);
  });

  it("reports a related fact as an addition and shows what is still kept", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫属于哺乳动物");

    const reply = engine.process("猫属于爬行动物").response;

    expect(reply).toContain("已记录新的相关事实");
    expect(reply).toContain("猫 属于 爬行动物");
    expect(reply).toContain("猫 属于 哺乳动物");
    expect(reply).toContain("仍保留");
  });

  it("never claims an update, replacement or supersession", () => {
    // The earlier fact is still stored, so any of these words would describe a
    // knowledge state that does not exist. Deciding between related facts is
    // ConflictResolver work, not this layer's.
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫属于哺乳动物");

    const reply = engine.process("猫属于爬行动物").response;

    expect(reply).not.toMatch(/已更新|更新为|已覆盖|覆盖|已替换|替换|改为|以.*为准/u);
  });

  it("keeps both records when they differ only by negated", () => {
    // Same subject+relation+object, flipped `negated`: still a related fact, so
    // both survive. (Teaching a negated fact is blocked by the write gate, so
    // this exercises the store contract directly.)
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("企鹅属于鸟类");
    engine.knowledgeStore.add(
      { subject: "企鹅", relation: "属于", object: "鸟类", negated: true },
      { source: "user" },
    );

    expect(
      engine.knowledgeStore
        .all()
        .filter((record) => record.subject === "企鹅")
        .map((record) => record.negated)
        .sort(),
    ).toEqual([false, true]);
  });

  it("reply text matches the final knowledge base state", () => {
    // The property this ruling asks for: whatever the reply claims, the store
    // must actually hold afterwards. Uses a fresh engine so the assertions
    // describe exactly the turns below.
    const engine = createSunlandEngine({ personalityId: "plain" });
    const first = engine.process("猫属于哺乳动物").response;

    const storedObjects = (): string[] =>
      engine.knowledgeStore
        .all()
        .filter((record) => record.subject === "猫" && record.relation === "属于")
        .map((record) => record.object)
        .sort();

    // "已记录" is truthful for the first teaching.
    expect(first).toBe("已记录：猫 属于 哺乳动物");
    expect(storedObjects()).toEqual(["哺乳动物"]);

    // "已记录新的相关事实" is truthful only while BOTH facts exist.
    const related = engine.process("猫属于爬行动物").response;
    expect(related).toContain("已记录新的相关事实");
    expect(storedObjects()).toEqual(["哺乳动物", "爬行动物"]);

    // The duplicate changed nothing, so the state is unchanged by it.
    const duplicate = engine.process("猫属于哺乳动物").response;
    expect(duplicate).toContain("未重复记录");
    expect(storedObjects()).toEqual(["哺乳动物", "爬行动物"]);
  });

  it("a related reply names exactly the facts that are stored", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫属于哺乳动物");

    const reply = engine.process("猫属于爬行动物").response;

    const storedFacts = engine.knowledgeStore
      .all()
      .map((record) => `${record.subject} ${record.negated ? "不" : ""}${record.relation} ${record.object}`);

    // Every fact the reply names must really be in the store...
    for (const mentioned of ["猫 属于 哺乳动物", "猫 属于 爬行动物"]) {
      expect(reply, `reply does not mention ${mentioned}`).toContain(mentioned);
      expect(storedFacts, `${mentioned} named in reply but not stored`).toContain(mentioned);
    }
    // ...and the store must not hold a third object the reply stayed silent
    // about, which would make the reply incomplete rather than wrong.
    expect(storedFacts).toHaveLength(2);
  });

  it("never claims a write happened when it did not", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("鸟会飞");
    const before = engine.knowledgeStore.all();

    const replies = [
      engine.process("鸟会飞").response,
      engine.process("鸟能飞").response,
      engine.process("鸟能够飞").response,
    ];

    for (const reply of replies) {
      expect(reply).toContain("未重复记录");
    }
    expect(engine.knowledgeStore.all()).toEqual(before);
  });

  it("does not modify the existing record when a fact is re-taught", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    const first = engine.process("猫属于哺乳动物");
    const stored = engine.knowledgeStore.all();

    engine.process("猫属于哺乳动物");

    expect(engine.knowledgeStore.all()).toEqual(stored);
    expect(first.response).toContain("已记录");
  });

  it("keeps both facts when one supersedes another (nothing is silently dropped)", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫属于哺乳动物");
    engine.process("猫属于爬行动物");

    expect(
      engine.knowledgeStore.all().map((record) => record.object).sort(),
    ).toEqual(["哺乳动物", "爬行动物"]);
  });

  it("does not treat a different relation as a correction", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫属于哺乳动物");

    const reply = engine.process("猫喜欢鱼").response;

    expect(reply).toBe("已记录：猫 喜欢 鱼");
  });

  it("does not treat a different subject as a correction", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫属于哺乳动物");

    expect(engine.process("狗属于哺乳动物").response).toBe("已记录：狗 属于 哺乳动物");
  });

  it("renders all three outcomes under Frost too", () => {
    const engine = createSunlandEngine();
    const added = engine.process("星尘兽属于幻想生物").response;
    const duplicate = engine.process("星尘兽属于幻想生物").response;
    const related = engine.process("星尘兽属于原创兽设").response;

    expect(added).toContain("星尘兽 属于 幻想生物");
    // A duplicate must not reuse the "recorded it" wording.
    expect(duplicate).not.toBe(added);
    expect(duplicate).toContain("星尘兽 属于 幻想生物");

    // The related reply names both facts and never claims an update, because
    // both really are stored afterwards.
    expect(related).toContain("星尘兽 属于 原创兽设");
    expect(related).toContain("星尘兽 属于 幻想生物");
    expect(related).toContain("知识库");
    expect(related).not.toMatch(/已更新|更新为|已覆盖|覆盖|已替换|替换/u);
    expect(
      engine.knowledgeStore.all().map((record) => record.object).sort(),
    ).toEqual(["原创兽设", "幻想生物"]);
  });

  it("omitting the optional outcome renders as a first teaching (backward compatible)", () => {
    // `outcome` is optional so a host that builds this context by hand keeps the
    // historical behaviour. Asserted through the persona directly, because a
    // real engine turn always supplies the field.
    const reply = FrostPersonality.respond({
      kind: "learned",
      record: {
        subject: "猫",
        relation: "属于",
        object: "哺乳动物",
        negated: false,
        id: "k_manual",
        confidence: 1,
        source: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(reply).toContain("猫 属于 哺乳动物");
    expect(reply).toContain("知识库");
  });
});
