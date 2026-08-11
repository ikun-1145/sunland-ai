import type {
  ConversationState,
  ConversationTopic,
  ConversationUnderstanding,
  ConversationMode,
  DialogueIntent,
  UserMood,
} from "@/types";
import type { CommunityResolution, PragmaticUnderstanding } from "@/types";
import { resolveCommunityLanguage, resolvePragmatics } from "@/community";
import { trackConversationTopics } from "./topicTracker";
import { detectInitiativeSignals } from "./initiativeSignals";

export interface ConversationAnalyzer {
  analyze(input: string, context?: ConversationState): ConversationUnderstanding;
}

const GREETING = /^(?:你好|您好|嗨|哈喽|hello|hi|早|早安|早上好|下午好|晚上好)[呀啊哦～~！!。,.，\s]*$/iu;
const THANKS = /^(?:谢(?:谢|啦|了)?|多谢|thanks?|thx)[呀啊哦～~！!。,.，\s]*$/iu;
const FAREWELL = /^(?:再见|拜拜|晚安|回头见|下次见|bye|good\s*night)[呀啊哦～~！!。,.，\s]*$/iu;
const REACTION = /^(?:(?:哈){2,}|(?:嘿){2,}|233+|笑死(?:我了)?|好家伙|绝了|寄|草|lol|lmao)[哈嘿\d啊呀！!。,.，\s～~]*$/iu;
const SHORT_ACKNOWLEDGEMENT = /^(?:嗯+|哦+|行|好|好的|可以|成|懂了|知道了|收到)[呀啊哦～~！!。,.，\s]*$/u;
const SINGLE_QUESTION = /^[?？]+$/u;
const BANTER = /^(?:你是不是傻|你真傻|笨死了|你真笨|你真垃圾|垃圾\s*ai|你是不是蠢)[呀啊哦～~！!。,.，\s]*$/iu;
const PRAISE = /^(?:你真厉害|太强了|牛啊|真聪明|干得漂亮|厉害了)[呀啊哦～~！!。,.，\s]*$/u;
const QUESTION_CUE = /[?？]|(?:为什么|为何|怎么|如何)|(?:是什么意思|是什么|什么|啥|是不是|能不能|可不可以|多少|哪里|哪个|谁|吗|呢)[？?。！!\s]*$/u;
const REQUEST_CUE = /(?:帮我|麻烦|替我|能否|可以帮|你帮我|看看|分析|解释|修复|排查|写一|做一|整理|^请(?:帮|给|分析|解释|写|做|整理|检查|看看)|^给我(?:写|做|整理|分析|生成|解释))/u;
const OPINION_CUE = /(?:你觉得|你怎么看|你认为|你的看法|有什么建议|你会选)/u;
const OPINION_STATEMENT = /(?:好丑|难看|灾难|离谱|怪怪的|太土了)/u;
const STORY_CUE = /(?:跟你说|我跟你讲|事情是这样|后来|然后呢|刚才发生|今天发生|昨天发生)/u;
const FIRST_PERSON = /(?:^|[，,。！!？?\s])我(?:们)?/u;
const MEAL = /(?:吃(?:完|了)?(?:饭|早餐|早饭|午饭|晚饭|夜宵)?|饭吃完|火锅|烧烤|外卖|面条|米饭|披萨|汉堡)/u;
const EXAM = /(?:考试|考砸|没考好|挂科|成绩|分数|面试没过)/u;
const SLEEP = /(?:睡觉|睡不着|失眠|困了|晚安|熬夜|刚起床|刚醒|睡醒)/u;
const WORK = /(?:工作|上班|加班|下班|开会|项目|作业)/u;
const TECHNICAL = /(?:bug|报错|异常|代码|程序|接口|api|jwt|rsa|token|git|js|undefined|密码学|加密|公钥|私钥|签名|验签|数据库|编译|运行|部署|请求|堆栈|日志|typescript|javascript|python|java|react|node)/iu;
const CREATIVE = /(?:写作|故事|角色|设定|画|设计|创作|脑洞|文案)/u;
const LEARNING = /(?:学习|复习|课程|知识|题目|考试|论文)/u;

