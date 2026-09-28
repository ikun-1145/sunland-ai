/**
 * Provenance authority ranks — the SINGLE definition.
 *
 * When two propositions about the same thing disagree, and they are equally
 * direct and equally confident, `source` is what breaks the tie. That ordering
 * must exist in exactly one place: a second copy elsewhere (a planner, a future
 * resolver, a persona) would eventually disagree with this one, and the same
 * pair of facts would then be resolved differently depending on which path
 * asked the question.
 *
 * The ranks mirror the real `KnowledgeSource` enum
 * (`types/knowledge.ts`: `"user" | "inference" | "seed" | "import"`) and the
 * type is a `Record<KnowledgeSource, number>`, so adding a new source value is
 * a compile error here rather than a silent default.
 *
 * Why this order:
 *   - `user`      the account holder said it; the highest authority available.
 *   - `import`    the user's own data, migrated in from an earlier host, so it
 *                 carries the user's intent but not their current, explicit
 *                 assertion.
 *   - `seed`      shipped with the product: curated, but not about this user.
 *   - `inference` derived by a rule from other facts. Lowest, because a rule
 *                 change can revise it and it is not something anyone asserted
 *                 directly. (Derived answers are separately outranked by direct
 *                 ones before `source` is ever consulted.)
 */
import type { KnowledgeSource } from "@/types";

export const SOURCE_AUTHORITY: Readonly<Record<KnowledgeSource, number>> =
  Object.freeze({
    user: 3,
    import: 2,
    seed: 1,
    inference: 0,
  });

/** Higher wins. Unknown sources rank below every known one. */
export function sourceAuthority(source: KnowledgeSource): number {
  return SOURCE_AUTHORITY[source] ?? -1;
}
