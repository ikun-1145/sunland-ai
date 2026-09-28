/**
 * The ONE relation-alias vocabulary.
 *
 * Before this module the relation words existed twice: `parser/registry.ts`
 * hand-wrote the surface words it could parse (`createStatementPattern("属于",
 * ["属于", "是一种"])`, `createStatementPattern("有")`, ...) while
 * `semantic/lexicon.ts` independently declared its own `aliases` for the same
 * relations. The two drifted, and the drift was not benign:
 *
 *   - `猫能飞` / `猫喜爱鱼` / `猫位于屋顶` matched NOTHING in the Legacy
 *     grammar, so those aliases could never be taught even though Semantic
 *     understood them.
 *   - `猫拥有爪子` was worse than unmatched. `拥有` contains the registered
 *     relation `有`, and `猫算是哺乳动物` contains `是`, so the alternation cut
 *     the string at the substring and stored the facts `{猫拥, 有, 爪子}` and
 *     `{猫算, 是, 哺乳动物}` -- silently corrupt subjects, reported to the user
 *     as a successful teaching turn.
 *
 * `CANONICAL_RELATION_ALIASES` is therefore the single declaration, and
 * `semantic/lexicon.ts` is the one consumer that also owns the *semantic*
 * entry (weights, constraints, concept ids). `relationAliasesFor` exposes the
 * same data to the Legacy grammar, so "what can be taught" and "what can be
 * understood" can no longer diverge. An invariant test asserts the lexicon's
 * relation entries agree with this table.
 *
 * Dependency direction: `types/` only. Nothing here may import parser,
 * semantic, knowledge, reasoners, dialogue, personality or engine code, which
 * is what keeps it usable from every layer without a cycle.
 */
import { CoreRelations, type Relation } from "@/types";

/**
 * Two relations the Legacy grammar teaches but `CoreRelations` does not name:
 * the registry used to register them as bare string literals
 * (`createStatementPattern("意思是", [...])`, `createStatementPattern("有")`).
 * They are named here rather than left as scattered literals; adding them to
 * `CoreRelations` is deliberately avoided because that constant is part of the
 * frozen public type surface.
 */
export const ADDITIONAL_RELATIONS = Object.freeze({
  /** Possession / attribute, e.g. 猫 有 爪子 */
  Has: "有",
  /** Definition, e.g. 猫 意思是 家猫 */
  Means: "意思是",
} as const);

/**
 * Relation -> alternate surface words, in the intended precedence order.
 *
 * A relation's own canonical word is always first and is always an alias of
 * itself, so callers never need to special-case it. Order within an entry is
 * precedence for equal-length aliases; matching always prefers the LONGEST
 * alias first regardless (see `relationAliasesLongestFirst`), because that is
 * what stops `拥有`/`算是` from being split into `有`/`是`.
 */
export const CANONICAL_RELATION_ALIASES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    [CoreRelations.IsA]: Object.freeze([
      "属于",
      "是一种",
      "算是",
      "归类为",
    ]),
    [CoreRelations.Can]: Object.freeze([
      "会",
      "能",
      "能够",
      "可以",
    ]),
    [ADDITIONAL_RELATIONS.Has]: Object.freeze([
      "有",
      "拥有",
      "具备",
    ]),
    [CoreRelations.Likes]: Object.freeze([
      "喜欢",
      "喜爱",
    ]),
    [CoreRelations.LocatedIn]: Object.freeze([
      "在",
      "位于",
    ]),
    [ADDITIONAL_RELATIONS.Means]: Object.freeze([
      "意思是",
      "指的是",
    ]),
  });

/**
 * `CANONICAL_RELATION_ALIASES` keys are the relations the Legacy grammar
 * teaches. `CoreRelations` carries one more (`是`, identity) that is
 * deliberately absent: its statement and query patterns are registered
 * separately because `是` is also the head of the interrogative vocabulary
 * ("是什么") and must keep its narrower alias set.
 */
export const LEGACY_TEACHABLE_RELATIONS: readonly Relation[] = Object.freeze(
  Object.keys(CANONICAL_RELATION_ALIASES),
);

/**
 * Every surface word that denotes `relation`, in the declared precedence order.
 * Read-only view for consumers (such as the semantic lexicon) that declare their
 * own alias list but must never drift from this one.
 */
export function relationAliasesFor(relation: Relation): readonly string[] {
  return CANONICAL_RELATION_ALIASES[relation] ?? Object.freeze([relation]);
}

/** Every surface word that denotes `relation`, longest first. */
export function relationAliasesLongestFirst(relation: Relation): readonly string[] {
  const aliases = CANONICAL_RELATION_ALIASES[relation];
  if (aliases === undefined) return Object.freeze([relation]);
  return Object.freeze(
    [...aliases].sort(
      (left, right) =>
        right.length - left.length || left.localeCompare(right),
    ),
  );
}

/**
 * The alias list for `relation` filtered down to whole words that will not be
 * mistaken for an interrogative. Used by the open ("A <relation>什么") and why
 * ("A 为什么<relation>B") queries, which must not treat `是什么`/`是什么意思`
 * as the relation `是`, nor match a question word as the relation.
 */
export function relationAliasesForUnambiguousQuery(relation: Relation): readonly string[] {
  const aliases = CANONICAL_RELATION_ALIASES[relation];
  if (aliases === undefined) return Object.freeze([relation]);
  return Object.freeze(
    aliases.filter(
      (alias) => alias === relation || !alias.startsWith("是") || alias === "是一种",
    ),
  );
}

/**
 * Every alias in the vocabulary, deduplicated, longest first. A single
 * alternation built from this list cannot split a long alias, because the
 * regex engine tries the alternatives in order.
 */
export function allRelationAliasesLongestFirst(): readonly string[] {
  const seen = new Set<string>();
  for (const aliases of Object.values(CANONICAL_RELATION_ALIASES)) {
    for (const alias of aliases) seen.add(alias);
  }
  return Object.freeze(
    [...seen].sort(
      (left, right) =>
        right.length - left.length || left.localeCompare(right),
    ),
  );
}