const SAD = /(?:难过|伤心|失落|没考好|考砸|挂科|没过|想哭|沮丧|泄气)/u;
const FRUSTRATED = /(?:烦死|烦躁|崩溃|搞了|折腾了|还是不行|卡住|受不了|心累|破防|无语)/u;
const TIRED = /(?:累死|热死|闷死|好累|有点累|太累|疲惫|困了|没精神)/u;
const ANGRY = /(?:生气|气死|火大|恼火|愤怒)/u;
const ANXIOUS = /(?:焦虑|紧张|担心|慌|压力好大)/u;
const CONFUSED = /(?:看不懂|不明白|搞不懂|迷惑|懵了|不知道怎么办)/u;
const HAPPY = /(?:开心|高兴|太好了|成功了|搞定了|顺利|修好|修完|解决了)/u;
const EXCITED = /(?:激动|兴奋|好期待|太棒了|爽|起飞)/u;

function moodOf(
  input: string,
  community: CommunityResolution,
  pragmatics: PragmaticUnderstanding,
): UserMood {
  if (pragmatics.requiresSafetyHandling) return "sad";
  if (pragmatics.socialTone === "self_deprecating") return "frustrated";
  if (pragmatics.socialTone === "hostile") return "angry";
  if (pragmatics.socialTone === "teasing" || pragmatics.socialTone === "sarcastic") return "playful";
  if (pragmatics.socialTone === "excited") return "excited";
  if (PRAISE.test(input)) return "happy";
  if (BANTER.test(input)) return "playful";
  if (SINGLE_QUESTION.test(input)) return "confused";
  if (ANGRY.test(input)) return "angry";
  if (FRUSTRATED.test(input)) return "frustrated";
  if (SAD.test(input)) return "sad";
  if (TIRED.test(input)) return "tired";
  if (ANXIOUS.test(input)) return "anxious";
  if (CONFUSED.test(input)) return "confused";
  if (EXCITED.test(input)) return "excited";
  if (HAPPY.test(input)) return "happy";
  if (REACTION.test(input)) return "playful";
  const communityTags = new Set(
    community.matches.map(({ semanticTag }) => semanticTag),
  );
  if (
    communityTags.has("FAILED_STATE") ||
    communityTags.has("EMOTIONAL_OVERLOAD") ||
    communityTags.has("OVERWHELMED_REACTION")
  ) return "frustrated";
  if (
    communityTags.has("INTERNET_LAUGHTER") ||
    communityTags.has("CANNOT_HOLD_REACTION") ||
    communityTags.has("SHIPPING_EXCITEMENT")
  ) return "playful";
  if (communityTags.has("BIG_WIN") || communityTags.has("NAILED_IT")) return "happy";
  return "neutral";
}

function topicOf(
  input: string,
  community: CommunityResolution,
  context?: ConversationState,
): ConversationTopic {
  if (MEAL.test(input)) return "meal";
  if (EXAM.test(input)) return "exam";
  if (SLEEP.test(input)) return "sleep";
  if (TECHNICAL.test(input)) return "technical_problem";
  if (WORK.test(input)) return "work";
  if (GREETING.test(input) || THANKS.test(input) || FAREWELL.test(input)) return "social";
  if (community.matches.length > 0) return "daily_life";
  if (FIRST_PERSON.test(input) || STORY_CUE.test(input)) return "daily_life";
  return context?.recentTopic ?? "unknown";
}

function modeOf(
  input: string,
  mood: UserMood,
  topic: ConversationTopic,
  context?: ConversationState,
): ConversationMode {
  if (TECHNICAL.test(input)) return "technical";
  if (
    topic === "technical_problem" &&
    context?.conversationMode === "technical" &&
    (QUESTION_CUE.test(input) || /^(?:那|这个|它)|(?:位|日志|结果|配置|够不够|够吗)/u.test(input))
  ) return "technical";
  if (mood !== "neutral" && mood !== "playful" && mood !== "happy" && mood !== "excited") {
    return "emotional";
  }
  if (CREATIVE.test(input)) return "creative";
  if (LEARNING.test(input)) return "learning";
  if (REQUEST_CUE.test(input)) return "task";
  return "casual";
}

