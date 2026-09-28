/**
 * Bounded multi-fact teaching: split one teaching turn into several facts.
 *
 * This module is PURE and only performs shape recognition. It does not parse,
 * normalize, gate or write anything -- each returned segment is fed through the
 * ordinary single-fact pipeline (canonicalization -> parser -> safety gate) by
 * the caller, so multi-fact teaching can never relax what counts as a valid
 * fact. It only relaxes how many valid facts one turn may contain.
 *
 * Two things make this safe rather than a bypass:
 *
 *   1. It splits ONE level deep, never recursively, with a hard segment ceiling
 *      (`MULTI_FACT_LIMITS`). A segment that still contains a separator is
 *      rejected by the per-segment clause-boundary check.
 *   2. The turn-level envelope gate (`hasUnsafeMultiFactTurnStructure`) runs
 *      BEFORE splitting, so prohibitions, question structure and choice markers
 *      cannot be hidden in one clause while another clause is written.
 *
 * Dependency direction: `parser/` only (sideEffectSafety + textNormalize), so
 * any layer may import it without a cycle.
 */
import {
  countKnownRelationMentions,
  hasChoiceOrSequenceStructure,
  hasExplicitSideEffectProhibition,
  hasInternalClauseBoundary,
  hasQuestionStructure,
  LEGACY_SIDE_EFFECT_LIMITS,
  normalizeCapturedValue,
  stripTrailingDeclarativePunctuation,
} from "./sideEffectSafety";
import { RegexParser } from "./parser";
import { stripTeachingCuePrefix } from "./teachingCanonical";

/**
 * Multi-fact limits. Every bound is a named constant so a turn's blast radius is
 * auditable rather than implicit.
 *
 * These live here, not in `sideEffectSafety.ts`, because that module is
 * re-exported by `parser/index.ts` and therefore reaches the frozen public SDK
 * surface. Adding runtime constants there would change the 70-export contract.
 */
export const MULTI_FACT_LIMITS = Object.freeze({
  /** How many facts one turn may teach. */
  maxFactsPerTurn: 4,
  /**
   * Splitting is ONE level deep, never recursive, so the segment ceiling equals
   * the fact ceiling and there is no combinatorial growth.
   */
  maxSegments: 4,
});

/**
 * Separators that may divide one teaching turn into several facts.
 *
 * Deliberately a whitelist of pure clause separators, each dividing two
 * statements that are independently complete.
 *
 * NOT included, on purpose:
 *   - `、` (enumerating comma): joins sibling subjects sharing one predicate
 *     ("猫、狗喜欢肉"), a different structure needing its own design.
 *   - `\n`/`\r`: same shape as the clause boundary the single-fact path already
 *     rejects; users can use punctuation.
 *   - `或者`/`或是`/`还是` (choice) and `而且`/`并且`/`同时`/`接着`/`另外`/
 *     `然后` (sequence): still refused, because they change what is being
 *     asserted rather than merely joining assertions.
 */
export const MULTI_FACT_SEPARATORS: readonly string[] = Object.freeze([
  "，",
  "；",
  "。",
  ";",
  ",",
]);

/**
 * Markers that may open a continuation segment whose SUBJECT is inherited from
 * the immediately preceding segment ("猫会飞，也会游泳").
 *
 * A marker is never stripped as a bare string prefix -- see
 * `continuationRemainder`, which requires the marker to be the ENTIRE subject a
 * standalone parse produces. Stripping by prefix would turn the country name in
 * "也门属于亚洲" into the subject "门".
 */
export const CONTINUATION_MARKERS: readonly string[] = Object.freeze([
  "也",
  "还",
  "同样",
]);

/**
 * TURN-LEVEL envelope gate.
 *
 * Conditions that belong to the turn as a whole and CANNOT be delegated to
 * segments, because splitting would otherwise let them be bypassed: a
 * prohibition can sit in one clause while another clause still gets written
 * ("不要记住猫会飞，猫会游泳").
 *
 * Deliberately excludes the two checks that are inherent properties of
 * single-fact input -- `maxRelationMentions` and the internal clause boundary.
 * Those would reject any multi-fact turn by construction, so they stay in
 * `hasUnsafeLegacySideEffectStructure` and are applied PER SEGMENT, after
 * continuation completion, where each segment is once again a single fact.
 */
