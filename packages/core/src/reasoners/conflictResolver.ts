/**
 * ConflictResolver v1 — deterministic adjudication of contradictory facts.
 *
 * The problem: `KnowledgeStore` keys facts by `(subject, relation, object,
 * negated)`, so `猫会飞` and `猫不会飞` are two distinct, coexisting records. The
 * reasoner used to return BOTH, producing a self-contradicting answer
 * ("猫 会 飞；猫 不会 飞") with an empty `conflicts` list, because nothing ever
 * detected the contradiction.
 *
 * What counts as a conflict, and nothing else:
 *
 *     same subject   (compared via `entityLookupKey`)
 *   + same relation  (exact string)
 *   + same object    (compared via `entityLookupKey`)
 *   + OPPOSITE `negated`
 *
 * A different object or relation is a different proposition and coexists --
 * `猫会飞` plus `猫会游泳` is a cat that can do both. Deciding between those is
 * explicitly not this module's job, and it never overwrites one with the other.
 *
 * Winner order (every key an explicit field; polarity is NOT one of them, so
 * positive and negative assertions compete on fully symmetric terms):
 *
 *   1. direct before derived
 *   2. higher `confidence`
 *   3. higher `source` authority (`sourceAuthority.ts`, the single definition)
 *   4. newer `createdAt`
 *   5. `id` ascending, which makes the order TOTAL
 *
 * Because polarity is absent from that list, teaching `猫会飞` then
 * `猫不会飞` and teaching `猫不会飞` then `猫会飞` both resolve to the NEWER
 * fact. Deciding between related facts is symmetric; only the evidence decides.
 *
 * Adjudication is a READ-TIME VIEW. This module never mutates the store: it
 * receives already-computed answers plus the store they came from, and reports
 * which assertions are held back. The suppressed facts remain stored, retain
 * their `confidence`/`source`/`createdAt`, and stay explainable.
 */
import type {
  Conflict,
  ConflictStrategy,
  Inference,
  KnowledgeQuery,
  KnowledgeRecord,
  Triple,
} from "@/types";
import { entityLookupKey } from "@/parser/textNormalize";
import { assertionKey, compareDerivedIdentity } from "./derivedIdentity";
import { sourceAuthority } from "./sourceAuthority";

export const CONFLICT_RESOLVER_ID = "contradiction-resolver-v1";

/** Identity of the PROPOSITION an inference asserts, ignoring its polarity. */
function propositionKey(triple: Triple): string {
  return [
    entityLookupKey(triple.subject),
    triple.relation,
    entityLookupKey(triple.object),
  ].join("\u0000");
}

/** Evidence about one side of a conflict, gathered from the answer + its record. */
interface Evidence {
  readonly answer: Inference;
  readonly triple: Triple;
  readonly isDerived: boolean;
  readonly confidence: number;
  /** `null` when the assertion has no stored record (a pure inference). */
  readonly record: KnowledgeRecord | null;
}

function evidenceFor(known: KnowledgeQuery, answer: Inference): Evidence {
  const triple = answer.conclusion;
  return {
    answer,
    triple,
    isDerived: answer.steps.length > 0,
    confidence: answer.confidence,
    record: recordFor(known, triple),
  };
}

/**
 * Compare two sides and report both the winner and the rule that decided it.
 * Returns `null` when they are the same assertion (not a conflict at all).
 */
function adjudicate(
  left: Evidence,
  right: Evidence,
): { winner: Evidence; strategy: ConflictStrategy } | null {
  if (left.triple.negated === right.triple.negated) return null;

  if (left.isDerived !== right.isDerived) {
    return {
      winner: left.isDerived ? right : left,
      strategy: "direct-over-derived",
    };
  }
  if (left.confidence !== right.confidence) {
    return {
      winner: left.confidence > right.confidence ? left : right,
      strategy: "higher-confidence",
    };
  }

  const leftAuthority = left.record === null ? -1 : sourceAuthority(left.record.source);
  const rightAuthority = right.record === null ? -1 : sourceAuthority(right.record.source);
  if (leftAuthority !== rightAuthority) {
    return {
      winner: leftAuthority > rightAuthority ? left : right,
      strategy: "source-authority",
    };
  }

  const leftCreatedAt = left.record?.createdAt ?? "";
  const rightCreatedAt = right.record?.createdAt ?? "";
  if (leftCreatedAt !== rightCreatedAt) {
    return {
      winner: leftCreatedAt > rightCreatedAt ? left : right,
      strategy: "more-recent",
    };
  }

  // Fully tied on every recorded key. `leftId`/`rightId` are both "" when both
  // sides are DERIVED (a derived inference has no record at all), which would
  // make this comparison report equality and hand the winner to whichever side
  // arrived first. `compareDerivedIdentity` closes that: it is derived from the
  // canonical assertion plus the canonical premise set, so it is stable across
  // runs and store ordering, and it does NOT use polarity to rank.
  // Content-derived before `id`: record ids come from an insertion-ordered
  // counter, so ranking on them would let the teaching order decide a
  // contradiction between two facts whose evidence is otherwise identical.
  const leftAssertion = assertionKey(left.triple);
  const rightAssertion = assertionKey(right.triple);
  if (leftAssertion !== rightAssertion) {
    return {
      winner: leftAssertion <= rightAssertion ? left : right,
      strategy: "total-order-id",
    };
  }
  const leftId = left.record?.id ?? "";
  const rightId = right.record?.id ?? "";
  if (leftId !== rightId) {
    return {
      winner: leftId <= rightId ? left : right,
      strategy: "total-order-id",
    };
  }
  return {
    winner: compareDerivedIdentity(left.answer, right.answer) <= 0 ? left : right,
    strategy: "total-order-id",
  };
}

