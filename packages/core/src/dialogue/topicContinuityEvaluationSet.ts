import type { TopicEventType, TopicTransition, WorkingTopicStatus } from "@/types";

export interface TopicContinuityExpected {
  readonly activeLabel?: string;
  readonly transition?: TopicTransition;
  readonly topicCount?: number;
  readonly needsClarification?: boolean;
  readonly finalStatus?: WorkingTopicStatus;
  readonly finalEvent?: TopicEventType;
  readonly referenceResolved?: boolean;
  readonly activeCleared?: boolean;
}

export interface TopicContinuityEvaluationCase {
  readonly id: string;
  readonly turns: readonly string[];
  readonly expected: TopicContinuityExpected;
}

function defineCase(
  id: string,
  turns: readonly string[],
  expected: TopicContinuityExpected,
): TopicContinuityEvaluationCase {
  return Object.freeze({ id, turns: Object.freeze(turns), expected: Object.freeze(expected) });
}

const NEW_TOPICS: readonly [string, string][] = Object.freeze([
  ["我的网站登录炸了", "网站登录问题"],
  ["网页登录一直失败", "网站登录问题"],
  ["网站的登录又有问题", "网站登录问题"],
  ["App登录打不开", "App登录问题"],
  ["应用登录失败了", "App登录问题"],
  ["Mac上的Codex连不上", "Codex连接问题"],
  ["Codex一直重新连接", "Codex连接问题"],
  ["iPhone连不上", "iPhone连接问题"],
  ["iPhone连接有问题", "iPhone连接问题"],
  ["Watch也连不上", "Apple Watch连接问题"],
  ["Apple Watch连接失败", "Apple Watch连接问题"],
  ["服务器又超时了", "服务器问题"],
  ["服务器挂了", "服务器问题"],
  ["数据库一直报错", "数据库问题"],
  ["数据库连接失败", "数据库问题"],
  ["接口返回异常", "接口问题"],
  ["API又超时", "接口问题"],
  ["Git又报错了", "Git问题"],
  ["RSA现在安全吗", "RSA"],
  ["JWT验签失败", "JWT"],
  ["代码又崩了", "代码问题"],
  ["周末准备去兽展", "兽展"],
  ["老师终于开稿了", "委托"],
  ["我推新谷出了", "周边"],
  ["最近有什么新番", "新番"],
]);

const NON_TOPICS = Object.freeze([
  "哈哈哈", "行", "行吧", "草", "笑死", "嗯", "哦", "好", "好的", "？",
  "晚安", "谢谢", "推门", "推代码", "吃谷物", "山谷", "数学老师来了", "猫开始掉毛了",
  "数组这一列", "官方公告", "天气不错", "今天挺好", "先歇会儿", "收到", "再见",
]);

const DIRECT_CONTINUATIONS = Object.freeze([
  ["我的网站登录炸了", "我试了清缓存", "结果还是没好"],
  ["接口一直报错", "尝试了方案A", "还是报错"],
  ["数据库连接失败", "我重启了服务", "仍然连不上"],
  ["服务器又超时了", "换了配置", "结果还是不行"],
  ["Codex一直重新连接", "我重装了", "还是没好"],
]);

const PRONOUNS = Object.freeze([
  ["Mac上的Codex连不上", "它一直显示重新连接"],
  ["我的网站登录炸了", "这个还是没好"],
  ["服务器挂了", "它又超时了"],
  ["数据库一直报错", "这个问题还是不行"],
  ["App登录打不开", "这玩意还是报错"],
]);

const SWITCHES: readonly [readonly string[], string][] = Object.freeze([
  [["网站登录炸了", "对了周末兽展几点"], "兽展"],
  [["代码又崩了", "话说我推新谷出了"], "周边"],
  [["老师终于开稿了", "顺便问下RSA安全吗"], "RSA"],
  [["周末准备去兽展", "换个话题，最近有什么新番"], "新番"],
  [["服务器又超时了", "对了，日本留学怎么样"], "日本留学"],
]);

const RETURNS: readonly [readonly string[], string][] = Object.freeze([
  [["网站登录炸了", "对了周末兽展几点", "回到刚才那个bug"], "网站登录问题"],
  [["接口一直报错", "话说我推新谷出了", "之前那个bug还是不行"], "接口问题"],
  [["服务器挂了", "换个话题，最近有什么新番", "前面那个问题后来呢"], "服务器问题"],
  [["数据库连接失败", "老师终于开稿了", "刚才那个bug继续"], "数据库问题"],
  [["代码又崩了", "对了，日本留学怎么样", "回到刚才那个bug"], "代码问题"],
]);

const AMBIGUITIES = Object.freeze([
  ["iPhone连不上", "Watch也连不上", "它还是不行"],
  ["网站登录炸了", "App登录也失败", "那个还是没好"],
  ["服务器挂了", "数据库也报错", "它还是不行"],
  ["接口一直报错", "代码也崩了", "这个还是没好"],
  ["Codex连不上", "App也打不开", "那玩意还是不行"],
]);

