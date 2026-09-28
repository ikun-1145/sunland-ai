/**
 * Personality contracts.
 *
 * A Personality controls ONLY language style: opener/closer phrasing, tone,
 * and (sparing) emoji use. It is the final "Answer Generation" step of the
 * pipeline — it renders content that Parser / Knowledge / Reasoner have
 * ALREADY finalized. It must never:
 *   - alter a fact (subject/relation/object/negated)
 *   - alter a confidence score
 *   - alter a reasoning step or conflict
 *   - decide what is true
 *
 * This boundary is enforced structurally, not just by convention:
 * `ResponseContext` only ever carries already-computed, read-only data
 * (`ReasoningResult`, `KnowledgeRecord`, `ParseFailure`), so a Personality
 * implementation has no data of its own to reason with — it can only
 * transform already-finalized facts into text.
 *
 * Dependency direction is one-way:
 *   parser / knowledge / reasoners / memory  →  personality  →  ui
 * Personality must never be imported BY those upstream modules.
 */
import type { KnowledgeRecord } from "./knowledge";
import type { MemoryKey } from "./memory";
import type { IdentityAspect, ParseFailure } from "./parser";
import type { ClarificationPlan, ResponsePlan } from "./planner";
import type { ReasoningResult } from "./reasoning";
import type { DialogueTurnContext } from "./dialogue";

/**
 * How a taught fact related to what the store already held. See the
 * `"learned"` member of `ResponseContext` for the exact semantics.
 */
export type LearnedOutcome = "added" | "already-known" | "related-known";

/**
 * One fact taught during a multi-fact turn.
 *
 * `outcome` is computed against the store state at the START of the turn plus
 * the facts taught EARLIER IN THE SAME TURN, so teaching "猫会飞，猫会飞" reports
 * the first as added and the second as already-known -- matching the store's
 * final contents rather than depending on when the write happened.
 */
export interface LearnedFactResult {
  readonly record: KnowledgeRecord;
  readonly outcome: LearnedOutcome;
  readonly relatedExisting?: readonly KnowledgeRecord[];
}

/**
 * Every "moment" a chat-facing module may need styled text for. Adding a new
 * kind of moment (e.g. a future `"farewell"`) is additive — existing
 * personas simply won't have a case for it until updated, which TypeScript's
 * exhaustiveness checking on this union will catch at compile time.
 */