function describeTriple(triple: Triple): string {
  return `${triple.subject} ${triple.negated ? "不" : ""}${triple.relation} ${triple.object}`;
}

/** Why the winning side won, in the user's language. */
const STRATEGY_REASON: Readonly<Record<ConflictStrategy, string>> = Object.freeze({
  "direct-over-derived": "直接记录优先于推理结论",
  "higher-confidence": "置信度更高",
  "source-authority": "来源更可信",
  "more-recent": "以较新的记录为准",
  "total-order-id": "其余依据相同，按记录标识定序",
});

export interface ConflictResolution {
  /** Answers with every suppressed assertion removed; all others untouched. */
  readonly answers: readonly Inference[];
  readonly conflicts: readonly Conflict[];
}

/**
 * Detect and adjudicate contradictions within one answer set.
 *
 * Pure with respect to `known`: it only reads.
 */
export function resolveConflicts(
  answers: readonly Inference[],
  known: KnowledgeQuery,
): ConflictResolution {
  // Group by proposition so only opposite-polarity pairs ever meet.
  const byProposition = new Map<string, Evidence[]>();
  for (const answer of answers) {
    const key = propositionKey(answer.conclusion);
    const group = byProposition.get(key);
    const evidence = evidenceFor(known, answer);
    if (group === undefined) {
      byProposition.set(key, [evidence]);
    } else {
      group.push(evidence);
    }
  }

  const suppressedAssertions = new Set<string>();
  const conflicts: Conflict[] = [];

  for (const group of byProposition.values()) {
    const positive = group.filter((side) => !side.triple.negated);
    const negative = group.filter((side) => side.triple.negated);
    if (positive.length === 0 || negative.length === 0) continue;

    // Every opposing pair is adjudicated with the same total order, so the
    // overall winner is the best of each side and the losers are exactly the
    // remaining assertions. `sort` is stable and the keys are total, so the
    // result does not depend on the order the answers arrived in.
    const ordered = [...group].sort((left, right) => {
      const outcome = adjudicate(left, right);
      if (outcome === null) return 0;
      if (outcome.winner === left && outcome.winner !== right) return -1;
      if (outcome.winner === right && outcome.winner !== left) return 1;
      return 0;
    });
    const winner = ordered[0];
    if (winner === undefined) continue;

    const suppressed = ordered
      .slice(1)
      .filter((side) => side.triple.negated !== winner.triple.negated);
    if (suppressed.length === 0) continue;

    // The rule that decided it, reported for the strongest suppressed side.
    const decisive = adjudicate(winner, suppressed[0]!);
    const strategy: ConflictStrategy = decisive?.strategy ?? "total-order-id";

    for (const side of suppressed) {
      suppressedAssertions.add(assertionKey(side.triple));
    }
    conflicts.push(
      Object.freeze({
        description:
          `${describeTriple(winner.triple)} 与 ` +
          `${suppressed.map((side) => describeTriple(side.triple)).join("、")} 冲突：` +
          `采用 ${describeTriple(winner.triple)}（${STRATEGY_REASON[strategy]}）`,
        winner: winner.triple,
        suppressed: Object.freeze(suppressed.map((side) => side.triple)),
        strategy,
      }),
    );
  }

  return Object.freeze({
    answers: Object.freeze(
      answers.filter(
        (answer) => !suppressedAssertions.has(assertionKey(answer.conclusion)),
      ),
    ),
    conflicts: Object.freeze(conflicts),
  });
}

/**
 * Newest stored record for one assertion, or `null` when the assertion is purely
 * inferred.
 *
 * Deliberately a targeted `match` rather than an index of the whole store: only
 * the candidate answers are ever consulted, so indexing every record made each
 * query cost O(store size) for no benefit.
 */
function recordFor(known: KnowledgeQuery, triple: Triple): KnowledgeRecord | null {
  let records: readonly KnowledgeRecord[];
  try {
    records = known.match({
      subject: triple.subject,
      relation: triple.relation,
      object: triple.object,
      negated: triple.negated,
    });
  } catch {
    return null;
  }
  let newest: KnowledgeRecord | null = null;
  for (const record of records) {
    if (newest === null || record.createdAt > newest.createdAt) newest = record;
  }
  return newest;
}
