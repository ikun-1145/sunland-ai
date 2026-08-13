import type {
  ConversationUnderstanding,
  Emotion,
  EmotionState,
  EventSequence,
  ParseResult,
  SpeechAct,
  TemporalRelation,
  TopicEntity,
  TopicEvent,
  TurnImplication,
  TurnIntent,
  TurnUnderstanding,
  StateTransition,
  UnderstandingCorrection,
  UnderstoodEntity,
  UnderstoodEvent,
  UnderstoodEventType,
  UnderstandingEvidence,
  UnderstandingSource,
  UserMood,
  UserNeed,
} from "@/types";
import type { SemanticAnalysis } from "@/semantic";
import { resolveEventStateCandidates } from "./eventStateResolver";

interface ScoredCandidate<T extends string> {
  readonly value: T;
  readonly confidence: number;
  readonly source: UnderstandingSource;
  readonly evidenceId: string;
}

export interface TurnUnderstandingCandidatePool {
  readonly rawInput: string;
  readonly normalizedInput: string;
  readonly parserResult: ParseResult;
  readonly semanticAnalysis?: SemanticAnalysis;
  readonly conversation: ConversationUnderstanding;
  readonly speechActs: readonly ScoredCandidate<SpeechAct>[];
  readonly intents: readonly ScoredCandidate<TurnIntent>[];
  readonly entities: readonly UnderstoodEntity[];
  readonly events: readonly UnderstoodEvent[];
  readonly stateTransitions: readonly StateTransition[];
  readonly eventSequence: EventSequence;
  readonly temporalRelations: readonly TemporalRelation[];
  readonly correction?: UnderstandingCorrection;
  readonly emotions: readonly ScoredCandidate<Emotion>[];
  readonly needs: readonly ScoredCandidate<UserNeed>[];
  readonly implications: readonly TurnImplication[];
  readonly evidence: readonly UnderstandingEvidence[];
}

export interface CreateTurnCandidatePoolOptions {
  readonly rawInput: string;
  readonly parserResult: ParseResult;
  readonly conversation: ConversationUnderstanding;
  readonly semanticAnalysis?: SemanticAnalysis;
}

const WALLET_DEATH_EXPRESSION = /钱包.{0,4}(?:死了?|寄了?)/u;

function hasPragmaticPattern(
  conversation: ConversationUnderstanding,
  patternId: string,
): boolean {
  return conversation.pragmatics.matchedPatterns.includes(patternId);
}

function hasSpendingPressureMeaning(
  input: string,
  conversation: ConversationUnderstanding,
): boolean {
  return WALLET_DEATH_EXPRESSION.test(input) ||
    conversation.pragmatics.implications.some(({ tag }) =>
      tag === "budget_pressure_joke" || tag === "wallet_pressure_joke",
    );
}