export function hasUnsafeMultiFactTurnStructure(raw: string): boolean {
  const input = raw.trim();
  return (
    input.length === 0 ||
    input.length > LEGACY_SIDE_EFFECT_LIMITS.maxInputLength ||
    hasQuestionStructure(input) ||
    // A choice/sequence marker anywhere makes the whole turn's assertion
    // ambiguous ("猫会飞或者猫会游泳" asserts neither deterministically), so it
    // is a turn-level refusal rather than a per-segment one.
    hasChoiceOrSequenceStructure(input) ||
    hasExplicitSideEffectProhibition(input)
  );
}

/** Built once: the default grammar is immutable. */
const parser = new RegexParser();

export type MultiFactSplit =
  /** Not a multi-fact turn: the ordinary single-fact path should handle it. */
  | { readonly kind: "single" }
  /** A turn to reject outright, with a machine-readable reason. */
  | { readonly kind: "rejected"; readonly reason: MultiFactRejection }
  /** Two or more segments, each independently completable to one fact. */
  | { readonly kind: "segments"; readonly segments: readonly MultiFactSegment[] };

export type MultiFactRejection =
  | "empty-input"
  | "too-long"
  | "question-structure"
  | "choice-or-sequence"
  | "explicit-prohibition"
  | "too-many-segments"
  | "empty-segment"
  | "corrupted-subject"
  | "continuation-without-context"
  | "enumerating-comma";

export interface MultiFactSegment {
  /** The segment text as written, for reporting. */
  readonly raw: string;
  /**
   * Set when the segment opened with a continuation marker and therefore needs
   * its subject supplied by the previous segment. `remainder` is the text after
   * the marker, already verified to be a relation-bearing clause.
   */
  readonly continuation?: { readonly marker: string; readonly remainder: string };
  /**
   * Text to teach instead of `raw`, set when the Legacy parser folded a shared
   * continuation marker into the subject and dropping it yields a statement
   * ("鸟也不会飞" -> "鸟不会飞"). The caller uses this verbatim.
   */
  readonly repairedText?: string;
}

