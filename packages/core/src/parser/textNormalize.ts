/**
 * Canonical entity/relation text normalization.
 *
 * This is the FIRST-WRITE canonical form: matcher keys, dedupe keys and
 * comparison keys across the whole Core all use exactly these three steps, and
 * nothing else. It deliberately does NOT case-fold (that is a separate,
 * read-only concern — see `entityLookupKey`) and it deliberately does NOT
 * remove spaces (they can be meaningful in names such as "Alice Chen").
 *
 * Why it lives here: `parser/` must stay the lowest text layer. Before this
 * module existed, four separate copies of the same expression lived in
 * `semantic/candidates.ts`, `semantic/engineAdapter.ts`,
 * `semantic/legacySideEffectGate.ts` and
 * `semantic/producers/contextProducer.ts`; a divergence between any two of
 * them silently changes whether a write is approved. There is now one
 * implementation.
 *
 * Contract: `normalizeMatchText` is IDEMPOTENT — `f(f(x)) === f(x)` for every
 * input. Callers rely on this, because parse-side and write-side code both
 * apply it and the result must not drift with the number of applications.
 * Dependencies: none (pure string function), so any layer may import it.
 */

const WHITESPACE_RUN = /\s+/gu;

/** Canonical comparison text: trim, collapse whitespace runs, keep the case. */
export function normalizeMatchText(value: string): string {
  return value.trim().replace(WHITESPACE_RUN, " ");
}

/**
 * Whitespace-only lookup key: additionally removes ALL whitespace.
 *
 * Purpose is lookup parity, not storage. The legacy query grammar normalizes
 * its input by deleting every space (`parser/normalize.ts`), while a taught
 * statement keeps the user's spacing, so "Alice Chen" taught once was
 * unreachable from the query "AliceChen属于什么". Comparing through this key
 * bridges that gap WITHOUT changing what is persisted or displayed.
 *
 * Strictly bounded scope, by explicit decision: whitespace only. No case
 * folding, no full-width/half-width folding, no punctuation stripping, no
 * traditional/simplified conversion, no pinyin, and no fuzzy or similarity
 * matching. Two entities that differ by anything other than whitespace remain
 * different entities.
 *
 * IDEMPOTENT, like `normalizeMatchText`.
 */
const ALL_WHITESPACE = /\s+/gu;

export function entityLookupKey(value: string): string {
  return value.replace(ALL_WHITESPACE, "");
}
