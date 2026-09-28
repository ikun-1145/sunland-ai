import { describe, expect, it } from "vitest";
import { InMemoryKnowledgeStore } from "@/knowledge";
import type { Inference, KnowledgeQuery, KnowledgeRecord, ParsedQuery } from "@/types";
import { answerGraphQuery } from "./graphReasoner";
import {
  CAPABILITY_PROPAGATION_RELATIONS,
  PROPAGATION_BUDGET,
  isPropagatingRelation,
} from "./capabilityPropagation";
import { compareAnswers } from "./answerOrdering";
import { derivedIdentity } from "./derivedIdentity";

type Fact = readonly [subject: string, relation: string, object: string, negated?: boolean, confidence?: number];

function storeOf(...facts: readonly Fact[]): InMemoryKnowledgeStore {
  const store = new InMemoryKnowledgeStore();
  for (const [subject, relation, object, negated = false, confidence = 1] of facts) {
    store.add({ subject, relation, object, negated }, { source: "user", confidence });
  }
  return store;
}

function ask(store: InMemoryKnowledgeStore, subject: string, relation: string, object?: string) {
  const query: ParsedQuery = {
    type: "query",
    subject,
    relation,
    kind: "object-of",
    ...(object === undefined ? {} : { object }),
    raw: "",
  };
  return answerGraphQuery(query, store).result;
}

function objects(answers: readonly Inference[]): string[] {
  return answers.map((answer) => `${answer.conclusion.negated ? "not-" : ""}${answer.conclusion.object}`);
}

/** Deterministic shuffle so any failure is reproducible. */
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

describe("whitelist is the single source of truth", () => {
  it("contains exactly 会 and 有", () => {
    expect(Object.isFrozen(CAPABILITY_PROPAGATION_RELATIONS)).toBe(true);
    expect([...CAPABILITY_PROPAGATION_RELATIONS].sort()).toEqual(["会", "有"]);
  });

  it.each(["喜欢", "在", "意思是", "是", "属于", "爱", ""])(
    "refuses '%s'",
    (relation) => {
      expect(isPropagatingRelation(relation)).toBe(false);
    },
  );

  it("value range is disjoint from is-a, so isa and capability cannot duplicate", () => {
    // isaTransitivity answers only 属于; capability answers only the whitelist.
    expect(CAPABILITY_PROPAGATION_RELATIONS).not.toContain("属于");
  });
});

