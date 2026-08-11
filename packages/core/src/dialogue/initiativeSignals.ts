import type {
  DialogueIntent,
  InitiativeTurnSignals,
  PlannedConversationEvent,
  TopicContinuity,
  UserMood,
} from "@/types";

const BOREDOM = /^(?:(?:真的|现在|今天|有点|太)?好无聊|无聊(?:死了)?|不知道干嘛|没事干|闲得慌)[呀啊哦！!。,.，\s]*$/u;
const RETURNED = /^(?:我)?回来(?:了|啦|咯)?[呀啊哦！!。,.，\s～~]*$/u;
const EXPLICIT_CLOSE = /(?:算了[，,\s]*(?:不说|不聊)|不说了|不聊了|先这样(?:吧)?|就这样(?:吧)?|回头再说|先睡了|我去(?:睡觉|上课|忙了)|晚安)/u;
const LOW_ENGAGEMENT = /^(?:嗯+|哦+|行(?:吧)?|随便(?:吧)?|不知道|没啥|没事|算了|好(?:的)?|收到)[呀啊哦！!。,.，\s～~]*$/u;
const LAUGHTER = /^(?:(?:哈){2,}|233+|笑死(?:我了)?|草)[呀啊哦！!。,.，\s～~]*$/u;
const STORY_CONTINUATION = /(?:你猜后来|然后更离谱|更离谱的来了|还有高手|接下来才(?:是真的)?离谱|后面才精彩)/u;

interface EventRule {
  readonly planned: RegExp;
  readonly resolved: RegExp;
  readonly event: PlannedConversationEvent;
}

const EVENT_RULES: readonly EventRule[] = Object.freeze([
  {
    planned: /(?:等下|一会|待会|马上|下午|明天|准备|要|去).{0,8}(?:考试|考场)|(?:考试|考场).{0,8}(?:出发|去了)/u,
    resolved: /(?:考完了|考试结束了|考完回来|考试考完)/u,
    event: Object.freeze({ type: "planned_event", summary: "考试" }),
  },
  {
    planned: /(?:等下|一会|待会|马上|下午|明天|准备|要|去).{0,8}面试|面试.{0,8}(?:出发|去了)/u,
    resolved: /(?:面试完了|面完了|面试结束了)/u,
    event: Object.freeze({ type: "planned_event", summary: "面试" }),
  },
  {
    planned: /(?:等下|一会|待会|马上|下午|准备|要|去).{0,8}(?:吃饭|吃东西)|(?:吃饭|吃东西).{0,8}(?:去了|出发)/u,
    resolved: /(?:吃完了|吃完饭了|饭吃完了)/u,
    event: Object.freeze({ type: "planned_event", summary: "吃饭" }),
  },
  {
    planned: /(?:等下|一会|待会|马上|下午|周末|准备|要|去).{0,8}(?:兽展|兽聚|毛聚)/u,
    resolved: /(?:(?:兽展|兽聚|毛聚).{0,6}(?:结束|逛完)|从(?:兽展|兽聚|毛聚)回来)/u,
    event: Object.freeze({ type: "planned_event", summary: "兽展" }),
  },
  {
    planned: /(?:等下|一会|待会|马上|准备|要).{0,8}(?:更新系统|升级系统)/u,
    resolved: /(?:系统|版本).{0,5}(?:更新好了|更新完了|升级好了|升级完成)/u,
    event: Object.freeze({ type: "planned_event", summary: "系统更新" }),
  },
  {
    planned: /(?:等|蹲|还没).{0,8}(?:返图|稿子|稿件)|(?:返图|稿子|稿件).{0,8}(?:还没|没发|没到)/u,
    resolved: /(?:返图|稿子|稿件).{0,5}(?:到了|发了|收到)|(?:收到|拿到).{0,5}(?:返图|稿子|稿件)/u,
    event: Object.freeze({ type: "awaiting_result", summary: "返图" }),
  },
]);

function plannedEvent(input: string): PlannedConversationEvent | undefined {
  return EVENT_RULES.find(({ planned }) => planned.test(input))?.event;
}

function resolvedEventSummary(input: string): string | undefined {
  return EVENT_RULES.find(({ resolved }) => resolved.test(input))?.event.summary;
}

export function detectInitiativeSignals(
  input: string,
  intent: DialogueIntent,
  mood: UserMood,
  continuity: TopicContinuity,
): InitiativeTurnSignals {
  const normalized = input.trim();
  const event = plannedEvent(normalized);
  const resolved = resolvedEventSummary(normalized);
  const departingForEvent = event?.type === "planned_event" &&
    /(?:我要|我去|先去|出发|走了|准备去)/u.test(normalized);
  const lowEngagement = LOW_ENGAGEMENT.test(normalized) && !LAUGHTER.test(normalized);
  const highEngagement =
    LAUGHTER.test(normalized) ||
    STORY_CONTINUATION.test(normalized) ||
    intent === "question" ||
    intent === "storytelling" ||
    normalized.length >= 24 ||
    continuity.transition === "continued" ||
    (mood !== "neutral" && mood !== "unknown" && !lowEngagement);

  return Object.freeze({
    boredom: BOREDOM.test(normalized),
    returned: RETURNED.test(normalized),
    explicitClose: EXPLICIT_CLOSE.test(normalized) || departingForEvent,
    lowEngagement,
    highEngagement,
    storyContinuation: STORY_CONTINUATION.test(normalized),
    ...(event === undefined ? {} : { plannedEvent: event }),
    ...(resolved === undefined ? {} : { resolvedEventSummary: resolved }),
  });
}
