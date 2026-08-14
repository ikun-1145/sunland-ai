import type {
  EventSequenceRelationType,
  SemanticStateStatus,
  TemporalRelationType,
  TopicEventType,
  UnderstoodEventType,
  WorkingTopicStatus,
} from "@/types";

export interface EventStateTemporalExpected {
  readonly eventTypes?: readonly UnderstoodEventType[];
  readonly finalEvent?: UnderstoodEventType;
  readonly noEvent?: boolean;
  readonly recurrence?: boolean;
  readonly previousOccurrence?: boolean;
  readonly stateBefore?: SemanticStateStatus;
  readonly stateAfter?: SemanticStateStatus;
  readonly temporalIncludes?: readonly TemporalRelationType[];
  readonly temporalExcludes?: readonly TemporalRelationType[];
  readonly sequenceIncludes?: readonly EventSequenceRelationType[];
  readonly correction?: boolean;
  readonly ambiguous?: boolean;
  readonly topicEvent?: TopicEventType;
  readonly topicStatus?: WorkingTopicStatus;
}

export interface EventStateTemporalEvaluationCase {
  readonly id: string;
  readonly turns: readonly string[];
  readonly expected: EventStateTemporalExpected;
}

function defineCase(
  id: string,
  turns: readonly string[],
  expected: EventStateTemporalExpected,
): EventStateTemporalEvaluationCase {
  return Object.freeze({
    id,
    turns: Object.freeze(turns),
    expected: Object.freeze(expected),
  });
}

const RECURRENCE_INPUTS = Object.freeze([
  "bug又活了",
  "这个bug又活了",
  "问题又活了",
  "这个问题又活了",
  "故障又活了",
  "这个故障又活了",
  "网站又炸了",
  "网站又挂了",
  "服务器又挂了",
  "服务器又超时了",
  "数据库又报错了",
  "数据库再次报错了",
  "接口又超时了",
  "接口再次失败了",
  "代码又崩了",
  "代码再次崩了",
  "登录问题又活了",
  "登录又失败了",
  "网站再次断开了",
  "服务器再次炸了",
]);

const STILL_FAILURE_INPUTS = Object.freeze([
  "bug还是不行",
  "服务器还是挂了",
  "数据库仍然报错",
  "接口依然连不上",
  "网站还是没好",
  "代码仍然失败",
  "登录依然打不开",
  "问题还在报错",
  "接口还在报错",
  "数据库问题还在",
]);

const CHOICE_INPUTS = Object.freeze([
  "苹果还是安卓？",
  "咖啡还是茶？",
  "用PostgreSQL还是SQLite？",
  "买黑色还是白色？",
  "吃火锅还是烧烤？",
  "选A还是B？",
  "要今天还是明天？",
  "坐地铁还是公交？",
  "是左边还是右边？",
  "用网页还是App？",
]);

const FINALLY_INPUTS: readonly [string, UnderstoodEventType, SemanticStateStatus][] = Object.freeze([
  ["老师终于开稿了", "start", "available"],
  ["画师终于开委托了", "start", "available"],
  ["太太总算放档期了", "start", "available"],
  ["我推的谷终于到了", "receive", "available"],
  ["周边总算到了", "receive", "available"],
  ["返图终于到了", "receive", "available"],
  ["bug终于修好了", "recover", "resolved"],
  ["服务器终于恢复了", "recover", "resolved"],
  ["数据库总算能用了", "recover", "resolved"],
  ["接口终于修完了", "recover", "resolved"],
  ["网站总算好了", "recover", "resolved"],
  ["登录终于解决了", "recover", "resolved"],
  ["任务终于完成了", "complete", "resolved"],
  ["任务总算做完了", "complete", "resolved"],
  ["服务终于启动了", "start", "active"],
  ["网站总算上线了", "start", "active"],
]);

const ALREADY_INPUTS: readonly [string, UnderstoodEventType, SemanticStateStatus][] = Object.freeze([
  ["服务器已经挂了", "failure", "failed"],
  ["接口已经报错了", "failure", "failed"],
  ["数据库已经断开", "failure", "failed"],
  ["网站已经炸了", "failure", "failed"],
  ["任务已经完成了", "complete", "resolved"],
  ["任务已经做完了", "complete", "resolved"],
  ["缓存已经删除了", "delete", "inactive"],
  ["缓存已经移除了", "delete", "inactive"],
  ["服务已经启动了", "start", "active"],
  ["网站已经上线了", "start", "active"],
  ["服务已经停止了", "stop", "inactive"],
  ["服务已经下线了", "stop", "inactive"],
  ["配置已经改成了新值", "change", "working"],
  ["老师已经开稿了", "start", "available"],
  ["谷已经到了", "receive", "available"],
  ["稿件已经收到了", "receive", "available"],
]);