describe("propagation matrix (1-5, 13-17)", () => {
  it("1. single-hop positive capability 'can'", () => {
    const result = ask(storeOf(["鸟", "会", "飞"], ["企鹅", "属于", "鸟"]), "企鹅", "会");
    expect(objects(result.answers)).toEqual(["飞"]);
    expect(result.answers[0]?.conclusion.negated).toBe(false);
    expect(result.answers[0]?.steps.length).toBeGreaterThan(0);
  });

  it("2. single-hop negative capability 'can' — symmetric", () => {
    const result = ask(storeOf(["鸟", "会", "飞", true], ["企鹅", "属于", "鸟"]), "企鹅", "会");
    expect(objects(result.answers)).toEqual(["not-飞"]);
  });

  it("3. single-hop positive capability 'has'", () => {
    const result = ask(storeOf(["鸟", "有", "翅膀"], ["企鹅", "属于", "鸟"]), "企鹅", "有");
    expect(objects(result.answers)).toEqual(["翅膀"]);
  });

  it("4. single-hop negative capability 'has' (grammar-supported form: 没有)", () => {
    const result = ask(storeOf(["鸟", "有", "翅膀", true], ["企鹅", "属于", "鸟"]), "企鹅", "有");
    expect(objects(result.answers)).toEqual(["not-翅膀"]);
  });

  it("5. two-level is-a + capability, with complete provenance", () => {
    const result = ask(
      storeOf(["企鹅", "属于", "海鸟"], ["海鸟", "属于", "鸟"], ["鸟", "会", "飞"]),
      "企鹅",
      "会",
    );
    const answer = result.answers[0]!;
    expect(objects(result.answers)).toEqual(["飞"]);
    expect(answer.path).toEqual(["企鹅", "海鸟", "鸟", "飞"]);
    expect(answer.steps.map((step) => step.ruleId)).toEqual([
      "isa-transitivity",
      "capability-propagation",
    ]);
    // The capability step must name the ancestor fact it consumed.
    const last = answer.steps.at(-1)!;
    expect(last.premises).toContainEqual({
      subject: "鸟",
      relation: "会",
      object: "飞",
      negated: false,
    });
  });

  it("13-15. 喜欢 / 在 / 意思是 never propagate", () => {
    for (const [relation, object] of [["喜欢", "水"], ["在", "地球"], ["意思是", "动物"]] as const) {
      const result = ask(
        storeOf(["猫", "属于", "哺乳动物"], ["哺乳动物", relation, object]),
        "猫",
        relation,
      );
      expect(objects(result.answers), `${relation} propagated`).toEqual([]);
    }
  });

  it("15b. 是 is not propagated either — it is only the pre-existing read fallback", () => {
    // `是` is deliberately OUTSIDE the whitelist. A query for `猫 是 什么` can
    // still answer, but via the pre-existing `是 <-> 属于` relation-alignment
    // fallback reading the DIRECT fact `猫 属于 哺乳动物` — never by inheriting
    // `哺乳动物 是 动物`. The answer must therefore be a direct, underived fact.
    const result = ask(
      storeOf(["猫", "属于", "哺乳动物"], ["哺乳动物", "是", "动物"]),
      "猫",
      "是",
    );
    expect(objects(result.answers)).toEqual(["哺乳动物"]);
    expect(result.answers[0]?.steps).toEqual([]);
    expect(isPropagatingRelation("是")).toBe(false);
  });

  it("16. a member's exception never contaminates its class", () => {
    const result = ask(
      storeOf(["企鹅", "属于", "鸟"], ["企鹅", "会", "飞", true]),
      "鸟",
      "会",
    );
    expect(objects(result.answers)).toEqual([]);
  });

  it("17. a member's exception never contaminates a sibling", () => {
    const result = ask(
      storeOf(["企鹅", "属于", "鸟"], ["麻雀", "属于", "鸟"], ["企鹅", "会", "飞", true]),
      "麻雀",
      "会",
    );
    expect(objects(result.answers)).toEqual([]);
  });

  it("does not confuse same relation different objects", () => {
    const result = ask(
      storeOf(["鸟", "会", "飞"], ["鸟", "会", "游泳"], ["企鹅", "属于", "鸟"]),
      "企鹅",
      "会",
    );
    expect(objects(result.answers).sort()).toEqual(["游泳", "飞"].sort());
    expect(result.conflicts).toEqual([]);
  });
});