const COMMUNITY: readonly [readonly string[], string, TopicEventType | null][] = Object.freeze([
  [["老师终于开稿了", "我蹲好久了", "终于约到了"], "委托", "succeeded"],
  [["我推新谷出了", "真的好贵", "终于到了"], "周边", "succeeded"],
  [["周末准备去兽展", "准备出毛", "热死了", "返图终于到了"], "兽展", "succeeded"],
  [["老师开稿了", "我试着约了一下", "还是没约到"], "委托", "failed"],
  [["我推新谷出了", "算了还是买", "到了"], "周边", "succeeded"],
  [["周末兽展", "人真的好多", "返图到了"], "兽展", "succeeded"],
  [["我在等老师返图", "等了好久", "终于发了"], "返图", "succeeded"],
  [["老师终于开稿了", "我蹲一下", "结果还是没抢到"], "委托", "failed"],
  [["我推新谷出了", "太贵了", "结果还是买了", "终于到了"], "周边", "succeeded"],
  [["周末准备出毛", "感觉会热死", "但返图不错"], "毛装活动", null],
]);

const PROBLEM_THREADS: readonly string[][] = Object.freeze([
  ["网站登录炸了", "试了方案A", "还是不行", "换了方案B", "好了"],
  ["接口一直报错", "我重启了", "仍然报错", "改了配置", "解决了"],
  ["数据库连接失败", "试了清缓存", "还是连不上", "重装了", "搞定了"],
  ["服务器挂了", "尝试重启", "结果还是没好", "换了配置", "恢复了"],
  ["Codex一直重新连接", "我重装了", "还是不行", "更新了版本", "能用了"],
  ["App登录失败", "试了方案A", "仍然打不开", "清缓存了", "好了"],
  ["iPhone连接有问题", "我重启了", "还是连不上", "更新了系统", "解决了"],
  ["Git又报错了", "换了方案", "还是报错", "重新配置了", "搞定了"],
  ["JWT验签失败", "改了配置", "结果还是不行", "更新了密钥", "成功了"],
  ["代码又崩了", "试了fix1", "仍然失败", "换成fix2", "修好了"],
]);

const DECAY_BASES = Object.freeze([
  "网站登录炸了", "接口一直报错", "服务器挂了", "数据库连接失败", "Codex连不上",
]);

const newTopicCases = NEW_TOPICS.map(([input, label], index) =>
  defineCase(`new-topic-${index + 1}`, [input], {
    activeLabel: label,
    transition: "new_topic",
    topicCount: 1,
  }));
const noTopicCases = NON_TOPICS.map((input, index) =>
  defineCase(`no-topic-${index + 1}`, [input], { topicCount: 0 }));
const directCases = DIRECT_CONTINUATIONS.map((turns, index) =>
  defineCase(`direct-continuation-${index + 1}`, turns, {
    transition: "continued",
    finalEvent: "failed",
  }));
const pronounCases = PRONOUNS.map((turns, index) =>
  defineCase(`pronoun-${index + 1}`, turns, { referenceResolved: true }));
const switchCases = SWITCHES.map(([turns, label], index) =>
  defineCase(`switch-${index + 1}`, turns, {
    activeLabel: label,
    transition: "switched",
    topicCount: 2,
  }));
const returnCases = RETURNS.map(([turns, label], index) =>
  defineCase(`return-${index + 1}`, turns, {
    activeLabel: label,
    transition: "resumed",
    topicCount: 2,
  }));
const ambiguityCases = AMBIGUITIES.map((turns, index) =>
  defineCase(`ambiguity-${index + 1}`, turns, {
    transition: "ambiguous",
    needsClarification: true,
    topicCount: 2,
  }));
const communityCases = COMMUNITY.map(([turns, label, event], index) =>
  defineCase(`community-${index + 1}`, turns, {
    activeLabel: label,
    ...(event === null ? {} : { finalEvent: event }),
  }));
const problemCases = PROBLEM_THREADS.map((turns, index) =>
  defineCase(`problem-thread-${index + 1}`, turns, {
    transition: "resolved",
    finalStatus: "resolved",
    finalEvent: "resolved",
  }));
const decayCases = DECAY_BASES.map((first, index) =>
  defineCase(
    `decay-${index + 1}`,
    [first, ...Array.from({ length: 18 }, (_, fillerIndex) => `普通闲聊 ${index}-${fillerIndex}`)],
    { transition: "none", activeCleared: true },
  ));

export const TOPIC_CONTINUITY_EVALUATION_SET: readonly TopicContinuityEvaluationCase[] =
  Object.freeze([
    ...newTopicCases,
    ...noTopicCases,
    ...directCases,
    ...pronounCases,
    ...switchCases,
    ...returnCases,
    ...ambiguityCases,
    ...communityCases,
    ...problemCases,
    ...decayCases,
  ]);
