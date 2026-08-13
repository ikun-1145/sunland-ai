import type {
  ConversationMode,
  ConversationState,
  ConversationTopic,
  AssistantResponseSignals,
  DialogueIntent,
  DialoguePlan,
  DialoguePrimaryGoal,
  DialogueTone,
  RelationshipState,
  UserMood,
  TurnUnderstanding,
} from "@/types";
import {
  dialogueIntentFromTurn,
  userMoodFromTurn,
} from "@/understanding/compatibility";
import {
  advanceCommunityContext,
  COMMUNITY_LANGUAGE_COOLDOWN_TURNS,
  createEmptyCommunityContext,
  normalizeCommunityContext,
} from "@/community";
import {
  createEmptyConversationWorkingMemory,
  normalizeConversationWorkingMemory,
} from "./topicTracker";
import {
  advanceInitiativeState,
  completeInitiativeState,
  createEmptyInitiativeState,
  normalizeInitiativeState,
} from "./initiativeState";

export const MAX_CONVERSATION_FAMILIARITY = 8;
export const FOLLOW_UP_COOLDOWN_TURNS = 2;
export const FURRY_EXPRESSION_COOLDOWN_TURNS = 3;
export const RECENT_ASSISTANT_OPENING_LIMIT = 8;
export const RECENT_REACTION_PATTERN_LIMIT = 8;
export const RECENT_JOKE_CONCEPT_LIMIT = 6;
export const BANTER_COOLDOWN_TURNS = 2;
export const RECENT_HOSTILE_TURN_LIMIT = 3;

const TOPICS: ReadonlySet<ConversationTopic> = new Set([
  "meal", "exam", "sleep", "work", "technical_problem", "daily_life", "social", "unknown",
]);
const MOODS: ReadonlySet<UserMood> = new Set([
  "neutral", "happy", "excited", "sad", "frustrated", "tired", "angry", "confused", "anxious", "playful", "unknown",
]);
const MODES: ReadonlySet<ConversationMode> = new Set([
  "casual", "emotional", "technical", "learning", "creative", "task", "unknown",
]);
const INTENTS: ReadonlySet<DialogueIntent> = new Set([
  "question", "command", "casual_chat", "emotional_share", "storytelling", "opinion_request", "greeting", "farewell", "thanks", "reaction", "unknown",
]);
const GOALS: ReadonlySet<DialoguePrimaryGoal> = new Set([
  "answer", "chat", "comfort", "encourage", "react", "continue_topic", "clarify", "explain", "help_task",
]);
const TONES: ReadonlySet<DialogueTone> = new Set([
  "neutral", "warm", "gentle", "playful", "enthusiastic", "calm", "technical",
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<T>): T | undefined {
  return typeof value === "string" && values.has(value as T) ? value as T : undefined;
}

function boundedInteger(value: unknown, maximum: number): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.min(maximum, Math.max(0, value))
    : 0;
}

export function createEmptyConversationState(): ConversationState {
  return Object.freeze({
    relationship: Object.freeze({
      familiarity: 0,
      casualness: 0,
      teasingPermission: 0,
    }),
    followUpCooldown: 0,
    recentFollowUpCount: 0,
    lastAssistantAskedQuestion: false,
    furryExpressionCooldown: 0,
    recentAssistantOpeningKeys: Object.freeze([]),
    communityContext: createEmptyCommunityContext(),
    communityLanguageCooldown: 0,
    recentReactionPatterns: Object.freeze([]),
    recentJokeConcepts: Object.freeze([]),
    banterCooldown: 0,
    recentHostileTurns: 0,
    workingMemory: createEmptyConversationWorkingMemory(),
    initiative: createEmptyInitiativeState(),
  });
}

function boundedRatio(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
}

function relationshipState(
  value: unknown,
  legacyFamiliarity: unknown,
): RelationshipState {
  const record = isRecord(value) ? value : {};
  const migratedFamiliarity =
    typeof legacyFamiliarity === "number" && Number.isFinite(legacyFamiliarity)
      ? legacyFamiliarity / MAX_CONVERSATION_FAMILIARITY
      : 0;
  return Object.freeze({
    familiarity: isRecord(value)
      ? boundedRatio(record.familiarity)
      : boundedRatio(migratedFamiliarity),
    casualness: boundedRatio(record.casualness),
    teasingPermission: boundedRatio(record.teasingPermission),
  });
}

