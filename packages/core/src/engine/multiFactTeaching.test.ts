import { describe, expect, it } from "vitest";
import type { KnowledgeRecord, StorageAdapter } from "@/types";
import { createSunlandEngine } from "./sunlandEngine";

/**
 * B.8 — bounded multi-fact teaching.
 *
 * The invariant under test throughout: B.8 relaxes how many valid facts one turn
 * may contain, never what counts as a valid fact. Every segment goes through the
 * same canonicalization, parser and safety gate as a single-fact turn, and the
 * whole turn is atomic.
 */
function facts(engine: ReturnType<typeof createSunlandEngine>): string[] {
  return engine.knowledgeStore
    .all()
    .map((record) => `${record.subject}|${record.relation}|${record.object}|neg=${record.negated}`);
}

/** A StorageAdapter that records writes and can be made to fail on demand. */
class CountingStorage implements StorageAdapter {
  readonly writes: { key: string; value: string }[] = [];
  failOnWrite = false;
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failOnWrite) throw new Error("persist rejected");
    this.writes.push({ key, value });
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("multi-fact teaching: supported forms", () => {
  it.each([
    ["猫喜欢鱼，狗喜欢肉", ["猫|喜欢|鱼|neg=false", "狗|喜欢|肉|neg=false"]],
    ["猫会飞。猫会游泳", ["猫|会|飞|neg=false", "猫|会|游泳|neg=false"]],
    ["猫会飞；猫会游泳", ["猫|会|飞|neg=false", "猫|会|游泳|neg=false"]],
    ["猫会飞, 猫会游泳", ["猫|会|飞|neg=false", "猫|会|游泳|neg=false"]],
  ])("teaches both facts from '%s'", (input, expected) => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process(input);
    expect(facts(engine).sort()).toEqual([...expected].sort());
  });

  it("completes a continuation segment's subject from the previous clause", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    const result = engine.process("猫会飞，也会游泳");

    expect(facts(engine)).toEqual(["猫|会|飞|neg=false", "猫|会|游泳|neg=false"]);
    expect(result.response).toContain("猫 会 游泳");
    // The marker must never become a subject.
    expect(facts(engine).some((fact) => fact.startsWith("也|"))).toBe(false);
  });

  it.each(["也", "还", "同样"])("supports the '%s' continuation marker", (marker) => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process(`猫会飞，${marker}会游泳`);
    expect(facts(engine)).toEqual(["猫|会|飞|neg=false", "猫|会|游泳|neg=false"]);
  });

  it("repairs a shared marker the parser folded into the subject", () => {
    // "鸟也不会飞" parses with subject "鸟也"; the marker is shared between the
    // two clauses rather than an ellipsis, so the subject is repaired to "鸟".
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫不会飞，鸟也不会飞");

    expect(facts(engine).sort()).toEqual(["猫|会|飞|neg=true", "鸟|会|飞|neg=true"]);
    expect(facts(engine).some((fact) => fact.includes("也|"))).toBe(false);
  });
});

