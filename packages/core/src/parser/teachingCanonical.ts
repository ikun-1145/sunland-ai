/**
 * Canonical form of a *taught* statement.
 *
 * Two separate problems, both about text that must never leak into stored
 * knowledge:
 *
 *   1. **Teaching wrappers (A5).** The same teaching cue the Semantic
 *      lexicon already declares (`semantic/lexicon.ts` entry `teaching`,
 *      match mode `prefix`, side-effect safe) is read by the Semantic layer
 *      but was never removed by the Legacy grammar. `记住 猫 属于 哺乳动物`
 *      therefore stored the subject `记住 猫` -- a fact that can never be
 *      matched by any later query. `stripTeachingCuePrefix()` makes the
 *      Legacy statement path agree with what Semantic already claims.
 *
 *   2. **Relation/object normalization (A2).** `猫是一种哺乳动物` parsed to
 *      `{猫, 是, 一种哺乳动物}`. The Legacy side-effect gate already computed
 *      the normalized comparison key (`是`->`属于`, `一种` prefix removed) but
 *      only used it for *deciding*, while the store received the raw parse --
 *      so a stored fact could be invisible to `属于` inference even though the
 *      write had been approved under its normalized form.
 *      `canonicalStatementTriple()` is that one normalization, applied to the
 *      value that is actually persisted, so the decision key and the stored
 *      fact can no longer diverge.
 *
 * Both functions are pure, deterministic and idempotent: they are applied on
 * the read path (parsing) and again on the write path (the gate compares
 * canonical forms), so re-applying them must never change an
 * already-canonical value. They never invent information: `是`/`属于` stay
 * distinct unless the object literally carries the `一种...` is-a wrapper,
 * which is the only signal that a Legacy `是` was meant as classification.
 *
 * Dependency direction: `parser/` only -- this module must not import
 * knowledge, reasoners, semantic, or engine code.
 */
import { normalizeCapturedValue } from "./sideEffectSafety";

/** Relation words a Legacy statement may be normalized into. */
const IS_A_RELATION = "属于";
const LEGACY_IDENTITY_RELATION = "是";
/** Wrapper meaning "a kind of", e.g. "一种哺乳动物" == "哺乳动物" under 属于. */
const KIND_OF_PREFIX = "一种";

/**
 * Teaching cues that may precede a statement. Mirrors the `teaching` entry's
 * aliases in `semantic/lexicon.ts` plus the bare imperative `记住`, which is
 * how the product prompt actually asks a user to teach a fact. Longest first,
 * so a compound cue is preferred over its own prefix.
 */
const TEACHING_CUE_ALIASES: readonly string[] = Object.freeze([
  "告诉你一个知识",
  "记住这个事实",
  "记住",
  "教你",
]);

/** A cue may be joined to the fact by whitespace or punctuation. */
const CUE_SEPARATOR = /^[\s,，:：]/u;
/**
 * Remove one leading teaching cue from `raw` when `isTaught` accepts what
 * follows it. Returns the input unchanged when no cue is present or the
 * remainder is not the fact being taught, so callers may apply it
 * unconditionally.
 *
 * The single decision this makes is whether the text after a cue is the thing
 * being taught or a sentence ABOUT the cue. Every caller supplies the test
 * for its own grammar: a statement must find a relation, a name must match a
 * name pattern. Without that test `记住这个事实是真的` would be reduced to
 * `是真的`, inventing a subject the user never stated.
 */
export function stripTeachingCuePrefixWhen(
  raw: string,
  isTaught: (remainder: string) => boolean,
): string {
  const trimmed = raw.trim();
  for (const alias of TEACHING_CUE_ALIASES) {
    if (!trimmed.startsWith(alias)) continue;
    // `记住: 猫 属于 哺乳动物` -> drop the separator the cue was joined with.
    const remainder = trimmed.slice(alias.length).replace(CUE_SEPARATOR, "").trim();
    if (remainder.length !== 0 && isTaught(remainder)) return remainder;
  }
  return trimmed;
}

/**
 * A relation needs something on both sides: `记住这个事实是真的` leaves
 * `是真的`, and "真" is a predicate, not the object of the relation 是.
 */
const CLAUSE_RELATION_HAS_BOTH_SIDES =
  /[^的了]\s*(?:属于|是一种|算是|归类为|指的是|意思是|喜欢|拥有|具备|位于|是|会|能|有|在)\s*(?!真|假|这样|那样)([^\s])/u;

/** `stripTeachingCuePrefixWhen` specialized to the statement grammar. */
export function stripTeachingCuePrefix(raw: string): string {
  return stripTeachingCuePrefixWhen(
    raw,
    (remainder) => CLAUSE_RELATION_HAS_BOTH_SIDES.test(remainder),
  );
}

/**
 * Canonical persisted form of a parsed statement.
 *
 * @param hasIsACue whether the Semantic extraction recognized an is-a
 *   concept (`属于`/`是一种`/`算是`/`归类为`) in the original input. Only a
 *   recognized cue may turn `是` into `属于`; a Legacy-only parse without
 *   Semantic analysis keeps its literal relation.
 */
export function canonicalStatementTriple(
  subject: string,
  relation: string,
  object: string,
  negated: boolean,
  hasIsACue: boolean,
): readonly [string, string, string, boolean] {
  let canonicalRelation = relation.trim();
  let canonicalObject = object.trim();

  if (
    canonicalRelation === LEGACY_IDENTITY_RELATION &&
    hasIsACue
  ) {
    canonicalRelation = IS_A_RELATION;
  }
  if (
    canonicalRelation === IS_A_RELATION &&
    canonicalObject.startsWith(KIND_OF_PREFIX) &&
    canonicalObject.length > KIND_OF_PREFIX.length
  ) {
    canonicalObject = canonicalObject.slice(KIND_OF_PREFIX.length).trim();
  }

  return Object.freeze([
    normalizeCapturedValue(subject),
    canonicalRelation,
    normalizeCapturedValue(canonicalObject),
    negated,
  ]);
}