function openingKeys(value: unknown): readonly string[] {
  return Object.freeze(
    (Array.isArray(value) ? value : [])
      .filter((item): item is string =>
        typeof item === "string" && /^opening-[a-z0-9]+$/u.test(item),
      )
      .slice(-RECENT_ASSISTANT_OPENING_LIMIT),
  );
}

function strategyIds(value: unknown, limit: number): readonly string[] {
  return Object.freeze(
    (Array.isArray(value) ? value : [])
      .filter((item): item is string =>
        typeof item === "string" && /^[a-z0-9-]+$/u.test(item),
      )
      .filter((item, index, items) => items.lastIndexOf(item) === index)
      .slice(-limit),
  );
}

/** Fail-closed normalization for a host-restored conversation summary. */
export function normalizeConversationState(value: unknown): ConversationState | undefined {
  if (!isRecord(value)) return undefined;

  const recentTopic = enumValue(value.recentTopic, TOPICS);
  const currentMood = enumValue(value.currentMood, MOODS);
  const conversationMode = enumValue(value.conversationMode, MODES);
  const recentAssistantTone = enumValue(value.recentAssistantTone, TONES);
  const lastUserIntent = enumValue(value.lastUserIntent, INTENTS);
  const lastInteractionType = enumValue(value.lastInteractionType, GOALS);

  return Object.freeze({
    ...(recentTopic === undefined ? {} : { recentTopic }),
    ...(currentMood === undefined ? {} : { currentMood }),
    ...(conversationMode === undefined ? {} : { conversationMode }),
    relationship: relationshipState(value.relationship, value.familiarity),
    ...(recentAssistantTone === undefined ? {} : { recentAssistantTone }),
    ...(lastUserIntent === undefined ? {} : { lastUserIntent }),
    ...(lastInteractionType === undefined ? {} : { lastInteractionType }),
    followUpCooldown: boundedInteger(value.followUpCooldown, FOLLOW_UP_COOLDOWN_TURNS),
    recentFollowUpCount: boundedInteger(value.recentFollowUpCount, 2),
    lastAssistantAskedQuestion: value.lastAssistantAskedQuestion === true,
    furryExpressionCooldown: boundedInteger(
      value.furryExpressionCooldown,
      FURRY_EXPRESSION_COOLDOWN_TURNS,
    ),
    recentAssistantOpeningKeys: openingKeys(
      value.recentAssistantOpeningKeys,
    ),
    communityContext: normalizeCommunityContext(value.communityContext),
    communityLanguageCooldown: boundedInteger(
      value.communityLanguageCooldown,
      COMMUNITY_LANGUAGE_COOLDOWN_TURNS,
    ),
    recentReactionPatterns: strategyIds(
      value.recentReactionPatterns,
      RECENT_REACTION_PATTERN_LIMIT,
    ),
    recentJokeConcepts: strategyIds(
      value.recentJokeConcepts,
      RECENT_JOKE_CONCEPT_LIMIT,
    ),
    banterCooldown: boundedInteger(
      value.banterCooldown,
      BANTER_COOLDOWN_TURNS,
    ),
    recentHostileTurns: boundedInteger(
      value.recentHostileTurns,
      RECENT_HOSTILE_TURN_LIMIT,
    ),
    workingMemory: normalizeConversationWorkingMemory(value.workingMemory),
    initiative: normalizeInitiativeState(value.initiative),
  });
}

