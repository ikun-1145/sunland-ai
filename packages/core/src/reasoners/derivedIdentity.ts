/**
 * Deterministic identity for DERIVED inferences.
 *
 * Why this exists: a derived `Inference` has no `KnowledgeRecord`, so it has no
 * `id`, `source` or `createdAt`. Both the display comparator
 * (`answerOrdering.ts`) and the conflict resolver (`conflictResolver.ts`) fall
 * back to those fields for their final tie-breakers, which meant two derived
 * candidates that differed only in polarity compared as **equal**. An equal
 * comparison is not a cosmetic problem: `Array.prototype.sort` then leaves the
 * order to the input sequence, and the resolver's "winner" becomes whichever
 * side happened to arrive first -- so the same store and the same query could
 * produce different `answers`, `conflicts` and `explanation` run to run.
 *
 * The identity is built ONLY from facts already in the inference:
 *
 *   conclusion   the canonical assertion (subject / relation / object / negated)
 *   provenance   the canonical SET of facts the derivation consumed, taken from
 *                the steps' premises and sorted
 *
 * Rules that make it safe:
 *   - No random UUID, no clock, no counter, no store-order dependence.
 *   - The provenance is a sorted SET, so the identity describes WHICH FACTS
 *     supported the conclusion, not the order a traversal happened to visit
 *     them. Two derivations of the same conclusion from the same facts are the
 *     same derivation.
 *   - Polarity appears only as part of the canonical assertion (a positive and a
 *     negative assertion genuinely differ). It is NEVER used to rank one above
 *     the other: polarity is not a precedence rule, here or anywhere.
 */
import type { Inference, Triple } from "@/types";

/**
 * Canonical, content-derived key for one assertion.
 *
 * Content-derived matters: it does NOT depend on record ids, insertion order or
 * clock values, so it is the same for the same assertion however the store was
 * populated. Used as the final tie-break wherever a comparison would otherwise
 * fall back on `id`, which IS insertion-order dependent for records.
 */
export function assertionKey(triple: Triple): string {
  return [
    triple.subject,
    triple.relation,
    triple.object,
    triple.negated ? "1" : "0",
  ].join("\u0000");
}

/**
 * Canonical provenance for a derivation: the assertion keys of every premise its
 * steps consumed, deduplicated and sorted. Sorting is what removes traversal
 * order from the identity.
 */
export function canonicalProvenance(answer: Inference): readonly string[] {
  const keys = new Set<string>();
  for (const step of answer.steps) {
    for (const premise of step.premises) {
      keys.add(assertionKey(premise));
    }
    // The step's own conclusion is part of what supports the final answer when
    // it is an intermediate (e.g. the is-a hop a capability rule consumed).
    keys.add(assertionKey(step.conclusion));
  }
  keys.delete(assertionKey(answer.conclusion));
  return Object.freeze([...keys].sort());
}

/**
 * Total, order-independent identity for a derived inference. Equal identity
 * means "the same conclusion derived from the same facts", which is the only
 * case where reporting equality is correct.
 */
export function derivedIdentity(answer: Inference): string {
  return [
    assertionKey(answer.conclusion),
    canonicalProvenance(answer).join("\u0001"),
  ].join("\u0002");
}

/**
 * Identity used to order two DERIVED answers against each other, whatever their
 * polarity. Falls back to the conclusion key when neither side carries steps,
 * which keeps the function total for any pair.
 */
export function compareDerivedIdentity(left: Inference, right: Inference): number {
  const leftId = left.steps.length > 0 ? derivedIdentity(left) : assertionKey(left.conclusion);
  const rightId = right.steps.length > 0 ? derivedIdentity(right) : assertionKey(right.conclusion);
  return leftId.localeCompare(rightId, "und");
}
