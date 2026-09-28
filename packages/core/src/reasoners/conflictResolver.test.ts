import { describe, expect, it } from "vitest";
import { InMemoryKnowledgeStore } from "@/knowledge";
import type { Inference, KnowledgeRecord, KnowledgeSource, Triple } from "@/types";
import { answerGraphQuery } from "@/reasoners";
import { resolveConflicts } from "./conflictResolver";
import { SOURCE_AUTHORITY, sourceAuthority } from "./sourceAuthority";

function record(
  subject: string,
  relation: string,
  object: string,
  negated: boolean,
  options: { source?: KnowledgeSource; createdAt?: string; confidence?: number; id?: string } = {},
): KnowledgeRecord {
  return {
    subject,
    relation,
    object,
    negated,
    id: options.id ?? `k_${subject}_${object}_${negated ? "n" : "p"}`,
    confidence: options.confidence ?? 1,
    source: options.source ?? "user",
    createdAt: options.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

function direct(rec: KnowledgeRecord, confidence = rec.confidence): Inference {
  return {
    conclusion: {
      subject: rec.subject,
      relation: rec.relation,
      object: rec.object,
      negated: rec.negated,
    },
    confidence,
    steps: [],
    path: [rec.subject, rec.object],
  };
}

function derived(triple: Triple, confidence = 1): Inference {
  return {
    conclusion: triple,
    confidence,
    steps: [
      {
        ruleId: "isa-transitivity",
        description: "derived",
        premises: [],
        conclusion: triple,
      },
    ],
    path: [triple.subject, "x", triple.object],
  };
}

function storeOf(...records: readonly KnowledgeRecord[]): InMemoryKnowledgeStore {
  const store = new InMemoryKnowledgeStore();
  store.addMany(records);
  return store;
}

function outcomes(answers: readonly Inference[], store: InMemoryKnowledgeStore) {
  const resolved = resolveConflicts(answers, store);
  return {
    kept: resolved.answers.map((answer) => `${answer.conclusion.negated ? "not-" : ""}${answer.conclusion.object}`),
    strategies: resolved.conflicts.map((conflict) => conflict.strategy),
    conflicts: resolved.conflicts,
  };
}

describe("source authority is defined in exactly one place", () => {
  it("ranks user > import > seed > inference and covers the real enum", () => {
    expect(SOURCE_AUTHORITY).toEqual({ user: 3, import: 2, seed: 1, inference: 0 });
    expect(sourceAuthority("user")).toBeGreaterThan(sourceAuthority("import"));
    expect(sourceAuthority("import")).toBeGreaterThan(sourceAuthority("seed"));
    expect(sourceAuthority("seed")).toBeGreaterThan(sourceAuthority("inference"));
  });
});

describe("polarity symmetry: the newer fact wins in BOTH teaching orders", () => {
  it("negated first, then positive: the positive wins", () => {
    const older = record("猫", "会", "飞", true, { createdAt: "2026-01-01T00:00:00.000Z", id: "k_neg" });
    const newer = record("猫", "会", "飞", false, { createdAt: "2026-06-01T00:00:00.000Z", id: "k_pos" });
    const result = outcomes([direct(older), direct(newer)], storeOf(older, newer));

    expect(result.kept).toEqual(["飞"]);
    expect(result.strategies).toEqual(["more-recent"]);
    expect(result.conflicts[0]?.winner.negated).toBe(false);
    expect(result.conflicts[0]?.suppressed[0]?.negated).toBe(true);
  });

  it("positive first, then negated: the negated wins", () => {
    const older = record("猫", "会", "飞", false, { createdAt: "2026-01-01T00:00:00.000Z", id: "k_pos" });
    const newer = record("猫", "会", "飞", true, { createdAt: "2026-06-01T00:00:00.000Z", id: "k_neg" });
    const result = outcomes([direct(older), direct(newer)], storeOf(older, newer));

    expect(result.kept).toEqual(["not-飞"]);
    expect(result.strategies).toEqual(["more-recent"]);
    expect(result.conflicts[0]?.winner.negated).toBe(true);
    expect(result.conflicts[0]?.suppressed[0]?.negated).toBe(false);
  });

  it("is symmetric: swapping ONLY the timestamps swaps ONLY the winner", () => {
    const positive = record("猫", "会", "飞", false, { createdAt: "2026-06-01T00:00:00.000Z", id: "k_a" });
    const negative = record("猫", "会", "飞", true, { createdAt: "2026-01-01T00:00:00.000Z", id: "k_b" });
    const positiveNewer = outcomes([direct(positive), direct(negative)], storeOf(positive, negative));

    const positiveOld = record("猫", "会", "飞", false, { createdAt: "2026-01-01T00:00:00.000Z", id: "k_a" });
    const negativeNew = record("猫", "会", "飞", true, { createdAt: "2026-06-01T00:00:00.000Z", id: "k_b" });
    const negativeNewer = outcomes([direct(positiveOld), direct(negativeNew)], storeOf(positiveOld, negativeNew));

    expect(positiveNewer.conflicts[0]?.winner.negated).toBe(false);
    expect(negativeNewer.conflicts[0]?.winner.negated).toBe(true);
    // Same rule both times: polarity is not a criterion.
    expect(positiveNewer.strategies).toEqual(negativeNewer.strategies);
  });
});

describe("direct outranks derived regardless of polarity", () => {
  it("direct positive beats derived negative", () => {
    const directRec = record("猫", "会", "飞", false, { createdAt: "2026-01-01T00:00:00.000Z" });
    const result = outcomes(
      [direct(directRec), derived({ subject: "猫", relation: "会", object: "飞", negated: true })],
      storeOf(directRec),
    );

    expect(result.kept).toEqual(["飞"]);
    expect(result.strategies).toEqual(["direct-over-derived"]);
    expect(result.conflicts[0]?.winner.negated).toBe(false);
  });

  it("direct negative beats derived positive, even when the derivation is more confident", () => {
    const directRec = record("企鹅", "会", "飞", true, { createdAt: "2026-01-01T00:00:00.000Z", confidence: 0.3 });
    const result = outcomes(
      [direct(directRec, 0.3), derived({ subject: "企鹅", relation: "会", object: "飞", negated: false }, 0.99)],
      storeOf(directRec),
    );

    expect(result.kept).toEqual(["not-飞"]);
    expect(result.strategies).toEqual(["direct-over-derived"]);
    expect(result.conflicts[0]?.winner.negated).toBe(true);
  });
});

describe("the remaining winner keys, in order", () => {
  const sameTime = "2026-01-01T00:00:00.000Z";

  it("higher confidence outranks source and recency", () => {
    const low = record("猫", "会", "飞", false, { source: "user", confidence: 0.4, createdAt: sameTime, id: "k_p" });
    const high = record("猫", "会", "飞", true, { source: "seed", confidence: 0.9, createdAt: sameTime, id: "k_n" });
    const result = outcomes([direct(low, 0.4), direct(high, 0.9)], storeOf(low, high));

    expect(result.strategies).toEqual(["higher-confidence"]);
    expect(result.conflicts[0]?.winner.negated).toBe(true);
  });

  it("source authority decides when confidence ties", () => {
    const user = record("猫", "会", "飞", false, { source: "user", confidence: 1, createdAt: sameTime, id: "k_p" });
    const seed = record("猫", "会", "飞", true, { source: "seed", confidence: 1, createdAt: sameTime, id: "k_n" });
    const result = outcomes([direct(user), direct(seed)], storeOf(user, seed));

    expect(result.strategies).toEqual(["source-authority"]);
    expect(result.conflicts[0]?.winner.negated).toBe(false);
  });

  it("falls back to id only when every other key ties, and does so deterministically", () => {
    const a = record("猫", "会", "飞", false, { source: "user", confidence: 1, createdAt: sameTime, id: "k_aaa" });
    const b = record("猫", "会", "飞", true, { source: "user", confidence: 1, createdAt: sameTime, id: "k_bbb" });

    const forward = outcomes([direct(a), direct(b)], storeOf(a, b));
    const backward = outcomes([direct(b), direct(a)], storeOf(a, b));

    expect(forward.strategies).toEqual(["total-order-id"]);
    // `winner` is a Triple (no id); with every other key tied, `id ASC` decides,
    // so the lower id (k_aaa, the positive record) wins.
    expect(forward.conflicts[0]?.winner.negated).toBe(false);
    // Input order must not matter.
    expect(backward.conflicts[0]?.winner).toEqual(forward.conflicts[0]?.winner);
    expect(backward.kept).toEqual(forward.kept);
  });
});

describe("what is NOT a conflict", () => {
  it("same relation, different object: both coexist and nothing is suppressed", () => {
    const fly = record("猫", "会", "飞", false);
    const swim = record("猫", "会", "游泳", false);
    const result = outcomes([direct(fly), direct(swim)], storeOf(fly, swim));

    // Both retained; the display ORDER is B.6's concern, not the resolver's, so
    // assert membership rather than a locale-dependent sequence.
    expect([...result.kept].sort()).toEqual(["游泳", "飞"].sort());
    expect(result.kept).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
  });

  it("different subject or relation: no conflict", () => {
    const cat = record("猫", "会", "飞", false);
    const bird = record("鸟", "会", "飞", false);
    const likes = record("猫", "喜欢", "飞", false);
    const result = outcomes([direct(cat), direct(bird), direct(likes)], storeOf(cat, bird, likes));

    expect(result.conflicts).toEqual([]);
    expect(result.kept).toHaveLength(3);
  });

  it("same polarity repeated: not a conflict", () => {
    const first = record("猫", "会", "飞", false, { id: "k_1" });
    const second = record("猫", "会", "飞", false, { id: "k_2" });
    const result = outcomes([direct(first), direct(second)], storeOf(first, second));

    expect(result.conflicts).toEqual([]);
  });
});

describe("object entity identity matches A.6c (whitespace-only)", () => {
  it("treats a whitespace difference as the SAME proposition", () => {
    const spaced = record("Alice Chen", "会", "Furry Club", false, { createdAt: "2026-01-01T00:00:00.000Z", id: "k_p" });
    const compact = record("AliceChen", "会", "FurryClub", true, { createdAt: "2026-06-01T00:00:00.000Z", id: "k_n" });
    const result = outcomes([direct(spaced), direct(compact)], storeOf(spaced, compact));

    expect(result.conflicts).toHaveLength(1);
    expect(result.strategies).toEqual(["more-recent"]);
    expect(result.conflicts[0]?.winner.negated).toBe(true);
  });

  it("does NOT treat a non-whitespace difference as the same proposition", () => {
    const short = record("Alice", "会", "Furry Club", false, { id: "k_1" });
    const long = record("AliceChen", "会", "Furry Club", true, { id: "k_2" });
    const result = outcomes([direct(short), direct(long)], storeOf(short, long));

    expect(result.conflicts).toEqual([]);
    expect(result.kept).toHaveLength(2);
  });
});

describe("the store is never modified", () => {
  it("keeps every original fact, with its provenance, after adjudication", () => {
    const older = record("猫", "会", "飞", true, { source: "user", confidence: 0.7, createdAt: "2026-01-01T00:00:00.000Z", id: "k_neg" });
    const newer = record("猫", "会", "飞", false, { source: "user", confidence: 0.7, createdAt: "2026-06-01T00:00:00.000Z", id: "k_pos" });
    const store = storeOf(older, newer);
    const before = store.all();

    const result = outcomes([direct(older), direct(newer)], store);

    expect(result.conflicts).toHaveLength(1);
    // Deep equality: nothing deleted, no confidence change, no source rewrite,
    // no `updatedAt`/superseded marker, ids intact, order intact.
    expect(store.all()).toEqual(before);
    expect(store.all()).toHaveLength(2);
    expect(store.all().map((entry) => entry.id).sort()).toEqual(["k_neg", "k_pos"]);
  });

  it("suppressed facts remain individually retrievable from the store", () => {
    const older = record("猫", "会", "飞", true, { createdAt: "2026-01-01T00:00:00.000Z", id: "k_neg" });
    const newer = record("猫", "会", "飞", false, { createdAt: "2026-06-01T00:00:00.000Z", id: "k_pos" });
    const store = storeOf(older, newer);

    resolveConflicts([direct(older), direct(newer)], store);

    expect(store.has({ subject: "猫", relation: "会", object: "飞", negated: true })).toBe(true);
    expect(store.match({ subject: "猫", relation: "会", negated: true })).toHaveLength(1);
  });
});

describe("end-to-end through the reasoner", () => {
  const query = { type: "query", subject: "猫", relation: "会", kind: "object-of", raw: "" } as const;

  it("returns one answer plus an explainable conflict instead of two contradictory answers", () => {
    const older = record("猫", "会", "飞", true, { createdAt: "2026-01-01T00:00:00.000Z", id: "k_neg" });
    const newer = record("猫", "会", "飞", false, { createdAt: "2026-06-01T00:00:00.000Z", id: "k_pos" });
    const store = storeOf(older, newer);

    const result = answerGraphQuery(query, store).result;

    expect(result.answers).toHaveLength(1);
    expect(result.answers[0]?.conclusion.negated).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      strategy: "more-recent",
      winner: { subject: "猫", relation: "会", object: "飞", negated: false },
      suppressed: [{ subject: "猫", relation: "会", object: "飞", negated: true }],
    });
  });

  it("names the suppressed fact and the rule in the explanation", () => {
    const older = record("猫", "会", "飞", true, { createdAt: "2026-01-01T00:00:00.000Z", id: "k_neg" });
    const newer = record("猫", "会", "飞", false, { createdAt: "2026-06-01T00:00:00.000Z", id: "k_pos" });
    const result = answerGraphQuery(query, storeOf(older, newer)).result;

    // "what was suppressed, by what, and on what basis" -- all three present.
    expect(result.explanation).toContain("猫 不会 飞");
    expect(result.explanation).toContain("猫 会 飞");
    expect(result.explanation).toContain("以较新的记录为准");
  });

  it("every suppressed answer is accounted for in conflicts and absent from answers", () => {
    const older = record("猫", "会", "飞", true, { createdAt: "2026-01-01T00:00:00.000Z", id: "k_neg" });
    const newer = record("猫", "会", "飞", false, { createdAt: "2026-06-01T00:00:00.000Z", id: "k_pos" });
    const store = storeOf(older, newer);
    const result = answerGraphQuery(query, store).result;

    const answered = new Set(
      result.answers.map((answer) => `${answer.conclusion.object}|${answer.conclusion.negated}`),
    );
    const suppressed = result.conflicts.flatMap((conflict) => conflict.suppressed);
    expect(suppressed.length).toBeGreaterThan(0);
    for (const triple of suppressed) {
      // Held back from the answer set...
      expect(answered.has(`${triple.object}|${triple.negated}`)).toBe(false);
      // ...yet still stored, which is what makes the explanation checkable.
      expect(store.has(triple)).toBe(true);
    }
  });
});
