/**
 * Location query pattern: "A在哪里" / "A位于哪里"
 *
 * Unlike the other query patterns, this is not parameterized by relation — it
 * is always about the built-in spatial relation `CoreRelations.LocatedIn`
 * ("在"). It is kept as its own file (rather than folded into
 * `createObjectOfPattern`) because "哪里" is a distinct question word from
 * "什么", so forcing it through the generic factory would require a special
 * case there — one dedicated pattern is clearer than a leaky abstraction.
 *
 * The relation half comes from `relationVocabulary.ts` so that a relation word
 * which can be TAUGHT can also be ASKED ABOUT: teaching only understood
 * `猫在屋顶`, while the question only understood `猫在哪里`, so `猫位于哪里`
 * was unanswerable even after `猫位于屋顶` was stored.
 */
import type { GrammarPattern, Relation } from "@/types";
import { CoreRelations } from "@/types";
import { escapeRegExp } from "@/utils";

const LOCATION_QUESTION_WORDS: readonly string[] = Object.freeze([
  "哪里",
  "哪儿",
  "什么地方",
]);

function locationPattern(relationAliases: readonly string[]): RegExp {
  const relationPattern = [...relationAliases]
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .map(escapeRegExp)
    .join("|");
  const questionPattern = [...LOCATION_QUESTION_WORDS]
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .map(escapeRegExp)
    .join("|");
  return new RegExp(`^(.+?)(?:${relationPattern})(?:${questionPattern})$`, "u");
}

export function createLocatePattern(
  relationAliases: readonly string[] = [CoreRelations.LocatedIn],
): GrammarPattern {
  const pattern = locationPattern(relationAliases);

  return {
    name: "query:locate",
    match(normalizedInput) {
      const matched = pattern.exec(normalizedInput);
      if (!matched) return null;

      const [, subject] = matched;
      if (!subject) return null;

      return {
        type: "query",
        subject,
        // The canonical relation, never the surface alias that matched.
        relation: CoreRelations.LocatedIn satisfies Relation,
        kind: "locate",
        raw: normalizedInput,
      };
    },
  };
}
