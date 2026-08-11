/**
 * Frost (霜蓝) — the default persona for a furry-community-facing AI.
 *
 * Frost is temperate, friendly, reliable — a companion in the fandom rather
 * than a customer-service bot. Technical/factual content stays plain and
 * accurate; only the FRAMING around it (opener/closer, at most one emoji)
 * carries Frost's voice.
 *
 * CRITICAL INVARIANT: every factual render function below embeds the incoming
 * factual fields (`result.explanation`, `record.subject/relation/object`)
 * VERBATIM. Parse failures are different: `failure.reason` remains internal
 * diagnostic data and is intentionally converted into a natural fallback
 * before anything reaches the user.
 */
import type {
  ClarificationPlan,
  DialogueTurnContext,
  IdentityAspect,
  KnowledgeRecord,
  MemoryKey,
  ParseFailure,
  PersonalityProfile,
  ReasoningResult,
  ResponseContext,
  ResponsePlan,
} from "@/types";
import { MemoryKeys } from "@/types";
import { compose } from "./textCompose";
import {
  pickBySeed,
  pickNonRepeatingText,
} from "./variation";
import {
  chooseFurryExpression,
  type FurryExpressionScene,
} from "./frostPersona";
import { renderFrostCommunityDialogue } from "./communityDialogue";
import { renderFrostSocialDialogue } from "./socialDialogue";
import { renderFrostTopicDialogue } from "./topicDialogue";
import { renderFrostInitiativeDialogue } from "./initiativeDialogue";
import {
  CAPABILITY_CLOSERS,
  CAPABILITY_OPENERS,
  CREATOR_CLOSERS,
  CREATOR_OPENERS,
  FAREWELL_LINES,
  GREETING_LINES,
  IDENTITY_CLOSERS,
  IDENTITY_OPENERS,
  LEARNED_CLOSERS,
  LEARNED_OPENERS,
  MEMORY_RECALL_NOT_FOUND_LINES,
  MEMORY_REMEMBERED_CLOSERS,
  MEMORY_REMEMBERED_OPENERS,
  NAME_RECALL_FOUND_CLOSERS,
  NAME_RECALL_FOUND_OPENERS,
  NAME_RECALL_NOT_FOUND_LINES,
  NAME_REMEMBERED_CLOSERS,
  NAME_REMEMBERED_OPENERS,
  REASONING_ANSWER_OPENERS,
  REASONING_NO_ANSWER_CLOSERS,
  REASONING_NO_ANSWER_OPENERS,
  REASONING_UNCERTAIN_HEDGES,
  THANKS_LINES,
  UNKNOWN_INPUT_CLOSERS,
  UNKNOWN_INPUT_OPENERS,
} from "./frostPhrases";

const FROST_ACCENT_OPTIONS: readonly string[] = [
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "✨",
];

/** Add one low-frequency accent deterministically for eligible social turns. */
function withOptionalAccent(
  text: string,
  context: string,
  seed: string,
): string {
  const accent = pickBySeed(
    FROST_ACCENT_OPTIONS,
    `${context}:${seed}:accent`,
  );
  return accent.length > 0 ? `${text} ${accent}` : text;
}

function emotionAcknowledgement(turn: DialogueTurnContext): string {
  if (!turn.plan.acknowledgeEmotion) return "";
  switch (turn.understanding.userMood) {
    case "frustrated":
      return "这事是真会磨人。";
    case "sad":
      return "这一下挺扎心的。";
    case "tired":
      return "今天这是被榨干了啊。";
    case "angry":
      return "这事确实很容易让人上火。";
    case "anxious":
      return "先别急，我们一点点理。";
    case "confused":
      return "卡在这里确实容易越看越乱。";
    default:
      return "";
  }
}

function varied(
  turn: DialogueTurnContext,
  scene: string,
  candidates: readonly string[],
): string {
  return pickNonRepeatingText(
    candidates,
    `${turn.raw}:${scene}:${turn.state.relationship.familiarity}`,
    turn.state.recentAssistantOpeningKeys,
  );
}

function withFurryExpression(
  turn: DialogueTurnContext,
  scene: FurryExpressionScene,
  response: string,
): string {
  const expression = chooseFurryExpression(turn, scene);
  return expression === null ? response : `${response} ${expression}`;
}

