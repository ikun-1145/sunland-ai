import type {
  InitiativeAction,
  InitiativeState,
  OpenLoop,
  OpenLoopType,
  RelationshipState,
  TurnUnderstanding,
} from "@/types";
import { hashString } from "@/utils/deterministic";

export const INITIATIVE_LIMITS = Object.freeze({
  maximumOpenLoops: 6,
  maximumSummaryLength: 32,
  maximumRecentInitiatives: 3,
  maximumCooldownTurns: 3,
  maximumConsecutiveQuestions: 3,
});

const OPEN_LOOP_TYPES: ReadonlySet<OpenLoopType> = new Set([
  "awaiting_result", "unfinished_story", "unresolved_problem", "planned_event",
]);
const OPEN_LOOP_SUMMARIES: ReadonlySet<string> = new Set([
  "考试", "面试", "吃饭", "兽展", "系统更新", "返图",
]);
const OPEN_LOOP_ID = /^loop-[a-z0-9-]+$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function ratio(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

function integer(value: unknown, maximum: number): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.min(maximum, Math.max(0, value))
    : 0;
}

function turn(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function normalizeOpenLoop(value: unknown): OpenLoop | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" && OPEN_LOOP_ID.test(value.id)
    ? value.id.slice(0, 80)
    : undefined;
  const type = typeof value.type === "string" && OPEN_LOOP_TYPES.has(value.type as OpenLoopType)
    ? value.type as OpenLoopType
    : undefined;
  const summary = typeof value.summary === "string" && OPEN_LOOP_SUMMARIES.has(value.summary)
    ? value.summary.slice(0, INITIATIVE_LIMITS.maximumSummaryLength)
    : undefined;
  const status = value.status === "open" || value.status === "resolved"
    ? value.status
    : undefined;
  if (id === undefined || type === undefined || summary === undefined || status === undefined) {
    return null;
  }
  const topicId = typeof value.topicId === "string" && /^topic-[a-z0-9-]+$/u.test(value.topicId)
    ? value.topicId.slice(0, 80)
    : undefined;
  return Object.freeze({
    id,
    ...(topicId === undefined ? {} : { topicId }),
    type,
    summary,
    status,
    createdTurn: turn(value.createdTurn),
    lastUpdatedTurn: turn(value.lastUpdatedTurn),
    relevance: ratio(value.relevance),
  });
}

export function createEmptyInitiativeState(): InitiativeState {
  return Object.freeze({
    version: 1,
    drive: 0.35,
    userEngagement: 0.45,
    topicMomentum: 0,
    userInitiativePreference: 0.45,
    silenceTolerance: 0.65,
    recentAssistantInitiativeCount: 0,
    initiativeCooldownTurns: 0,
    consecutiveQuestionTurns: 0,
    followUpFatigue: 0,
    openLoops: Object.freeze([]),
  });
}

export function normalizeInitiativeState(value: unknown): InitiativeState {
  if (!isRecord(value)) return createEmptyInitiativeState();
  const openLoops = Object.freeze(
    (Array.isArray(value.openLoops) ? value.openLoops : [])
      .map(normalizeOpenLoop)
      .filter((loop): loop is OpenLoop => loop !== null)
      .filter((loop, index, loops) => loops.findIndex(({ id }) => id === loop.id) === index)
      .slice(-INITIATIVE_LIMITS.maximumOpenLoops),
  );
  const lastInitiativeTurn = typeof value.lastInitiativeTurn === "number" &&
    Number.isSafeInteger(value.lastInitiativeTurn) && value.lastInitiativeTurn >= 0
    ? value.lastInitiativeTurn
    : undefined;
  return Object.freeze({
    version: 1,
    drive: ratio(value.drive, 0.35),
    userEngagement: ratio(value.userEngagement, 0.45),
    topicMomentum: ratio(value.topicMomentum),
    userInitiativePreference: ratio(value.userInitiativePreference, 0.45),
    silenceTolerance: ratio(value.silenceTolerance, 0.65),
    recentAssistantInitiativeCount: integer(
      value.recentAssistantInitiativeCount,
      INITIATIVE_LIMITS.maximumRecentInitiatives,
    ),
    ...(lastInitiativeTurn === undefined ? {} : { lastInitiativeTurn }),
    initiativeCooldownTurns: integer(
      value.initiativeCooldownTurns,
      INITIATIVE_LIMITS.maximumCooldownTurns,
    ),
    consecutiveQuestionTurns: integer(
      value.consecutiveQuestionTurns,
      INITIATIVE_LIMITS.maximumConsecutiveQuestions,
    ),
    followUpFatigue: ratio(value.followUpFatigue),
    openLoops,
  });
}

function openLoopId(summary: string, currentTurn: number): string {
  return `loop-${hashString(`${summary}:${currentTurn}`).toString(36)}`;
}

