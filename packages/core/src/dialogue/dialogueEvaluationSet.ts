import type { DialogueIntent } from "@/types";

export interface DialogueEvalMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface DialogueEvalCase {
  readonly id: string;
  readonly input: string;
  readonly previousTurns?: readonly DialogueEvalMessage[];
  readonly expectedIntent?: DialogueIntent;
  readonly forbiddenPatterns?: readonly string[];
  readonly preferredCharacteristics?: readonly string[];
}

const NO_ASSISTANT_FRAMING = Object.freeze([
  "当然可以",
  "我来帮你",
  "下面是",
  "总结一下",
  "还有其他问题",
]);
const NO_MECHANICAL_EMPATHY = Object.freeze([
  "我理解你的感受",
  "听起来你",
  "以下是",
  "建议你",
]);
const NO_FURRY_TECH = Object.freeze([
  "主人",
  "喵",
  "小爪",
  "尾巴",
  "耳朵",
  "🐾",
]);

function defineCase(
  id: string,
  input: string,
  expectedIntent: DialogueIntent,
  preferredCharacteristics: readonly string[],
  forbiddenPatterns: readonly string[] = NO_ASSISTANT_FRAMING,
  previousTurns?: readonly DialogueEvalMessage[],
): DialogueEvalCase {
  return Object.freeze({
    id,
    input,
    expectedIntent,
    preferredCharacteristics: Object.freeze([...preferredCharacteristics]),
    forbiddenPatterns: Object.freeze([...forbiddenPatterns]),
    ...(previousTurns === undefined
      ? {}
      : { previousTurns: Object.freeze([...previousTurns]) }),
  });
}