function splitOnSeparators(raw: string): readonly string[] {
  // Longest separator first so multi-character forms win, and split on a
  // character class built from the whitelist only.
  const pattern = new RegExp(
    MULTI_FACT_SEPARATORS.map((separator) =>
      separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
      .sort((left, right) => right.length - left.length)
      .join("|"),
    "gu",
  );
  return raw.split(pattern);
}

/**
 * Repair a subject that the Legacy parser allowed a shared continuation marker
 * to creep into: "鸟也不会飞" parses with subject "鸟也" instead of "鸟", so
 * teaching it would store the corrupted entity "鸟也".
 *
 * That folding is PRE-EXISTING parser behaviour, not something multi-fact
 * splitting introduces, but B.8 must not turn it into a silent write.
 *
 * The repair is bounded twice over:
 *   1. the marker must be at the TAIL of the parsed subject, and
 *   2. removing it must still leave a segment that parses as a statement.
 *
 * Condition 2 is what separates "鸟也" (entity + stray marker -> repair to "鸟",
 * which parses) from "也门" (a real entity that merely STARTS with a marker --
 * the marker is not at the tail, and no repair is attempted). Nothing is
 * rewritten on a guess: the repaired text must independently parse.
 */
export function repairSharedMarkerSubject(
  segment: string,
  parsedSubject: string,
): string | null {
  const subject = normalizeCapturedValue(parsedSubject);
  for (const marker of CONTINUATION_MARKERS) {
    if (subject.length <= marker.length || !subject.endsWith(marker)) continue;
    // The marker occupies the tail of the subject, so it is the same character
    // position in the segment (the subject is a prefix of the segment).
    const index = subject.length - marker.length;
    const repaired = normalizeCapturedValue(
      segment.slice(0, index) + segment.slice(subject.length),
    );
    if (repaired.length === 0) continue;
    if (hasInternalClauseBoundary(repaired)) continue;
    if (countKnownRelationMentions(repaired) !== 1) continue;
    if (parser.parse(repaired).type !== "statement") continue;
    return repaired;
  }
  return null;
}

/** True when the parsed subject ends with a continuation marker. */
export function subjectEndsWithMarker(parsedSubject: string): boolean {
  const subject = normalizeCapturedValue(parsedSubject);
  return CONTINUATION_MARKERS.some(
    (marker) => subject.length > marker.length && subject.endsWith(marker),
  );
}

/**
 * Whether `segment` really is a continuation of the previous clause, and if so
 * what remains after its marker.
 *
 * The guard that matters is ENTITY INTEGRITY. Stripping a leading marker by
 * string prefix is unsafe because a marker character is often the first
 * character of an ordinary entity: "也门属于亚洲" (Yemen) is a complete,
 * well-formed statement whose subject is "也门", yet a prefix strip would yield
 * marker "也" plus remainder "门属于亚洲" -- a valid-looking clause with the
 * subject truncated to "门". The same hazard exists for "还" and "同样".
 *
 * So a marker is only a marker when the marker is the ENTIRE subject that a
 * standalone parse produces. "也会游泳" parses alone with subject "也" (exactly
 * the marker) and is a genuine ellipsis; "也门属于亚洲" parses alone with
 * subject "也门", which is longer than the marker, so the marker reading is
 * discarded and the segment keeps its own subject.
 *
 * A relation must also follow the marker, which is what rules out a marker that
 * is merely the head of a relative clause ("会飞的猫属于鸟").
 */
function continuationRemainder(segment: string): string | null {
  if (segment.length < 2) return null;
  for (const marker of CONTINUATION_MARKERS) {
    if (!segment.startsWith(marker)) continue;
    // The marker must be followed by something; a bare marker is not a clause.
    if (segment.length <= marker.length) continue;

    const parsed = parser.parse(segment);
    if (parsed.type !== "statement") continue;
    // ENTITY INTEGRITY: the marker must be the ENTIRE subject the parser saw,
    // not a prefix of it. "也会游泳" parses with subject "也" (== the marker) and
    // is a true ellipsis.
    //
    // This is also what rejects the shared-marker construction
    // "鸟也不会飞", where the parser reads the subject as "鸟也" -- a subject
    // LONGER than the marker. Treating that as a continuation would strip "鸟也"
    // down to "鸟" and mangle the entity, so it must keep its own subject.
    if (normalizeCapturedValue(parsed.subject) !== marker) continue;

    // The remainder starts where the marker ENDS, so a segment whose subject is
    // exactly the marker always has one.
    const remainder = normalizeCapturedValue(segment.slice(marker.length));
    if (remainder.length === 0) continue;
    if (hasInternalClauseBoundary(remainder)) continue;
    if (countKnownRelationMentions(remainder) !== 1) continue;
    return remainder;
  }
  return null;
}

/** Why the turn-level envelope refused this input, or `null` when it passed. */
function envelopeRejection(raw: string): MultiFactRejection | null {
  const input = raw.trim();
  if (input.length === 0) return "empty-input";
  if (input.length > LEGACY_SIDE_EFFECT_LIMITS.maxInputLength) return "too-long";
  if (hasQuestionStructure(input)) return "question-structure";
  if (hasChoiceOrSequenceStructure(input)) return "choice-or-sequence";
  if (hasExplicitSideEffectProhibition(input)) return "explicit-prohibition";
  return null;
}

/**
 * Split a teaching turn into independently-completable facts.
 *
 * Returns `{ kind: "single" }` for anything that is not clearly a multi-fact
 * turn, so the existing single-fact path keeps handling it unchanged.
 */
export function splitTeachingInput(raw: string): MultiFactSplit {
  const envelope = envelopeRejection(raw);
  const pieces = splitOnSeparators(raw);
  const multiClause = hasMultipleSeparatedClauses(raw);

  const segments: MultiFactSegment[] = [];
  for (const piece of pieces) {
    const trimmed = piece.trim();
    if (trimmed.length === 0) {
      // Leading, trailing or doubled separators produce empty pieces. Only a
      // refusal when the input is otherwise a multi-clause teaching turn; a lone
      // "，" is just input the single-fact path should handle (and reject).
      if (!multiClause) return { kind: "single" };
      return { kind: "rejected", reason: "empty-segment" };
    }
    const remainder = continuationRemainder(trimmed);
    if (remainder !== null) {
      segments.push(
        Object.freeze({
          raw: trimmed,
          continuation: Object.freeze({
            marker: trimmed.slice(0, trimmed.length - remainder.length).trim(),
            remainder,
          }),
        }),
      );
      continue;
    }

    // Not a continuation. Check whether a shared marker leaked into the subject.
    const parsed = parser.parse(stripTeachingCuePrefix(trimmed));
    if (parsed.type === "statement" && subjectEndsWithMarker(parsed.subject)) {
      const repaired = repairSharedMarkerSubject(trimmed, parsed.subject);
      if (repaired === null) {
        // The subject is corrupted and cannot be repaired without guessing, so
        // the turn is refused rather than stored with a mangled entity.
        return { kind: "rejected", reason: "corrupted-subject" };
      }
      segments.push(Object.freeze({ raw: trimmed, repairedText: repaired }));
      continue;
    }
    segments.push(Object.freeze({ raw: trimmed }));
  }

  // A continuation segment in first position has no clause to continue, so its
  // marker would become a subject ("也会游泳" -> {也, 会, 游泳}). The input IS
  // shaped like teaching, so this is a refusal rather than ordinary
  // conversation.
  if (segments[0]?.continuation !== undefined) {
    return { kind: "rejected", reason: "continuation-without-context" };
  }

  // `、` joins sibling subjects sharing one predicate ("猫、狗喜欢肉"), which this
  // batch does not support. It is REFUSED rather than left to the single-fact
  // path, which would store the subject "猫、狗".
  if (raw.includes("、") && segments.length >= 1 && raw.trim().length > 0) {
    return { kind: "rejected", reason: "enumerating-comma" };
  }

  // Multi-fact teaching engages ONLY when every segment is a teachable
  // statement. "这个 bug 我搞了一下午还是不行，你帮我看看为什么" is one companion
  // turn that happens to contain a comma: splitting it would change its meaning,
  // so it is handed back to the ordinary pipeline untouched. This check comes
  // BEFORE the envelope so a non-teaching turn is never refused for a reason
  // (choice cue, question) that only makes sense for teaching.
  // Not every segment is a teachable statement, so this is not a multi-fact
  // teaching turn at all -- it is ordinary conversation that happens to contain
  // a comma ("这个 bug 我搞了一下午还是不行，你帮我看看为什么" is ONE companion
  // turn). The whole input goes back to the normal pipeline untouched, and the
  // envelope is deliberately NOT applied: its conditions only mean something for
  // a teaching attempt.
  if (!canTeachEverySegment(segments)) return { kind: "single" };

  // From here the turn IS a multi-fact teaching attempt (or a single teachable
  // fact), so envelope violations are refusals: those conditions cannot be
  // delegated to segments.
  if (envelope !== null) return { kind: "rejected", reason: envelope };

  if (segments.length > MULTI_FACT_LIMITS.maxSegments) {
    return { kind: "rejected", reason: "too-many-segments" };
  }
  if (segments.length < 2) return { kind: "single" };

  return { kind: "segments", segments: Object.freeze(segments) };
}

/**
 * Whether every segment could be taught as a statement, completing
 * continuations as it goes. Used only to decide whether this turn is really a
 * multi-fact teaching attempt; it performs no writes.
 */
function canTeachEverySegment(segments: readonly MultiFactSegment[]): boolean {
  let previousSubject: string | null = null;
  for (const segment of segments) {
    const text = segment.repairedText ?? (
      segment.continuation === undefined
        ? segment.raw
        : previousSubject === null
          ? null
          : `${previousSubject}${segment.continuation.remainder}`
    );
    if (text === null) return false;
    const parsed = parser.parse(stripTeachingCuePrefix(text));
    if (parsed.type !== "statement") return false;
    previousSubject = parsed.subject;
  }
  return true;
}

/** True when the input contains a whitelisted separator joining two clauses. */
function hasMultipleSeparatedClauses(raw: string): boolean {
  const stripped = stripTrailingDeclarativePunctuation(raw);
  return splitOnSeparators(stripped).filter((piece) => piece.trim().length > 0).length > 1;
}