describe("entity integrity: markers must never truncate a name", () => {
  it("keeps 也门 intact — a marker character is not a continuation", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("也门属于亚洲");

    // The country name must survive whole. A prefix strip would have produced
    // marker "也" plus the bogus subject "门".
    expect(facts(engine)).toEqual(["也门|属于|亚洲|neg=false"]);
    expect(facts(engine).some((fact) => fact.startsWith("门|"))).toBe(false);
  });

  it("keeps 也门 intact when it is the second clause", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫会飞，也门属于亚洲");

    expect(facts(engine).sort()).toEqual([
      "也门|属于|亚洲|neg=false",
      "猫|会|飞|neg=false",
    ]);
  });

  it("never stores a garbage subject made of a continuation marker", () => {
    for (const input of [
      "猫会飞，也会游泳",
      "猫会飞，还会游泳",
      "猫会飞，同样会游泳",
      "猫不会飞，鸟也不会飞",
      "猫会飞，也门属于亚洲",
    ]) {
      const engine = createSunlandEngine({ personalityId: "plain" });
      engine.process(input);
      for (const record of engine.knowledgeStore.all()) {
        expect(
          ["也", "还", "同样"].includes(record.subject),
          `"${input}" stored a marker as a subject: ${record.subject}`,
        ).toBe(false);
        expect(record.subject.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("multi-fact feedback matches the store", () => {
  it("reports a fact repeated inside one turn as already known", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    const result = engine.process("猫会飞，猫会飞");

    const lines = result.response.split("\n");
    expect(lines[0]).toContain("已记录");
    expect(lines[1]).toContain("未重复记录");
    // And the store really holds exactly one copy.
    expect(facts(engine)).toEqual(["猫|会|飞|neg=false"]);
  });

  it("writes both polarities and reports the second as a related fact, not an update", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    const result = engine.process("猫会飞，猫不会飞");

    expect(facts(engine).sort()).toEqual(["猫|会|飞|neg=false", "猫|会|飞|neg=true"]);
    expect(result.response).toContain("已记录新的相关事实");
    expect(result.response).toContain("仍保留");
    expect(result.response).not.toMatch(/已更新|已覆盖|已替换/u);
  });

  it("exposes one learned entry per fact", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    const result = engine.process("猫喜欢鱼，狗喜欢肉");

    expect(result.learnedFacts?.map((entry) => entry.outcome)).toEqual(["added", "added"]);
    expect(result.learnedFacts?.map((entry) => entry.record.object)).toEqual(["鱼", "肉"]);
  });
});

describe("multi-fact teaching: refused inputs write nothing", () => {
  it.each([
    ["5 segments", "猫会飞，猫会游泳，狗喜欢肉，鸟会飞，鱼会游"],
    ["question segment", "猫会飞，猫是什么"],
    ["question turn", "猫会飞吗，猫会游泳"],
    ["choice structure", "猫会飞或者猫会游泳"],
    ["unsupported connector", "猫会飞，而且会游泳"],
    ["first-person denial", "猫会飞，我不是小明"],
    ["prohibition in one clause", "不要记住猫会飞，猫会游泳"],
    ["incomplete segment", "猫会飞，猫不会"],
    ["trailing separator", "猫会飞，"],
    ["leading separator", "，猫会飞"],
    ["doubled separator", "猫会飞，，猫会游泳"],
    ["no separator at all", "猫会飞猫会游泳"],
    ["enumerating comma", "猫、狗喜欢肉"],
    ["too long", `${"猫会飞，".repeat(30)}猫会游泳`],
  ])("refuses %s ('%s')", (_label, input) => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process(input);
    expect(engine.knowledgeStore.all(), `${input} produced a write`).toEqual([]);
    expect(engine.memory.list()).toEqual([]);
  });

  it("refuses a lone continuation segment with no clause to continue", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("也会游泳");
    expect(engine.knowledgeStore.all()).toEqual([]);
  });

  it("refuses a segment that still contains a separator (splitting is one level)", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    // The third piece would itself be a two-fact clause; only one level is split,
    // so the leftover separator makes that segment fail and the turn is refused.
    engine.process("猫会飞，猫会游泳");
    const before = facts(engine);
    engine.process("猫会飞。猫会游泳，狗喜欢肉。");
    expect(facts(engine)).toEqual(before);
  });
});

