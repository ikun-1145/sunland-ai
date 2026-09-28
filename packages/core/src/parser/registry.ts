/**
 * Default grammar pattern registry.
 *
 * `RegexParser` tries patterns IN ORDER and returns the first match — so
 * ordering here is a real design decision, not an arbitrary list:
 *
 *   1. locate            "猫在哪里"
 *   2. why (all rel.)    "猫为什么属于生物" (Stage 7 — Response Planner's
 *                        `explain` cue; see `patterns/why.ts`)
 *   3. verify (all rel.) "企鹅是不是鸟" / "企鹅属不属于鸟" / "麻雀会不会飞"
 *   4. object-of (all)   "猫属于什么" / "猫是什么" / "鸟会什么"
 *   5. statement (all)   "猫属于哺乳动物" / "企鹅不会飞"
 *
 * Queries MUST be tried before statements. Both "猫属于什么" (a query) and
 * "猫属于哺乳动物" (a statement) share the substring "猫属于", so if the
 * generic statement pattern for 属于 ran first it would happily — but
 * incorrectly — parse "猫属于什么" as the statement (猫, 属于, "什么"),
 * treating the literal characters "什么" as an object instead of recognizing
 * the question. Trying the more specific query patterns first resolves this
 * ambiguity deterministically. The same reasoning applies to "why" patterns:
 * "猫为什么属于生物" would otherwise be mis-parsed as the statement
 * {subject: "猫为什么", relation: "属于", object: "生物"} (see `why.ts`).
 *
 * Similarly, verify patterns ("是不是") must precede object-of patterns
 * ("是什么") and statement patterns ("是") because they share a relation
 * prefix — but since their trailing literals ("不是" vs "什么" vs anything
 * else) never overlap, their relative order versus object-of doesn't matter;
 * they are grouped by kind here purely for readability. "Why" patterns never
 * overlap with verify/object-of either (they require the literal "为什么"
 * cue neither of those looks for), so its exact position among the other
 * query kinds doesn't matter — only that it precedes `statement`.
 *
 * Adding a new relation (e.g. a plugin introducing "害怕"): register one
 * statement + one object-of + one verify pattern for it. No existing pattern
 * needs to change — this is the Open/Closed Principle in practice.
 */
import { CoreRelations, type GrammarPattern, type Relation } from "@/types";
import {
  ADDITIONAL_RELATIONS,
  relationAliasesForUnambiguousQuery,
  relationAliasesLongestFirst,
} from "./relationVocabulary";
import {
  createLocatePattern,
  createObjectOfPattern,
  createStatementPattern,
  createVerifyPattern,
  createWhyPattern,
} from "./patterns";

/**
 * Relations that get the full statement + object-of + verify + why grammar.
 * `CoreRelations.LocatedIn` ("在") is deliberately included: without a way to
 * assert "猫在屋顶", the "猫在哪里" location query would have no facts to
 * ever match against.
 *
 * The surface words are NOT written here any more -- they come from
 * `relationVocabulary.ts`, which `semantic/lexicon.ts` also draws on, so the
 * set of relations a user can TEACH can no longer drift from the set Semantic
 * can UNDERSTAND. `CoreRelations.Is` ("是") keeps its own entry because it is
 * also the head of the interrogative vocabulary ("是什么") and therefore needs
 * a narrower alias set than the vocabulary's is-a entry.
 */
const RELATIONS_WITH_FULL_GRAMMAR: readonly Relation[] = [
  CoreRelations.IsA,
  CoreRelations.Is,
  CoreRelations.Can,
  CoreRelations.Likes,
  CoreRelations.LocatedIn,
  ADDITIONAL_RELATIONS.Has,
];

/**
 * Relations that only ever get a statement pattern, and whose patterns are
 * registered BEFORE the full-grammar statements.
 *
 * This ordering is load-bearing, not cosmetic. `参考 意思是 ...` and `有` own
 * multi-character aliases (`意思是`, `指的是`, `拥有`, `具备`) that CONTAIN a
 * full-grammar relation word (`是`, `有`). If the shorter relation's statement
 * pattern ran first, its non-greedy subject group would happily stop inside the
 * longer alias and store a corrupted subject -- exactly the
 * `猫拥有爪子` → `{猫拥, 有, 爪子}` defect this batch fixes. Running the
 * longer-alias patterns first means the longer match is claimed before the
 * shorter one can cut into it.
 */
/**
 * Which relations get a statement pattern, and in which ORDER those patterns are
 * tried.
 *
 * The order is load-bearing, not cosmetic. `意思是`/`指的是`/`拥有`/`具备`/
 * `是一种`/`能够` contain a shorter registered relation word (`是`, `有`, `会`)
 * as a substring. A statement pattern's subject group is non-greedy, so if the
 * shorter relation's pattern were tried first it would stop inside the longer
 * alias and store a corrupted subject -- exactly the `猫拥有爪子` ->
 * `{猫拥, 有, 爪子}` defect this batch fixes. Sorting by the relation's LONGEST
 * alias puts the multi-character aliases in front, so the longer match is always
 * claimed first.
 *
 * `意思是` is statement-only: it has no object-of/verify/why form ("A 意思是
 * 什么" is the interrogative `是什么`, handled by `query-definition`).
 */
const STATEMENT_RELATIONS: readonly Relation[] = [
  ...RELATIONS_WITH_FULL_GRAMMAR,
  ADDITIONAL_RELATIONS.Means,
];

function longestAliasLength(relation: Relation): number {
  return relationAliasesLongestFirst(relation).reduce(
    (longest, alias) => Math.max(longest, alias.length),
    0,
  );
}

/**
 * `意思是`(3), `指的是`(3), `拥有`(2), `具备`(2), `能够`(2)... all before
 * `是`(1), `有`(1), `会`(1), `在`(1).
 */
const STATEMENT_RELATIONS_BY_ALIAS_LENGTH: readonly Relation[] = Object.freeze(
  [...STATEMENT_RELATIONS].sort(
    (left, right) => longestAliasLength(right) - longestAliasLength(left),
  ),
);

export const defaultPatterns: readonly GrammarPattern[] = [
  createLocatePattern(relationAliasesLongestFirst(CoreRelations.LocatedIn)),
  ...RELATIONS_WITH_FULL_GRAMMAR.map(createWhyPattern),
  ...RELATIONS_WITH_FULL_GRAMMAR.map(createVerifyPattern),
  ...RELATIONS_WITH_FULL_GRAMMAR.map((relation) =>
    // Open queries ("A <relation>什么") take the canonical word and the
    // unambiguous longer aliases; a leading `是` alias would collide with the
    // interrogative forms.
    createObjectOfPattern(relation, relationAliasesForUnambiguousQuery(relation)),
  ),
  ...STATEMENT_RELATIONS_BY_ALIAS_LENGTH.map((relation) =>
    createStatementPattern(relation, relationAliasesLongestFirst(relation)),
  ),
];