export const DIALOGUE_EVALUATION_SET: readonly DialogueEvalCase[] =
  Object.freeze([
    defineCase("casual-wake", "我刚起床", "casual_chat", ["short", "natural"]),
    defineCase("casual-meal", "我刚吃完饭", "casual_chat", ["short", "optional_follow_up"]),
    defineCase("casual-hotpot", "火锅", "casual_chat", ["reaction_only"]),
    defineCase("casual-out", "我准备出门", "casual_chat", ["short"]),
    defineCase("casual-off-work", "我今天下班很早", "casual_chat", ["natural"]),
    defineCase("casual-daydream", "我在发呆", "casual_chat", ["short"]),
    defineCase("casual-color", "我喜欢这个颜色", "casual_chat", ["natural"]),
    defineCase("casual-home", "我刚到家", "casual_chat", ["short"]),
    defineCase("casual-walk", "我准备散步", "casual_chat", ["natural_ending"]),
    defineCase("casual-bed", "我还在床上", "casual_chat", ["short"]),

    defineCase("emotion-annoyed", "烦死了", "emotional_share", ["short", "emotion_acknowledgement"], NO_MECHANICAL_EMPATHY),
    defineCase("emotion-tired", "今天累死了", "emotional_share", ["short", "no_unsolicited_advice"], NO_MECHANICAL_EMPATHY),
    defineCase("emotion-exam", "考试没考好，有点难受", "emotional_share", ["gentle", "at_most_one_question"], NO_MECHANICAL_EMPATHY),
    defineCase("emotion-anxious", "我有点焦虑", "emotional_share", ["calm"], NO_MECHANICAL_EMPATHY),
    defineCase("emotion-angry", "我快气死了", "emotional_share", ["emotion_acknowledgement"], NO_MECHANICAL_EMPATHY),
    defineCase("emotion-bug", "这个 bug 给我整破防了", "emotional_share", ["technical", "emotion_acknowledgement"], NO_FURRY_TECH),
    defineCase("emotion-bug-fixed", "我终于把 bug 修好了", "emotional_share", ["celebratory", "short"], NO_FURRY_TECH),
    defineCase("emotion-happy", "我好开心", "emotional_share", ["celebratory"]),
    defineCase("emotion-sad", "我有点难过", "emotional_share", ["gentle"], NO_MECHANICAL_EMPATHY),
    defineCase("emotion-speechless", "无语", "emotional_share", ["short", "natural"]),

    defineCase("technical-jwt", "JWT 是什么", "question", ["accurate", "technical"], NO_FURRY_TECH),
    defineCase("technical-jwt-none", "JWT 空算法为什么危险", "question", ["accurate", "technical"], NO_FURRY_TECH),
    defineCase("technical-error", "代码为什么报错", "question", ["technical"], NO_FURRY_TECH),
    defineCase("technical-look", "你帮我看看这个 bug", "command", ["technical", "task"], NO_FURRY_TECH),
    defineCase("technical-analyze", "请分析这段代码", "command", ["technical", "task"], NO_FURRY_TECH),
    defineCase("technical-api", "API 请求为什么失败", "question", ["technical"], NO_FURRY_TECH),
    defineCase("technical-db", "数据库连接不上怎么办", "question", ["technical"], NO_FURRY_TECH),
    defineCase("technical-react", "React 状态为什么没更新", "question", ["technical"], NO_FURRY_TECH),
    defineCase("technical-deploy", "这个接口怎么部署", "question", ["technical"], NO_FURRY_TECH),
    defineCase("technical-compile", "帮我排查编译错误", "command", ["technical", "task"], NO_FURRY_TECH),

    defineCase("learning-choice", "这道题为什么选 A", "question", ["learning", "accurate"]),
    defineCase("learning-review", "你觉得怎么复习比较好", "opinion_request", ["learning", "opinion"]),
    defineCase("learning-paper", "论文是什么意思", "question", ["learning", "accurate"]),
    defineCase("learning-ellipsis", "我想知道猫会什么", "question", ["learning", "accurate"]),
    defineCase("learning-category", "猫属于什么", "question", ["learning", "accurate"]),

    defineCase("reaction-laugh", "哈哈哈哈哈哈", "reaction", ["one_sentence", "playful"]),
    defineCase("reaction-lol", "笑死我了", "reaction", ["one_sentence", "playful"]),
    defineCase("reaction-233", "233333", "reaction", ["one_sentence"]),
    defineCase("reaction-ok", "行", "reaction", ["short"]),
    defineCase("reaction-hm", "嗯", "reaction", ["short"]),
    defineCase("reaction-question", "？", "reaction", ["short"]),
    defineCase("reaction-insult", "你是不是傻", "reaction", ["self_deprecating", "non_confrontational"]),
    defineCase("reaction-wow", "好家伙", "reaction", ["short", "playful"]),
    defineCase("reaction-praise", "你真厉害", "reaction", ["short", "natural"]),

    defineCase("opinion-ui", "这个 UI 好丑", "opinion_request", ["opinion", "natural"]),
    defineCase("opinion-plan", "你觉得这个方案怎么样", "opinion_request", ["opinion"]),
    defineCase("opinion-button", "这个按钮太土了", "opinion_request", ["opinion", "short"]),
    defineCase("opinion-absurd", "这也太离谱了", "opinion_request", ["opinion", "reaction"]),

    defineCase("social-goodnight", "晚安", "farewell", ["natural_ending", "short"]),
    defineCase("social-morning", "早安", "greeting", ["short", "warm"]),
    defineCase("social-thanks", "谢谢", "thanks", ["short"]),
    defineCase("social-bye", "再见", "farewell", ["natural_ending"]),

    defineCase("noise-a", "啊", "unknown", ["short"]),
    defineCase("noise-dots", "……", "unknown", ["short"]),
    defineCase("noise-letter", "x", "unknown", ["short"]),
    defineCase("noise-number", "1", "unknown", ["short"]),
    defineCase("noise-symbol", "#", "unknown", ["short"]),

    defineCase(
      "context-topic-change",
      "对了，JWT 是什么",
      "question",
      ["topic_change", "technical"],
      NO_FURRY_TECH,
      [
        { role: "user", content: "刚吃完饭" },
        { role: "assistant", content: "吃的什么？" },
        { role: "user", content: "火锅" },
        { role: "assistant", content: "火锅很会选。" },
      ],
    ),
    defineCase(
      "context-repeat",
      "哈哈哈哈哈哈",
      "reaction",
      ["variation", "short"],
      NO_ASSISTANT_FRAMING,
      [
        { role: "user", content: "哈哈哈哈哈哈" },
        { role: "assistant", content: "你笑成这样，我开始好奇了。" },
      ],
    ),
    defineCase("reaction-insult-strong", "你真垃圾", "reaction", ["non_confrontational"]),
    defineCase("reaction-okay", "好的", "reaction", ["short"]),
    defineCase("story-start", "我跟你说件事", "storytelling", ["continuation"]),
    defineCase("task-summary", "给我写个摘要", "command", ["task", "structured_if_needed"]),
  ]);
