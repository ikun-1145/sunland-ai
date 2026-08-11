import type {
  InitiativeAction,
  InitiativeTurnSignals,
} from "@/types";

export interface InitiativeLocalExpected {
  readonly action?: InitiativeAction;
  readonly signal?: keyof Pick<
    InitiativeTurnSignals,
    | "boredom"
    | "returned"
    | "explicitClose"
    | "lowEngagement"
    | "highEngagement"
    | "storyContinuation"
  >;
  readonly plannedEventSummary?: string;
}

export interface InitiativeLocalEvaluationCase {
  readonly id: string;
  readonly input: string;
  readonly expected: InitiativeLocalExpected;
}

export interface InitiativeMultiExpected {
  readonly maximumQuestionResponses?: number;
  readonly finalEngagementAtMost?: number;
  readonly finalResponseIncludes?: RegExp;
  readonly finalResponseExcludes?: RegExp;
  readonly noOpenLoopSummary?: string;
  readonly finalAction?: InitiativeAction;
}

export interface InitiativeMultiEvaluationCase {
  readonly id: string;
  readonly turns: readonly string[];
  readonly expected: InitiativeMultiExpected;
}

function localCases(
  prefix: string,
  inputs: readonly string[],
  expected: InitiativeLocalExpected,
): readonly InitiativeLocalEvaluationCase[] {
  return inputs.map((input, index) => Object.freeze({
    id: `${prefix}-${index + 1}`,
    input,
    expected: Object.freeze(expected),
  }));
}

const BOREDOM = Object.freeze([
  "好无聊", "好无聊啊", "好无聊。", "无聊", "无聊死了",
  "无聊死了啊", "不知道干嘛", "不知道干嘛。", "没事干", "没事干啊",
  "闲得慌", "闲得慌。", "真的好无聊", "现在好无聊", "今天好无聊",
]);
const CLOSURES = Object.freeze([
  "算了不说了", "算了，不说了", "算了不聊了", "算了，不聊了", "不说了",
  "不说了。", "不聊了", "不聊了。", "先这样", "先这样吧",
  "就这样", "就这样吧", "回头再说", "回头再说吧", "先睡了",
  "我去睡觉", "我去上课", "我去忙了", "晚安", "晚安啦",
]);
const RETURNS = Object.freeze([
  "我回来了", "回来了", "我回来啦", "回来啦", "我回来咯",
  "回来咯", "我回来了。", "回来了！", "我回来啦～", "回来啦。",
]);
const LOW_ENGAGEMENT = Object.freeze([
  "嗯", "嗯嗯", "嗯。", "哦", "哦哦", "哦。", "行", "行吧", "行。", "随便",
  "随便吧", "不知道", "不知道。", "没啥", "没啥。", "没事", "算了", "好", "好的", "收到",
]);
const LAUGHTER = Object.freeze([
  "哈哈", "哈哈哈", "哈哈哈哈", "哈哈哈哈哈", "笑死", "笑死我了", "233", "2333", "草", "草哈哈哈",
]);
const STORIES = Object.freeze([
  "你猜后来怎么了", "然后更离谱的来了", "更离谱的来了", "还有高手", "接下来才离谱",
  "后面才精彩", "你猜后来呢", "然后更离谱的来了。", "等下，还有高手", "接下来才是真的离谱",
]);
const PLANNED_EVENTS: readonly [string, string][] = Object.freeze([
  ["我要去考试了", "考试"], ["等下去考试", "考试"], ["下午要考试", "考试"],
  ["我要去面试了", "面试"], ["等下去面试", "面试"], ["下午准备面试", "面试"],
  ["我去吃饭了", "吃饭"], ["等下去吃饭", "吃饭"], ["准备去吃东西", "吃饭"],
  ["周末准备去兽展", "兽展"], ["下午去兽聚", "兽展"],
  ["等下更新系统", "系统更新"], ["准备升级系统", "系统更新"],
  ["老师还没返图", "返图"], ["我还在等稿子", "返图"],
]);

export const INITIATIVE_LOCAL_EVALUATION_SET: readonly InitiativeLocalEvaluationCase[] =
  Object.freeze([
    ...localCases("boredom", BOREDOM, { signal: "boredom", action: "expand" }),
    ...localCases("closure", CLOSURES, { signal: "explicitClose", action: "close_topic" }),
    ...localCases("return", RETURNS, { signal: "returned", action: "react" }),
    ...localCases("low-engagement", LOW_ENGAGEMENT, { signal: "lowEngagement", action: "none" }),
    ...localCases("laughter", LAUGHTER, { signal: "highEngagement" }),
    ...localCases("story", STORIES, { signal: "storyContinuation", action: "expand" }),
    ...PLANNED_EVENTS.map(([input, plannedEventSummary], index) => Object.freeze({
      id: `planned-event-${index + 1}`,
      input,
      expected: Object.freeze({ plannedEventSummary }),
    })),
  ]);

