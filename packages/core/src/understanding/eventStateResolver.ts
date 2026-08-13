import type {
  ConversationUnderstanding,
  EntityRef,
  EventSequence,
  EventSequenceRelation,
  SemanticState,
  StateTransition,
  TemporalRelation,
  TemporalRelationType,
  UnderstandingCorrection,
  UnderstandingEvidence,
  UnderstoodEvent,
  UnderstoodEventType,
  WorkingConversationTopic,
} from "@/types";
import { hashString } from "@/utils/deterministic";

export interface EventStateResolution {
  readonly events: readonly UnderstoodEvent[];
  readonly stateTransitions: readonly StateTransition[];
  readonly temporalRelations: readonly TemporalRelation[];
  readonly eventSequence: EventSequence;
  readonly correction?: UnderstandingCorrection;
  readonly evidence: readonly UnderstandingEvidence[];
}

interface EventDraft {
  readonly type: UnderstoodEventType;
  readonly target: EntityRef;
  readonly stateBefore?: SemanticState;
  readonly stateAfter?: SemanticState;
  readonly confidence: number;
  readonly recurrence?: boolean;
  readonly evidenceLabel: string;
}

const FAILURE = /(?:(?:bug|问题|故障).{0,4}(?:又|再次)?活了|炸了?|崩了?|挂了?|坏了?|失败|报错|异常|断了?|断开|超时|连不上|打不开|不行|没好|没约到|没抢到)/iu;
const RESOLUTION = /(?:修好|修完|解决|搞定|恢复|能用了?|好了|成功了)/u;
const ATTEMPT = /(?:试了|尝试|重试|重启|重装|清缓存|换了|改了|重新配置)/iu;
const UPDATE = /(?:更新|升级|改(?:了|完)?(?:配置|cookie|依赖|代码|密钥)|换(?:了|完)?(?:配置|方案|版本|密钥))/iu;
const WAITING = /(?:还在(?:等|转圈|加载|处理|重连|报错)|仍在等|问题还在|正在(?:审核|处理|排队)|还没(?:到|发|返图|出图|完成|好)|没收到)/u;
const UNRESOLVED_PROBLEM = /(?:还没好|还是不行|仍然不行|依然不行|还在(?:转圈|加载|重连|报错)|问题还在)/u;
const RECEIVE = /(?:收到了?|到手了?|(?:谷|周边|返图|稿子|稿件|快递|毛装).{0,5}到了?|终于(?:到了|收到|返图))/u;
const SEND = /(?:(?:老师|画师|对方).{0,6}(?:发了|返图了|交付了)|(?:稿子|稿件|返图).{0,5}(?:发了|交付))/u;
const COMMISSION_OPEN = /(?:老师|画师|太太).{0,8}(?:开稿|开委托|放档期|开槽)|(?:开稿|开委托|放档期|开槽).{0,8}(?:老师|画师|太太)/u;
const MERCH_RELEASE = /(?:我推|本命|自推).{0,8}(?:出谷|上新|新谷|周边)|(?:出谷|上新|新谷).{0,8}(?:我推|本命|自推)/u;
const REPEATED_MEAL = /我又(?:去)?吃(?:了)?(?:火锅|饭|烧烤|外卖|面|披萨|汉堡)/u;
const CORRECTION = /^(?:不对|等等|等下|好像不是|我说错了|其实)[，,s]*/u;
const CHOICE = /(?:选|要|用|买|吃|是).{0,12}还是.{0,12}[？?]|^[^，,。]{1,12}还是[^，,。]{1,12}[？?]$/u;

