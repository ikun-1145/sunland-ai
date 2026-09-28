import {
  hasExplicitSideEffectProhibition,
  hasUnsafeLegacySideEffectStructure,
} from "@/parser/sideEffectSafety";
import { canonicalStatementTriple } from "@/parser/teachingCanonical";
import { normalizeSemanticMatchText } from "./normalize";
import type {
  ParseResult,
  ParsedIntent,
  ParsedStatement,
} from "@/types";
import type {
  SemanticAnalysis,
  SemanticCandidate,
  UnderstandingDecision,
} from "./types";

export type LegacySideEffectAdmissionReason =
  | "not-a-side-effect"
  | "semantic-side-effect-confirmed"
  | "semantic-clarification-required"
  | "semantic-side-effect-rejected"
  | "semantic-side-effect-not-accepted"
  | "negation-detected"
  | "question-detected"
  | "missing-required-slot"
  | "compound-or-conflicting-side-effect"
  | "side-effect-interpretation-mismatch"
  | "explicit-prohibition"
  | "unsafe-input-structure";

export type LegacySideEffectAdmission =
  | {
      readonly kind: "allow-legacy-side-effect";
      readonly reason: "semantic-side-effect-confirmed";
    }
  | {
      readonly kind: "allow-passive-legacy";
      readonly reason: "not-a-side-effect";
    }
  | {
      readonly kind: "block-and-clarify";
      readonly reason: "semantic-clarification-required";
      readonly decision: Extract<
        UnderstandingDecision,
        { readonly kind: "clarify" }
      >;
    }
  | {
      readonly kind: "block-and-no-understanding";
      readonly reason: Exclude<
        LegacySideEffectAdmissionReason,
        | "not-a-side-effect"
        | "semantic-side-effect-confirmed"
        | "semantic-clarification-required"
      >;
    }
  | {
      readonly kind: "reject";
      readonly reason: "side-effect-interpretation-mismatch";
    };

type LegacySideEffectResult = ParsedStatement | ParsedIntent;

const GREETING_PREFIX =
  /^(?:你好|您好|嗨|哈喽|hello|hi)[,，]\s*/iu;

function isRememberNameResult(
  result: ParseResult,
): result is ParsedIntent {
  return (
    result.type === "intent" &&
    result.intent === "RememberName"
  );
}

export function isLegacySideEffectResult(
  result: ParseResult,
): result is LegacySideEffectResult {
  return result.type === "statement" || isRememberNameResult(result);
}

/**
 * A negated statement whose negation is fully absorbed into the triple: the
 * parser captured a real subject, a real object, and the `negated` flag, so
 * `{s, r, o, true}` is the proposition the user asserted. Anything less (an
 * empty or missing side, a failed parse) is NOT complete, and a negation on an
 * incomplete reading is what makes a write unsafe -- "猫不会" could be denying
 * anything.
 */
function isCompleteNegatedStatement(result: ParseResult): boolean {
  return (
    result.type === "statement" &&
    result.negated &&
    result.subject.trim().length > 0 &&
    result.relation.trim().length > 0 &&
    result.object.trim().length > 0
  );
}

function effectiveSideEffect(candidate: SemanticCandidate): boolean {
  return (
    candidate.sideEffect !== "none" ||
    candidate.result?.type === "statement" ||
    (candidate.result?.type === "intent" &&
      candidate.result.intent === "RememberName")
  );
}


/**
 * The comparison key for an approved knowledge write.
 *
 * Delegates relation/object normalization to the SAME pure function the
 * Legacy statement pattern now applies before persisting (`parser/
 * teachingCanonical.ts`), so the key a write is approved under and the fact
 * that actually reaches the store cannot drift apart. Keeping a second,
 * private copy of the `是`->`属于` / `一种` rules here is exactly how
 * `猫是一种哺乳动物` was once approved as `猫 属于 哺乳动物` and then stored
 * as `猫 是 一种哺乳动物`.
 */
function normalizedStatementParts(
  statement: ParsedStatement,
  analysis: SemanticAnalysis,
): readonly [string, string, string, boolean] {
  const hasIsAConcept = analysis.extraction.relations.some(
    ({ conceptId }) => conceptId === "is-a",
  );
  const [subject, relation, object, negated] = canonicalStatementTriple(
    statement.subject,
    statement.relation,
    statement.object,
    statement.negated,
    hasIsAConcept,
  );
  // `指的是`/`意思是` are the same "means" relation under two surface words.
  const canonicalRelation =
    relation === "指的是" ? "意思是" : relation;
  return Object.freeze([
    normalizeSemanticMatchText(subject),
    canonicalRelation,
    normalizeSemanticMatchText(object),
    negated,
  ]);
}

function sideEffectInterpretationKey(
  result: ParseResult | null,
  analysis: SemanticAnalysis,
): string | null {
  if (result?.type === "statement") {
    return `knowledge:${normalizedStatementParts(result, analysis).join("|")}`;
  }
  if (
    result?.type === "intent" &&
    result.intent === "RememberName"
  ) {
    const name = result.entities[0];
    return name === undefined
      ? null
      : `memory:name:${normalizeSemanticMatchText(name)}`;
  }
  return null;
}

function acceptedCandidates(
  decision: UnderstandingDecision,
): readonly SemanticCandidate[] {
  return decision.kind === "accept"
    ? Object.freeze([
        decision.selectedCandidate,
        ...decision.secondaryCandidates,
      ])
    : Object.freeze([]);
}

