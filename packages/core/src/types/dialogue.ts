import type {
  CommunityContext,
  CommunityLanguageMode,
  CommunityResolution,
} from "./community";
import type {
  DialogueSecondaryGoal,
  PragmaticUnderstanding,
  SocialResponseStrategy,
} from "./pragmatics";

/** Lightweight, privacy-safe contracts for chat-first turn planning. */
export type DialogueIntent =
  | "question"
  | "command"
  | "casual_chat"
  | "emotional_share"
  | "storytelling"
  | "opinion_request"
  | "greeting"
  | "farewell"
  | "thanks"
  | "reaction"
  | "unknown";

export type UserMood =
  | "neutral"
  | "happy"
  | "excited"
  | "sad"
  | "frustrated"
  | "tired"
  | "angry"
  | "confused"
  | "anxious"
  | "playful"
  | "unknown";

export type ConversationMode =
  | "casual"
  | "emotional"
  | "technical"
  | "learning"
  | "creative"
  | "task"
  | "unknown";

/** Deliberately categorical: raw conversation text is never persisted. */
export type ConversationTopic =
  | "meal"
  | "exam"
  | "sleep"
  | "work"
  | "technical_problem"
  | "daily_life"
  | "social"
  | "unknown";

export interface ConversationUnderstanding {
  readonly intent: DialogueIntent;
  readonly userMood: UserMood;
  readonly conversationMode: ConversationMode;
  readonly topic: ConversationTopic;
  readonly expectsAnswer: boolean;
  readonly expectsEmotionalResponse: boolean;
  readonly expectsContinuation: boolean;
  readonly confidence: number;
  /** Transient community-language semantics; raw input is not retained in it. */
  readonly community: CommunityResolution;
  /** Transient speech-act and social-context interpretation. */
  readonly pragmatics: PragmaticUnderstanding;
}

export interface ConversationRhythm {
  readonly targetSentenceCount: number;
  readonly allowFollowUp: boolean;
  readonly followUpProbability: number;
  readonly allowTopicExpansion: boolean;
  readonly allowNaturalEnding: boolean;
}

export type DialoguePrimaryGoal =
  | "answer"
  | "chat"
  | "comfort"
  | "encourage"
  | "react"
  | "continue_topic"
  | "clarify"
  | "explain"
  | "help_task";

export type DialogueTone =
  | "neutral"
  | "warm"
  | "gentle"
  | "playful"
  | "enthusiastic"
  | "calm"
  | "technical";

export interface DialoguePlan {
  readonly primaryGoal: DialoguePrimaryGoal;
  readonly useReasoning: boolean;
  readonly useKnowledge: boolean;
  readonly useMemory: boolean;
  readonly acknowledgeEmotion: boolean;
  readonly shouldAskFollowUp: boolean;
  readonly conversationDrive: "respond" | "invite" | "guide";
  readonly tone: DialogueTone;
  readonly personalityIntensity: "none" | "low" | "medium";
  readonly rhythm: ConversationRhythm;
  readonly communityLanguageMode: CommunityLanguageMode;
  readonly socialStrategy: SocialResponseStrategy;
  readonly secondaryGoals: readonly DialogueSecondaryGoal[];
}

export interface RelationshipState {
  /** All values are bounded to [0, 1] and never affect authorization. */
  readonly familiarity: number;
  readonly casualness: number;
  readonly teasingPermission: number;
}

/**
 * Small per-conversation summary. It contains no raw messages, entities,
 * durable user facts or model-generated prose.
 */
export interface ConversationState {
  readonly recentTopic?: ConversationTopic;
  readonly currentMood?: UserMood;
  readonly conversationMode?: ConversationMode;
  readonly relationship: RelationshipState;
  readonly recentAssistantTone?: DialogueTone;
  readonly lastUserIntent?: DialogueIntent;
  readonly lastInteractionType?: DialoguePrimaryGoal;
  /** Number of turns before another optional follow-up may be asked. */
  readonly followUpCooldown: number;
  readonly recentFollowUpCount: number;
  readonly lastAssistantAskedQuestion: boolean;
  /** Number of turns before another explicit furry action may be rendered. */
  readonly furryExpressionCooldown: number;
  /** Privacy-safe hashes of recent openings, never response prose. */
  readonly recentAssistantOpeningKeys: readonly string[];
  readonly communityContext: CommunityContext;
  /** Number of turns before another mirrored community term may be generated. */
  readonly communityLanguageCooldown: number;
  /** Privacy-safe strategy/concept ids only; never response text. */
  readonly recentReactionPatterns: readonly string[];
  readonly recentJokeConcepts: readonly string[];
  readonly banterCooldown: number;
  readonly recentHostileTurns: number;
}

export interface AssistantResponseSignals {
  readonly askedQuestion: boolean;
  readonly furryExpressionUsed: boolean;
  readonly assistantOpeningKey: string;
  readonly communityLanguageUsed: boolean;
  readonly reactionPattern?: string;
  readonly jokeConcept?: string;
  readonly banterUsed?: boolean;
}

/** Transient hand-off to Personality; `raw` is never part of persisted state. */
export interface DialogueTurnContext {
  readonly raw: string;
  readonly understanding: ConversationUnderstanding;
  readonly plan: DialoguePlan;
  readonly state: ConversationState;
  readonly rememberedName?: string;
}