describe("atomicity (P0): a failed turn leaves the brain untouched", () => {
  function taughtEngine(): ReturnType<typeof createSunlandEngine> {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("鸟会飞");
    return engine;
  }

  it("keeps store.all() deep-equal when a later segment is invalid", () => {
    const engine = taughtEngine();
    const before: readonly KnowledgeRecord[] = engine.knowledgeStore.all();

    engine.process("猫喜欢鱼，狗喜欢肉，猫不会");

    expect(engine.knowledgeStore.all()).toEqual(before);
  });

  it("keeps store.all() deep-equal when the turn is refused by the envelope", () => {
    const engine = taughtEngine();
    const before = engine.knowledgeStore.all();

    engine.process("不要记住猫喜欢鱼，狗喜欢肉");

    expect(engine.knowledgeStore.all()).toEqual(before);
  });

  it("keeps store.all() deep-equal when persistence REJECTS the write", () => {
    // The P0 case: the in-memory store is written first, so a persist failure
    // must be rolled back rather than leaving a partially taught brain behind.
    const storage = new CountingStorage();
    const engine = createSunlandEngine({
      personalityId: "plain",
      storage: { adapter: storage, key: "brain" },
    });
    engine.process("鸟会飞");
    const before = engine.knowledgeStore.all();

    storage.failOnWrite = true;
    expect(() => engine.process("猫喜欢鱼，狗喜欢肉")).toThrow();

    storage.failOnWrite = false;
    expect(engine.knowledgeStore.all()).toEqual(before);
  });

  it("rolls back Memory too when persistence rejects", () => {
    const storage = new CountingStorage();
    const engine = createSunlandEngine({
      personalityId: "plain",
      storage: { adapter: storage, key: "brain" },
    });

    storage.failOnWrite = true;
    expect(() => engine.process("猫喜欢鱼，狗喜欢肉")).toThrow();
    storage.failOnWrite = false;

    expect(engine.memory.list()).toEqual([]);
    expect(engine.knowledgeStore.all()).toEqual([]);
  });

  it("leaves no partial state when a segment throws during processing", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    const before = engine.knowledgeStore.all();

    // A segment that parses as a statement but is blocked at the write gate.
    engine.process("猫喜欢鱼，我不是小明");

    expect(engine.knowledgeStore.all()).toEqual(before);
  });
});

describe("single persistence per turn", () => {
  it("writes the knowledge snapshot once for two facts", () => {
    const storage = new CountingStorage();
    const engine = createSunlandEngine({
      personalityId: "plain",
      storage: { adapter: storage, key: "brain" },
    });

    engine.process("猫喜欢鱼，狗喜欢肉");

    const knowledgeWrites = storage.writes.filter((write) => write.key === "brain");
    expect(knowledgeWrites).toHaveLength(1);
    // And that single snapshot carries both facts.
    const persisted = JSON.parse(knowledgeWrites[0]!.value) as readonly KnowledgeRecord[];
    expect(persisted.map((record) => record.object).sort()).toEqual(["肉", "鱼"]);
  });

  it("writes once for a single-fact turn too", () => {
    const storage = new CountingStorage();
    const engine = createSunlandEngine({
      personalityId: "plain",
      storage: { adapter: storage, key: "brain" },
    });

    engine.process("猫喜欢鱼");

    expect(storage.writes.filter((write) => write.key === "brain")).toHaveLength(1);
  });
});

describe("multi-fact does not capture ordinary conversation", () => {
  it.each([
    "你好，我叫小明",
    "考试没考好，有点难受",
    "我今天很开心，也有点累",
    "这个 bug 我搞了一下午还是不行，你帮我看看为什么",
  ])("leaves '%s' to the normal pipeline", (input) => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    const result = engine.process(input);
    // Not reported as a multi-fact teaching turn...
    expect(result.learnedFacts).toBeUndefined();
    // ...and no world facts were invented from a conversational turn.
    expect(
      engine.knowledgeStore.all().filter((record) => record.relation !== "意思是"),
      `"${input}" wrote knowledge`,
    ).toEqual([]);
  });
});

describe("multi-fact bounds", () => {
  it("accepts exactly the maximum number of facts", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫会飞，猫会游泳，狗喜欢肉，鸟会飞");
    expect(facts(engine)).toHaveLength(4);
  });

  it("refuses one fact more than the maximum", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫会飞，猫会游泳，狗喜欢肉，鸟会飞，鱼喜欢水");
    expect(engine.knowledgeStore.all()).toEqual([]);
  });

  it("is idempotent across repeated turns", () => {
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("猫喜欢鱼，狗喜欢肉");
    const after = facts(engine);
    const second = engine.process("猫喜欢鱼，狗喜欢肉");

    expect(facts(engine)).toEqual(after);
    expect(second.response).toContain("未重复记录");
  });
});
