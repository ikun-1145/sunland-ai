/**
 * Open ("object-of") query patterns: "A <关系>什么"
 *
 * Asks the reasoning engine to fill in the object of a relation, e.g.:
 *   猫属于什么   → find X such that 猫 属于 X
 *   猫是什么     → find X such that 猫 是 X
 *   鸟会什么     → find X such that 鸟 会 X
 *
 * Same rationale as `createStatementPattern`: one shared shape, factored into
 * a single factory parameterized by relation.
 *
 * The relation's surface words come from `relationVocabulary.ts` (longest
 * first, so `是一种` is never read as `是`), but matching still runs against the
 * whitespace-stripped input: the whitespace-tolerant character chain that
 * `createStatementPattern` needs for RAW input would turn `是什么` into a
 * nonsense `是\s*什\s*么` alternation here.
 */
import type { GrammarPattern, Relation } from "@/types";
import { escapeRegExp } from "@/utils";

export function createObjectOfPattern(
  relation: Relation,
  aliases: readonly string[] = [relation],
): GrammarPattern {
  const relationPattern = [...aliases]
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .map(escapeRegExp)
    .join("|");
  const pattern = new RegExp(`^(.+?)(?:${relationPattern})什么$`, "u");

  return {
    name: `query:object-of:${relation}`,
    match(normalizedInput) {
      const matched = pattern.exec(normalizedInput);
      if (!matched) return null;

      const [, subject] = matched;
      if (!subject) return null;

      return {
        type: "query",
        subject,
        // The canonical relation, never the surface alias that matched.
        relation,
        kind: "object-of",
        raw: normalizedInput,
      };
    },
  };
}
