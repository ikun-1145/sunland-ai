import type {
  CommunityDomain,
  CommunityResolution,
} from "./community";
import type {
  ConversationMode,
  ConversationTopic,
} from "./dialogue";
import type { InitiativeTurnSignals } from "./initiative";
import type {
  PragmaticUnderstanding,
} from "./pragmatics";
import type {
  ResolvedReference,
  TopicContinuity,
  TopicEntityType,
  TopicTransition,
} from "./topic";

/** The single resolved speech-act vocabulary consumed after Stage 16.0. */
export type SpeechAct =
  | "statement"
  | "question"
  | "request"
  | "command"
  | "reaction"
  | "storytelling"
  | "emotional_expression";

/** Intent describes why the user is speaking, not the surface sentence form. */
export type TurnIntent =
  | "ask_help"
  | "share_experience"
  | "vent"
  | "seek_validation"
  | "seek_reaction"
  | "provide_information"
  | "request_action"
  | "joke"
  | "continue_topic";

export type UnderstandingSource =
  | "parser"
  | "semantic"
  | "dialogue"
  | "community"
  | "pragmatics"
  | "topic"
  | "social"
  | "temporal"
  | "event"
  | "state";

export interface UnderstandingEvidence {
  readonly id: string;
  readonly source: UnderstandingSource;
  readonly kind: string;
  /** Controlled diagnostic label. It must never contain the full raw input. */
  readonly label: string;
  readonly confidence: number;
}

export interface IntentCandidate {
  readonly intent: TurnIntent;
  readonly confidence: number;
  readonly sources: readonly UnderstandingSource[];
  readonly evidenceIds: readonly string[];
}

export interface UnderstoodEntity {
  readonly type: TopicEntityType | "semantic" | "community_term";
  readonly value: string;
  readonly role?: "subject" | "object" | "target" | "reference";
  readonly confidence: number;
  readonly sources: readonly UnderstandingSource[];
  readonly evidenceIds: readonly string[];
}

export interface EntityRef {
  readonly id?: string;
  readonly label: string;
  readonly type: TopicEntityType | "action" | "deliverable" | "unknown";
  readonly confidence: number;
}

export type SemanticStateStatus =
  | "working"
  | "failed"
  | "resolved"
  | "pending"
  | "active"
  | "inactive"
  | "available"
  | "unavailable"
  | "unknown";

export interface SemanticState {
  readonly label: string;
  readonly status: SemanticStateStatus;
  readonly confidence: number;
}

export type UnderstoodEventType =
  | "failure"
  | "success"
  | "change"
  | "start"
  | "stop"
  | "resume"
  | "retry"
  | "recur"
  | "complete"
  | "resolve"
  | "recover"
  | "wait"
  | "receive"
  | "send"
  | "create"
  | "delete"
  | "update"
  | "unknown";

export interface EventEvidenceRef {
  readonly evidenceId: string;
}

export interface UnderstoodEvent {
  readonly id: string;
  readonly type: UnderstoodEventType;
  readonly subject?: EntityRef;
  readonly object?: EntityRef;
  readonly target?: EntityRef;
  readonly stateBefore?: SemanticState;
  readonly stateAfter?: SemanticState;
  readonly recurrence: boolean;
  readonly previousOccurrence: boolean;
  readonly certainty: number;
  readonly confidence: number;
  readonly evidence: readonly EventEvidenceRef[];
  readonly sources: readonly UnderstandingSource[];
  readonly evidenceIds: readonly string[];
}

export type TemporalRelationType =
  | "now"
  | "previously"
  | "again"
  | "still"
  | "already"
  | "finally"
  | "just_now"
  | "later"
  | "before"
  | "after"
  | "continuing"
  | "unknown";

export interface TemporalRelation {
  readonly type: TemporalRelationType;
  readonly marker: string;
  readonly eventId?: string;
  readonly relatedEventId?: string;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
}

export interface StateTransition {
  readonly target: EntityRef;
  readonly from?: SemanticState;
  readonly to: SemanticState;
  readonly trigger?: string;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
}

export type EventSequenceRelationType =
  | "before"
  | "after"
  | "same_time"
  | "continuation"
  | "possible_cause";

export interface EventSequenceRelation {
  readonly fromEventId: string;
  readonly toEventId: string;
  readonly type: EventSequenceRelationType;
  readonly confidence: number;
}