const RECENT_INPUTS: readonly [string, UnderstoodEventType, SemanticStateStatus][] = Object.freeze([
  ["服务器刚刚挂了", "failure", "failed"],
  ["数据库刚才报错", "failure", "failed"],
  ["接口刚刚超时", "failure", "failed"],
  ["网站刚才炸了", "failure", "failed"],
  ["bug刚刚又活了", "failure", "failed"],
  ["登录刚才失败了", "failure", "failed"],
  ["服务器刚才还好好的", "success", "working"],
  ["网站刚刚恢复了", "recover", "resolved"],
  ["接口刚才修好了", "recover", "resolved"],
  ["任务刚刚完成了", "complete", "resolved"],
  ["服务刚才启动了", "start", "active"],
  ["缓存刚刚删掉了", "delete", "inactive"],
]);

const SEQUENCE_INPUTS: readonly [string, readonly UnderstoodEventType[], boolean][] = Object.freeze([
  ["我先更新了依赖，然后网站就炸了", ["update", "failure"], true],
  ["先重启服务器，然后好了", ["retry", "recover"], false],
  ["改完配置以后还是不行", ["update", "failure"], false],
  ["依赖更新完了就网站炸了", ["update", "failure"], true],
  ["先服务启动了，然后服务停了", ["start", "stop"], false],
  ["先创建了任务，然后删除了缓存", ["create", "delete"], false],
  ["我改了cookie，然后登录还是不行", ["update", "failure"], false],
  ["先重启接口，然后接口恢复了", ["retry", "recover"], false],
  ["任务完成了以后服务启动了", ["complete", "start"], false],
  ["服务停了以后重新启动服务", ["stop", "resume"], false],
  ["先缓存删掉了，然后服务重新启动", ["delete", "resume"], false],
  ["先网站上线了，然后服务器挂了", ["start", "failure"], false],
  ["先创建了任务，然后任务完成了", ["create", "complete"], false],
  ["先更新了代码，然后接口报错了", ["update", "failure"], false],
  ["配置改完了就登录失败了", ["update", "failure"], true],
  ["先服务停了，然后重新开始服务", ["stop", "resume"], false],
]);

const LIFECYCLE_INPUTS: readonly [string, UnderstoodEventType, SemanticStateStatus][] = Object.freeze([
  ["服务启动了", "start", "active"],
  ["网站上线了", "start", "active"],
  ["服务停止了", "stop", "inactive"],
  ["服务下线了", "stop", "inactive"],
  ["服务重新启动", "resume", "working"],
  ["任务完成了", "complete", "resolved"],
  ["创建了任务", "create", "available"],
  ["删除了缓存", "delete", "inactive"],
  ["配置改成了新值", "change", "working"],
  ["我又吃火锅了", "recur", "resolved"],
]);

const PROBLEM_THREADS: readonly string[][] = Object.freeze([
  ["网站登录炸了", "好了"],
  ["接口一直报错", "解决了"],
  ["数据库连接失败", "搞定了"],
  ["服务器挂了", "恢复了"],
  ["Codex一直重新连接", "能用了"],
  ["App登录失败", "修好了"],
  ["iPhone连不上", "好了"],
  ["Watch也连不上", "解决了"],
  ["Git又报错了", "搞定了"],
  ["JWT验签失败", "修好了"],
  ["网站登录炸了", "我重启了", "终于好了"],
  ["接口一直报错", "我改了配置", "终于解决了"],
  ["数据库连接失败", "我重启了服务", "总算搞定了"],
  ["服务器挂了", "我重新配置了", "终于恢复了"],
  ["Codex一直重新连接", "我重装了", "终于能用了"],
  ["App登录失败", "我清缓存了", "总算修好了"],
  ["iPhone连不上", "我重启了", "终于好了"],
  ["Watch也连不上", "我更新了配置", "终于解决了"],
  ["Git又报错了", "我重新配置了", "总算搞定了"],
  ["JWT验签失败", "我更新了密钥", "终于修好了"],
]);

const CORRECTION_THREADS = Object.freeze([
  ["网站登录炸了", "好了", "等等，好像还是不行"],
  ["接口一直报错", "解决了", "等下，其实还是报错"],
  ["数据库连接失败", "搞定了", "不对，它依然连不上"],
  ["服务器挂了", "恢复了", "等等，服务器又挂了"],
  ["App登录失败", "修好了", "其实，登录还是打不开"],
  ["iPhone连不上", "好了", "等下，它还是连不上"],
  ["Watch也连不上", "解决了", "不对，还是不行"],
  ["Git又报错了", "搞定了", "等等，又报错了"],
  ["JWT验签失败", "修好了", "其实，还是失败"],
  ["代码崩了", "修好了", "等等，代码又崩了"],
]);

const WAITING_THREADS: readonly [readonly string[], UnderstoodEventType][] = Object.freeze([
  [["返图还没到", "已经到了"], "receive"],
  [["周边还没到", "终于到了"], "receive"],
  [["谷子还没到", "总算收到了"], "receive"],
  [["我推的新谷还没到", "已经到了"], "receive"],
  [["稿件还没到", "终于收到了"], "receive"],
  [["稿件还没发", "已经发了"], "send"],
  [["老师还没返图", "终于发了"], "send"],
  [["返图还没发", "总算交付了"], "send"],
  [["稿子还没发", "已经发出去了"], "send"],
  [["稿件还没完成", "终于交付了"], "send"],
]);

