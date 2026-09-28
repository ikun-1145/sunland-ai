/**
 * Whitespace-insensitive entity lookup for reading stored facts.
 *
 * Lives in `knowledge/` because it is a property of how stored facts are
 * matched, and `rules/` (is-a traversal) must be able to use it: `reasoners/`
 * already imports `rules/`, so the dependency could not go the other way.
 *
 * The problem this solves is a real, user-visible one. The Legacy query grammar
 * normalizes its input by DELETING every space (`parser/normalize.ts`), so
 * asking about "Alice Chen" arrives as `AliceChen`, while a taught statement
 * keeps the user's spacing and stores `Alice Chen`. `KnowledgeStore.match` is an
 * exact string comparison, so the fact was stored successfully and then could
 * never be found again -- and a multi-hop chain broke at the second hop even
 * when the first hop matched.
 *
 * The fix compares through `entityLookupKey` (whitespace removed) instead of the
 * literal string. Scope is deliberately minimal, per explicit decision:
 *
 *   - whitespace only; no case folding, no full/half-width folding, no
 *     punctuation stripping, no traditional/simplified mapping, no pinyin, and
 *     no fuzzy or similarity matching;
 *   - it is a LOOKUP fallback, never a canonicalizer. The value that gets
 *     persisted and displayed is untouched;
 *   - exact matches are always tried first, so precision is never traded away
 *     for recall when both would work.
 */
// NOTE: deliberately NOT exported from `knowledge/index.ts`. That barrel is
// re-exported through `sdk.ts`, so adding a runtime function here would change
// the frozen 70-export public surface. Import this file directly.
import type { KnowledgeQuery, KnowledgeRecord, TriplePattern } from "@/types";
import { entityLookupKey } from "@/parser/textNormalize";

export function matchByEntity(
  known: KnowledgeQuery,
  pattern: TriplePattern,
): readonly KnowledgeRecord[] {
  const exact = known.match(pattern);
  if (exact.length > 0) return exact;

  const { subject, relation, object } = pattern;
  if (subject === undefined || relation === undefined) return exact;

  // Bounded by the relation index, then compared on the lookup key. The
  // relation index is one of the store's secondary indexes, so this stays
  // proportional to the facts sharing the relation rather than to the whole
  // knowledge base.
  const candidates = known.match({
    relation,
    ...(pattern.negated === undefined ? {} : { negated: pattern.negated }),
  });
  const wantedSubject = entityLookupKey(subject);
  const bySubject = candidates.filter(
    (record) => entityLookupKey(record.subject) === wantedSubject,
  );

  // A fixed object stays a FIXED object: it is re-compared, never dropped.
  // Dropping it would turn a verify query ("猫是不是生物") into "what does 猫
  // belong to", answering with the intermediate hop instead of running the
  // transitive traversal that was asked for.
  if (object === undefined) return bySubject;
  const wantedObject = entityLookupKey(object);
  return bySubject.filter(
    (record) => entityLookupKey(record.object) === wantedObject,
  );
}