describe("bounds and cycles (6, 7, 8, 22)", () => {
  it("6. stops exactly at maxPropagationDepth", () => {
    const facts: Fact[] = [["A0", "属于", "A1"]];
    for (let index = 2; index <= PROPAGATION_BUDGET.maxDepth + 3; index += 1) {
      facts.push([`A${index - 1}`, "属于", `A${index}`]);
    }
    const deep = `A${PROPAGATION_BUDGET.maxDepth + 3}`;
    const result = ask(storeOf(...facts, [deep, "会", "X"]), "A0", "会");
    // X sits one hop BEYOND the budget, so it must not be derived.
    expect(objects(result.answers)).toEqual([]);

    // One hop closer, i.e. exactly at the budget, it must be derived.
    const atLimit = `A${PROPAGATION_BUDGET.maxDepth}`;
    const within = ask(storeOf(...facts, [atLimit, "会", "Y"]), "A0", "会");
    expect(objects(within.answers)).toEqual(["Y"]);
  });

  it("7. terminates on an is-a cycle without duplicating", () => {
    const result = ask(
      storeOf(["A", "属于", "B"], ["B", "属于", "C"], ["C", "属于", "A"], ["C", "会", "X"]),
      "A",
      "会",
    );
    expect(objects(result.answers)).toEqual(["X"]);
  });

  it("7b. terminates on a self loop", () => {
    const result = ask(storeOf(["A", "属于", "A"], ["A", "会", "X"]), "A", "会");
    expect(objects(result.answers)).toEqual(["X"]);
  });

  it("8. a diamond produces ONE derivation via the shortest path", () => {
    // A -> B -> D and A -> C -> D -> E (longer); D 会 X reachable via both.
    const result = ask(
      storeOf(["A", "属于", "B"], ["A", "属于", "C"], ["B", "属于", "D"], ["C", "属于", "D"], ["D", "会", "X"]),
      "A",
      "会",
    );
    expect(objects(result.answers)).toEqual(["X"]);
    // Shortest chain: A -> B -> D (or A -> C -> D), never a longer detour.
    expect(result.answers[0]?.path.length).toBe(4);
  });

  it("22. exhausts the derived-fact budget deterministically", () => {
    const facts: Fact[] = [["A", "属于", "P"]];
    for (let index = 0; index < PROPAGATION_BUDGET.maxDerivedFacts + 8; index += 1) {
      facts.push(["P", "会", `X${String(index).padStart(3, "0")}`]);
    }
    const store = storeOf(...facts);
    const first = objects(ask(store, "A", "会").answers);
    const second = objects(ask(store, "A", "会").answers);

    expect(first.length).toBeLessThanOrEqual(PROPAGATION_BUDGET.maxDerivedFacts);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it("22b. survives a wide fan-out without exceeding the visited budget", () => {
    const facts: Fact[] = [["A", "属于", "Root"]];
    for (let index = 0; index < PROPAGATION_BUDGET.maxVisitedEntities + 20; index += 1) {
      facts.push([`P${index}`, "属于", "Root"]);
      facts.push([`P${index}`, "会", "X"]);
    }
    const store = storeOf(...facts);
    const result = ask(store, "A", "会");
    // Only the ancestor's own capability is reachable from A; must not throw or hang.
    expect(objects(result.answers)).toEqual([]);
  });
});

describe("negation symmetry and conflict integration (9-12, 24)", () => {
  it("9. direct positive beats derived negative", () => {
    // Parent says the capability holds, but the member has a DIRECT positive
    // fact; the inherited (derived) negative must not win.
    const result = ask(
      storeOf(["鸟", "会", "飞", true], ["企鹅", "属于", "鸟"], ["企鹅", "会", "飞"]),
      "企鹅",
      "会",
      "飞",
    );
    expect(objects(result.answers)).toEqual(["飞"]);
    expect(result.answers[0]?.steps).toEqual([]);
    expect(result.conflicts.map((conflict) => conflict.strategy)).toEqual(["direct-over-derived"]);
  });

  it("10. direct negative beats derived positive — no polarity privilege", () => {
    // Mirror image: the direct fact is negative, the inherited one positive, and
    // the DIRECT one still wins. Polarity decides nothing.
    const result = ask(
      storeOf(["鸟", "会", "飞"], ["企鹅", "属于", "鸟"], ["企鹅", "会", "飞", true]),
      "企鹅",
      "会",
      "飞",
    );
    expect(objects(result.answers)).toEqual(["not-飞"]);
    expect(result.answers[0]?.steps).toEqual([]);
    expect(result.conflicts.map((conflict) => conflict.strategy)).toEqual(["direct-over-derived"]);
  });

  it("24. explains the suppressed fact and the rule", () => {
    const result = ask(
      storeOf(["鸟", "会", "飞"], ["企鹅", "属于", "鸟"], ["企鹅", "会", "飞", true]),
      "企鹅",
      "会",
      "飞",
    );
    const conflict = result.conflicts[0]!;
    expect(conflict.winner.negated).toBe(true);
    expect(conflict.suppressed[0]?.negated).toBe(false);
    expect(result.explanation).toContain("直接记录优先于推理结论");
    expect(result.explanation).toContain("企鹅 会 飞");
    expect(result.explanation).toContain("企鹅 不会 飞");
  });

  it("11-12. two derived capabilities just sort; they are not a conflict", () => {
    const result = ask(
      storeOf(["鸟", "会", "飞"], ["鸟", "会", "游泳"], ["企鹅", "属于", "鸟"]),
      "企鹅",
      "会",
    );
    expect(result.answers).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
  });
});

describe("entity identity (18)", () => {
  it("propagates across a whitespace difference at BOTH hops", () => {
    const store = storeOf(["Alice Chen", "属于", "Furry Club"], ["Furry Club", "会", "飞"]);
    for (const subject of ["Alice Chen", "AliceChen"]) {
      expect(objects(ask(store, subject, "会").answers), `subject ${subject}`).toEqual(["飞"]);
    }
  });

  it("follows the chain through a spaced ancestor", () => {
    const store = storeOf(
      ["A", "属于", "Furry Club"],
      ["Furry Club", "属于", "Community"],
      ["Community", "会", "飞"],
    );
    expect(objects(ask(store, "A", "会").answers)).toEqual(["飞"]);
  });

  it("does not merge entities that differ by more than whitespace", () => {
    const store = storeOf(["Alice Chen", "属于", "Furry Club"], ["FurryClub", "会", "飞"]);
    expect(objects(ask(store, "Alicia", "会").answers)).toEqual([]);
  });

  it("is-a traversal itself keeps BOTH hops across a whitespace difference", () => {
    // Regression for the identity unify: before it, the FIRST hop matched
    // through the lookup key but later hops used a literal `match`, so the
    // second hop was silently lost for a spaced entity.
    const store = storeOf(["Alice Chen", "属于", "Furry Club"], ["Furry Club", "属于", "Community"]);
    for (const subject of ["Alice Chen", "AliceChen"]) {
      expect(
        objects(ask(store, subject, "属于").answers),
        `subject ${subject} lost a hop`,
      ).toEqual(["Furry Club", "Community"]);
    }
  });

});

describe("store mutation invariant (19)", () => {
  it("leaves the store deep-equal after a derivation", () => {
    const store = storeOf(
      ["鸟", "会", "飞"],
      ["企鹅", "属于", "鸟"],
      ["鸟", "有", "翅膀"],
      ["企鹅", "属于", "海鸟"],
      ["海鸟", "属于", "鸟"],
    );
    const before: readonly KnowledgeRecord[] = store.all();

    ask(store, "企鹅", "会");
    ask(store, "企鹅", "有");
    ask(store, "企鹅", "属于");

    expect(store.all()).toEqual(before);
    // Nothing derived was written: no 企鹅 会 飞 record exists.
    expect(store.all().some((record) => record.subject === "企鹅" && record.object === "飞")).toBe(false);
  });
});

describe("determinism (20, 21)", () => {
  const facts: readonly Fact[] = [
    ["鸟", "会", "飞"],
    ["鸟", "会", "游泳"],
    ["鸟", "有", "翅膀"],
    ["企鹅", "属于", "鸟"],
    ["企鹅", "会", "飞", true],
  ];

  it("20. repeated queries are byte-identical", () => {
    const store = storeOf(...facts);
    const snapshot = () => {
      const result = ask(store, "企鹅", "会", "飞");
      return JSON.stringify({
        answers: result.answers,
        conflicts: result.conflicts,
        explanation: result.explanation,
      });
    };
    const first = snapshot();
    for (let index = 0; index < 20; index += 1) {
      expect(snapshot()).toBe(first);
    }
  });

  it("21. survives shuffling the store insertion order", () => {
    const reference = (() => {
      const result = ask(storeOf(...facts), "企鹅", "会", "飞");
      return JSON.stringify({
        answers: result.answers,
        conflicts: result.conflicts,
        explanation: result.explanation,
      });
    })();

    for (let seed = 1; seed <= 15; seed += 1) {
      const shuffled = shuffle(facts, seed);
      const result = ask(storeOf(...shuffled), "企鹅", "会", "飞");
      expect(
        JSON.stringify({
          answers: result.answers,
          conflicts: result.conflicts,
          explanation: result.explanation,
        }),
        `shuffle ${seed} changed the outcome`,
      ).toBe(reference);
    }
  });
});

function emptyQuery(): KnowledgeQuery {
  return { all: () => [], has: () => false, match: () => [] };
}

describe("derived-vs-derived determinism (revision 1)", () => {
  function derived(object: string, negated: boolean, premises: readonly (readonly [string, string, string])[]): Inference {
    return {
      conclusion: { subject: "X", relation: "会", object, negated },
      confidence: 0.5,
      path: ["X", "P", object],
      steps: [
        {
          ruleId: "capability-propagation",
          description: "d",
          premises: premises.map(([s, r, o]) => ({ subject: s, relation: r, object: o, negated: false })),
          conclusion: { subject: "X", relation: "会", object, negated },
        },
      ],
    };
  }

  it("opposite polarity at equal confidence does NOT compare equal", () => {
    const positive = derived("飞", false, [["X", "属于", "P"], ["P", "会", "飞"]]);
    const negative = derived("飞", true, [["X", "属于", "P"], ["P", "会", "飞"]]);

    const forward = compareAnswers(emptyQuery(), positive, negative);
    const backward = compareAnswers(emptyQuery(), negative, positive);

    expect(forward).not.toBe(0);
    expect(Math.sign(forward)).toBe(-Math.sign(backward));
    expect(derivedIdentity(positive)).not.toBe(derivedIdentity(negative));
  });

  it("any two distinct derived candidates compare strictly (no ties)", () => {
    const candidates = [
      derived("飞", false, [["X", "属于", "P"], ["P", "会", "飞"]]),
      derived("飞", true, [["X", "属于", "P"], ["P", "会", "飞"]]),
      derived("游泳", false, [["X", "属于", "P"], ["P", "会", "游泳"]]),
      derived("游泳", true, [["X", "属于", "P"], ["P", "会", "游泳"]]),
      derived("飞", false, [["X", "属于", "Q"], ["Q", "会", "飞"]]),
    ];
    for (const left of candidates) {
      for (const right of candidates) {
        if (left === right) continue;
        const forward = compareAnswers(emptyQuery(), left, right);
        const backward = compareAnswers(emptyQuery(), right, left);
        if (derivedIdentity(left) === derivedIdentity(right)) continue;
        expect(forward, `${derivedIdentity(left)} vs ${derivedIdentity(right)} tied`).not.toBe(0);
        expect(Math.sign(forward)).toBe(-Math.sign(backward));
      }
    }
  });

  it("identity ignores premise ORDER but separates different premise sets", () => {
    const a = derived("飞", false, [["X", "属于", "P"], ["P", "会", "飞"]]);
    const b = derived("飞", false, [["P", "会", "飞"], ["X", "属于", "P"]]);
    const c = derived("飞", false, [["X", "属于", "Q"], ["Q", "会", "飞"]]);
    expect(derivedIdentity(a)).toBe(derivedIdentity(b));
    expect(derivedIdentity(a)).not.toBe(derivedIdentity(c));
  });

  it("uses no clock, no randomness: identity is stable across calls", () => {
    const candidate = derived("飞", false, [["X", "属于", "P"], ["P", "会", "飞"]]);
    const first = derivedIdentity(candidate);
    for (let index = 0; index < 50; index += 1) {
      expect(derivedIdentity(candidate)).toBe(first);
    }
  });
});

describe("confidence is conservative and reuses the product rule (26)", () => {
  it("multiplies chain confidences: 0.7 x 0.9 = 0.63", () => {
    const result = ask(
      storeOf(["企鹅", "属于", "鸟", false, 0.7], ["鸟", "会", "飞", false, 0.9]),
      "企鹅",
      "会",
    );
    expect(result.answers[0]?.confidence).toBeCloseTo(0.63, 10);
  });

  it("never raises confidence above the weakest supporting fact", () => {
    const result = ask(
      storeOf(
        ["企鹅", "属于", "海鸟", false, 0.8],
        ["海鸟", "属于", "鸟", false, 0.5],
        ["鸟", "会", "飞", false, 0.9],
      ),
      "企鹅",
      "会",
    );
    const answer = result.answers[0]!;
    expect(answer.confidence).toBeCloseTo(0.8 * 0.5 * 0.9, 10);
    expect(answer.confidence).toBeLessThanOrEqual(0.5);
  });

  it("B.5 can still consume the derived confidence", () => {
    const result = ask(
      storeOf(["鸟", "会", "飞", false, 0.6], ["企鹅", "属于", "鸟", false, 0.5]),
      "企鹅",
      "会",
    );
    expect(result.answers[0]?.confidence).toBeCloseTo(0.3, 10);
    expect(Number.isFinite(result.answers[0]!.confidence)).toBe(true);
  });
});

describe("teaching integration (23)", () => {
  it("derives after a multi-fact turn taught both facts", async () => {
    const { createSunlandEngine } = await import("@/engine");
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("鸟会飞，企鹅属于鸟");

    expect(
      engine.knowledgeStore.all().map((record) => `${record.subject}|${record.relation}|${record.object}`).sort(),
    ).toEqual(["企鹅|属于|鸟", "鸟|会|飞"]);
    expect(engine.process("企鹅会什么").response).toContain("飞");
  });

  it("derives after teaching a negated parent capability (B.7 + B.4)", async () => {
    const { createSunlandEngine } = await import("@/engine");
    const engine = createSunlandEngine({ personalityId: "plain" });
    engine.process("鸟不会飞，企鹅属于鸟");

    expect(engine.process("企鹅会什么").response).toContain("不会 飞");
  });
});

describe("existing is-a regression (29)", () => {
  it("keeps transitivity working after the identity unify", () => {
    const result = ask(storeOf(["猫", "属于", "哺乳动物"], ["哺乳动物", "属于", "动物"]), "猫", "属于");
    expect(objects(result.answers)).toEqual(["哺乳动物", "动物"]);
  });

  it("keeps the direct is-a answer first", () => {
    const result = ask(storeOf(["猫", "属于", "哺乳动物"]), "猫", "属于");
    expect(objects(result.answers)).toEqual(["哺乳动物"]);
    expect(result.answers[0]?.steps).toEqual([]);
  });

  it("仍然 ignores negated is-a edges when walking", () => {
    const result = ask(
      storeOf(["企鹅", "属于", "鸟"], ["鸟", "属于", "动物", true]),
      "企鹅",
      "属于",
    );
    expect(objects(result.answers)).toEqual(["鸟"]);
  });
});
