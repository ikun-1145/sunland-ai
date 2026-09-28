import { describe, expect, it } from "vitest";
import { createSunlandEngine } from "./sunlandEngine";

/**
 * End-to-end behaviour for the batch-one fixes:
 *
 *   A2 -- what a user teaches is what gets stored (canonical triple).
 *   A4 -- restoring a snapshot never leaves duplicate facts behind.
 *   A5 -- a teaching cue is a wrapper, not part of the subject.
 *
 * These assert the user-visible contract ("I taught it, so it must be
 * answerable"), not the internal representation, because the failure they
 * cover is silent: the turn reported success while the fact was stored under
 * a subject no later query could ever match.
 */
describe("taught knowledge is stored under the subject the user named", () => {
  it("answers from a fact taught through the engine, not a raw subject", () => {
    const engine = createSunlandEngine({});
    engine.process("记住 猫 属于 哺乳动物");

    expect(
      engine.knowledgeStore
        .all()
        .map((record) => `${record.subject}|${record.relation}|${record.object}`),
    ).toEqual(["猫|属于|哺乳动物"]);
    expect(engine.process("猫属于什么").response).toContain("哺乳动物");
  });

  it("answers a query after teaching the same fact without a separator", () => {
    const engine = createSunlandEngine({});
    engine.process("记住猫属于哺乳动物");

    expect(engine.process("猫属于什么").response).toContain("哺乳动物");
  });

  it("forgets the cue but keeps the sentence that is about the cue", () => {
    const engine = createSunlandEngine({});
    engine.process("记住这个事实很重要");

    // Nothing was taught, and in particular no fact was invented with
    // "记住这个事实" or a fragment of it as the subject.
    expect(
      engine.knowledgeStore.all().some((record) => record.subject.includes("记住")),
    ).toBe(false);
  });

  it("stores the canonical is-a triple for the 一种 phrasing", () => {
    const engine = createSunlandEngine({});
    engine.process("猫是一种哺乳动物");

    expect(
      engine.knowledgeStore
        .all()
        .map((record) => `${record.relation}|${record.object}`),
    ).toEqual(["属于|哺乳动物"]);
    expect(engine.process("猫属于什么").response).toContain("哺乳动物");
  });

  it("keeps identity statements distinct from classification", () => {
    const engine = createSunlandEngine({});
    engine.process("苏格拉底是人");

    expect(
      engine.knowledgeStore
        .all()
        .map((record) => `${record.relation}|${record.object}`),
    ).toEqual(["是|人"]);
  });

  it("learns a name behind a teaching cue", () => {
    const engine = createSunlandEngine({});
    engine.process("记住 我叫小明");

    expect(engine.memory.recall("name")?.value).toBe("小明");
  });

  it("does not duplicate a fact when the same snapshot is restored twice", () => {
    const taught = createSunlandEngine({});
    taught.process("猫属于哺乳动物");
    const snapshot = taught.knowledgeStore.all();

    const restored = createSunlandEngine({});
    restored.knowledgeStore.addMany(snapshot);
    restored.knowledgeStore.addMany(snapshot);

    expect(restored.knowledgeStore.all()).toHaveLength(1);
    expect(restored.process("猫属于什么").response).toContain("哺乳动物");
  });

  describe("entities containing spaces (A.6c)", () => {
    it("answers a spaced entity from a query the Legacy grammar compacted", () => {
      // The Legacy query grammar deletes whitespace, so a question about
      // "Alice Chen" arrives as "AliceChen" while the taught subject kept its
      // space. Before the entity lookup key existed, the fact was stored and
      // then unreachable.
      const engine = createSunlandEngine({ personalityId: "plain" });
      engine.process("Alice Chen 属于 Furry Club");

      expect(engine.process("Alice Chen属于什么").response).toContain("Furry Club");
      expect(engine.process("AliceChen属于什么").response).toContain("Furry Club");
      expect(engine.process("Alice Chen 属于什么").response).toContain("Furry Club");
    });

    it("keeps the stored and displayed entity exactly as taught", () => {
      const engine = createSunlandEngine({ personalityId: "plain" });
      engine.process("Alice Chen 属于 Furry Club");

      const [record] = engine.knowledgeStore.all();
      expect(record?.subject).toBe("Alice Chen");
      expect(record?.object).toBe("Furry Club");
    });

    it("still answers unspaced Chinese entities", () => {
      const engine = createSunlandEngine({ personalityId: "plain" });
      engine.process("猫 属于 哺乳动物");
      expect(engine.process("猫属于什么").response).toContain("哺乳动物");
    });

    it("does not merge two entities that differ by something other than whitespace", () => {
      const engine = createSunlandEngine({ personalityId: "plain" });
      engine.process("Alice Chen 属于 Furry Club");

      // Lookup-key matching is whitespace-only by explicit decision: a
      // different name must stay a different entity.
      expect(engine.process("Alicia属于什么").response).not.toContain("Furry Club");
    });
  });
});
