import type {
  CommunityResolution,
  ConversationMode,
  ConversationTopic,
  ConversationWorkingMemory,
  DialogueIntent,
  ResolvedReference,
  TopicContinuity,
  TopicEntity,
  TopicEntityType,
  TopicEvent,
  TopicEventType,
  UnderstoodEvent,
  WorkingConversationTopic,
  WorkingTopicStatus,
} from "@/types";
import { hashString } from "@/utils/deterministic";
import { resolveTopicReferences } from "./referenceResolver";

export const TOPIC_MEMORY_LIMITS = Object.freeze({
  maximumTopics: 8,
  maximumRecentEntities: 20,
  maximumRecentReferences: 12,
  maximumEventsPerTopic: 6,
  maximumEntitiesPerTopic: 8,
  maximumLabelLength: 64,
  maximumSummaryLength: 160,
  maximumAliasLength: 48,
});

const ENTITY_TYPES: ReadonlySet<TopicEntityType> = new Set([
  "person", "project", "object", "software", "event", "place", "concept", "problem", "unknown",
]);
const TOPIC_STATUSES: ReadonlySet<WorkingTopicStatus> = new Set([
  "active", "background", "paused", "resolved", "abandoned",
]);
const EVENT_TYPES: ReadonlySet<TopicEventType> = new Set([
  "mentioned", "problem_reported", "attempted", "failed", "succeeded", "resolved", "pending", "user_reaction",
]);
const COMMUNITY_DOMAINS: ReadonlySet<WorkingConversationTopic["domains"][number]> = new Set([
  "furry", "acg", "art", "cosplay", "goods", "internet",
]);
const SAFE_TOPIC_ID = /^topic-[a-z0-9-]+$/u;
const SAFE_ENTITY_ID = /^entity-[a-z0-9-]+$/u;

const REACTION_ONLY = /^(?:(?:哈){2,}|233+|笑死(?:我了)?|草|嗯+|哦+|行(?:吧)?|好(?:的)?|寄|晚安|[?？]+)[呀啊哦哈！!。,.，\s～~]*$/u;
const SWITCH_CUE = /(?:^|[，,。！!？?\s])(?:对了|话说|顺便|换个话题|先不说这个|另外(?:想问|说个)|回到刚才)/u;
const RETURN_CUE = /(?:回到刚才|刚才那个|前面那个|之前那个)/u;
const CORRECTION_CUE = /^(?:不对|等等|等下|好像不是|我说错了|其实)[，,\s]*/u;
const PAUSE_CUE = /(?:这个|那个|问题|bug)?.{0,5}(?:等下再说|先放着|先不说|待会再弄|晚点再看)/iu;
const ABANDON_CUE = /(?:算了不(?:搞|弄|管|聊)|不管了|放弃了|懒得弄|就这样吧)/u;
const RESOLVED_CUE = /(?:^|[，,。！!\s])(?:好了|解决了|搞定了|修好了|恢复了|能用了|成功了)[呀啊哦！!。,.，\s]*$/u;
const FAILED_CUE = /(?:还是|仍然|结果).{0,8}(?:不行|没好|失败|报错|连不上|打不开|没约到|没抢到)|(?:又|依然).{0,5}(?:崩|炸|报错|失败|断开)/u;
const ATTEMPT_CUE = /(?:试了|尝试|改了|换了|重装|重启|方案|fix|修复|排查|清缓存|更新了)/iu;
const PROBLEM_CUE = /(?:bug|问题|报错|异常|失败|连不上|打不开|崩了|炸了|挂了|超时|断开|重新连接|不工作|不能用)/iu;
const SUCCEEDED_CUE = /(?:终于|总算).{0,8}(?:好了|成功|到了|发了|出了|约到|收到)|(?:到了|发了|出了)[呀啊哦！!。,.，\s]*$/u;
const IMPLICIT_CONTINUATION_CUE = /^(?:但|但是|不过|然后|后来|结果|终于|总算|人(?:真的)?好多|好贵|太贵|热死|累死|到了|发了|好了|没好|不行|找到了|返图)/u;

interface EntityPattern {
  readonly expression: RegExp;
  readonly canonical: string;
  readonly type: TopicEntityType;
}