const CARRYOVER_THREADS: readonly [readonly string[], UnderstoodEventType, SemanticStateStatus, SemanticStateStatus][] = Object.freeze([
  [["网站登录炸了", "我改了配置"], "update", "failed", "working"],
  [["接口一直报错", "我重启了"], "retry", "failed", "working"],
  [["数据库连接失败", "我重新配置了"], "retry", "failed", "working"],
  [["服务器挂了", "我更新了配置"], "update", "failed", "working"],
  [["App登录失败", "我清缓存了"], "retry", "failed", "working"],
  [["网站登录炸了", "我改了cookie", "结果还是不行"], "failure", "working", "failed"],
  [["接口一直报错", "我重启了", "依然报错"], "failure", "working", "failed"],
  [["数据库连接失败", "我改了配置", "还是连不上"], "failure", "working", "failed"],
  [["返图还没到", "还在等"], "wait", "pending", "pending"],
  [["稿件还没发", "仍在等"], "wait", "pending", "pending"],
]);

const recurrenceCases = RECURRENCE_INPUTS.map((input, index) => defineCase(
  `recurrence-${index + 1}`,
  [input],
  {
    finalEvent: "failure",
    recurrence: true,
    previousOccurrence: true,
    stateAfter: "failed",
    temporalIncludes: ["again"],
  },
));
const stillCases = STILL_FAILURE_INPUTS.map((input, index) => defineCase(
  `still-failure-${index + 1}`,
  [input],
  {
    finalEvent: "failure",
    previousOccurrence: true,
    stateAfter: "failed",
    temporalIncludes: ["still"],
  },
));
const choiceCases = CHOICE_INPUTS.map((input, index) => defineCase(
  `still-choice-${index + 1}`,
  [input],
  { noEvent: true, temporalExcludes: ["still"] },
));
const finallyCases = FINALLY_INPUTS.map(([input, event, status], index) => defineCase(
  `finally-${index + 1}`,
  [input],
  { finalEvent: event, stateAfter: status, temporalIncludes: ["finally"] },
));
const alreadyCases = ALREADY_INPUTS.map(([input, event, status], index) => defineCase(
  `already-${index + 1}`,
  [input],
  { finalEvent: event, stateAfter: status, temporalIncludes: ["already"] },
));
const recentCases = RECENT_INPUTS.map(([input, event, status], index) => defineCase(
  `recent-${index + 1}`,
  [input],
  { finalEvent: event, stateAfter: status, temporalIncludes: ["just_now"] },
));
const sequenceCases = SEQUENCE_INPUTS.map(([input, events, possibleCause], index) => defineCase(
  `sequence-${index + 1}`,
  [input],
  {
    eventTypes: events,
    sequenceIncludes: possibleCause ? ["before", "possible_cause"] : ["before"],
  },
));
const lifecycleCases = LIFECYCLE_INPUTS.map(([input, event, status], index) => defineCase(
  `lifecycle-${index + 1}`,
  [input],
  { finalEvent: event, stateAfter: status },
));
const problemThreadCases = PROBLEM_THREADS.map((turns, index) => defineCase(
  `problem-thread-${index + 1}`,
  turns,
  {
    finalEvent: index < 10 ? "resolve" : "recover",
    stateBefore: index < 10 ? "failed" : "working",
    stateAfter: "resolved",
    topicEvent: "resolved",
    topicStatus: "resolved",
  },
));
const correctionCases = CORRECTION_THREADS.map((turns, index) => defineCase(
  `correction-${index + 1}`,
  turns,
  {
    finalEvent: "failure",
    stateAfter: "failed",
    correction: true,
    topicEvent: "failed",
    topicStatus: "active",
  },
));
const waitingCases = WAITING_THREADS.map(([turns, event], index) => defineCase(
  `waiting-${index + 1}`,
  turns,
  {
    finalEvent: event,
    stateBefore: "pending",
    stateAfter: "available",
    topicEvent: "succeeded",
  },
));
const carryoverCases = CARRYOVER_THREADS.map(
  ([turns, event, before, after], index) => defineCase(
    `carryover-${index + 1}`,
    turns,
    { finalEvent: event, stateBefore: before, stateAfter: after },
  ),
);

export const EVENT_STATE_TEMPORAL_EVALUATION_SET:
readonly EventStateTemporalEvaluationCase[] = Object.freeze([
  ...recurrenceCases,
  ...stillCases,
  ...choiceCases,
  ...finallyCases,
  ...alreadyCases,
  ...recentCases,
  ...sequenceCases,
  ...lifecycleCases,
  ...problemThreadCases,
  ...correctionCases,
  ...waitingCases,
  ...carryoverCases,
]);