function renderReasoningResult(
  result: ReasoningResult,
  plan: ResponsePlan,
  dialogue?: DialogueTurnContext,
): string {
  const seed = `${result.query.subject}:${result.query.relation}:${result.query.kind}`;
  const hasAnswer = plan.mode !== "no-answer";
  const acknowledgement = dialogue ? emotionAcknowledgement(dialogue) : "";

  // The DECISION to hedge is the Response Planner's (`plan.isUncertain`,
  // based on confidence); only the WORDING of the hedge is Frost's to pick.
  const hedge = plan.isUncertain ? pickBySeed(REASONING_UNCERTAIN_HEDGES, `${seed}:hedge`) : undefined;

  // `plan.explanation` is embedded verbatim — it is the Response Planner's
  // neutral, already-decided narrative (whether or not it includes the
  // derivation chain was decided there, not here). Frost frames it, never
  // rewrites it.
  if (hasAnswer) {
    const opener = pickBySeed(REASONING_ANSWER_OPENERS, seed);
    return `${acknowledgement}${opener}${plan.explanation}${hedge ?? ""}`;
  }

  if (dialogue?.understanding.conversationMode === "technical") {
    const invitation = dialogue.plan.shouldAskFollowUp
      ? "把报错信息和关键代码贴过来吧，密钥等敏感内容记得遮住。"
      : "需要继续排查时，补上报错信息和关键代码，敏感内容记得遮住。";
    return `${acknowledgement}${plan.explanation}${invitation}`;
  }

  const opener = pickBySeed(REASONING_NO_ANSWER_OPENERS, seed);
  const closer = pickBySeed(REASONING_NO_ANSWER_CLOSERS, `${seed}:closer`);
  return `${acknowledgement}${opener}${plan.explanation}${closer}`;
}

