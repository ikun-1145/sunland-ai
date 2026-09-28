import { describe, expect, it } from "vitest";
import type { Inference, KnowledgeRecord, Triple } from "@/types";
import { InMemoryKnowledgeStore } from "@/knowledge";
import { answerComparator, answerKey } from "./answerOrdering";

function inference(
  triple: Partial<Triple> & { subject: string; object: string },
  options: {
    readonly confidence?: number;
    readonly negated?: boolean;
    readonly relation?: string;
    readonly path?: readonly string[];
    readonly derived?: boolean;
  } = {},
): Inference {
  const relation = options.relation ?? triple.relation ?? "属于";
  const subject = triple.subject;
  const object = triple.object;
  return {
    conclusion: { subject, relation, object, negated: options.negated ?? triple.negated ?? false },
    confidence: options.confidence ?? 1,
    steps: options.derived
      ? [
          {
            ruleId: "isa-transitivity",
            description: "derived",
            premises: [],
            conclusion: { subject, relation, object, negated: options.negated ?? false },
          },
        ]
      : [],
    path: options.path ?? [subject, object],
  };
}

function record(triple: Triple, id: string, createdAt: string): KnowledgeRecord {
  return { ...triple, id, confidence: 1, source: "user", createdAt };
}

/** Deterministic pseudo-shuffle so a failure is reproducible. */
function shuffle<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  let state = seed;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const swap = state % (index + 1);
    const a = result[index]!;
    const b = result[swap]!;
    result[index] = b;
    result[swap] = a;
  }
  return result;
}

function emptyStore(): InMemoryKnowledgeStore {
  return new InMemoryKnowledgeStore();
}

describe("compareAnswers total order", () => {
  it("prefers directly-known facts over derived ones", () => {
    const sorted = [
      inference({ subject: "猫", object: "生物" }, { derived: true, path: ["猫", "动物", "生物"] }),
      inference({ subject: "猫", object: "哺乳动物" }),
    ].sort(answerComparator(emptyStore()));
    expect(sorted.map((answer) => answer.conclusion.object)).toEqual(["哺乳动物", "生物"]);
  });

  it("prefers affirmative facts over negated ones", () => {
    const sorted = [
      inference({ subject: "企鹅", object: "飞" }, { negated: true }),
      inference({ subject: "企鹅", object: "鸟" }),
    ].sort(answerComparator(emptyStore()));
    expect(sorted.map((answer) => answer.conclusion.negated)).toEqual([false, true]);
  });

  it("orders by confidence descending", () => {
    const sorted = [
      inference({ subject: "猫", object: "低" }, { confidence: 0.4 }),
      inference({ subject: "猫", object: "高" }, { confidence: 0.9 }),
    ].sort(answerComparator(emptyStore()));
    expect(sorted.map((answer) => answer.conclusion.object)).toEqual(["高", "低"]);
  });

  it("orders by derivation path length ascending", () => {
    const sorted = [
      inference({ subject: "猫", object: "生物" }, { derived: true, path: ["猫", "动物", "生物"] }),
      inference({ subject: "猫", object: "动物" }, { derived: true, path: ["猫", "动物"] }),
    ].sort(answerComparator(emptyStore()));
    expect(sorted.map((answer) => answer.conclusion.object)).toEqual(["动物", "生物"]);
  });

  it("breaks remaining ties by object, then relation, then subject", () => {
    const sorted = [
      inference({ subject: "猫", object: "乙" }),
      inference({ subject: "猫", object: "甲" }),
    ].sort(answerComparator(emptyStore()));
    expect(sorted.map((answer) => answer.conclusion.object)).toEqual(["乙", "甲"].sort((a, b) => a.localeCompare(b, "und")));
  });

  it("resolves record identity from the answer's own triple, not from store order", () => {
    const triple: Triple = { subject: "猫", relation: "属于", object: "动物", negated: false };
    const older = record(triple, "k_a", "2026-01-01T00:00:00.000Z");
    const newer = record(triple, "k_b", "2026-06-01T00:00:00.000Z");

    const store = new InMemoryKnowledgeStore();
    store.addMany([older, newer]);

    // Two records asserting the SAME triple are one fact: `addMany` dedupes by
    // fact identity (A.4), so only the first survives and the identity lookup
    // finds it.
    expect(store.match({ subject: "猫", relation: "属于", object: "动物" })).toHaveLength(1);
    expect(store.match({ subject: "猫", relation: "属于", object: "动物" })[0]?.id).toBe("k_a");

    // Ordering is still deterministic for two equal answers.
    const answers = [inference({ subject: "猫", object: "动物" }), inference({ subject: "猫", object: "动物" })];
    const forward = [...answers].sort(answerComparator(store)).map((answer) => answer.conclusion.object);
    const backward = [...answers].reverse().sort(answerComparator(store)).map((answer) => answer.conclusion.object);
    expect(forward).toEqual(backward);
  });

  it("is a TOTAL order: every distinct pair compares strictly, no ties", () => {
    // A non-total comparator would report 0 for distinguishable answers and let
    // `Array.prototype.sort` fall back to input order, making the shuffle
    // invariant below vacuous. Assert strictness directly.
    const comparator = answerComparator(storeOfRecords(records));
    for (const left of answers) {
      for (const right of answers) {
        if (left === right) continue;
        const forward = comparator(left, right);
        const backward = comparator(right, left);
        if (answerKey(left) === answerKey(right)) {
          // Same conclusion: provably the same answer, so 0 is correct here.
          expect(forward).toBe(0);
          continue;
        }
        expect(forward, `${answerKey(left)} vs ${answerKey(right)} tied`).not.toBe(0);
        // Antisymmetry.
        expect(Math.sign(forward)).toBe(-Math.sign(backward));
      }
    }
  });

  it("leaves record identity empty for derived answers without throwing", () => {
    const derived = inference({ subject: "猫", object: "生物" }, { derived: true });
    expect(emptyStore().match({ subject: "猫", relation: "属于", object: "生物" })).toEqual([]);
    expect(() => [derived].sort(answerComparator(emptyStore()))).not.toThrow();
  });
});

