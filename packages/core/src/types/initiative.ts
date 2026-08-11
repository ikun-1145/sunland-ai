export type InitiativeAction =
  | "none"
  | "react"
  | "follow_up"
  | "expand"
  | "resume_topic"
  | "offer_related_topic"
  | "close_topic";

export interface InitiativeDecision {
  readonly action: InitiativeAction;
  readonly intensity: number;
  readonly targetTopicId?: string;
  readonly targetOpenLoopId?: string;
  /** Controlled diagnostic id; never rendered to the user. */
  readonly reason?: string;
}

export type OpenLoopType =
  | "awaiting_result"
  | "unfinished_story"
  | "unresolved_problem"
  | "planned_event";

export interface OpenLoop {
  readonly id: string;
  readonly topicId?: string;
  readonly type: OpenLoopType;
  /** Controlled label such as `考试` or `返图`; never raw user text. */
  readonly summary: string;
  readonly status: "open" | "resolved";
  readonly createdTurn: number;
  readonly lastUpdatedTurn: number;
  readonly relevance: number;
}

export interface InitiativeState {
  readonly version: 1;
  readonly drive: number;
  readonly userEngagement: number;
  readonly topicMomentum: number;
  readonly userInitiativePreference: number;
  readonly silenceTolerance: number;
  readonly recentAssistantInitiativeCount: number;
  readonly lastInitiativeTurn?: number;
  readonly initiativeCooldownTurns: number;
  readonly consecutiveQuestionTurns: number;
  readonly followUpFatigue: number;
  readonly openLoops: readonly OpenLoop[];
}

export interface PlannedConversationEvent {
  readonly type: "awaiting_result" | "planned_event";
  readonly summary: string;
}

/** Transient, deterministic turn signals. Nothing here is persisted verbatim. */
export interface InitiativeTurnSignals {
  readonly boredom: boolean;
  readonly returned: boolean;
  readonly explicitClose: boolean;
  readonly lowEngagement: boolean;
  readonly highEngagement: boolean;
  readonly storyContinuation: boolean;
  readonly plannedEvent?: PlannedConversationEvent;
  readonly resolvedEventSummary?: string;
}

export interface TopicResumeCandidate {
  readonly topicId: string;
  readonly relevance: number;
  readonly recency: number;
  readonly emotionalWeight: number;
  readonly unresolvedWeight: number;
  readonly resumeScore: number;
}

export interface InitiativeMetrics {
  readonly overQuestioningScore: number;
  readonly overInitiativeScore: number;
  readonly deadConversationScore: number;
  readonly forcedTopicResumeScore: number;
  readonly poorClosureScore: number;
  readonly staleTopicRevivalScore: number;
}