function boundedConfidence(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function evidence(
  id: string,
  source: UnderstandingSource,
  kind: string,
  label: string,
  confidence: number,
): UnderstandingEvidence {
  return Object.freeze({
    id,
    source,
    kind,
    label,
    confidence: boundedConfidence(confidence),
  });
}

function candidate<T extends string>(
  value: T,
  confidence: number,
  source: UnderstandingSource,
  evidenceId: string,
): ScoredCandidate<T> {
  return Object.freeze({
    value,
    confidence: boundedConfidence(confidence),
    source,
    evidenceId,
  });
}

function parserSpeechAct(result: ParseResult): SpeechAct {
  if (result.type === "query") return "question";
  if (result.type === "statement") return "statement";
  if (result.type === "intent") {
    if (result.intent === "Identity" || result.intent === "RecallName") {
      return "question";
    }
    if (result.intent === "RememberName") return "statement";
    return "reaction";
  }
  return "statement";
}

function dialogueSpeechAct(
  conversation: ConversationUnderstanding,
): SpeechAct {
  switch (conversation.intent) {
    case "question": return "question";
    case "command": return "request";
    case "reaction":
    case "greeting":
    case "thanks":
    case "farewell": return "reaction";
    case "storytelling": return "storytelling";
    case "emotional_share": return "emotional_expression";
    case "opinion_request": return "request";
    case "casual_chat":
    case "unknown": return "statement";
  }
}

function pragmaticSpeechAct(
  conversation: ConversationUnderstanding,
): SpeechAct {
  switch (conversation.pragmatics.communicativeGoal) {
    case "ask_for_help": return "request";
    case "vent":
    case "complain": return "emotional_expression";
    case "joke":
    case "tease":
    case "sarcasm": return "reaction";
    case "seek_validation":
    case "seek_opinion": return "request";
    case "share": return "storytelling";
    default: return dialogueSpeechAct(conversation);
  }
}

function intentForDialogue(
  conversation: ConversationUnderstanding,
): TurnIntent {
  switch (conversation.intent) {
    case "command": return conversation.pragmatics.communicativeGoal === "ask_for_help"
      ? "ask_help"
      : "request_action";
    case "emotional_share": return "vent";
    case "storytelling":
    case "casual_chat": return "share_experience";
    case "opinion_request": return "seek_validation";
    case "reaction":
    case "greeting":
    case "thanks":
    case "farewell": return "seek_reaction";
    case "question": return "provide_information";
    case "unknown": return conversation.topicContinuity.transition === "continued" ||
        conversation.topicContinuity.transition === "resumed"
      ? "continue_topic"
      : "provide_information";
  }
}

function intentForPragmatics(
  conversation: ConversationUnderstanding,
): TurnIntent {
  switch (conversation.pragmatics.communicativeGoal) {
    case "ask_for_help": return "ask_help";
    case "vent":
    case "complain": return "vent";
    case "seek_validation":
    case "seek_opinion": return "seek_validation";
    case "joke":
    case "tease":
    case "sarcasm": return "joke";
    case "share":
    case "celebrate": return "share_experience";
    case "invite_interaction": return "continue_topic";
    case "inform": return "provide_information";
    case "unknown": return intentForDialogue(conversation);
  }
}

function parserIntent(result: ParseResult): TurnIntent | null {
  if (result.type === "query") return "provide_information";
  if (result.type === "statement") return "provide_information";
  // An unmatched parser discovered no structure. It remains explainable
  // evidence, but must not vote against stronger dialogue/pragmatic intent.
  if (result.type === "unknown") return null;
  switch (result.intent) {
    case "Identity":
    case "RecallName": return "provide_information";
    case "RememberName": return "request_action";
    case "Greeting":
    case "Thanks":
    case "Farewell": return "seek_reaction";
  }
}

function emotionForMood(mood: UserMood): Emotion {
  switch (mood) {
    case "happy": return "joy";
    case "excited": return "excitement";
    case "sad": return "sadness";
    case "frustrated": return "frustration";
    case "tired": return "fatigue";
    case "angry": return "anger";
    case "confused": return "confusion";
    case "anxious": return "anxiety";
    case "playful": return "playfulness";
    case "neutral": return "neutral";
    case "unknown": return "unknown";
  }
}

function emotionForPragmatics(
  conversation: ConversationUnderstanding,
): Emotion | null {
  switch (conversation.pragmatics.socialTone) {
    case "annoyed":
    case "self_deprecating": return "frustration";
    case "excited": return "excitement";
    case "hostile": return "anger";
    case "playful":
    case "teasing":
    case "sarcastic": return "playfulness";
    case "friendly": return "joy";
    case "neutral":
    case "unknown": return null;
  }
}

function eventTypeForTopic(event: TopicEvent): UnderstoodEventType {
  switch (event.type) {
    case "problem_reported":
    case "failed": return "failure";
    case "succeeded": return "success";
    case "resolved": return "resolve";
    case "attempted": return "retry";
    case "pending": return "wait";
    case "mentioned":
    case "user_reaction": return "unknown";
  }
}

function eventTarget(
  rawInput: string,
  topicEntities: readonly TopicEntity[],
  topicLabel?: string,
): string | undefined {
  if (/\bbug\b/iu.test(rawInput)) return "bug";
  return topicEntities.find(({ type }) => type !== "problem")?.canonicalName ??
    topicEntities.find(({ type }) => type === "problem")?.canonicalName ??
    topicLabel;
}

function uniqueSources(values: readonly UnderstandingSource[]): readonly UnderstandingSource[] {
  return Object.freeze([...new Set(values)]);
}

function mergeScored<T extends string>(
  values: readonly ScoredCandidate<T>[],
): readonly {
  readonly value: T;
  readonly confidence: number;
  readonly sources: readonly UnderstandingSource[];
  readonly evidenceIds: readonly string[];
}[] {
  const grouped = new Map<T, ScoredCandidate<T>[]>();
  for (const value of values) {
    const group = grouped.get(value.value);
    if (group === undefined) grouped.set(value.value, [value]);
    else group.push(value);
  }
  return Object.freeze(
    [...grouped.entries()]
      .map(([value, supporters]) => {
        const strongest = Math.max(...supporters.map(({ confidence }) => confidence));
        const corroboration = Math.min(
          0.08,
          (new Set(supporters.map(({ source }) => source)).size - 1) * 0.04,
        );
        return Object.freeze({
          value,
          confidence: boundedConfidence(strongest + corroboration),
          sources: uniqueSources(supporters.map(({ source }) => source)),
          evidenceIds: Object.freeze([
            ...new Set(supporters.map(({ evidenceId }) => evidenceId)),
          ]),
        });
      })
      .sort((left, right) =>
        right.confidence - left.confidence ||
        left.value.localeCompare(right.value),
      ),
  );
}

function mergeEntities(
  values: readonly UnderstoodEntity[],
): readonly UnderstoodEntity[] {
  const grouped = new Map<string, UnderstoodEntity[]>();
  for (const value of values) {
    const key = `${value.type}:${value.value.toLocaleLowerCase("und")}:${value.role ?? ""}`;
    const group = grouped.get(key);
    if (group === undefined) grouped.set(key, [value]);
    else group.push(value);
  }
  return Object.freeze(
    [...grouped.values()].map((supporters) => {
      const first = supporters[0]!;
      return Object.freeze({
        ...first,
        confidence: Math.max(...supporters.map(({ confidence }) => confidence)),
        sources: uniqueSources(supporters.flatMap(({ sources }) => sources)),
        evidenceIds: Object.freeze([
          ...new Set(supporters.flatMap(({ evidenceIds }) => evidenceIds)),
        ]),
      });
    }),
  );
}

function semanticEntities(
  analysis: SemanticAnalysis | undefined,
  allEvidence: UnderstandingEvidence[],
): readonly UnderstoodEntity[] {
  if (analysis === undefined) return Object.freeze([]);
  return Object.freeze(analysis.extraction.entities.map((entity, index) => {
    const evidenceId = `semantic:entity:${index}`;
    allEvidence.push(evidence(
      evidenceId,
      "semantic",
      "entity",
      entity.kind,
      entity.confidence,
    ));
    return Object.freeze({
      type: "semantic" as const,
      value: entity.value,
      ...(entity.kind === "subject" || entity.kind === "self"
        ? { role: "subject" as const }
        : entity.kind === "object"
          ? { role: "object" as const }
          : {}),
      confidence: entity.confidence,
      sources: Object.freeze(["semantic" as const]),
      evidenceIds: Object.freeze([evidenceId]),
    });
  }));
}

function parserEntities(
  result: ParseResult,
  allEvidence: UnderstandingEvidence[],
): readonly UnderstoodEntity[] {
  if (result.type === "statement" || result.type === "query") {
    const subjectEvidence = "parser:entity:subject";
    allEvidence.push(evidence(subjectEvidence, "parser", "entity", "subject", 0.95));
    const values: UnderstoodEntity[] = [Object.freeze({
      type: "semantic",
      value: result.subject,
      role: "subject",
      confidence: 0.95,
      sources: Object.freeze(["parser" as const]),
      evidenceIds: Object.freeze([subjectEvidence]),
    })];
    if (result.object !== undefined) {
      const objectEvidence = "parser:entity:object";
      allEvidence.push(evidence(objectEvidence, "parser", "entity", "object", 0.95));
      values.push(Object.freeze({
        type: "semantic",
        value: result.object,
        role: "object",
        confidence: 0.95,
        sources: Object.freeze(["parser" as const]),
        evidenceIds: Object.freeze([objectEvidence]),
      }));
    }
    return Object.freeze(values);
  }
  return Object.freeze([]);
}

function topicEntities(
  conversation: ConversationUnderstanding,
  allEvidence: UnderstandingEvidence[],
): readonly UnderstoodEntity[] {
  const current = conversation.topicContinuity.activeTopic?.entities ?? [];
  return Object.freeze(current.map((entity, index) => {
    const evidenceId = `topic:entity:${index}`;
    allEvidence.push(evidence(
      evidenceId,
      "topic",
      "entity",
      entity.type,
      0.84,
    ));
    return Object.freeze({
      type: entity.type,
      value: entity.canonicalName ?? entity.aliases[0] ?? entity.type,
      role: "target" as const,
      confidence: 0.84,
      sources: Object.freeze(["topic" as const]),
      evidenceIds: Object.freeze([evidenceId]),
    });
  }));
}

function communityEntities(
  conversation: ConversationUnderstanding,
  allEvidence: UnderstandingEvidence[],
): readonly UnderstoodEntity[] {
  return Object.freeze(conversation.community.matches.map((match, index) => {
    const evidenceId = `community:term:${index}`;
    allEvidence.push(evidence(
      evidenceId,
      "community",
      "community-term",
      match.semanticTag,
      match.confidence,
    ));
    return Object.freeze({
      type: "community_term" as const,
      value: match.canonical,
      confidence: match.confidence,
      sources: Object.freeze(["community" as const]),
      evidenceIds: Object.freeze([evidenceId]),
    });
  }));
}

function legacyResolvedEvents(
  input: string,
  conversation: ConversationUnderstanding,
  temporal: readonly TemporalRelation[],
  allEvidence: UnderstandingEvidence[],
): readonly UnderstoodEvent[] {
  const events: UnderstoodEvent[] = [];
  const recurrence = temporal.some(({ type }) => type === "again");
  const continuation = temporal.some(({ type }) => type === "still");
  const topic = conversation.topicContinuity.activeTopic;
  const topicEvent = topic?.events.at(-1);
  if (topic !== undefined && topicEvent !== undefined) {
    const evidenceId = "topic:event:current";
    const explicitType = eventTypeForTopic(topicEvent);
    allEvidence.push(evidence(
      evidenceId,
      "topic",
      "event",
      explicitType,
      0.9,
    ));
    const target = eventTarget(input, topic.entities, topic.label);
    const targetRef = target === undefined
      ? undefined
      : Object.freeze({
          label: target,
          type: "unknown" as const,
          confidence: conversation.topicContinuity.needsClarification ? 0.35 : 0.76,
        });
    const stateAfter = explicitType === "failure"
      ? Object.freeze({ label: "failed", status: "failed" as const, confidence: 0.86 })
      : explicitType === "resolve"
        ? Object.freeze({ label: "resolved", status: "resolved" as const, confidence: 0.86 })
        : explicitType === "wait"
          ? Object.freeze({ label: "pending", status: "pending" as const, confidence: 0.82 })
          : Object.freeze({ label: "changed", status: "unknown" as const, confidence: 0.6 });
    const id = `legacy-event-${topic.id}-${topicEvent.turn}`;
    events.push(Object.freeze({
      id,
      type: explicitType,
      ...(targetRef === undefined ? {} : { target: targetRef }),
      stateAfter,
      recurrence,
      previousOccurrence: recurrence || continuation ||
        conversation.topicContinuity.transition === "continued" ||
        conversation.topicContinuity.transition === "resumed",
      certainty: 0.9,
      confidence: 0.9,
      evidence: Object.freeze([{ evidenceId }]),
      sources: Object.freeze([
        "topic" as const,
        ...(recurrence || continuation ? ["temporal" as const] : []),
      ]),
      evidenceIds: Object.freeze([
        evidenceId,
        ...temporal.flatMap(({ evidenceIds }) => evidenceIds),
      ]),
    }));
  } else if (
    conversation.topicContinuity.needsClarification &&
    continuation
  ) {
    const evidenceId = "topic:event:ambiguous-failure";
    allEvidence.push(evidence(
      evidenceId,
      "topic",
      "event",
      "ambiguous-failure",
      0.72,
    ));
    events.push(Object.freeze({
      id: "legacy-event-ambiguous-failure",
      type: "failure",
      stateAfter: Object.freeze({ label: "failed", status: "failed", confidence: 0.62 }),
      recurrence,
      previousOccurrence: true,
      certainty: 0.62,
      confidence: 0.72,
      evidence: Object.freeze([{ evidenceId }]),
      sources: Object.freeze([
        "topic" as const,
        ...(temporal.length > 0 ? ["temporal" as const] : []),
      ]),
      evidenceIds: Object.freeze([evidenceId]),
    }));
  }

  if (hasPragmaticPattern(conversation, "art-commission-open")) {
    const evidenceId = "community:event:creator-commission-open";
    allEvidence.push(evidence(
      evidenceId,
      "community",
      "event",
      "creator-commission-open",
      0.96,
    ));
    events.push(Object.freeze({
      id: "legacy-event-creator-commission-open",
      type: "start",
      target: Object.freeze({
        label: "creator_commission",
        type: "event",
        confidence: 0.96,
      }),
      stateBefore: Object.freeze({
        label: "commission_unavailable",
        status: "unavailable",
        confidence: 0.82,
      }),
      stateAfter: Object.freeze({
        label: "commission_available",
        status: "available",
        confidence: 0.96,
      }),
      recurrence: false,
      previousOccurrence: false,
      certainty: 0.96,
      confidence: 0.96,
      evidence: Object.freeze([{ evidenceId }]),
      sources: Object.freeze([
        "community" as const,
        "pragmatics" as const,
        ...(temporal.length > 0 ? ["temporal" as const] : []),
      ]),
      evidenceIds: Object.freeze([
        evidenceId,
        ...temporal.flatMap(({ evidenceIds }) => evidenceIds),
      ]),
    }));
  }

  if (conversation.initiativeSignals.plannedEvent !== undefined) {
    const evidenceId = "dialogue:event:plan";
    allEvidence.push(evidence(
      evidenceId,
      "dialogue",
      "event",
      "plan",
      0.9,
    ));
    events.push(Object.freeze({
      id: "legacy-event-plan",
      type: "start",
      target: Object.freeze({
        label: conversation.initiativeSignals.plannedEvent.summary,
        type: "event",
        confidence: 0.9,
      }),
      stateAfter: Object.freeze({ label: "planned", status: "pending", confidence: 0.9 }),
      recurrence: false,
      previousOccurrence: false,
      certainty: 0.9,
      confidence: 0.9,
      evidence: Object.freeze([{ evidenceId }]),
      sources: Object.freeze(["dialogue" as const]),
      evidenceIds: Object.freeze([evidenceId]),
    }));
  }
  return Object.freeze(events);
}

function buildNeeds(
  conversation: ConversationUnderstanding,
  primaryIntent: TurnIntent,
  allEvidence: UnderstandingEvidence[],
): readonly ScoredCandidate<UserNeed>[] {
  const values: ScoredCandidate<UserNeed>[] = [];
  const add = (
    need: UserNeed,
    confidence: number,
    source: UnderstandingSource,
    label: string,
  ) => {
    const evidenceId = `need:${need}:${source}`;
    allEvidence.push(evidence(evidenceId, source, "need", label, confidence));
    values.push(candidate(need, confidence, source, evidenceId));
  };

  if (primaryIntent === "ask_help" || primaryIntent === "request_action") {
    add("solve_problem", 0.96, "pragmatics", "explicit-help");
  }
  if (primaryIntent === "vent") {
    add("receive_acknowledgement", 0.9, "pragmatics", "emotional-expression");
    add("share_emotion", 0.86, "social", "emotional-expression");
    if (conversation.conversationMode === "technical") {
      add("solve_problem", 0.48, "dialogue", "technical-problem-possible");
    }
  }
  if (primaryIntent === "share_experience" || primaryIntent === "continue_topic") {
    add("continue_chat", 0.82, "dialogue", "continuation-expected");
  }
  if (primaryIntent === "seek_validation") {
    add("make_decision", 0.86, "pragmatics", "validation-or-opinion");
  }
  if (conversation.expectsAnswer) {
    add("receive_information", 0.88, "dialogue", "answer-expected");
  }
  if (primaryIntent === "joke" || primaryIntent === "seek_reaction") {
    add("receive_acknowledgement", 0.76, "social", "reaction-expected");
    add("continue_chat", 0.66, "dialogue", "social-continuation");
  }
  if (values.length === 0) {
    add("continue_chat", 0.45, "dialogue", "default-continuation");
  }
  return Object.freeze(values);
}

export function createTurnCandidatePool(
  options: CreateTurnCandidatePoolOptions,
): TurnUnderstandingCandidatePool {
  const normalizedInput = options.semanticAnalysis?.input.surface ??
    options.rawInput.trim().replace(/\s+/gu, " ");
  const allEvidence: UnderstandingEvidence[] = [];
  const parserEvidence = "parser:result";
  allEvidence.push(evidence(
    parserEvidence,
    "parser",
    "structure",
    options.parserResult.type,
    options.parserResult.type === "unknown" ? 0.25 : 0.95,
  ));
  const dialogueEvidence = "dialogue:classification";
  allEvidence.push(evidence(
    dialogueEvidence,
    "dialogue",
    "classification",
    options.conversation.intent,
    options.conversation.confidence,
  ));
  const pragmaticEvidence = "pragmatics:goal";
  allEvidence.push(evidence(
    pragmaticEvidence,
    "pragmatics",
    "communicative-goal",
    options.conversation.pragmatics.communicativeGoal,
    options.conversation.pragmatics.confidence,
  ));
  const socialEvidence = "social:emotion";
  allEvidence.push(evidence(
    socialEvidence,
    "social",
    "emotion",
    options.conversation.userMood,
    options.conversation.userMood === "unknown" ? 0.3 : 0.82,
  ));
  const topicEvidence = "topic:relation";
  allEvidence.push(evidence(
    topicEvidence,
    "topic",
    "topic-relation",
    options.conversation.topicContinuity.transition,
    options.conversation.topicContinuity.needsClarification ? 0.98 : 0.82,
  ));

  const speechActs: ScoredCandidate<SpeechAct>[] = [
    candidate(
      parserSpeechAct(options.parserResult),
      options.parserResult.type === "unknown"
        ? 0.28
        : options.parserResult.type === "statement"
          ? 0.68
          : 0.95,
      "parser",
      parserEvidence,
    ),
    candidate(
      dialogueSpeechAct(options.conversation),
      options.conversation.confidence,
      "dialogue",
      dialogueEvidence,
    ),
    candidate(
      pragmaticSpeechAct(options.conversation),
      options.conversation.pragmatics.confidence,
      "pragmatics",
      pragmaticEvidence,
    ),
  ];
  const parsedIntent = parserIntent(options.parserResult);
  const intents: ScoredCandidate<TurnIntent>[] = [
    ...(parsedIntent === null
      ? []
      : [candidate(
          parsedIntent,
          options.parserResult.type === "statement" ? 0.68 : 0.88,
          "parser",
          parserEvidence,
        )]),
    candidate(
      intentForDialogue(options.conversation),
      options.conversation.confidence,
      "dialogue",
      dialogueEvidence,
    ),
    candidate(
      intentForPragmatics(options.conversation),
      options.conversation.pragmatics.confidence,
      "pragmatics",
      pragmaticEvidence,
    ),
  ];

  const eventState = resolveEventStateCandidates(
    normalizedInput,
    options.conversation,
  );
  allEvidence.push(...eventState.evidence);
  const temporal = eventState.temporalRelations;
  const topicEvent = options.conversation.topicContinuity.activeTopic?.events.at(-1);
  const topicTransition = options.conversation.topicContinuity.transition;
  if (
    options.conversation.topicContinuity.needsClarification ||
    topicTransition === "continued" ||
    topicTransition === "resumed" ||
    topicTransition === "paused" ||
    topicTransition === "resolved" ||
    topicTransition === "abandoned"
  ) {
    intents.push(candidate(
      "continue_topic",
      options.conversation.topicContinuity.needsClarification ? 0.98 : 0.94,
      "topic",
      topicEvidence,
    ));
  }
  if (
    options.conversation.topicContinuity.activeTopic !== undefined &&
    options.conversation.intent !== "question" &&
    options.conversation.intent !== "command" &&
    options.conversation.intent !== "opinion_request" &&
    options.parserResult.type === "statement"
  ) {
    // A structured-looking fragment inside an active conversation is not
    // enough to authorize a fact write. The topic producer contributes the
    // competing continuation intent; the existing write gate remains intact.
    intents.push(candidate("continue_topic", 0.9, "topic", topicEvidence));
  }
  if (
    topicEvent?.type === "failed" ||
    (
      options.conversation.topicContinuity.needsClarification &&
      temporal.some(({ type }) => type === "still")
    )
  ) {
    intents.push(candidate("vent", 0.95, "topic", topicEvidence));
    speechActs.push(candidate(
      "emotional_expression",
      0.92,
      "topic",
      topicEvidence,
    ));
  }

  if (options.semanticAnalysis !== undefined) {
    options.semanticAnalysis.candidates.forEach((semanticCandidate, index) => {
      const evidenceId = `semantic:candidate:${index}`;
      allEvidence.push(evidence(
        evidenceId,
        "semantic",
        "candidate",
        `${semanticCandidate.producer}:${semanticCandidate.result?.type ?? "partial"}`,
        semanticCandidate.confidence,
      ));
      if (semanticCandidate.result !== null) {
        speechActs.push(candidate(
          parserSpeechAct(semanticCandidate.result),
          semanticCandidate.result.type === "statement"
            ? Math.min(0.68, semanticCandidate.confidence)
            : semanticCandidate.confidence,
          "semantic",
          evidenceId,
        ));
        const semanticIntent = parserIntent(semanticCandidate.result);
        if (semanticIntent !== null) {
          intents.push(candidate(
            semanticIntent,
            semanticCandidate.result.type === "statement"
              ? Math.min(0.68, semanticCandidate.confidence)
              : semanticCandidate.confidence,
            "semantic",
            evidenceId,
          ));
        }
      }
    });
  }

  const spendingPressure = hasSpendingPressureMeaning(
    normalizedInput,
    options.conversation,
  );
  if (spendingPressure) {
    const evidenceId = "pragmatics:wallet-pressure";
    allEvidence.push(evidence(
      evidenceId,
      "pragmatics",
      "non-literal-expression",
      "spending-pressure",
      0.94,
    ));
    intents.push(candidate("vent", 0.9, "pragmatics", evidenceId));
    speechActs.push(candidate(
      "emotional_expression",
      0.9,
      "pragmatics",
      evidenceId,
    ));
  }

  const pragmaticEmotion = emotionForPragmatics(options.conversation);
  if (pragmaticEmotion !== null) {
    const evidenceId = "pragmatics:emotion";
    allEvidence.push(evidence(
      evidenceId,
      "pragmatics",
      "emotion",
      pragmaticEmotion,
      options.conversation.pragmatics.confidence,
    ));
  }
  const mergedIntents = mergeScored(intents);
  const primaryIntent = mergedIntents[0]?.value ?? "provide_information";
  const needs = buildNeeds(options.conversation, primaryIntent, allEvidence);
  const implications: TurnImplication[] = options.conversation.pragmatics.implications
    .map((implication, index) => {
      const evidenceId = `pragmatics:implication:${index}`;
      allEvidence.push(evidence(
        evidenceId,
        "pragmatics",
        "implication",
        implication.tag,
        implication.confidence,
      ));
      return Object.freeze({
        meaning: implication.tag,
        confidence: implication.confidence,
        safeToReflect: implication.safeToReflect,
        sources: Object.freeze(["pragmatics" as const]),
        evidenceIds: Object.freeze([evidenceId]),
      });
    });
  if (spendingPressure) {
    implications.push(Object.freeze({
      meaning: "spending_pressure",
      confidence: 0.94,
      safeToReflect: true,
      sources: Object.freeze(["pragmatics" as const]),
      evidenceIds: Object.freeze(["pragmatics:wallet-pressure"]),
    }));
  }

  return Object.freeze({
    rawInput: options.rawInput,
    normalizedInput,
    parserResult: options.parserResult,
    ...(options.semanticAnalysis === undefined
      ? {}
      : { semanticAnalysis: options.semanticAnalysis }),
    conversation: options.conversation,
    speechActs: Object.freeze(speechActs),
    intents: Object.freeze(intents),
    entities: mergeEntities([
      ...parserEntities(options.parserResult, allEvidence),
      ...semanticEntities(options.semanticAnalysis, allEvidence),
      ...topicEntities(options.conversation, allEvidence),
      ...communityEntities(options.conversation, allEvidence),
    ]),
    events: eventState.events.length > 0
      ? eventState.events
      : legacyResolvedEvents(
          normalizedInput,
          options.conversation,
          temporal,
          allEvidence,
        ),
    stateTransitions: eventState.stateTransitions,
    eventSequence: eventState.eventSequence,
    temporalRelations: temporal,
    ...(eventState.correction === undefined
      ? {}
      : { correction: eventState.correction }),
    emotions: Object.freeze([
      candidate(
        emotionForMood(options.conversation.userMood),
        options.conversation.userMood === "unknown" ? 0.3 : 0.84,
        "dialogue",
        socialEvidence,
      ),
      ...(pragmaticEmotion === null
        ? []
        : [candidate(
            pragmaticEmotion,
            options.conversation.pragmatics.confidence,
            "pragmatics",
            "pragmatics:emotion",
          )]),
      ...(spendingPressure
        ? [candidate(
            "frustration" as const,
            0.88,
            "pragmatics",
            "pragmatics:wallet-pressure",
          )]
        : []),
    ]),
    needs,
    implications: Object.freeze(implications),
    evidence: Object.freeze(allEvidence),
  });
}

function normalizedMeaning(
  pool: TurnUnderstandingCandidatePool,
  primaryIntent: TurnIntent | null,
): string {
  if (pool.implications.some(({ meaning }) => meaning === "spending_pressure")) {
    return "spending_pressure";
  }
  if (pool.events.some(({ type, target }) =>
    type === "start" && target?.label === "creator_commission",
  )) return "creator_commission";
  const event = pool.events[0];
  if (event?.type === "failure" && event.recurrence) return "recurring_failure";
  if (event !== undefined) return event.type;
  const implication = [...pool.implications]
    .sort((left, right) => right.confidence - left.confidence)[0];
  if (implication !== undefined) return implication.meaning;
  return primaryIntent ?? "unresolved";
}

export function resolveTurnUnderstanding(
  pool: TurnUnderstandingCandidatePool,
): TurnUnderstanding {
  const speechActs = mergeScored(pool.speechActs);
  const intents = mergeScored(pool.intents).map((intent) => Object.freeze({
    intent: intent.value,
    confidence: intent.confidence,
    sources: intent.sources,
    evidenceIds: intent.evidenceIds,
  }));
  const emotions = mergeScored(pool.emotions);
  const needs = mergeScored(pool.needs).map((need) => Object.freeze({
    need: need.value,
    confidence: need.confidence,
    sources: need.sources,
    evidenceIds: need.evidenceIds,
  }));
  const primaryIntent = intents[0]?.intent ?? null;
  const emotion = emotions[0];
  const emotionalState: EmotionState | undefined = emotion === undefined
    ? undefined
    : Object.freeze({
        primary: emotion.value,
        confidence: emotion.confidence,
        sources: emotion.sources,
        evidenceIds: emotion.evidenceIds,
      });
  const figurativeOverwhelm = pool.implications.some(({ meaning }) =>
    meaning === "figurative_overwhelm_possible" ||
    meaning === "spending_pressure",
  );
  const expression = pool.implications.some(({ meaning }) =>
    meaning === "spending_pressure",
  ) || pool.conversation.pragmatics.reactionPattern === "abstract-overwhelm"
    ? "exaggerated" as const
    : figurativeOverwhelm || pool.conversation.pragmatics.literalness < 0.45
      ? "figurative" as const
      : "literal" as const;
  const topicRelationEvidence = pool.evidence.find(({ id }) => id === "topic:relation");
  const topicRelation = Object.freeze({
    relation: pool.conversation.topicContinuity.transition,
    ...(pool.conversation.topicContinuity.activeTopic === undefined
      ? {}
      : { topicId: pool.conversation.topicContinuity.activeTopic.id }),
    candidateTopics: pool.conversation.topicContinuity.clarificationCandidates,
    ambiguous: pool.conversation.topicContinuity.needsClarification,
    confidence: topicRelationEvidence?.confidence ?? 0.5,
    evidenceIds: Object.freeze(["topic:relation"]),
  });
  const componentScores = [
    speechActs[0]?.confidence ?? 0,
    intents[0]?.confidence ?? 0,
    pool.events[0]?.confidence ?? 0,
    emotionalState?.confidence ?? 0,
    topicRelation.confidence,
  ].filter((value) => value > 0);
  const confidence = topicRelation.ambiguous
    ? Math.min(0.72, Math.max(...componentScores))
    : componentScores.length === 0
      ? 0
      : componentScores.reduce((sum, value) => sum + value, 0) /
        componentScores.length;
  const socialInteraction = pool.conversation.intent === "greeting"
    ? "greeting" as const
    : pool.conversation.intent === "thanks"
      ? "thanks" as const
      : pool.conversation.intent === "farewell"
        ? "farewell" as const
        : "none" as const;
  const communityTags = Object.freeze([
    ...new Set([
      ...pool.conversation.community.matches.map(({ semanticTag }) => semanticTag),
      ...pool.conversation.community.compositions.map(({ semanticTag }) => semanticTag),
    ]),
  ]);

  return Object.freeze({
    rawInput: pool.rawInput,
    normalizedMeaning: normalizedMeaning(pool, primaryIntent),
    literal: expression === "literal",
    expression,
    speechAct: speechActs[0]?.value ?? "statement",
    intents: Object.freeze(intents),
    primaryIntent,
    entities: pool.entities,
    events: pool.events,
    stateTransitions: pool.stateTransitions,
    eventSequence: Object.freeze({
      events: pool.events,
      relations: pool.eventSequence.relations,
    }),
    temporalRelations: pool.temporalRelations,
    ...(pool.correction === undefined ? {} : { correction: pool.correction }),
    ...(emotionalState === undefined ? {} : { emotionalState }),
    userNeeds: Object.freeze(needs),
    references: pool.conversation.topicContinuity.references,
    topicRelation,
    implications: pool.implications,
    communityContext: Object.freeze({
      domains: pool.conversation.community.activeDomains,
      ...(pool.conversation.community.primaryDomain === undefined
        ? {}
        : { primaryDomain: pool.conversation.community.primaryDomain }),
      semanticTags: communityTags,
    }),
    socialInteraction,
    confidence: boundedConfidence(confidence),
    evidence: pool.evidence,
    conversationMode: pool.conversation.conversationMode,
    topic: pool.conversation.topic,
    community: pool.conversation.community,
    pragmatics: pool.conversation.pragmatics,
    topicContinuity: pool.conversation.topicContinuity,
    initiativeSignals: pool.conversation.initiativeSignals,
  });
}