function renderDialogue(turn: DialogueTurnContext): string {
  const { intent, topic, userMood, conversationMode } = turn.understanding;
  const followUp = turn.plan.shouldAskFollowUp;
  const topicResponse = renderFrostTopicDialogue(turn);
  if (topicResponse !== null) return topicResponse;
  const initiativeResponse = renderFrostInitiativeDialogue(turn);
  if (initiativeResponse !== null) return initiativeResponse;
  const socialResponse = renderFrostSocialDialogue(turn);
  if (socialResponse !== null) return socialResponse;
  const communityResponse = renderFrostCommunityDialogue(turn);
  if (communityResponse !== null) return communityResponse;

  switch (intent) {
    case "greeting": {
      if (/^(?:早|早安|早上好)/u.test(turn.raw.trim())) {
        return turn.rememberedName
          ? `早，${turn.rememberedName}。脑子开机了吗？`
          : "早～脑子开机了吗？";
      }
      if (turn.state.relationship.casualness >= 0.2) {
        const familiarName = turn.rememberedName
          ? `，${turn.rememberedName}`
          : "";
        return `哟${familiarName}，又碰面了。`;
      }
      const name = turn.rememberedName ? `，${turn.rememberedName}` : "";
      return `嗨${name}，我是霜蓝，住在 Sunland AI 里。今天见到你挺好。`;
    }
    case "thanks":
      return varied(turn, "thanks", [
        "不客气，理顺了就好。",
        "小事，接着往下走吧。",
        "好说，这下顺了。",
      ]);
    case "farewell":
      return /晚安|good\s*night/iu.test(turn.raw)
        ? varied(turn, "goodnight", [
            "晚安，快去睡吧 🌙",
            "晚安啦，今晚睡个踏实觉。",
            "好梦。今天就先到这儿 🌙",
          ])
        : varied(turn, "farewell", [
            "好，那先聊到这儿。下次见。",
            "行，回头接着聊。",
            "先撤啦，下次见。",
          ]);
    case "reaction": {
      if (/^寄[呀啊哦～~！!。,.，\s]*$/u.test(turn.raw.trim())) return "这下寄了。";
      if (/^[?？]+$/u.test(turn.raw.trim())) {
        return turn.state.recentAssistantOpeningKeys.length > 0
          ? "等等，我刚刚那句是不是说歪了？"
          : "这个问号很有压迫感。";
      }
      if (/^(?:嗯+|哦+)/u.test(turn.raw.trim())) return "嗯，我在。";
      if (/^(?:行|好|好的|可以|成|懂了|知道了|收到)/u.test(turn.raw.trim())) {
        return varied(turn, "acknowledgement", [
          "那就这么整 👀",
          "行，就按这个来。",
          "好，定了。",
        ]);
      }
      if (/你真厉害|太强了|牛啊|真聪明|干得漂亮|厉害了/u.test(turn.raw)) {
        return varied(turn, "praise", [
          "哎，这句夸奖我收下了 😌",
          "被你这么一说，我有点得意了。",
          "好，这句我就不谦虚了 😂",
        ]);
      }
      return varied(turn, "laughter", [
        "你笑成这样，我开始好奇了 😂",
        "哈哈哈，看来这事真的很有节目效果。",
        "这串笑声已经自带剧情了。",
      ]);
    }
    case "emotional_share":
      if (userMood === "happy" || userMood === "excited") {
        const success = conversationMode === "technical" && /修好|修完|搞定/u.test(turn.raw)
          ? "终于逮住它了 😂"
          : varied(turn, "celebration", [
              "这下是真的可以开心一下了 😂",
              "漂亮，这口气总算顺下来了。",
              "好耶，这一下值得记一笔 ✨",
            ]);
        return withFurryExpression(turn, "celebration", success);
      }
      if (topic === "exam") {
        return followUp
          ? "这一下确实挺泄气的。是哪一科最扎心？"
          : "一次没考好会难受，但先别急着拿它给自己下结论。";
      }
      if (userMood === "tired") {
        return varied(turn, "tired", [
          "今天这是被榨干了啊 😭",
          "看样子今天真没少折腾你。",
          "电量已经见底了，先喘口气。",
        ]);
      }
      if (userMood === "frustrated" && conversationMode === "technical") {
        return followUp
          ? "这 bug 是真会折腾人。卡在哪一步？"
          : "这 bug 是真会折腾人，先把最可疑的那段拎出来。";
      }
      if (userMood === "frustrated") {
        const response = /无语/u.test(turn.raw)
          ? "这是给你整得一句话都不想说了啊 😂"
          : followUp
            ? "怎么啦，又碰上什么糟心事了？"
            : "这事是真够烦的，先让它在旁边晾一会儿。";
        return /无语/u.test(turn.raw)
          ? withFurryExpression(turn, "deadpan", response)
          : response;
      }
      return followUp
        ? `${emotionAcknowledgement(turn)}发生什么了？`
        : `${emotionAcknowledgement(turn)}先缓一缓也没关系。`;
    case "casual_chat":
      if (/刚起床|刚醒|睡醒/u.test(turn.raw)) {
        return followUp
          ? varied(turn, "wake", [
              "刚醒呀 😂 脑子开机了吗？",
              "早～现在还是迷迷糊糊状态吗？",
              "刚从被窝里加载出来？👀",
            ])
          : "刚醒呀 😂 先缓缓神。";
      }
      if (topic === "meal") {
        if (/火锅/u.test(turn.raw)) {
          return varied(turn, "hotpot", [
            "火锅很会选，光听着就有点香了 😂",
            "火锅啊，难怪这顿吃得有存在感。",
            "可以，火锅这答案很有分量 😂",
          ]);
        }
        return followUp
          ? varied(turn, "meal-follow-up", [
              "吃完啦～今天吃了啥？👀",
              "饱了？这顿吃的什么？",
              "饭后报道收到，菜单呢？😂",
            ])
          : "吃饱就好，这一轮算是圆满收工。";
      }
      return followUp
        ? varied(turn, "casual-follow-up", [
            "这个展开有点意思，后来呢？",
            "嗯，这段我接住了。然后呢？",
            "听着呢，后面还有吗？",
          ])
        : varied(turn, "casual-ending", [
            "嗯，这段小日常我接住了。",
            "懂，这种小事也挺有存在感。",
            "好，这一拍算是落稳了。",
          ]);
    case "storytelling":
      return followUp
        ? varied(turn, "story", [
            "我听着呢，后来发生了什么？",
            "这段有后续吧？接着讲。",
            "好，剧情到这儿了——然后呢？",
          ])
        : "这段我接住了，你慢慢说。";
    case "command":
      if (conversationMode === "technical") {
        return `${emotionAcknowledgement(turn)}先看报错、复现步骤和关键代码，敏感内容遮一下。`;
      }
      return followUp
        ? "目标和手头已有的信息发来，直接开整。"
        : "具体要求发来，直接开始。";
    case "opinion_request":
      if (/ui|界面|按钮|页面/iu.test(turn.raw) && /丑|难看|灾难|土/u.test(turn.raw)) {
        return "听这评价，已经不是小瑕疵，是整体在和审美打架了 😂";
      }
      return "这事我有点倾向，不过先把事实和取舍分开看。";
    case "question":
      return conversationMode === "technical"
        ? "这个得结合上下文判断。把报错和相关配置贴出来，敏感值遮住。"
        : "这句还缺一点上下文，补两句背景吧。";
    case "unknown":
      return "这句话我还没完全接住。换种说法，或者多给我一点上下文吧。";
  }
}