export function advanceConversationState(
  current: ConversationState | undefined,
  understanding: TurnUnderstanding,
  plan: DialoguePlan,
): ConversationState {
  const previous = current ?? createEmptyConversationState();
  const intent = dialogueIntentFromTurn(understanding);
  const userMood = userMoodFromTurn(understanding);
  const familiarity = Math.min(
    0.65,
    previous.relationship.familiarity + 0.04,
  );
  const isRelaxedTurn =
    understanding.conversationMode === "casual" ||
    intent === "reaction";
  const relationship = Object.freeze({
    familiarity,
    casualness: Math.min(
      0.7,
      previous.relationship.casualness + (isRelaxedTurn ? 0.04 : 0.01),
    ),
    teasingPermission: Math.min(
      0.35,
      previous.relationship.teasingPermission +
        (userMood === "playful" ||
        intent === "reaction"
          ? 0.04
          : 0),
    ),
  });
  const initiative = advanceInitiativeState(
    previous.initiative,
    understanding,
    relationship,
  );

  const recentTopic =
    understanding.topic === "unknown"
      ? previous.recentTopic
      : understanding.topic;

  return Object.freeze({
    ...(recentTopic === undefined ? {} : { recentTopic }),
    currentMood: userMood,
    conversationMode: understanding.conversationMode,
    relationship,
    recentAssistantTone: plan.tone,
    lastUserIntent: intent,
    lastInteractionType: plan.primaryGoal,
    followUpCooldown: previous.followUpCooldown,
    recentFollowUpCount: previous.recentFollowUpCount,
    lastAssistantAskedQuestion: previous.lastAssistantAskedQuestion,
    furryExpressionCooldown: previous.furryExpressionCooldown,
    recentAssistantOpeningKeys: previous.recentAssistantOpeningKeys,
    communityContext: advanceCommunityContext(
      previous.communityContext,
      understanding.community,
    ),
    communityLanguageCooldown: previous.communityLanguageCooldown,
    recentReactionPatterns: previous.recentReactionPatterns,
    recentJokeConcepts: previous.recentJokeConcepts,
    banterCooldown: previous.banterCooldown,
    recentHostileTurns:
      understanding.pragmatics.offenseLevel === "rude" ||
      understanding.pragmatics.offenseLevel === "hostile"
        ? Math.min(
            RECENT_HOSTILE_TURN_LIMIT,
            previous.recentHostileTurns + 1,
          )
        : Math.max(0, previous.recentHostileTurns - 1),
    workingMemory: understanding.topicContinuity.workingMemory,
    initiative,
  });
}

export function completeConversationState(
  current: ConversationState,
  signals: AssistantResponseSignals,
): ConversationState {
  const recentFollowUpCount = signals.askedQuestion
    ? Math.min(2, current.recentFollowUpCount + 1)
    : 0;
  const recentAssistantOpeningKeys = Object.freeze(
    [
      ...current.recentAssistantOpeningKeys.filter(
        (key) => key !== signals.assistantOpeningKey,
      ),
      signals.assistantOpeningKey,
    ].slice(-RECENT_ASSISTANT_OPENING_LIMIT),
  );
  const recentReactionPatterns = signals.reactionPattern === undefined
    ? Object.freeze(current.recentReactionPatterns.slice(1))
    : Object.freeze(
        [
          ...current.recentReactionPatterns.filter(
            (pattern) => pattern !== signals.reactionPattern,
          ),
          signals.reactionPattern,
        ].slice(-RECENT_REACTION_PATTERN_LIMIT),
      );
  const recentJokeConcepts = signals.jokeConcept === undefined
    ? Object.freeze(current.recentJokeConcepts.slice(1))
    : Object.freeze(
        [
          ...current.recentJokeConcepts.filter(
            (concept) => concept !== signals.jokeConcept,
          ),
          signals.jokeConcept,
        ].slice(-RECENT_JOKE_CONCEPT_LIMIT),
      );

  return Object.freeze({
    ...current,
    followUpCooldown: signals.askedQuestion
      ? FOLLOW_UP_COOLDOWN_TURNS
      : Math.max(0, current.followUpCooldown - 1),
    recentFollowUpCount,
    lastAssistantAskedQuestion: signals.askedQuestion,
    furryExpressionCooldown: signals.furryExpressionUsed
      ? FURRY_EXPRESSION_COOLDOWN_TURNS
      : Math.max(0, current.furryExpressionCooldown - 1),
    recentAssistantOpeningKeys,
    communityLanguageCooldown: signals.communityLanguageUsed
      ? COMMUNITY_LANGUAGE_COOLDOWN_TURNS
      : Math.max(0, current.communityLanguageCooldown - 1),
    recentReactionPatterns,
    recentJokeConcepts,
    banterCooldown: signals.banterUsed
      ? BANTER_COOLDOWN_TURNS
      : Math.max(0, current.banterCooldown - 1),
    initiative: completeInitiativeState(
      current.initiative,
      signals.initiativeAction ?? "none",
      signals.askedQuestion,
      current.workingMemory.currentTurn,
    ),
  });
}