function advanceOpenLoops(
  previous: InitiativeState,
  understanding: TurnUnderstanding,
): readonly OpenLoop[] {
  const currentTurn = understanding.topicContinuity.workingMemory.currentTurn;
  const activeTopic = understanding.topicContinuity.activeTopic;
  const latestEvent = activeTopic?.events.at(-1);
  let loops: OpenLoop[] = previous.openLoops
    .map((loop) => Object.freeze({
      ...loop,
      relevance: loop.relevance * (loop.status === "open" ? 0.82 : 0.45),
    }));

  const resolvedSummary = understanding.initiativeSignals.resolvedEventSummary;
  loops = loops.map((loop) => {
    const topicResolved = loop.topicId !== undefined &&
      loop.topicId === activeTopic?.id &&
      (latestEvent?.type === "resolved" || latestEvent?.type === "succeeded");
    if (loop.status === "open" && (loop.summary === resolvedSummary || topicResolved)) {
      return Object.freeze({
        ...loop,
        status: "resolved" as const,
        relevance: 0.12,
        lastUpdatedTurn: currentTurn,
      });
    }
    return loop;
  });

  const planned = understanding.initiativeSignals.plannedEvent;
  if (planned !== undefined) {
    const existingIndex = loops.findIndex(
      ({ status, summary }) => status === "open" && summary === planned.summary,
    );
    if (existingIndex >= 0) {
      const existing = loops[existingIndex];
      if (existing !== undefined) {
        loops[existingIndex] = Object.freeze({
          ...existing,
          ...(activeTopic === undefined ? {} : { topicId: activeTopic.id }),
          relevance: 1,
          lastUpdatedTurn: currentTurn,
        });
      }
    } else {
      loops.push(Object.freeze({
        id: openLoopId(planned.summary, currentTurn),
        ...(activeTopic === undefined ? {} : { topicId: activeTopic.id }),
        type: planned.type,
        summary: planned.summary,
        status: "open",
        createdTurn: currentTurn,
        lastUpdatedTurn: currentTurn,
        relevance: 1,
      }));
    }
  }

  return Object.freeze(
    loops
      .filter(({ relevance }) => relevance >= 0.08)
      .slice(-INITIATIVE_LIMITS.maximumOpenLoops),
  );
}

export function advanceInitiativeState(
  current: InitiativeState | undefined,
  understanding: TurnUnderstanding,
  relationship: RelationshipState,
): InitiativeState {
  const previous = normalizeInitiativeState(current);
  const signals = understanding.initiativeSignals;
  const targetEngagement = signals.explicitClose ? 0.05
    : signals.lowEngagement ? 0.14
      : signals.highEngagement ? 0.82
        : understanding.speechAct === "reaction" ? 0.5
          : 0.42;
  const userEngagement = ratio(
    previous.userEngagement * 0.55 + targetEngagement * 0.45,
  );
  const preferenceDelta = previous.consecutiveQuestionTurns > 0
    ? signals.lowEngagement ? -0.1 : signals.highEngagement ? 0.06 : -0.02
    : signals.highEngagement ? 0.02 : signals.lowEngagement ? -0.03 : 0;
  const userInitiativePreference = ratio(
    previous.userInitiativePreference + preferenceDelta,
  );
  const activeMomentum = understanding.topicContinuity.activeTopic?.momentum;
  const topicMomentum = signals.explicitClose
    ? 0
    : signals.lowEngagement
      ? (activeMomentum ?? previous.topicMomentum) * 0.5
      : ratio(activeMomentum ?? previous.topicMomentum * 0.75);
  const silenceTolerance = ratio(
    0.35 + (1 - userEngagement) * 0.45 + (signals.explicitClose ? 0.2 : 0),
  );
  const drive = understanding.pragmatics.requiresSafetyHandling || signals.explicitClose
    ? 0
    : ratio(
        userEngagement * 0.35 +
        topicMomentum * 0.3 +
        userInitiativePreference * 0.2 +
        relationship.familiarity * 0.15,
      );

  return Object.freeze({
    ...previous,
    drive,
    userEngagement,
    topicMomentum,
    userInitiativePreference,
    silenceTolerance,
    openLoops: advanceOpenLoops(previous, understanding),
  });
}

export function completeInitiativeState(
  current: InitiativeState,
  action: InitiativeAction,
  askedQuestion: boolean,
  currentTurn: number,
): InitiativeState {
  const significant = action === "follow_up" ||
    action === "expand" ||
    action === "resume_topic" ||
    action === "offer_related_topic";
  const recentAssistantInitiativeCount = significant
    ? Math.min(
        INITIATIVE_LIMITS.maximumRecentInitiatives,
        current.recentAssistantInitiativeCount + 1,
      )
    : Math.max(0, current.recentAssistantInitiativeCount - 1);
  const consecutiveQuestionTurns = askedQuestion
    ? Math.min(
        INITIATIVE_LIMITS.maximumConsecutiveQuestions,
        current.consecutiveQuestionTurns + 1,
      )
    : 0;
  const followUpFatigue = ratio(
    consecutiveQuestionTurns / INITIATIVE_LIMITS.maximumConsecutiveQuestions +
      recentAssistantInitiativeCount * 0.08,
  );
  const cooldown = action === "resume_topic" || action === "offer_related_topic"
    ? 3
    : action === "follow_up"
      ? 2
      : action === "expand"
        ? 1
        : Math.max(0, current.initiativeCooldownTurns - 1);

  return Object.freeze({
    ...current,
    recentAssistantInitiativeCount,
    ...(significant ? { lastInitiativeTurn: currentTurn } : {}),
    initiativeCooldownTurns: cooldown,
    consecutiveQuestionTurns,
    followUpFatigue,
  });
}
