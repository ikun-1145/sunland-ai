import type { CommunityDomain } from "./community";

export type TopicEntityType =
  | "person"
  | "project"
  | "object"
  | "software"
  | "event"
  | "place"
  | "concept"
  | "problem"
  | "unknown";

export interface TopicEntity {
  readonly id: string;
  readonly type: TopicEntityType;
  readonly canonicalName?: string;
  readonly aliases: readonly string[];
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export type WorkingTopicStatus =
  | "active"
  | "background"
  | "paused"
  | "resolved"
  | "abandoned";

export type TopicEventType =
  | "mentioned"
  | "problem_reported"
  | "attempted"
  | "failed"
  | "succeeded"
  | "resolved"
  | "user_reaction";

export interface TopicEvent {
  readonly type: TopicEventType;
  /** Controlled, bounded summary; never a copy of the user message. */
  readonly summary: string;
  readonly turn: number;
}

export interface WorkingConversationTopic {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly entities: readonly TopicEntity[];
  readonly status: WorkingTopicStatus;
  readonly relevance: number;
  readonly momentum: number;
  readonly createdTurn: number;
  readonly lastMentionTurn: number;
  readonly events: readonly TopicEvent[];
  readonly domains: readonly CommunityDomain[];
  readonly sourceMessageIds?: readonly string[];
}

export type ResolvedReferenceTargetType =
  | "entity"
  | "topic"
  | "event"
  | "message"
  | "unknown";

export interface ResolvedReference {
  readonly text: string;
  readonly targetType: ResolvedReferenceTargetType;
  readonly targetId?: string;
  readonly confidence: number;
}

export interface ConversationWorkingMemory {
  readonly version: 1;
  readonly activeTopicId?: string;
  readonly topics: readonly WorkingConversationTopic[];
  readonly recentEntities: readonly TopicEntity[];
  readonly recentReferences: readonly ResolvedReference[];
  readonly currentTurn: number;
}

export type TopicTransition =
  | "none"
  | "continued"
  | "new_topic"
  | "switched"
  | "resumed"
  | "paused"
  | "resolved"
  | "abandoned"
  | "ambiguous";

/** Transient result for the current turn; only `workingMemory` is persisted. */
export interface TopicContinuity {
  readonly transition: TopicTransition;
  readonly workingMemory: ConversationWorkingMemory;
  readonly references: readonly ResolvedReference[];
  readonly activeTopic?: WorkingConversationTopic;
  readonly needsClarification: boolean;
  readonly clarificationCandidates: readonly string[];
}