const ENTITY_PATTERNS: readonly EntityPattern[] = Object.freeze([
  { expression: /Sunland\s*AI/iu, canonical: "Sunland AI", type: "project" },
  { expression: /Codex/iu, canonical: "Codex", type: "software" },
  { expression: /Apple\s*Watch|\bWatch\b/iu, canonical: "Apple Watch", type: "object" },
  { expression: /iPhone/iu, canonical: "iPhone", type: "object" },
  { expression: /\bMac(?:Book)?\b/iu, canonical: "Mac", type: "object" },
  { expression: /(?:网站|网页)/u, canonical: "网站", type: "project" },
  { expression: /\bApp\b|应用/u, canonical: "App", type: "software" },
  { expression: /服务器/u, canonical: "服务器", type: "software" },
  { expression: /数据库/u, canonical: "数据库", type: "software" },
  { expression: /接口|\bAPI\b/iu, canonical: "接口", type: "software" },
  { expression: /\bGit\b/iu, canonical: "Git", type: "software" },
  { expression: /\bRSA\b/iu, canonical: "RSA", type: "concept" },
  { expression: /\bJWT\b/iu, canonical: "JWT", type: "concept" },
  { expression: /代码/u, canonical: "代码", type: "project" },
  { expression: /登录/u, canonical: "登录", type: "problem" },
  { expression: /连接|重新连接/u, canonical: "连接", type: "problem" },
  { expression: /(?:bug|报错|异常|崩了|炸了|超时)/iu, canonical: "故障", type: "problem" },
  { expression: /兽展|兽聚|毛聚/u, canonical: "兽展", type: "event" },
  { expression: /(?:出毛|毛装|兽装)/u, canonical: "毛装活动", type: "event" },
  { expression: /返图/u, canonical: "返图", type: "object" },
  { expression: /(?:开稿|约稿|委托|稿子|稿件)/u, canonical: "委托", type: "event" },
  { expression: /(?:新谷|谷子|周边|吧唧|徽章)/u, canonical: "周边", type: "object" },
  { expression: /(?:我推|本命)/u, canonical: "喜欢的角色", type: "person" },
  { expression: /(?:新番|番剧)/u, canonical: "新番", type: "concept" },
  { expression: /(?:日本留学|留学)/u, canonical: "日本留学", type: "concept" },
]);

const TOPIC_LABEL_RULES: readonly (readonly [RegExp, string])[] = Object.freeze([
  [/(?:网站|网页).{0,8}登录|登录.{0,8}(?:网站|网页)/u, "网站登录问题"],
  [/(?:App|应用).{0,8}登录|登录.{0,8}(?:App|应用)/iu, "App登录问题"],
  [/Codex.{0,10}(?:连不上|连接|重连)|(?:连不上|连接|重连).{0,10}Codex/iu, "Codex连接问题"],
  [/iPhone.{0,10}(?:连不上|连接|问题)/iu, "iPhone连接问题"],
  [/(?:Apple\s*Watch|Watch).{0,10}(?:连不上|连接|问题)/iu, "Apple Watch连接问题"],
  [/服务器/u, "服务器问题"],
  [/数据库/u, "数据库问题"],
  [/(?:接口|API)/iu, "接口问题"],
  [/\bGit\b/iu, "Git问题"],
  [/\bRSA\b/iu, "RSA"],
  [/\bJWT\b/iu, "JWT"],
  [/兽展|兽聚|毛聚/u, "兽展"],
  [/出毛|毛装|兽装/u, "毛装活动"],
  [/返图/u, "返图"],
  [/开稿|约稿|委托|稿子|稿件/u, "委托"],
  [/新谷|谷子|周边|吧唧|徽章/u, "周边"],
  [/新番|番剧/u, "新番"],
  [/日本留学|留学/u, "日本留学"],
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/gu, " ").slice(0, maximum);
  return normalized.length === 0 ? undefined : normalized;
}

function boundedRatio(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
}