function multi(
  id: string,
  turns: readonly string[],
  expected: InitiativeMultiExpected,
): InitiativeMultiEvaluationCase {
  return Object.freeze({ id, turns: Object.freeze(turns), expected: Object.freeze(expected) });
}

const LOW_MULTI = Object.freeze([
  ["今天上课", "嗯", "哦", "行"],
  ["今天有点忙", "嗯", "好", "收到"],
  ["刚吃完", "哦", "嗯", "行吧"],
  ["今天开会", "嗯嗯", "没啥", "好"],
  ["刚下课", "哦哦", "不知道", "算了"],
]);
const FATIGUE_MULTI = Object.freeze([
  ["我刚吃完饭", "火锅", "味道不错", "下次还想去", "嗯"],
  ["今天去散步了", "走了很久", "天气不错", "后来回家了", "行"],
  ["考试没考好", "数学", "题有点难", "我复习了很久", "算了"],
  ["今天发生件怪事", "路上有人摔了", "后来没事", "大家都走了", "嗯"],
  ["我在做新设定", "改了配色", "加了角", "现在顺眼多了", "好"],
]);
const OPEN_LOOP_MULTI: readonly [readonly string[], RegExp][] = Object.freeze([
  [["我要去考试了", "我回来了"], /考试|考得/u],
  [["我要去面试了", "我回来了"], /面试/u],
  [["我去吃饭了", "我回来了"], /吃|饭/u],
  [["下午去兽展", "我回来了"], /兽展/u],
  [["等下更新系统", "我回来了"], /系统|更新/u],
]);
const RESOLVED_LOOP_MULTI: readonly [readonly string[], string, RegExp][] = Object.freeze([
  [["我要去考试了", "考完了", "我回来了"], "考试", /考试|考得/u],
  [["我要去面试了", "面试完了", "我回来了"], "面试", /面试/u],
  [["我去吃饭了", "吃完饭了", "我回来了"], "吃饭", /吃|饭/u],
  [["下午去兽展", "从兽展回来了", "我回来了"], "兽展", /兽展/u],
  [["等下更新系统", "系统更新好了", "我回来了"], "系统更新", /系统|更新/u],
]);
const CLOSURE_MULTI = Object.freeze([
  ["今天聊了好多", "行，那先这样吧"],
  ["bug解决了", "就这样吧"],
  ["返图看完了", "回头再说"],
  ["今天有点累", "我去睡觉"],
  ["差不多懂了", "不聊了"],
]);
const STALE_MULTI: readonly [string, string, RegExp][] = Object.freeze([
  ["我要去考试了", "考试", /考试|考得/u],
  ["我要去面试了", "面试", /面试/u],
  ["我去吃饭了", "吃饭", /吃|饭/u],
  ["下午去兽展", "兽展", /兽展/u],
  ["等下更新系统", "系统更新", /系统|更新/u],
]);

export const INITIATIVE_MULTI_TURN_EVALUATION_SET: readonly InitiativeMultiEvaluationCase[] =
  Object.freeze([
    ...LOW_MULTI.map((turns, index) => multi(`low-${index + 1}`, turns, {
      maximumQuestionResponses: 1,
      finalEngagementAtMost: 0.32,
    })),
    ...FATIGUE_MULTI.map((turns, index) => multi(`fatigue-${index + 1}`, turns, {
      maximumQuestionResponses: 2,
    })),
    ...OPEN_LOOP_MULTI.map(([turns, expression], index) => multi(`open-loop-${index + 1}`, turns, {
      finalResponseIncludes: expression,
      maximumQuestionResponses: 1,
    })),
    ...RESOLVED_LOOP_MULTI.map(([turns, summary, expression], index) => multi(
      `resolved-loop-${index + 1}`,
      turns,
      {
        finalResponseExcludes: expression,
        noOpenLoopSummary: summary,
      },
    )),
    ...CLOSURE_MULTI.map((turns, index) => multi(`closure-${index + 1}`, turns, {
      maximumQuestionResponses: 1,
      finalAction: "close_topic",
      finalResponseExcludes: /[？?]/u,
    })),
    ...STALE_MULTI.map(([first, summary, expression], index) => multi(
      `stale-${index + 1}`,
      [first, ...Array.from({ length: 16 }, (__, filler) => `普通聊天 ${index}-${filler}`), "我回来了"],
      {
        finalResponseExcludes: expression,
        noOpenLoopSummary: summary,
      },
    )),
  ]);