export interface EventSequence {
  readonly events: readonly UnderstoodEvent[];
  readonly relations: readonly EventSequenceRelation[];
}

export interface UnderstandingCorrection {
  readonly targetEventId?: string;
  readonly replacement?: Partial<Pick<
    UnderstoodEvent,
    "type" | "target" | "stateBefore" | "stateAfter"
  >>;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
}

export type Emotion =
  | "neutral"
  | "joy"
  | "excitement"
  | "sadness"
  | "frustration"
  | "fatigue"
  | "anger"
  | "confusion"
  | "anxiety"
  | "playfulness"
  | "unknown";

export interface EmotionState {
  readonly primary: Emotion;
  readonly confidence: number;
  readonly sources: readonly UnderstandingSource[];
  readonly evidenceIds: readonly string[];
}

export type UserNeed =
  | "solve_problem"
  | "receive_acknowledgement"
  | "share_emotion"
  | "continue_chat"
  | "receive_information"
  | "make_decision";

export interface NeedCandidate {
  readonly need: UserNeed;
  readonly confidence: number;
  readonly sources: readonly UnderstandingSource[];
  readonly evidenceIds: readonly string[];
}

export interface TopicRelation {
  readonly relation: TopicTransition;
  readonly topicId?: string;
  readonly candidateTopics: readonly string[];
  readonly ambiguous: boolean;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
}

export interface TurnImplication {
  readonly meaning: string;
  readonly confidence: number;
  readonly safeToReflect: boolean;
  readonly sources: readonly UnderstandingSource[];
  readonly evidenceIds: readonly string[];
}

export type SocialInteractionKind =
  | "greeting"
  | "thanks"
  | "farewell"
  | "none";

export interface TurnCommunityContext {
  readonly domains: readonly CommunityDomain[];
  readonly primaryDomain?: CommunityDomain;
  readonly semanticTags: readonly string[];
}

export type ResponseActKind =
  | "answer"
  | "acknowledge"
  | "comfort"
  | "joke"
  | "ask_clarification"
  | "ask_followup"
  | "explain"
  | "refuse";

export type ResponseActSecondary =
  | "offer_help"
  | "acknowledge_emotion"
  | "continue_topic"
  | "provide_information";

/** Persona-neutral output decision owned by the existing Dialogue Planner. */
export interface ResponseAct {
  readonly primary: ResponseActKind;
  readonly secondary?: ResponseActSecondary;
  readonly confidence: number;
}

/**
 * Stage 16.0's resolved turn bus. Existing analyzers remain evidence producers;
 * downstream planning consumes this contract instead of choosing among their
 * independent intent labels.
 */
export interface TurnUnderstanding {
  /** Transient and never included in persisted conversation state. */
  readonly rawInput: string;
  /** Controlled canonical meaning id, not generated prose. */
  readonly normalizedMeaning: string;
  readonly literal: boolean;
  readonly expression: "literal" | "figurative" | "exaggerated";
  readonly speechAct: SpeechAct;
  readonly intents: readonly IntentCandidate[];
  readonly primaryIntent: TurnIntent | null;
  readonly entities: readonly UnderstoodEntity[];
  readonly events: readonly UnderstoodEvent[];
  readonly stateTransitions: readonly StateTransition[];
  readonly eventSequence: EventSequence;
  readonly temporalRelations: readonly TemporalRelation[];
  readonly correction?: UnderstandingCorrection;
  readonly emotionalState?: EmotionState;
  readonly userNeeds: readonly NeedCandidate[];
  readonly references: readonly ResolvedReference[];
  readonly topicRelation: TopicRelation;
  readonly implications: readonly TurnImplication[];
  readonly communityContext: TurnCommunityContext;
  readonly socialInteraction: SocialInteractionKind;
  readonly confidence: number;
  readonly evidence: readonly UnderstandingEvidence[];

  /** Existing bounded component outputs retained during gradual migration. */
  readonly conversationMode: ConversationMode;
  readonly topic: ConversationTopic;
  readonly community: CommunityResolution;
  readonly pragmatics: PragmaticUnderstanding;
  readonly topicContinuity: TopicContinuity;
  readonly initiativeSignals: InitiativeTurnSignals;
}