export type ResponseContext =
  /**
   * Answer to a query, already routed through the Response Planner (Stage
   * 7 — see `types/planner.ts`). `result` is kept alongside `plan` purely so
   * a persona can still vary phrasing by the original query (subject/
   * relation/kind), exactly like `raw` elsewhere in this union — Personality
   * must NOT read `result.answers`/`result.explanation` directly to decide
   * WHAT to say; that has already been decided by `plan`. It only ever
   * embeds `plan.explanation` verbatim and reacts to `plan.mode`/
   * `plan.showEvidence`/`plan.isUncertain` for FRAMING (which opener/closer,
   * whether to append an uncertainty hedge) — never re-deriving facts.
   */
  | {
      readonly kind: "reasoning-result";
      readonly result: ReasoningResult;
      readonly plan: ResponsePlan;
      /** Optional turn framing; it may affect tone, never the factual answer. */
      readonly dialogue?: DialogueTurnContext;
    }
  | { readonly kind: "dialogue"; readonly turn: DialogueTurnContext }
  | { readonly kind: "clarification"; readonly plan: ClarificationPlan }
  /**
   * A knowledge fact was taught.
   *
   * `outcome` exists because `KnowledgeStore.add` is idempotent per fact
   * identity and silently returns the already-stored record, so a persona that
   * only saw `record` could not tell a first teaching from a duplicate and
   * announced "记下了" either way -- which is not true the second time.
   *
   *   - `"added"`         the fact is new; nothing related was stored before.
   *   - `"already-known"` the identical canonical fact was already stored.
   *                       Nothing changed, and `record` is the EXISTING record
   *                       (its `id`, `createdAt`, `confidence` and `source` are
   *                       untouched).
   *   - `"related-known"` the store already held facts with the same
   *                       subject+relation but a different object or a
   *                       different `negated`, and they are STILL THERE. The
   *                       new fact is an addition alongside them;
   *                       `relatedExisting` lists them so the reply can show
   *                       what else is known.
   *
   * `"related-known"` deliberately does NOT mean "updated" or "replaced".
   * Nothing is deleted, overwritten, down-weighted or superseded here: the
   * store keeps both facts, so a reply claiming an update would describe a
   * state that does not exist. Deciding which of two related facts wins is the
   * job of a ConflictResolver, not of this layer.
   *
   * Optional so a host constructing this context by hand keeps working;
   * omitted means `"added"`, the historical behaviour.
   */
  | {
      readonly kind: "learned";
      readonly record: KnowledgeRecord;
      readonly outcome?: LearnedOutcome;
      /** Retained facts with the same subject+relation. Never superseded. */
      readonly relatedExisting?: readonly KnowledgeRecord[];
    }
  /**
   * Several facts were taught by ONE turn (B.8). Reported per fact so the reply
   * can be checked against the store, exactly like the single-fact `"learned"`
   * case: a multi-fact turn must not blur which facts actually landed.
   */
  | { readonly kind: "learned-many"; readonly results: readonly LearnedFactResult[] }
  | { readonly kind: "unknown-input"; readonly failure: ParseFailure }
  /**
   * `raw` is OPTIONAL and deliberately not the "fact" of the moment (there is
   * no fact here to protect) — it only lets a persona vary its phrasing by
   * exactly what the user typed ("你好" vs "嗨" vs "Hi" can get different
   * lines), instead of one hardcoded sentence forever. Omit it (e.g. a
   * host-initiated welcome message with no user input behind it) and a
   * persona should still fall back to *some* reasonable default line.
   */
  | { readonly kind: "greeting"; readonly raw?: string }
  | { readonly kind: "thanks"; readonly raw?: string }
  | { readonly kind: "farewell"; readonly raw?: string }
  /**
   * Answer to an Identity question ("你是谁"/"你能做什么"/"是谁开发了你").
   * `facts` are real `KnowledgeRecord`s pulled from a knowledge store by the
   * engine (see `engine/sunlandEngine.ts`'s `answerIdentity`) — NEVER
   * hardcoded text. `subject` is kept alongside `facts` (which may be `[]`
   * if nothing is known yet) so a persona can still refer to *who* was asked
   * about even when it has nothing to say. Personality only frames these
   * facts (opener/closer/emoji); it must not invent new ones, exactly like
   * `"learned"` and `"reasoning-result"` above.
   */
  | {
      readonly kind: "identity";
      readonly aspect: IdentityAspect;
      readonly subject: string;
      readonly facts: readonly KnowledgeRecord[];
      readonly raw?: string;
    }
  /**
   * A fact was just stored in the user's long-term memory (`MemoryManager`,
   * e.g. "我叫刘锡泽" -> `{ key: "name", value: "刘锡泽" }`). Deliberately
   * plain `key`/`value` strings rather than a full `MemoryRecord` -- a
   * persona only ever needs to phrase "I'll remember X", never `id`/
   * timestamps, keeping Personality decoupled from the memory module's
   * storage shape entirely.
   */
  | { readonly kind: "remembered"; readonly key: MemoryKey; readonly value: string; readonly raw?: string }
  /**
   * Answer to a recall question ("我叫什么？"). `value` is `null` when
   * nothing has been remembered yet under `key` -- Personality must
   * degrade gracefully (e.g. "目前你还没有告诉我你的名字。"), never invent a
   * name.
   */
  | { readonly kind: "recalled"; readonly key: MemoryKey; readonly value: string | null; readonly raw?: string }
  | { readonly kind: "error"; readonly message: string };

/**
 * A pluggable persona (Strategy pattern, same shape as InferenceRule /
 * Reasoner). New personas are added by implementing this interface and
 * registering them — the reasoning/knowledge layers never change.
 */
export interface PersonalityProfile {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  /**
   * Render `context` as a final, user-facing string in this persona's voice.
   * Must be pure (no I/O, no mutation, no randomness beyond a value
   * deterministically derived from `context` itself) and must not alter any
   * factual field carried inside `context` — only wrap/frame it.
   */
  respond(context: ResponseContext): string;
}