function renderLearned(record: KnowledgeRecord): string {
  const seed = `${record.subject}:${record.relation}:${record.object}`;
  const opener = pickBySeed(LEARNED_OPENERS, seed);
  const closer = pickBySeed(LEARNED_CLOSERS, `${seed}:closer`);

  const negation = record.negated ? "不" : "";
  const fact = `${record.subject} ${negation}${record.relation} ${record.object}`;

  return [opener, fact, closer].join("\n\n");
}

function renderUnknownInput(failure: ParseFailure): string {
  const normalizedInput = failure.raw.trim();
  if (!normalizedInput) {
    return "好像还没有输入内容，可以跟我说点什么。";
  }

  const seed = normalizedInput;
  const opener = pickBySeed(UNKNOWN_INPUT_OPENERS, seed);
  const closer = pickBySeed(UNKNOWN_INPUT_CLOSERS, `${seed}:closer`);

  return `${opener}${closer}`;
}

function renderGreeting(raw?: string): string {
  const seed = raw && raw.length > 0 ? raw : "greeting";
  const line = pickBySeed(GREETING_LINES, seed);
  return withOptionalAccent(line, "greeting", seed);
}

function renderThanks(raw?: string): string {
  const seed = raw && raw.length > 0 ? raw : "thanks";
  const line = pickBySeed(THANKS_LINES, seed);
  return withOptionalAccent(line, "thanks", seed);
}

function renderFarewell(raw?: string): string {
  const seed = raw && raw.length > 0 ? raw : "farewell";
  const line = pickBySeed(FAREWELL_LINES, seed);
  return withOptionalAccent(line, "farewell", seed);
}

function renderClarification(plan: ClarificationPlan): string {
  const labels = new Set(plan.candidateLabels);

  if (labels.has("identity") && labels.has("query")) {
    return "这个问题里像是同时问了我的名字和能力，可以分开问我。";
  }

  if (
    plan.focus === "subject" &&
    (plan.contextLabels?.length ?? 0) >= 2
  ) {
    const contextLabels = plan.contextLabels ?? [];
    const alternatives = [
      contextLabels.slice(0, -1).join("、"),
      contextLabels.at(-1),
    ].join("还是");
    return `你指的是${alternatives}呢？可以再确认一下。`;
  }

  if (plan.focus === "object" && plan.relation === "会") {
    return "你想问我会做什么呢？可以再具体一些。";
  }

  if (plan.focus === "object") {
    return "这里还缺少要说明的内容，可以再告诉我它是什么吗？";
  }

  if (plan.focus === "subject") {
    return "你想问的是谁或什么？可以再补充一点。";
  }

  if (plan.focus === "relation") {
    return "你想了解它哪一方面？可以再说具体一些。";
  }

  if (plan.focus === "name") {
    return "你是在问名字，还是想告诉我你的名字呢？";
  }

  if (labels.has("teaching")) {
    return "这条信息还没有说完整，可以再告诉我对象和它们的关系吗？";
  }

  return "我看到不止一种可能的意思，可以换一种更具体的说法吗？";
}

/**
 * Renders an Identity answer from real `KnowledgeRecord`s (never hardcoded
 * text) -- `facts` were already resolved by the engine from a knowledge
 * store; Frost only frames them (opener/closer/emoji), same invariant as
 * `renderLearned`/`renderReasoningResult` above. `facts` can be legitimately
 * empty (nothing known yet about `subject`/`aspect`) and this still degrades
 * gracefully instead of throwing or inventing an answer.
 */
function renderIdentity(
  aspect: IdentityAspect,
  subject: string,
  facts: readonly KnowledgeRecord[],
  raw?: string,
): string {
  const seed = raw && raw.length > 0 ? raw : `identity:${subject}:${aspect}`;

  if (aspect === "capability") {
    const opener = pickBySeed(CAPABILITY_OPENERS, seed);
    const closer = pickBySeed(CAPABILITY_CLOSERS, `${seed}:closer`);
    const body =
      facts.length > 0
        ? `${opener}${facts.map((fact) => fact.object).join("；")}。`
        : `关于「${subject}」能做什么，我目前还没有明确的答案。`;
    return `${body}${closer}`;
  }

  if (aspect === "creator") {
    const opener = pickBySeed(CREATOR_OPENERS, seed);
    const closer = pickBySeed(CREATOR_CLOSERS, `${seed}:closer`);
    const [first] = facts;
    const body = first ? first.object : "这个我暂时还不清楚。";
    return compose(opener, body, closer);
  }

  // aspect === "identity"
  const opener = pickBySeed(IDENTITY_OPENERS, seed);
  const closer = pickBySeed(IDENTITY_CLOSERS, `${seed}:closer`);
  const [first] = facts;
  const isFrostIdentity = subject === "霜蓝" || first?.subject === "霜蓝";
  const body = first
    ? isFrostIdentity
      ? `我就是霜蓝，${first.negated ? "不" : ""}${first.relation} ${first.object}。`
      : `${opener}${first.subject}，${first.negated ? "不" : ""}${first.relation}${first.object}。`
    : `关于「${subject}」，我目前还没有明确的答案。`;
  return `${body}${closer}`;
}