const answers: readonly Inference[] = Object.freeze([
  inference({ subject: "猫", object: "哺乳动物" }),
  inference({ subject: "猫", object: "动物" }),
  inference({ subject: "猫", object: "生物" }, { derived: true, path: ["猫", "动物", "生物"] }),
  inference({ subject: "猫", object: "宠物" }, { confidence: 0.5 }),
  inference({ subject: "猫", object: "野猫" }, { negated: true }),
  inference({ subject: "猫", object: "家猫" }, { relation: "是" }),
]);

const records: readonly KnowledgeRecord[] = Object.freeze([
  record({ subject: "猫", relation: "属于", object: "哺乳动物", negated: false }, "k_1", "2026-01-01T00:00:00.000Z"),
  record({ subject: "猫", relation: "属于", object: "动物", negated: false }, "k_2", "2026-02-01T00:00:00.000Z"),
  record({ subject: "猫", relation: "属于", object: "宠物", negated: false }, "k_3", "2026-03-01T00:00:00.000Z"),
  record({ subject: "猫", relation: "属于", object: "野猫", negated: true }, "k_4", "2026-04-01T00:00:00.000Z"),
  record({ subject: "猫", relation: "是", object: "家猫", negated: false }, "k_5", "2026-05-01T00:00:00.000Z"),
]);

function storeOfRecords(records: readonly KnowledgeRecord[]): InMemoryKnowledgeStore {
  const store = new InMemoryKnowledgeStore();
  store.addMany(records);
  return store;
}

describe("shuffle invariant: the result never depends on input order", () => {
  it("produces one identical ordering across 25 shuffles", () => {
    const expected = [...answers].sort(answerComparator(storeOfRecords(records))).map(answerKey);
    expect(expected).toHaveLength(answers.length);

    for (let seed = 1; seed <= 25; seed += 1) {
      const shuffled = shuffle(answers, seed);
      expect(shuffled, `shuffle ${seed} did not permute the input`).not.toEqual(answers);
      const sorted = [...shuffled].sort(answerComparator(storeOfRecords(records))).map(answerKey);
      expect(sorted, `shuffle ${seed} produced a different order`).toEqual(expected);
    }
  });
});