function intentOf(
  input: string,
  mood: UserMood,
  community: CommunityResolution,
  pragmatics: PragmaticUnderstanding,
  context?: ConversationState,
): DialogueIntent {
  if (GREETING.test(input)) return "greeting";
  if (THANKS.test(input)) return "thanks";
  if (FAREWELL.test(input)) return "farewell";
  if (pragmatics.communicativeGoal === "ask_for_help") return "command";
  if (
    pragmatics.communicativeGoal === "vent" ||
    pragmatics.communicativeGoal === "complain"
  ) return "emotional_share";
  if (
    pragmatics.communicativeGoal === "joke" ||
    pragmatics.communicativeGoal === "tease" ||
    pragmatics.communicativeGoal === "sarcasm"
  ) return "reaction";
  if (
    pragmatics.communicativeGoal === "celebrate" ||
    pragmatics.communicativeGoal === "share"
  ) return "casual_chat";
  if (
    REACTION.test(input) ||
    SHORT_ACKNOWLEDGEMENT.test(input) ||
    SINGLE_QUESTION.test(input) ||
    BANTER.test(input) ||
    PRAISE.test(input)
  ) return "reaction";
  if (OPINION_CUE.test(input) || OPINION_STATEMENT.test(input)) {
    return "opinion_request";
  }
  if (REQUEST_CUE.test(input)) return "command";
  if (mood !== "neutral" && mood !== "playful") return "emotional_share";
  if (STORY_CUE.test(input)) return "storytelling";
  if (QUESTION_CUE.test(input)) return "question";
  if (
    community.matches.some(({ semanticTag }) =>
      semanticTag === "INTERNET_LAUGHTER" ||
      semanticTag === "CANNOT_HOLD_REACTION",
    )
  ) return "reaction";
  if (community.matches.length > 0) return "casual_chat";
  if (MEAL.test(input) || FIRST_PERSON.test(input)) return "casual_chat";
  if (SLEEP.test(input)) return "casual_chat";
  if (
    community.matches.length > 0 ||
    (context !== undefined &&
      /^(?:感觉|但是|不过|希望|好想|算了|真的|有点|现在|正在|还在|已经|刚刚)/u.test(input))
  ) return "casual_chat";
  return "unknown";
}

function confidenceOf(intent: DialogueIntent, input: string): number {
  if (input.length === 0) return 0;
  if (["greeting", "thanks", "farewell", "reaction"].includes(intent)) return 0.98;
  if (intent === "unknown") return 0.25;
  if (intent === "casual_chat" && !MEAL.test(input) && !FIRST_PERSON.test(input)) return 0.66;
  if (intent === "emotional_share" || intent === "command" || intent === "opinion_request") return 0.9;
  return 0.82;
}

export const defaultConversationAnalyzer: ConversationAnalyzer = Object.freeze({
  analyze(input: string, context?: ConversationState): ConversationUnderstanding {
    const normalized = input.trim().replace(/\s+/gu, " ");
    const community = resolveCommunityLanguage(
      normalized,
      context?.communityContext,
    );
    const pragmatics = resolvePragmatics(normalized, community, context);
    const topic = topicOf(normalized, community, context);
    const userMood = moodOf(normalized, community, pragmatics);
    const initialIntent = intentOf(normalized, userMood, community, pragmatics, context);
    const conversationMode = modeOf(normalized, userMood, topic, context);
    const topicContinuity = trackConversationTopics(
      normalized,
      context?.workingMemory,
      community,
      initialIntent,
      topic,
      conversationMode,
    );
    let intent = initialIntent === "unknown" &&
      topicContinuity.activeTopic !== undefined &&
      topicContinuity.transition !== "none" &&
      topicContinuity.transition !== "ambiguous"
      ? userMood !== "neutral" && userMood !== "playful"
        ? "emotional_share"
        : "casual_chat"
      : initialIntent;
    let initiativeSignals = detectInitiativeSignals(
      normalized,
      intent,
      userMood,
      topicContinuity,
    );
    if (
      intent === "unknown" &&
      (initiativeSignals.boredom ||
        initiativeSignals.returned ||
        initiativeSignals.explicitClose ||
        initiativeSignals.storyContinuation ||
        initiativeSignals.plannedEvent !== undefined ||
        initiativeSignals.resolvedEventSummary !== undefined)
    ) {
      intent = "casual_chat";
      initiativeSignals = detectInitiativeSignals(
        normalized,
        intent,
        userMood,
        topicContinuity,
      );
    }
    const expectsAnswer = intent === "question" || intent === "command" || intent === "opinion_request";
    const expectsEmotionalResponse =
      intent === "emotional_share" ||
      (expectsAnswer && userMood !== "neutral" && userMood !== "unknown");
    const expectsContinuation =
      intent === "casual_chat" ||
      intent === "emotional_share" ||
      intent === "storytelling" ||
      intent === "opinion_request" ||
      intent === "command";

    return Object.freeze({
      intent,
      userMood,
      conversationMode,
      topic,
      expectsAnswer,
      expectsEmotionalResponse,
      expectsContinuation,
      confidence: confidenceOf(intent, normalized),
      community,
      pragmatics,
      topicContinuity,
      initiativeSignals,
    });
  },
});