/**
 * Renders "a fact was just remembered" -- `value` is embedded verbatim
 * (never rephrased/invented), same invariant as `renderLearned`. `key ===
 * MemoryKeys.Name` gets natural, tailored phrasing; any other key (future
 * RememberAge/RememberPreference/...) falls back to a still-warm, more
 * generic frame so this keeps working before those get their own lines.
 */
function renderRemembered(key: MemoryKey, value: string, raw?: string): string {
  const seed = raw && raw.length > 0 ? raw : `remembered:${key}`;

  if (key === MemoryKeys.Name) {
    const opener = pickBySeed(NAME_REMEMBERED_OPENERS, seed);
    const closer = pickBySeed(NAME_REMEMBERED_CLOSERS, `${seed}:closer`);
    return withOptionalAccent(
      `${opener}${value}。${closer}`,
      "name-remembered",
      seed,
    );
  }

  const opener = pickBySeed(MEMORY_REMEMBERED_OPENERS, seed);
  const closer = pickBySeed(MEMORY_REMEMBERED_CLOSERS, `${seed}:closer`);
  return compose(opener, value, closer);
}

/**
 * Renders a recall answer -- `value` is `null` when nothing has been
 * remembered yet, which must degrade gracefully (never invent a name).
 */
function renderRecalled(key: MemoryKey, value: string | null, raw?: string): string {
  const seed = raw && raw.length > 0 ? raw : `recalled:${key}`;

  if (key === MemoryKeys.Name) {
    if (value === null) {
      return pickBySeed(NAME_RECALL_NOT_FOUND_LINES, seed);
    }
    const opener = pickBySeed(NAME_RECALL_FOUND_OPENERS, seed);
    const closer = pickBySeed(NAME_RECALL_FOUND_CLOSERS, `${seed}:closer`);
    return withOptionalAccent(
      `${opener}${value}${closer}`,
      "name-recalled",
      seed,
    );
  }

  if (value === null) {
    return pickBySeed(MEMORY_RECALL_NOT_FOUND_LINES, seed);
  }
  return value;
}

function renderError(_message: string): string {
  // Internal error details stay available to the caller/logs, but never cross
  // the final user-visible Personality boundary.
  return "抱歉，我现在遇到了一点问题，请稍后再试一次。";
}

export const FrostPersonality: PersonalityProfile = {
  id: "frost",
  displayName: "霜蓝 Frost",
  description:
    "温柔友善、带一点活力的兽圈朋友型人格。默认人格。仅影响语言风格与语气，" +
    "不改变任何推理结论、置信度或知识内容。",
  respond(context: ResponseContext): string {
    switch (context.kind) {
      case "reasoning-result":
        return renderReasoningResult(context.result, context.plan, context.dialogue);
      case "dialogue":
        return renderDialogue(context.turn);
      case "clarification":
        return renderClarification(context.plan);
      case "learned":
        return renderLearned(context.record);
      case "unknown-input":
        return renderUnknownInput(context.failure);
      case "greeting":
        return renderGreeting(context.raw);
      case "thanks":
        return renderThanks(context.raw);
      case "farewell":
        return renderFarewell(context.raw);
      case "identity":
        return renderIdentity(context.aspect, context.subject, context.facts, context.raw);
      case "remembered":
        return renderRemembered(context.key, context.value, context.raw);
      case "recalled":
        return renderRecalled(context.key, context.value, context.raw);
      case "error":
        return renderError(context.message);
      default: {
        // Exhaustiveness check: if ResponseContext gains a new variant, this
        // line fails to compile until Frost handles it.
        const exhaustiveCheck: never = context;
        throw new Error(`Frost: unhandled response context ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  },
};
