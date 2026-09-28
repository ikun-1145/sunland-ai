/**
 * Deterministic answer ordering.
 *
 * `ReasoningResult.answers` is documented as "best first"
 * (`types/reasoning.ts`), but nothing enforced it. The order a user actually saw
 * was an accident of history: `directAnswers` returned whatever order
 * `KnowledgeStore.match` happened to yield, which follows the store's insertion
 * order, which follows `loadSnapshot`'s `order=created_at.asc,id.asc` -- i.e.
 * the order the user happened to teach things. The same two facts taught in the
 * opposite order produced the opposite answer order:
 *
 *   teach 哺乳动物, then 宠物  -> "猫 属于 哺乳动物；猫 属于 宠物"
 *   teach 宠物, then 哺乳动物  -> "猫 属于 宠物；猫 属于 哺乳动物"
 *
 * `compareAnswers` replaces that with one explicit total order. Every key is
 * either a stored field or a structural property of the inference, so the
 * ordering is auditable, testable, and independent of input order.
 *
 * The tuple, in priority order:
 *
 *   1. `isDerived` ASC      directly-known facts before inferred ones
 *   2. `negated`   ASC      affirmative before negative
 *   3. `confidence` DESC    stronger belief first
 *   4. `pathLength` ASC     shorter derivation first (哺乳动物 before 生物)
 *   5. `object`    ASC
 *   6. `relation`  ASC
 *   7. `subject`   ASC
 *   8. `createdAt` DESC     newer record first
 *   9. canonical assertion ASC  content-derived, so identical evidence never
 *                             resolves by insertion order
 *  10. `id`        ASC      last resort for RECORDED answers
 *  11. derived identity ASC  final tie-breaker for DERIVED answers, which have
 *                             no record; the order is total for them too
 *
 * Keys 8 and 9 exist so that two otherwise-identical records still compare
 * deterministically: without them `Array.prototype.sort` would fall back to
 * input order for ties, and the shuffle-invariance test could not hold.
 *
 * `createdAt`/`id` come from `KnowledgeRecord`; derived inferences have no
 * record of their own, so they compare as the empty string there. That is safe
 * because keys 1-7 already separate any derived pair that differs, and two
 * derived answers with the same path length and same conclusion are the same
 * answer.
 *
 * Comparison uses `localeCompare` with an explicit "und" locale rather than the
 * default, so the result does not depend on the host's locale.
 */
import type { Inference, KnowledgeQuery, KnowledgeRecord } from "@/types";
import { assertionKey, compareDerivedIdentity } from "./derivedIdentity";

const LOCALE = "und";

function compareText(left: string, right: string): number {
  return left.localeCompare(right, LOCALE);
}

/**
 * `createdAt`/`id` for an answer, or empty strings for a derived inference.
 *
 * The lookup is a targeted `match` on the answer's own exact triple, never a
 * pass over the store. Building an index of every stored record made each query
 * cost O(store size) even though only the handful of answers being compared is
 * ever consulted -- measured at ~1.7ms of a ~4ms query on a 10k-fact store.
 */
function recordIdentity(
  known: KnowledgeQuery,
  answer: Inference,
): { createdAt: string; id: string } {
  // A directly-known answer carries no record reference of its own; its identity
  // is the exact triple it asserts. Absent a match, both fields stay empty and
  // the earlier keys still decide.
  const records = known.match({
    subject: answer.conclusion.subject,
    relation: answer.conclusion.relation,
    object: answer.conclusion.object,
    negated: answer.conclusion.negated,
  });
  let newest: KnowledgeRecord | undefined;
  for (const record of records) {
    if (newest === undefined || record.createdAt > newest.createdAt) newest = record;
  }
  return { createdAt: newest?.createdAt ?? "", id: newest?.id ?? "" };
}

/** Exact-identity key for an answer's conclusion. */
export function answerKey(answer: Inference): string {
  const { subject, relation, object, negated } = answer.conclusion;
  return `${subject}\u0000${relation}\u0000${object}\u0000${negated}`;
}

export function compareAnswers(
  known: KnowledgeQuery,
  left: Inference,
  right: Inference,
): number {
  const leftDerived = left.steps.length > 0;
  const rightDerived = right.steps.length > 0;
  if (leftDerived !== rightDerived) return leftDerived ? 1 : -1;

  if (left.conclusion.negated !== right.conclusion.negated) {
    return left.conclusion.negated ? 1 : -1;
  }

  if (left.confidence !== right.confidence) {
    return right.confidence - left.confidence;
  }

  if (left.path.length !== right.path.length) {
    return left.path.length - right.path.length;
  }

  const byObject = compareText(left.conclusion.object, right.conclusion.object);
  if (byObject !== 0) return byObject;

  const byRelation = compareText(left.conclusion.relation, right.conclusion.relation);
  if (byRelation !== 0) return byRelation;

  const bySubject = compareText(left.conclusion.subject, right.conclusion.subject);
  if (bySubject !== 0) return bySubject;

  const leftId = recordIdentity(known, left);
  const rightId = recordIdentity(known, right);
  if (leftId.createdAt !== rightId.createdAt) {
    return leftId.createdAt < rightId.createdAt ? 1 : -1;
  }
  // Content-derived before `id`. A record's `id` is generated from an
  // insertion-ordered counter, so two facts carrying identical evidence would
  // otherwise be ordered by the sequence they happened to be taught in -- the
  // exact input-order dependence the determinism contract forbids.
  const byAssertion = compareText(assertionKey(left.conclusion), assertionKey(right.conclusion));
  if (byAssertion !== 0) return byAssertion;
  const byRecordId = compareText(leftId.id, rightId.id);
  if (byRecordId !== 0) return byRecordId;

  // Final tie-breaker for DERIVED pairs. A derived inference has no record, so
  // both record fields above are empty for it and two derived answers could
  // reach this point and compare equal -- which would leave their order to the
  // input sequence. `compareDerivedIdentity` is built from the canonical
  // assertion plus the canonical premise set, so it is stable across runs, store
  // ordering and traversal order, and it never ranks by polarity.
  return compareDerivedIdentity(left, right);
}

/** `compareAnswers` bound to one store, ready for `Array.prototype.sort`. */
export function answerComparator(
  known: KnowledgeQuery,
): (left: Inference, right: Inference) => number {
  return (left, right) => compareAnswers(known, left, right);
}