function isAcceptedReadOnlyQuestionRepair(
  decision: UnderstandingDecision,
  legacyResult: ParseResult,
  analysis: SemanticAnalysis,
): boolean {
  if (
    legacyResult.type !== "statement" ||
    decision.kind !== "accept" ||
    analysis.extraction.questionCues.length === 0
  ) {
    return false;
  }

  const candidate = decision.selectedCandidate;
  return (
    candidate.producer === "relation-pattern" &&
    candidate.sideEffect === "none" &&
    candidate.missingSlots.length === 0 &&
    candidate.result?.type === "query" &&
    candidate.evidence.some(({ kind }) => kind === "question-cue")
  );
}

function distinctCompleteSideEffects(
  analysis: SemanticAnalysis,
): ReadonlySet<string> {
  return new Set(
    analysis.candidates
      .filter(effectiveSideEffect)
      .filter(
        (candidate) =>
          candidate.result !== null &&
          candidate.result.type !== "unknown" &&
          candidate.missingSlots.length === 0,
      )
      .map((candidate) =>
        sideEffectInterpretationKey(candidate.result, analysis),
      )
      .filter((key): key is string => key !== null),
  );
}

function structuralInputFor(
  legacyResult: LegacySideEffectResult,
): string {
  return isRememberNameResult(legacyResult)
    ? legacyResult.raw.trim().replace(GREETING_PREFIX, "")
    : legacyResult.raw;
}

function block(
  reason: Extract<
    LegacySideEffectAdmission,
    { readonly kind: "block-and-no-understanding" }
  >["reason"],
): LegacySideEffectAdmission {
  return Object.freeze({
    kind: "block-and-no-understanding",
    reason,
  });
}

/**
 * Final, centralized admission gate for Legacy Memory/Knowledge writes.
 * Semantic still never performs a mutation; it only confirms whether the
 * already-parsed Legacy result is safe enough to retain its existing path.
 */
export function evaluateLegacySideEffectFallback(
  semanticDecision: UnderstandingDecision,
  legacyResult: ParseResult,
  analysis: SemanticAnalysis,
): LegacySideEffectAdmission {
  if (!isLegacySideEffectResult(legacyResult)) {
    return Object.freeze({
      kind: "allow-passive-legacy",
      reason: "not-a-side-effect",
    });
  }

  if (semanticDecision.kind === "clarify") {
    return Object.freeze({
      kind: "block-and-clarify",
      reason: "semantic-clarification-required",
      decision: semanticDecision,
    });
  }
  if (semanticDecision.kind === "reject-side-effect") {
    return block("semantic-side-effect-rejected");
  }
  if (semanticDecision.kind !== "accept") {
    return block("semantic-side-effect-not-accepted");
  }

  // A bounded relation-pattern query may repair a Legacy statement matcher
  // that captured a question word as its object (for example "猫在哪").
  // Continuing here would only block a read; it must never admit the Legacy
  // write, so hand control back to the read-only Semantic adapter instead.
  if (
    isAcceptedReadOnlyQuestionRepair(
      semanticDecision,
      legacyResult,
      analysis,
    )
  ) {
    return Object.freeze({
      kind: "allow-passive-legacy",
      reason: "not-a-side-effect",
    });
  }

  // A negation on a COMPLETE statement is a storable fact, not an unsafe
  // write: "企鹅不会飞" is exactly the kind of exception the knowledge base
  // needs, and blocking every negation here made `negated` unreachable on the
  // write path. An incomplete negated reading is still refused below by the
  // completeness checks and by `hasUnsafeLegacySideEffectStructure`, so this
  // no longer needs the blanket veto it used to carry.
  if (
    analysis.extraction.negationCues.length > 0 &&
    !isCompleteNegatedStatement(legacyResult)
  ) {
    return block("negation-detected");
  }
  if (analysis.extraction.questionCues.length > 0) {
    return block("question-detected");
  }
  if (hasExplicitSideEffectProhibition(analysis.input.raw)) {
    return block("explicit-prohibition");
  }
  if (
    hasUnsafeLegacySideEffectStructure(
      structuralInputFor(legacyResult),
    )
  ) {
    return block("unsafe-input-structure");
  }

  const semanticSideEffects = acceptedCandidates(
    semanticDecision,
  ).filter(effectiveSideEffect);
  if (
    semanticSideEffects.length === 0 ||
    semanticSideEffects.some(
      (candidate) =>
        candidate.result === null ||
        candidate.missingSlots.length > 0,
    )
  ) {
    return block(
      semanticSideEffects.length === 0
        ? "semantic-side-effect-not-accepted"
        : "missing-required-slot",
    );
  }

  if (distinctCompleteSideEffects(analysis).size > 1) {
    return block("compound-or-conflicting-side-effect");
  }

  const legacyKey = sideEffectInterpretationKey(
    legacyResult,
    analysis,
  );
  const semanticKeys = new Set(
    semanticSideEffects
      .map((candidate) =>
        sideEffectInterpretationKey(candidate.result, analysis),
      )
      .filter((key): key is string => key !== null),
  );
  if (legacyKey === null || !semanticKeys.has(legacyKey)) {
    return Object.freeze({
      kind: "reject",
      reason: "side-effect-interpretation-mismatch",
    });
  }

  return Object.freeze({
    kind: "allow-legacy-side-effect",
    reason: "semantic-side-effect-confirmed",
  });
}