function boundedTurn(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function safeId(value: unknown, prefix: "topic" | "entity"): string | undefined {
  const expression = prefix === "topic" ? SAFE_TOPIC_ID : SAFE_ENTITY_ID;
  return typeof value === "string" && expression.test(value)
    ? value.slice(0, 80)
    : undefined;
}

function entityId(type: TopicEntityType, canonical: string): string {
  return `entity-${type}-${hashString(canonical.toLocaleLowerCase("und")).toString(36)}`;
}

function normalizeEntity(value: unknown): TopicEntity | null {
  if (!isRecord(value)) return null;
  const type = typeof value.type === "string" && ENTITY_TYPES.has(value.type as TopicEntityType)
    ? value.type as TopicEntityType
    : undefined;
  const canonicalName = boundedText(value.canonicalName, TOPIC_MEMORY_LIMITS.maximumAliasLength);
  if (type === undefined || canonicalName === undefined) return null;
  const id = safeId(value.id, "entity") ?? entityId(type, canonicalName);
  const aliases = Object.freeze(
    (Array.isArray(value.aliases) ? value.aliases : [])
      .map((alias) => boundedText(alias, TOPIC_MEMORY_LIMITS.maximumAliasLength))
      .filter((alias): alias is string => alias !== undefined)
      .filter((alias, index, values) => values.indexOf(alias) === index)
      .slice(0, 6),
  );
  return Object.freeze({ id, type, canonicalName, aliases });
}

function normalizeEvent(value: unknown): TopicEvent | null {
  if (!isRecord(value)) return null;
  const type = typeof value.type === "string" && EVENT_TYPES.has(value.type as TopicEventType)
    ? value.type as TopicEventType
    : undefined;
  const summary = boundedText(value.summary, 64);
  if (type === undefined || summary === undefined) return null;
  const semanticEventId = typeof value.semanticEventId === "string" &&
      /^event-[a-z0-9-]{1,74}$/u.test(value.semanticEventId)
    ? value.semanticEventId
    : undefined;
  return Object.freeze({
    type,
    summary,
    turn: boundedTurn(value.turn),
    ...(semanticEventId === undefined ? {} : { semanticEventId }),
  });
}

function normalizeTopic(value: unknown): WorkingConversationTopic | null {
  if (!isRecord(value)) return null;
  const id = safeId(value.id, "topic");
  const label = boundedText(value.label, TOPIC_MEMORY_LIMITS.maximumLabelLength);
  const summary = boundedText(value.summary, TOPIC_MEMORY_LIMITS.maximumSummaryLength);
  const status = typeof value.status === "string" && TOPIC_STATUSES.has(value.status as WorkingTopicStatus)
    ? value.status as WorkingTopicStatus
    : undefined;
  if (id === undefined || label === undefined || summary === undefined || status === undefined) return null;
  const entities = Object.freeze(
    (Array.isArray(value.entities) ? value.entities : [])
      .map(normalizeEntity)
      .filter((entity): entity is TopicEntity => entity !== null)
      .filter((entity, index, values) => values.findIndex(({ id: itemId }) => itemId === entity.id) === index)
      .slice(-TOPIC_MEMORY_LIMITS.maximumEntitiesPerTopic),
  );
  const events = Object.freeze(
    (Array.isArray(value.events) ? value.events : [])
      .map(normalizeEvent)
      .filter((event): event is TopicEvent => event !== null)
      .slice(-TOPIC_MEMORY_LIMITS.maximumEventsPerTopic),
  );
  const domains = Object.freeze(
    (Array.isArray(value.domains) ? value.domains : [])
      .filter((domain): domain is WorkingConversationTopic["domains"][number] =>
        typeof domain === "string" && COMMUNITY_DOMAINS.has(domain as WorkingConversationTopic["domains"][number]),
      )
      .filter((domain, index, values) => values.indexOf(domain) === index)
      .slice(0, 3),
  );
  const semanticState = normalizeSemanticState(value.semanticState);
  return Object.freeze({
    id,
    label,
    summary,
    entities,
    status,
    relevance: boundedRatio(value.relevance),
    momentum: typeof value.momentum === "number"
      ? boundedRatio(value.momentum)
      : status === "active"
        ? 0.5
        : 0.15,
    createdTurn: boundedTurn(value.createdTurn),
    lastMentionTurn: boundedTurn(value.lastMentionTurn),
    events,
    ...(semanticState === undefined ? {} : { semanticState }),
    domains,
  });
}

function normalizeSemanticState(
  value: unknown,
): WorkingConversationTopic["semanticState"] | undefined {
  if (!isRecord(value)) return undefined;
  const status = typeof value.status === "string" && [
    "working", "failed", "resolved", "pending", "active", "inactive",
    "available", "unavailable", "unknown",
  ].includes(value.status)
    ? value.status as NonNullable<WorkingConversationTopic["semanticState"]>["status"]
    : undefined;
  const label = boundedText(value.label, 48);
  if (status === undefined || label === undefined) return undefined;
  return Object.freeze({ label, status, confidence: boundedRatio(value.confidence) });
}

function normalizeReference(value: unknown): ResolvedReference | null {
  if (!isRecord(value)) return null;
  const text = boundedText(value.text, 16);
  const targetType = typeof value.targetType === "string" &&
    ["entity", "topic", "event", "message", "unknown"].includes(value.targetType)
    ? value.targetType as ResolvedReference["targetType"]
    : undefined;
  if (text === undefined || targetType === undefined) return null;
  const targetId = typeof value.targetId === "string" && /^(?:topic|entity)-[a-z0-9-]+$/u.test(value.targetId)
    ? value.targetId.slice(0, 80)
    : undefined;
  return Object.freeze({
    text,
    targetType,
    ...(targetId === undefined ? {} : { targetId }),
    confidence: boundedRatio(value.confidence),
  });
}

export function createEmptyConversationWorkingMemory(): ConversationWorkingMemory {
  return Object.freeze({
    version: 1,
    topics: Object.freeze([]),
    recentEntities: Object.freeze([]),
    recentReferences: Object.freeze([]),
    currentTurn: 0,
  });
}

export function normalizeConversationWorkingMemory(value: unknown): ConversationWorkingMemory {
  if (!isRecord(value)) return createEmptyConversationWorkingMemory();
  const topics = Object.freeze(
    (Array.isArray(value.topics) ? value.topics : [])
      .map(normalizeTopic)
      .filter((topic): topic is WorkingConversationTopic => topic !== null)
      .filter((topic, index, values) => values.findIndex(({ id }) => id === topic.id) === index)
      .slice(-TOPIC_MEMORY_LIMITS.maximumTopics),
  );
  const activeTopicId = typeof value.activeTopicId === "string" &&
    topics.some(({ id, status }) => id === value.activeTopicId && status === "active")
    ? value.activeTopicId
    : undefined;
  const recentEntities = Object.freeze(
    (Array.isArray(value.recentEntities) ? value.recentEntities : [])
      .map(normalizeEntity)
      .filter((entity): entity is TopicEntity => entity !== null)
      .filter((entity, index, values) => values.findIndex(({ id }) => id === entity.id) === index)
      .slice(-TOPIC_MEMORY_LIMITS.maximumRecentEntities),
  );
  const recentReferences = Object.freeze(
    (Array.isArray(value.recentReferences) ? value.recentReferences : [])
      .map(normalizeReference)
      .filter((reference): reference is ResolvedReference => reference !== null)
      .slice(-TOPIC_MEMORY_LIMITS.maximumRecentReferences),
  );
  return Object.freeze({
    version: 1,
    ...(activeTopicId === undefined ? {} : { activeTopicId }),
    topics,
    recentEntities,
    recentReferences,
    currentTurn: boundedTurn(value.currentTurn),
  });
}

function topicEntity(type: TopicEntityType, canonicalName: string, alias: string): TopicEntity {
  return Object.freeze({
    id: entityId(type, canonicalName),
    type,
    canonicalName,
    aliases: Object.freeze(alias === canonicalName ? [canonicalName] : [canonicalName, alias]),
  });
}

export function detectTopicEntities(
  input: string,
  community: CommunityResolution,
): readonly TopicEntity[] {
  const entities: TopicEntity[] = [];
  for (const pattern of ENTITY_PATTERNS) {
    const match = pattern.expression.exec(input);
    if (match?.[0] === undefined) continue;
    entities.push(topicEntity(pattern.type, pattern.canonical, match[0]));
  }
  if (PROBLEM_CUE.test(input) && !entities.some(({ type }) => type === "problem")) {
    entities.push(topicEntity("problem", "未解决问题", "问题"));
  }
  if (community.primaryDomain !== undefined && entities.length === 0) {
    entities.push(topicEntity("concept", `${community.primaryDomain}话题`, community.primaryDomain));
  }
  return Object.freeze(
    entities.filter((entity, index, values) =>
      values.findIndex(({ id }) => id === entity.id) === index,
    ).slice(0, TOPIC_MEMORY_LIMITS.maximumEntitiesPerTopic),
  );
}

function topicLabel(
  input: string,
  entities: readonly TopicEntity[],
  category: ConversationTopic,
): string | undefined {
  for (const [expression, label] of TOPIC_LABEL_RULES) {
    if (expression.test(input)) return label;
  }
  const named = entities.find(({ type }) => type !== "problem")?.canonicalName;
  if (named !== undefined && PROBLEM_CUE.test(input)) return `${named}问题`;
  if (category === "technical_problem" && PROBLEM_CUE.test(input)) return "技术问题";
  return undefined;
}

function eventFor(input: string, activeIsProblem: boolean): TopicEvent {
  let type: TopicEventType = "mentioned";
  let summary = "话题被再次提及";
  if (FAILED_CUE.test(input)) {
    type = "failed";
    summary = "此前尝试未解决问题";
  } else if (RESOLVED_CUE.test(input) && activeIsProblem) {
    type = "resolved";
    summary = "问题已经解决";
  } else if (SUCCEEDED_CUE.test(input)) {
    type = "succeeded";
    summary = "等待的结果已经出现";
  } else if (ATTEMPT_CUE.test(input)) {
    type = "attempted";
    summary = "用户尝试了新的处理方式";
  } else if (PROBLEM_CUE.test(input)) {
    type = "problem_reported";
    summary = "用户报告了仍需处理的问题";
  } else if (REACTION_ONLY.test(input)) {
    type = "user_reaction";
    summary = "用户对当前话题作出反应";
  }
  return Object.freeze({ type, summary, turn: 0 });
}

function isProblemTopic(topic: WorkingConversationTopic | undefined): boolean {
  return topic?.entities.some(({ type }) => type === "problem") === true ||
    (topic !== undefined && /(?:问题|bug|报错|连接|登录)/iu.test(topic.label));
}

function decayedTopics(
  topics: readonly WorkingConversationTopic[],
): readonly WorkingConversationTopic[] {
  return Object.freeze(topics.map((topic) => {
    const factor = topic.status === "active" ? 0.92
      : topic.status === "background" ? 0.82
        : topic.status === "paused" ? 0.78
          : topic.status === "resolved" ? 0.56
            : 0.48;
    const momentumFactor = topic.status === "active" ? 0.9
      : topic.status === "background" ? 0.75
        : topic.status === "paused" ? 0.65
          : 0.2;
    return Object.freeze({
      ...topic,
      relevance: topic.relevance * factor,
      momentum: topic.momentum * momentumFactor,
    });
  }));
}

function topicForReference(
  topics: readonly WorkingConversationTopic[],
  references: readonly ResolvedReference[],
): WorkingConversationTopic | undefined {
  for (const reference of references) {
    if (reference.targetId === undefined || reference.confidence < 0.7) continue;
    const direct = topics.find(({ id }) => id === reference.targetId);
    if (direct !== undefined) return direct;
    const byEntity = topics.find(({ entities }) =>
      entities.some(({ id }) => id === reference.targetId),
    );
    if (byEntity !== undefined) return byEntity;
  }
  return undefined;
}

function topicForEntities(
  topics: readonly WorkingConversationTopic[],
  entities: readonly TopicEntity[],
): WorkingConversationTopic | undefined {
  const entityIds = new Set(
    entities.filter(({ type }) => type !== "problem").map(({ id }) => id),
  );
  if (entityIds.size === 0) return undefined;
  return [...topics]
    .sort((left, right) => right.lastMentionTurn - left.lastMentionTurn)
    .find((topic) => topic.entities.some(({ id }) => entityIds.has(id)));
}

function sameTopic(
  topic: WorkingConversationTopic,
  label: string,
  entities: readonly TopicEntity[],
): boolean {
  if (topic.label === label) return true;
  const entityIds = new Set(entities.map(({ id }) => id));
  return topic.entities.some(({ id, type }) => type !== "problem" && entityIds.has(id));
}

function updateTopic(
  topic: WorkingConversationTopic,
  entities: readonly TopicEntity[],
  event: TopicEvent,
  turn: number,
  status: WorkingTopicStatus,
  domains: readonly WorkingConversationTopic["domains"][number][],
): WorkingConversationTopic {
  const nextEvent = Object.freeze({ ...event, turn });
  const mergedEntities = Object.freeze(
    [...topic.entities, ...entities]
      .filter((entity, index, values) => values.findIndex(({ id }) => id === entity.id) === index)
      .slice(-TOPIC_MEMORY_LIMITS.maximumEntitiesPerTopic),
  );
  const events = Object.freeze(
    [...topic.events, nextEvent].slice(-TOPIC_MEMORY_LIMITS.maximumEventsPerTopic),
  );
  const mergedDomains = Object.freeze(
    [...domains, ...topic.domains]
      .filter((domain, index, values) => values.indexOf(domain) === index)
      .slice(0, 3),
  );
  const momentum = status === "resolved" || status === "abandoned"
    ? 0.05
    : status === "paused"
      ? 0.2
      : event.type === "failed" || event.type === "problem_reported"
        ? 0.9
        : event.type === "attempted"
          ? 0.8
          : event.type === "succeeded"
            ? 0.35
            : event.type === "user_reaction"
              ? Math.max(0.2, topic.momentum - 0.18)
              : Math.min(1, topic.momentum + 0.08);
  return Object.freeze({
    ...topic,
    summary: `${topic.label}；${nextEvent.summary}`.slice(0, TOPIC_MEMORY_LIMITS.maximumSummaryLength),
    entities: mergedEntities,
    status,
    relevance: status === "resolved" || status === "abandoned" ? 0.45 : 1,
    momentum,
    lastMentionTurn: turn,
    events,
    domains: mergedDomains,
  });
}

function newTopic(
  label: string,
  entities: readonly TopicEntity[],
  event: TopicEvent,
  turn: number,
  domains: readonly WorkingConversationTopic["domains"][number][],
): WorkingConversationTopic {
  const id = `topic-${hashString(`${label}:${turn}`).toString(36)}`;
  const nextEvent = Object.freeze({ ...event, turn });
  return Object.freeze({
    id,
    label: label.slice(0, TOPIC_MEMORY_LIMITS.maximumLabelLength),
    summary: `${label}；${nextEvent.summary}`.slice(0, TOPIC_MEMORY_LIMITS.maximumSummaryLength),
    entities: Object.freeze(entities.slice(0, TOPIC_MEMORY_LIMITS.maximumEntitiesPerTopic)),
    status: "active",
    relevance: 1,
    momentum: event.type === "problem_reported" || event.type === "failed"
      ? 0.85
      : event.type === "succeeded"
        ? 0.35
        : 0.6,
    createdTurn: turn,
    lastMentionTurn: turn,
    events: Object.freeze([nextEvent]),
    domains: Object.freeze(domains.slice(0, 3)),
  });
}

function topicEventFromUnderstanding(event: UnderstoodEvent): TopicEvent | null {
  const type: TopicEventType | null = event.type === "failure"
    ? event.evidenceIds.some((id) => id.includes("problem-reported"))
      ? "problem_reported"
      : "failed"
    : event.type === "resolve" || event.type === "recover"
      ? "resolved"
      : event.type === "success" || event.type === "complete" ||
          event.type === "receive" || event.type === "send" ||
          event.type === "start" || event.type === "stop" ||
          event.type === "resume" || event.type === "create" ||
          event.type === "delete"
        ? "succeeded"
        : event.type === "retry" || event.type === "update" || event.type === "change"
          ? "attempted"
          : event.type === "wait"
            ? "pending"
            : null;
  if (type === null) return null;
  const summary = type === "failed"
    ? "统一理解判定当前事件失败"
    : type === "resolved"
      ? "统一理解判定问题已经解决"
      : type === "succeeded"
        ? "统一理解判定等待结果已经出现"
        : type === "pending"
          ? "统一理解判定结果仍在等待"
          : "统一理解判定用户进行了新的尝试";
  return Object.freeze({
    type,
    summary,
    turn: 0,
    semanticEventId: event.id,
  });
}

function topicEntityFromUnderstanding(event: UnderstoodEvent): TopicEntity | undefined {
  const target = event.target;
  if (target === undefined || target.label === "unknown") return undefined;
  const type: TopicEntityType = target.type === "action"
    ? "event"
    : target.type === "deliverable"
      ? "object"
      : target.type;
  return topicEntity(type, target.label, target.label);
}

function createTopicFromUnderstanding(
  continuity: TopicContinuity,
  event: UnderstoodEvent,
  projected: TopicEvent,
): TopicContinuity | undefined {
  if (event.type !== "failure" && event.type !== "wait") return undefined;
  const entity = topicEntityFromUnderstanding(event);
  if (entity === undefined || event.target?.confidence === undefined || event.target.confidence < 0.75) {
    return undefined;
  }
  const currentTurn = continuity.workingMemory.currentTurn;
  const eventType: TopicEventType = event.type === "failure" ? "problem_reported" : "pending";
  const initialEvent = Object.freeze({
    ...projected,
    type: eventType,
    summary: eventType === "problem_reported"
      ? "统一理解识别了需要跟踪的问题"
      : "统一理解识别了等待中的结果",
  });
  const label = event.type === "failure" && !/(?:问题|bug)/iu.test(event.target.label)
    ? `${event.target.label}问题`
    : event.target.label;
  const created = Object.freeze({
    ...newTopic(label, [entity], initialEvent, currentTurn, []),
    ...(event.stateAfter === undefined ? {} : { semanticState: event.stateAfter }),
  });
  const topics = boundedTopics(
    [...continuity.workingMemory.topics, created],
    created.id,
  );
  return Object.freeze({
    ...continuity,
    transition: "new_topic",
    workingMemory: Object.freeze({
      ...continuity.workingMemory,
      activeTopicId: created.id,
      topics,
    }),
    activeTopic: created,
  });
}

/**
 * Projects a confident unified event back into bounded Working Memory.
 * The legacy topic regex remains the fallback that created `continuity`.
 */
export function applyUnifiedEventsToTopicContinuity(
  continuity: TopicContinuity,
  events: readonly UnderstoodEvent[],
): TopicContinuity {
  if (continuity.needsClarification) return continuity;
  const semanticEvent = [...events]
    .filter(({ confidence, target }) =>
      confidence >= 0.75 &&
      (target === undefined || target.confidence >= 0.7),
    )
    .at(-1);
  if (semanticEvent === undefined) return continuity;
  const targetId = semanticEvent.target?.id;
  const targetLabel = semanticEvent.target?.label;
  const active = continuity.activeTopic ?? (
    continuity.workingMemory.topics.find((topic) =>
      (targetId !== undefined && (
        topic.id === targetId || topic.entities.some(({ id }) => id === targetId)
      )) ||
      (targetLabel !== undefined && targetLabel !== "unknown" && (
        topic.label === targetLabel ||
        topic.entities.some(({ aliases, canonicalName }) =>
          canonicalName === targetLabel || aliases.includes(targetLabel),
        )
      )),
    )
  );
  const projected = topicEventFromUnderstanding(semanticEvent);
  if (projected === null) return continuity;
  if (active === undefined) {
    return createTopicFromUnderstanding(continuity, semanticEvent, projected) ?? continuity;
  }

  const currentTurn = continuity.workingMemory.currentTurn;
  const currentLegacyEvent = active.events.at(-1)?.turn === currentTurn;
  const compatibleProjection = projected.type === "failed" &&
      active.events.at(-1)?.type === "problem_reported" &&
      currentLegacyEvent &&
      continuity.transition === "new_topic"
    ? Object.freeze({
        ...projected,
        type: "problem_reported" as const,
        summary: "用户报告了再次发生的问题",
      })
    : projected;
  const currentEvents = active.events.at(-1)?.turn === currentTurn
    ? active.events.slice(0, -1)
    : active.events;
  const nextStatus: WorkingTopicStatus = projected.type === "resolved" &&
      isProblemTopic(active)
    ? "resolved"
    : projected.type === "failed"
      ? "active"
    : active.status;
  const nextActive: WorkingConversationTopic = Object.freeze({
    ...active,
    status: nextStatus,
    ...(semanticEvent.stateAfter === undefined
      ? {}
      : { semanticState: semanticEvent.stateAfter }),
    events: Object.freeze([
      ...currentEvents,
      Object.freeze({ ...compatibleProjection, turn: currentTurn }),
    ].slice(-TOPIC_MEMORY_LIMITS.maximumEventsPerTopic)),
  });
  const nextTopics = Object.freeze(continuity.workingMemory.topics.map((topic) =>
    topic.id === active.id ? nextActive : topic,
  ));
  const activeTopicId = nextStatus === "resolved"
    ? undefined
    : active.id;
  const workingMemory = Object.freeze({
    ...continuity.workingMemory,
    ...(activeTopicId === undefined ? {} : { activeTopicId }),
    topics: nextTopics,
  });
  if (activeTopicId === undefined) {
    const { activeTopicId: _removed, ...withoutActive } = workingMemory;
    return Object.freeze({
      ...continuity,
      transition: "resolved",
      workingMemory: Object.freeze(withoutActive),
      activeTopic: nextActive,
    });
  }
  return Object.freeze({
    ...continuity,
    transition: continuity.activeTopic === undefined ? "resumed" : continuity.transition,
    workingMemory,
    activeTopic: nextActive,
  });
}

function boundedTopics(
  topics: readonly WorkingConversationTopic[],
  activeTopicId: string | undefined,
): readonly WorkingConversationTopic[] {
  if (topics.length <= TOPIC_MEMORY_LIMITS.maximumTopics) return Object.freeze(topics);
  const ranked = [...topics].sort((left, right) => {
    if (left.id === activeTopicId) return -1;
    if (right.id === activeTopicId) return 1;
    const leftDisposable = left.status === "resolved" || left.status === "abandoned";
    const rightDisposable = right.status === "resolved" || right.status === "abandoned";
    return Number(leftDisposable) - Number(rightDisposable) ||
      right.relevance - left.relevance ||
      right.lastMentionTurn - left.lastMentionTurn;
  });
  const keep = new Set(ranked.slice(0, TOPIC_MEMORY_LIMITS.maximumTopics).map(({ id }) => id));
  return Object.freeze(topics.filter(({ id }) => keep.has(id)));
}

export function trackConversationTopics(
  input: string,
  current: ConversationWorkingMemory | undefined,
  community: CommunityResolution,
  intent: DialogueIntent,
  category: ConversationTopic,
  mode: ConversationMode,
): TopicContinuity {
  const previous = normalizeConversationWorkingMemory(current);
  const turn = previous.currentTurn + 1;
  const entities = detectTopicEntities(input, community);
  const references = resolveTopicReferences(input, previous, entities);
  const label = topicLabel(input, entities, category);
  const previousActive = previous.activeTopicId === undefined
    ? undefined
    : previous.topics.find(({ id }) => id === previous.activeTopicId);
  const referencedTopic = topicForReference(previous.topics, references.references);
  const returnRequested = RETURN_CUE.test(input);
  const correctionRequested = CORRECTION_CUE.test(input);
  const reactionOnly = intent === "reaction" || REACTION_ONLY.test(input);
  const meaningful = input.trim().length > 1 && !reactionOnly && intent !== "greeting" && intent !== "thanks" && intent !== "farewell";
  const hasImplicitContinuation =
    IMPLICIT_CONTINUATION_CUE.test(input) ||
    FAILED_CUE.test(input) ||
    ATTEMPT_CUE.test(input) ||
    RESOLVED_CUE.test(input) ||
    SUCCEEDED_CUE.test(input);
  let topics = [...decayedTopics(previous.topics)];
  let activeTopicId = previous.activeTopicId;
  let transition: TopicContinuity["transition"] = "none";

  if (references.ambiguousTopics.length > 1) {
    transition = "ambiguous";
  } else {
    const hasExplicitNamedEntity = entities.some(({ type }) => type !== "problem");
    let selected = correctionRequested
      ? [...topics].sort((left, right) => right.lastMentionTurn - left.lastMentionTurn)[0]
      : returnRequested
      ? referencedTopic
      : hasExplicitNamedEntity
        ? topicForEntities(topics, entities)
        : referencedTopic ?? (hasImplicitContinuation ? previousActive : undefined);
    if (selected === undefined && label !== undefined) {
      selected = topics.find((topic) => sameTopic(topic, label, entities));
    }
    if (
      selected === undefined &&
      label !== undefined &&
      previousActive !== undefined &&
      !SWITCH_CUE.test(input) &&
      (community.activeDomains.some((domain) => previousActive.domains.includes(domain)) ||
        (label === "返图" && previousActive.domains.length > 0))
    ) {
      selected = topics.find(({ id }) => id === previousActive.id);
    }
    const explicitDifferentTopic = label !== undefined &&
      (previousActive === undefined || !sameTopic(previousActive, label, entities));
    const createNew = meaningful && label !== undefined && selected === undefined &&
      !correctionRequested &&
      (explicitDifferentTopic || SWITCH_CUE.test(input));

    if (createNew) {
      topics = topics.map((topic) => topic.id === activeTopicId && topic.status === "active"
        ? Object.freeze({ ...topic, status: "background" as const })
        : topic);
      const event = PROBLEM_CUE.test(input)
        ? Object.freeze<TopicEvent>({
            type: "problem_reported",
            summary: "用户报告了仍需处理的问题",
            turn: 0,
          })
        : eventFor(input, false);
      const created = newTopic(label, entities, event, turn, community.activeDomains);
      topics.push(created);
      activeTopicId = created.id;
      transition = previousActive === undefined ? "new_topic" : "switched";
    } else {
      selected ??= referencedTopic ?? previousActive;
      const sharesCommunityDomain = selected !== undefined &&
        community.activeDomains.some((domain) => selected!.domains.includes(domain));
      const sameExplicitTopic = selected !== undefined && label !== undefined &&
        sameTopic(selected, label, entities);
      const continuesExisting = returnRequested || reactionOnly ||
        references.references.some(({ confidence }) => confidence >= 0.7) ||
        hasImplicitContinuation ||
        sameExplicitTopic || sharesCommunityDomain ||
        (selected !== undefined && isProblemTopic(selected) && mode === "technical");
      if (selected !== undefined && continuesExisting) {
        let status: WorkingTopicStatus = "active";
        if (ABANDON_CUE.test(input)) status = "abandoned";
        else if (PAUSE_CUE.test(input)) status = "paused";
        else if (RESOLVED_CUE.test(input) && isProblemTopic(selected)) status = "resolved";
        const event = eventFor(input, isProblemTopic(selected));
        topics = topics.map((topic) => {
          if (topic.id === selected!.id) {
            return updateTopic(topic, entities, event, turn, status, community.activeDomains);
          }
          return topic.id === activeTopicId && status === "active" && topic.status === "active"
            ? Object.freeze({ ...topic, status: "background" as const })
            : topic;
        });
        if (status === "resolved" || status === "abandoned" || status === "paused") {
          activeTopicId = undefined;
          transition = status;
        } else {
          activeTopicId = selected.id;
          transition = returnRequested || selected.id !== previousActive?.id ? "resumed" : "continued";
        }
      } else if (meaningful && mode !== "unknown" && SWITCH_CUE.test(input)) {
        activeTopicId = undefined;
        transition = "switched";
      }
    }
  }

  const decayedActive = activeTopicId === undefined
    ? undefined
    : topics.find(({ id }) => id === activeTopicId);
  if (transition === "none" && decayedActive !== undefined && decayedActive.relevance < 0.28) {
    topics = topics.map((topic) => topic.id === decayedActive.id
      ? Object.freeze({ ...topic, status: "background" as const })
      : topic);
    activeTopicId = undefined;
  }

  topics = [...boundedTopics(topics, activeTopicId)];
  const recentEntities = Object.freeze(
    [...previous.recentEntities, ...entities]
      .filter((entity, index, values) =>
        values.map(({ id }) => id).lastIndexOf(entity.id) === index)
      .slice(-TOPIC_MEMORY_LIMITS.maximumRecentEntities),
  );
  const recentReferences = Object.freeze(
    [...previous.recentReferences, ...references.references]
      .slice(-TOPIC_MEMORY_LIMITS.maximumRecentReferences),
  );
  const workingMemory = Object.freeze({
    version: 1 as const,
    ...(activeTopicId === undefined ? {} : { activeTopicId }),
    topics: Object.freeze(topics),
    recentEntities,
    recentReferences,
    currentTurn: turn,
  });
  const activeTopic = activeTopicId === undefined
    ? undefined
    : topics.find(({ id }) => id === activeTopicId);

  return Object.freeze({
    transition,
    workingMemory,
    references: references.references,
    ...(activeTopic === undefined ? {} : { activeTopic }),
    needsClarification: references.ambiguousTopics.length > 1,
    clarificationCandidates: Object.freeze(
      references.ambiguousTopics.map(({ label: candidate }) => candidate).slice(0, 3),
    ),
  });
}