function confidence(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function state(
  label: string,
  status: SemanticState["status"],
  value: number,
): SemanticState {
  return Object.freeze({ label, status, confidence: confidence(value) });
}

function entityRef(
  label: string,
  type: EntityRef["type"],
  value: number,
  id?: string,
): EntityRef {
  return Object.freeze({
    ...(id === undefined ? {} : { id }),
    label,
    type,
    confidence: confidence(value),
  });
}

function explicitTarget(input: string): EntityRef | undefined {
  const values: readonly [RegExp, string, EntityRef["type"]][] = [
    [/服务器/u, "服务器", "software"],
    [/数据库/u, "数据库", "software"],
    [/(?:网站|网页)/u, "网站", "project"],
    [/(?:登录)/u, "登录问题", "problem"],
    [/(?:接口|API)/iu, "接口", "software"],
    [/(?:代码)/u, "代码", "project"],
    [/(?:bug|故障|问题)/iu, "bug", "problem"],
    [/(?:依赖)/u, "依赖", "object"],
    [/(?:配置)/u, "配置", "object"],
    [/(?:cookie)/iu, "cookie", "object"],
    [/(?:返图)/u, "返图", "deliverable"],
    [/(?:稿子|稿件)/u, "稿件", "deliverable"],
    [/(?:谷|谷子|周边)/u, "周边", "object"],
    [/(?:开稿|委托|稿位)/u, "creator_commission", "event"],
    [/(?:火锅)/u, "吃火锅", "action"],
  ];
  const match = values.find(([expression]) => expression.test(input));
  return match === undefined ? undefined : entityRef(match[1], match[2], 0.94);
}

function topicTarget(topic: WorkingConversationTopic | undefined): EntityRef | undefined {
  if (topic === undefined) return undefined;
  const entity = topic.entities.find(({ type }) => type !== "problem") ??
    topic.entities.find(({ type }) => type === "problem");
  return entity === undefined
    ? entityRef(topic.label, "unknown", 0.76, topic.id)
    : entityRef(
        entity.canonicalName ?? entity.aliases[0] ?? topic.label,
        entity.type,
        0.82,
        entity.id,
      );
}

function previousTopic(
  conversation: ConversationUnderstanding,
  input: string,
): WorkingConversationTopic | undefined {
  if (conversation.topicContinuity.activeTopic !== undefined) {
    return conversation.topicContinuity.activeTopic;
  }
  if (!CORRECTION.test(input) && !/(?:还是|仍然|依然|终于|已经|还没|还在)/u.test(input)) {
    return undefined;
  }
  return [...conversation.topicContinuity.workingMemory.topics]
    .sort((left, right) => right.lastMentionTurn - left.lastMentionTurn)[0];
}

function priorTopicEvent(topic: WorkingConversationTopic | undefined) {
  if (topic === undefined) return undefined;
  const currentTurn = topic.lastMentionTurn;
  const current = topic.events.at(-1);
  return current?.turn === currentTurn ? topic.events.at(-2) : current;
}

function inferredPreviousState(
  topic: WorkingConversationTopic | undefined,
): SemanticState | undefined {
  if (topic?.semanticState !== undefined) return topic.semanticState;
  const event = priorTopicEvent(topic);
  if (event?.type === "failed" || event?.type === "problem_reported") {
    return state("previous_failed", "failed", 0.78);
  }
  if (event?.type === "resolved") return state("previous_resolved", "resolved", 0.82);
  if (event?.type === "pending") return state("previous_pending", "pending", 0.8);
  if (event?.type === "succeeded") return state("previous_available", "available", 0.72);
  return undefined;
}

function eventContext(
  input: string,
  conversation: ConversationUnderstanding,
): {
  readonly topic?: WorkingConversationTopic;
  readonly target: EntityRef;
  readonly previousState?: SemanticState;
  readonly ambiguous: boolean;
  readonly currentTurn: number;
} {
  const topic = previousTopic(conversation, input);
  const explicit = explicitTarget(input);
  const ambiguous = conversation.topicContinuity.needsClarification;
  const target = explicit ?? topicTarget(topic) ?? entityRef("unknown", "unknown", 0.35);
  const previousState = inferredPreviousState(topic);
  return {
    ...(topic === undefined ? {} : { topic }),
    target: ambiguous ? Object.freeze({ ...target, confidence: 0.35 }) : target,
    ...(previousState === undefined ? {} : { previousState }),
    ambiguous,
    currentTurn: conversation.topicContinuity.workingMemory.currentTurn,
  };
}

function splitSequence(input: string): readonly string[] {
  const normalized = input.trim();
  const explicit = normalized.match(/^(?:先)?(.+?)[，,]?(?:然后|后来)(.+)$/u);
  if (explicit?.[1] !== undefined && explicit[2] !== undefined) {
    return Object.freeze([explicit[1], explicit[2]].map((part) => part.trim()));
  }
  const after = normalized.match(/^(.+?)(?:以后|之后)(.+)$/u);
  if (after?.[1] !== undefined && after[2] !== undefined) {
    return Object.freeze([after[1], after[2]].map((part) => part.trim()));
  }
  const immediate = normalized.match(/^(.+?(?:完|了))[，,]?就(.+)$/u);
  if (immediate?.[1] !== undefined && immediate[2] !== undefined) {
    return Object.freeze([immediate[1], immediate[2]].map((part) => part.trim()));
  }
  return Object.freeze([normalized]);
}

function draftForClause(
  clause: string,
  context: ReturnType<typeof eventContext>,
  inheritedState?: SemanticState,
): EventDraft | null {
  const target = explicitTarget(clause) ?? context.target;
  const previous = inheritedState ?? context.previousState;
  const again = /(?:又|再次|重新)/u.test(clause);
  const still = /(?:还是|仍然|依然|还在|问题还在)/u.test(clause);

  if (COMMISSION_OPEN.test(clause)) {
    return {
      type: "start",
      target: entityRef("creator_commission", "event", 0.97),
      stateBefore: previous ?? state("commission_unavailable", "unavailable", 0.82),
      stateAfter: state("commission_available", "available", 0.97),
      confidence: 0.97,
      evidenceLabel: "commission-open",
    };
  }
  if (MERCH_RELEASE.test(clause)) {
    return {
      type: "create",
      target: entityRef("merchandise_release", "event", 0.94),
      stateBefore: previous ?? state("previous_release", "inactive", again ? 0.7 : 0.45),
      stateAfter: state("release_available", "available", 0.93),
      recurrence: again,
      confidence: 0.94,
      evidenceLabel: "merch-release",
    };
  }
  if (REPEATED_MEAL.test(clause)) {
    return {
      type: "recur",
      target: entityRef("吃火锅", "action", 0.96),
      stateAfter: state("action_completed", "resolved", 0.8),
      recurrence: true,
      confidence: 0.94,
      evidenceLabel: "repeated-action",
    };
  }
  if (WAITING.test(clause)) {
    const problem = target.type === "problem" || context.topic?.entities.some(
      ({ type }) => type === "problem",
    ) === true;
    return problem && UNRESOLVED_PROBLEM.test(clause)
      ? {
          type: "failure",
          target,
          stateBefore: previous ?? state("previous_failed", "failed", 0.72),
          stateAfter: state("still_failed", "failed", 0.94),
          confidence: context.ambiguous ? 0.58 : 0.93,
          evidenceLabel: "unresolved-problem",
        }
      : {
          type: "wait",
          target,
          stateBefore: previous ?? state("not_available_yet", "unavailable", 0.64),
          stateAfter: state("pending", "pending", 0.94),
          confidence: context.ambiguous ? 0.58 : 0.91,
          evidenceLabel: "pending-result",
        };
  }
  if (FAILURE.test(clause)) {
    const newlyReported = context.topic?.createdTurn === context.currentTurn &&
      context.topic.events.length === 1 &&
      context.topic.events[0]?.type === "problem_reported" &&
      !again && !still;
    const isRecurrence = again || /(?:又|再次).{0,4}活了/u.test(clause);
    const before = again
      ? previous ?? state("resolved_or_inactive_likely", "inactive", 0.62)
      : still
        ? previous ?? state("previous_failed", "failed", 0.76)
        : previous ?? state("previous_working_or_unknown", "working", 0.52);
    return {
      type: "failure",
      target,
      stateBefore: before,
      stateAfter: state(still ? "still_failed" : "failed", "failed", 0.96),
      recurrence: isRecurrence,
      confidence: context.ambiguous ? 0.58 : target.confidence >= 0.7 ? 0.94 : 0.72,
      evidenceLabel: newlyReported
        ? "problem-reported"
        : isRecurrence
          ? "failure-recurrence"
          : still
            ? "failure-continuation"
            : "failure",
    };
  }
  if (
    RESOLUTION.test(clause) &&
    (context.topic !== undefined || explicitTarget(clause) !== undefined || inheritedState !== undefined)
  ) {
    return {
      type: previous?.status === "failed" ? "resolve" : "recover",
      target,
      stateBefore: previous ?? state("previous_failed", "failed", 0.78),
      stateAfter: state("resolved", "resolved", 0.96),
      confidence: context.ambiguous ? 0.58 : 0.94,
      evidenceLabel: "problem-resolved",
    };
  }
  if (RECEIVE.test(clause)) {
    return {
      type: "receive",
      target,
      stateBefore: previous ?? state("pending", "pending", 0.72),
      stateAfter: state("received", "available", 0.94),
      confidence: target.confidence >= 0.7 ? 0.93 : 0.7,
      evidenceLabel: "received",
    };
  }
  if (SEND.test(clause)) {
    return {
      type: "send",
      target,
      stateBefore: previous ?? state("pending", "pending", 0.66),
      stateAfter: state("sent", "available", 0.9),
      confidence: 0.88,
      evidenceLabel: "sent",
    };
  }
  if (UPDATE.test(clause)) {
    return {
      type: "update",
      target,
      ...(previous === undefined ? {} : { stateBefore: previous }),
      stateAfter: state("updated", "working", 0.84),
      confidence: target.confidence >= 0.7 ? 0.9 : 0.76,
      evidenceLabel: "update-attempt",
    };
  }
  if (ATTEMPT.test(clause)) {
    return {
      type: "retry",
      target,
      ...(previous === undefined ? {} : { stateBefore: previous }),
      stateAfter: state("attempt_in_progress", "working", 0.82),
      confidence: target.confidence >= 0.7 ? 0.88 : 0.74,
      evidenceLabel: "retry-attempt",
    };
  }
  if (/刚才还好好的/u.test(clause)) {
    return {
      type: "success",
      target,
      stateAfter: state("working_recently", "working", 0.82),
      confidence: context.topic === undefined ? 0.64 : 0.8,
      evidenceLabel: "recent-working-state",
    };
  }
  return null;
}

function temporalDefinitions(
  input: string,
  events: readonly UnderstoodEvent[],
  choice: boolean,
): readonly { type: TemporalRelationType; marker: string; confidence: number }[] {
  const values: { type: TemporalRelationType; marker: string; confidence: number }[] = [];
  const add = (type: TemporalRelationType, expression: RegExp, value: number) => {
    const marker = input.match(expression)?.[0];
    if (marker !== undefined) values.push({ type, marker, confidence: value });
  };
  if (events.length > 0) add("again", /(?:再次|重新|又)/u, 0.95);
  if (!choice && events.some(({ type }) => type === "failure" || type === "wait")) {
    add("still", /(?:还是|仍然|依然|还在|问题还在)/u, 0.95);
  }
  add("already", /已经/u, 0.92);
  add("finally", /(?:终于|总算)/u, 0.97);
  add("just_now", /(?:刚刚|刚才)/u, 0.96);
  add("later", /后来/u, 0.9);
  add("previously", /之前|以前/u, 0.9);
  add("before", /(?:先|以前|之前)/u, 0.9);
  add("after", /(?:然后|后来|以后|之后|就)/u, 0.9);
  add("continuing", /(?:正在|还在|仍在)/u, 0.94);
  add("now", /(?:现在|当前)/u, 0.9);
  return Object.freeze(values);
}

export function resolveEventStateCandidates(
  input: string,
  conversation: ConversationUnderstanding,
): EventStateResolution {
  const normalized = input.trim().replace(/\s+/gu, " ");
  const context = eventContext(normalized, conversation);
  const clauses = splitSequence(normalized);
  const evidence: UnderstandingEvidence[] = [];
  const events: UnderstoodEvent[] = [];
  let inheritedState = context.previousState;

  for (const [index, clause] of clauses.entries()) {
    const draft = draftForClause(clause, context, inheritedState);
    if (draft === null) continue;
    const evidenceId = `event:${draft.evidenceLabel}:${index}`;
    evidence.push(Object.freeze({
      id: evidenceId,
      source: "event",
      kind: "semantic-event",
      label: draft.evidenceLabel,
      confidence: draft.confidence,
    }));
    const id = `event-${hashString(`${normalized}:${index}:${draft.type}:${draft.target.label}`).toString(36)}`;
    const event = Object.freeze({
      id,
      type: draft.type,
      target: draft.target,
      ...(draft.stateBefore === undefined ? {} : { stateBefore: draft.stateBefore }),
      ...(draft.stateAfter === undefined ? {} : { stateAfter: draft.stateAfter }),
      recurrence: draft.recurrence === true,
      previousOccurrence: draft.recurrence === true ||
        /(?:还是|仍然|依然)/u.test(clause),
      certainty: confidence(draft.confidence),
      confidence: confidence(draft.confidence),
      evidence: Object.freeze([{ evidenceId }]),
      sources: Object.freeze(["event" as const]),
      evidenceIds: Object.freeze([evidenceId]),
    });
    events.push(event);
    inheritedState = event.stateAfter;
  }

  const choice = CHOICE.test(normalized) && events.length === 0;
  const temporal = temporalDefinitions(normalized, events, choice).map(
    (definition, index) => {
      const evidenceId = `temporal:${definition.type}:${index}`;
      evidence.push(Object.freeze({
        id: evidenceId,
        source: "temporal",
        kind: "temporal-relation",
        label: definition.type,
        confidence: definition.confidence,
      }));
      return Object.freeze({
        type: definition.type,
        marker: definition.marker,
        ...(events.at(-1) === undefined ? {} : { eventId: events.at(-1)!.id }),
        confidence: definition.confidence,
        evidenceIds: Object.freeze([evidenceId]),
      });
    },
  );
  const stateTransitions = Object.freeze(events.flatMap((event) =>
    event.stateAfter === undefined || event.target === undefined
      ? []
      : [Object.freeze({
          target: event.target,
          ...(event.stateBefore === undefined ? {} : { from: event.stateBefore }),
          to: event.stateAfter,
          trigger: event.type,
          confidence: event.confidence,
          evidenceIds: event.evidenceIds,
        })],
  ));
  const relations: EventSequenceRelation[] = [];
  for (let index = 1; index < events.length; index += 1) {
    const from = events[index - 1]!;
    const to = events[index]!;
    relations.push(Object.freeze({
      fromEventId: from.id,
      toEventId: to.id,
      type: "before",
      confidence: 0.94,
    }));
    if (/就/u.test(normalized)) {
      relations.push(Object.freeze({
        fromEventId: from.id,
        toEventId: to.id,
        type: "possible_cause",
        confidence: 0.35,
      }));
    }
  }
  const previousSemanticEventId = context.topic?.events
    .filter(({ semanticEventId }) => semanticEventId !== undefined)
    .at(-1)?.semanticEventId;
  const correction = CORRECTION.test(normalized) && events[0] !== undefined
    ? Object.freeze({
        ...(previousSemanticEventId === undefined
          ? {}
          : { targetEventId: previousSemanticEventId }),
        replacement: Object.freeze({
          type: events[0].type,
          ...(events[0].target === undefined ? {} : { target: events[0].target }),
          ...(events[0].stateBefore === undefined
            ? {}
            : { stateBefore: events[0].stateBefore }),
          ...(events[0].stateAfter === undefined
            ? {}
            : { stateAfter: events[0].stateAfter }),
        }),
        confidence: 0.9,
        evidenceIds: events[0].evidenceIds,
      })
    : undefined;

  return Object.freeze({
    events: Object.freeze(events),
    stateTransitions,
    temporalRelations: Object.freeze(temporal),
    eventSequence: Object.freeze({
      events: Object.freeze(events),
      relations: Object.freeze(relations),
    }),
    ...(correction === undefined ? {} : { correction }),
    evidence: Object.freeze(evidence),
  });
}
