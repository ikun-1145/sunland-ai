/**
 * Reasoning engine contracts — the core of the system.
 *
 * Every conclusion carries a full, human-readable derivation. Reasoning is
 * purely symbolic: no machine learning, no hidden state.
 */
import type { KnowledgeRecord, Triple } from "./knowledge";
import type { KnowledgeQuery } from "./knowledgeStore";
import type { ParsedQuery } from "./parser";

/** One atomic derivation step, e.g. applying transitivity once. */
export interface ReasoningStep {
  /** Which rule produced this step (matches InferenceRule.id). */
  readonly ruleId: string;
  /** Human-readable narration, e.g. "猫 属于 哺乳动物，哺乳动物 属于 动物 ⇒ 猫 属于 动物". */
  readonly description: string;
  /** Facts consumed by this step. */
  readonly premises: readonly Triple[];
  /** Fact derived by this step. */
  readonly conclusion: Triple;
}

/** A derived (or directly-known) fact together with its justification. */
export interface Inference {
  readonly conclusion: Triple;
  /** Aggregated confidence in [0, 1]. */
  readonly confidence: number;
  /** Ordered derivation chain (empty for directly-known facts). */
  readonly steps: readonly ReasoningStep[];
  /** Node path for visualization, e.g. ["猫", "哺乳动物", "动物"]. */
  readonly path: readonly string[];
}

/** Stable, auditable identifier for the rule that decided a conflict. */
export type ConflictStrategy =
  /** A directly-known fact outranks a derived one, regardless of polarity. */
  | "direct-over-derived"
  /** Same directness, higher `confidence` wins. */
  | "higher-confidence"
  /** Same directness and confidence, higher `source` authority wins. */
  | "source-authority"
  /** Same directness, confidence and source: the newer record wins. */
  | "more-recent"
  /** Every key tied; `id` ordering makes the result total and input-irrelevant. */
  | "total-order-id";

/**
 * A detected contradiction between two assertions of the SAME proposition, and
 * the rule that decided which one is shown.
 *
 * Only `negated` may differ between winner and suppressed: a different object or
 * relation is a different proposition, and those coexist rather than conflict.
 * Note what this type deliberately does NOT have -- any notion of a modified,
 * overwritten or deleted fact. Adjudication is a read-time view; the store still
 * holds every original assertion.
 */
export interface Conflict {
  /** Human-readable account, including which rule applied and why. */
  readonly description: string;
  /** The assertion that is shown. */
  readonly winner: Triple;
  /**
   * The assertion(s) held back from the answer set, still stored and still
   * explainable. An array because one winner can outrank several records
   * asserting the same opposing proposition (a restored snapshot is untrusted
   * input and may repeat a triple under different ids).
   */
  readonly suppressed: readonly Triple[];
  /** Which comparison key decided it; see `ConflictStrategy`. */
  readonly strategy: ConflictStrategy;
}

/** The complete answer to a query, fully explainable. */
export interface ReasoningResult {
  readonly query: ParsedQuery;
  /** Zero or more supported answers, best first. */
  readonly answers: readonly Inference[];
  readonly conflicts: readonly Conflict[];
  /** Natural-language summary assembled from steps + conflicts. */
  readonly explanation: string;
}

/**
 * A pluggable inference rule (Strategy pattern).
 *
 * Rules are pure: given the current facts they emit new inferences without
 * mutating the store. New reasoning capabilities (temporal, probabilistic,
 * planning...) are added by registering more rules.
 */
export interface InferenceRule {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /**
   * Derive inferences reachable from `known`. Implementations should be
   * deterministic and side-effect free.
   */
  apply(known: KnowledgeQuery): readonly Inference[];
}

/** Resolves contradictions among competing facts/inferences. */
export interface ConflictResolver {
  readonly id: string;
  /** Return the conflicts found within the candidate set. */
  detect(candidates: readonly Inference[], known: KnowledgeQuery): readonly Conflict[];
}

/**
 * Top-level reasoning facade. Different algorithms (forward chaining,
 * backward chaining, ...) can implement this without changing callers.
 */
export interface Reasoner {
  readonly id: string;
  answer(query: ParsedQuery, known: KnowledgeQuery): ReasoningResult;
  /** Full forward-closure of derivable facts, used for visualization/debug. */
  materialize(known: KnowledgeQuery): readonly Inference[];
}

/** Convenience alias when a rule needs the concrete records, not just triples. */
export type FactSet = readonly KnowledgeRecord[];
