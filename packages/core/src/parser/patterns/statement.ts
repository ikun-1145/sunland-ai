/**
 * Statement patterns: "A [不] <关系> B"
 *
 * Covers every declarative fact the user can teach the system, e.g.:
 *   猫属于哺乳动物   → { subject: "猫", relation: "属于", object: "哺乳动物", negated: false }
 *   企鹅不会飞       → { subject: "企鹅", relation: "会",  object: "飞",      negated: true  }
 *
 * `createStatementPattern` is a factory, not a one-off pattern, because every
 * core relation (属于/是/会/喜欢/在) shares an IDENTICAL grammar shape — only
 * the relation word differs. Factoring this out means adding a brand new
 * relation is a single line in `registry.ts`, never a copy-pasted regex.
 */
import type { GrammarPattern, Relation } from "@/types";
import { escapeRegExp } from "@/utils";
import {
  canonicalStatementTriple,
  stripTeachingCuePrefix,
} from "../teachingCanonical";
import {
  hasUnsafeLegacySideEffectStructure,
  normalizeCapturedValue,
} from "../sideEffectSafety";

function whitespaceTolerantLiteral(value: string): string {
  return [...value]
    .map((character) => escapeRegExp(character))
    .join("\\s*");
}

export function createStatementPattern(
  relation: Relation,
  aliases: readonly string[] = [relation],
): GrammarPattern {
  const relationPattern = [...aliases]
    .sort((left, right) => right.length - left.length)
    .map(whitespaceTolerantLiteral)
    .join("|");
  // group 1: subject (non-greedy)   group 2: optional negation "不"
  // group 3: object. Matching raw input preserves meaningful entity spaces.
  const pattern = new RegExp(
    `^\\s*(.+?)\\s*(不|没)?\\s*(?:${relationPattern})\\s*(.+?)\\s*[。.!！]*\\s*$`,
    "u",
  );

  return {
    name: `statement:${relation}`,
    match(normalizedInput, rawInput) {
      // Safety is judged on exactly what the user typed, before any wrapper is
      // removed: stripping a cue must never be able to turn an input that the
      // gate would reject into one it accepts.
      const raw = rawInput ?? normalizedInput;
      if (hasUnsafeLegacySideEffectStructure(raw)) {
        return null;
      }

      const input = stripTeachingCuePrefix(raw);
      const matched = pattern.exec(input);
      if (!matched) return null;

      const [, subject, negationMarker, object] = matched;
      if (!subject || !object) return null;
      const cleanSubject = normalizeCapturedValue(subject);
      const cleanObject = normalizeCapturedValue(object);
      if (!cleanSubject || !cleanObject) return null;

      const [canonicalSubject, canonicalRelation, canonicalObject] =
        canonicalStatementTriple(
          cleanSubject,
          relation,
          cleanObject,
          negationMarker === "不" || negationMarker === "没",
          // The relation vocabulary this pattern itself was registered with is
          // the only is-a evidence available at the Legacy layer: `是一种` is
          // an alias of the is-a relation, so matching it always means
          // classification, and so does a bare `是` whose object carries the
          // `一种...` wrapper. A plain `是` with an unrelated object stays
          // identity (苏格拉底 是 人). Semantic promotion is decided in
          // `canonicalStatementTriple` via the write gate.
          relation === "是一种" || cleanObject.startsWith("一种"),
        );

      return {
        type: "statement",
        subject: canonicalSubject,
        relation: canonicalRelation,
        object: canonicalObject,
        negated: negationMarker === "不" || negationMarker === "没",
        raw,
      };
    },
  };
}
