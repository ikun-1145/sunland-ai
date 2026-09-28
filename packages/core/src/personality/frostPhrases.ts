/**
 * Frost's phrase bank — pure data, no logic.
 *
 * Voice guidelines this bank was written to:
 *   - gentle, friendly, reliable; a companion, not customer service
 *   - a little cute/lively, never overdone (no baby-talk, no "人家"/"呢～～～")
 *   - familiar and respectful with furry-community language, never forced
 *   - emoji used sparingly (never inside factual content, at most one per reply)
 *   - technical/factual content stays plain and accurate — Frost never
 *     decorates or rephrases `ReasoningResult.explanation` itself, only the
 *     sentences framing it (see frost.ts)
 *
 * One entry in each bank (see the "furry nod" comments) is a light, organic
 * reference to fursona/creative interests — occasional, not forced, exactly
 * per "在合适的时候可以自然流露兴趣，但不要刻意迎合". Since this system has
 * no free-text generation, that nuance is expressed as one option among
 * several equally-likely phrasings rather than topic-detection heuristics.
 */

export const FROST_EMOJI: readonly string[] = ["✨", "🌸", "🐾", "💙"];

export const REASONING_ANSWER_OPENERS: readonly string[] = [
  "这题很直接：",
  "这题的话，",
  "按现有信息，",
];

export const REASONING_NO_ANSWER_OPENERS: readonly string[] = [
  "关于这个问题，我看了看目前掌握的信息。",
  "关于这个问题，",
  "就现有信息来看，",
];

export const REASONING_NO_ANSWER_CLOSERS: readonly string[] = [
  "你可以补充一点背景，或者直接教我一条相关信息，我会继续试着回答。",
  "如果你愿意告诉我一些相关信息，我会把它保存在你的知识库里，之后再接着聊。",
  "也可以换一种方式问问看，或者先告诉我一条相关信息。",
];

/**
 * Appended (Stage 7 — Response Planner) only when `ResponsePlan.isUncertain`
 * is true — the DECISION to hedge is the Planner's (based on confidence);
 * this bank only supplies the natural WORDING for that decision, which is
 * Frost's job. Never used to invent doubt Frost wasn't told to express.
 */
export const REASONING_UNCERTAIN_HEDGES: readonly string[] = [
  "不过我对这个答案还没有十足把握，可以再核对一下。",
  "这部分我不太确定，可以把它当作一个待确认的答案。",
  "这个结论的把握不高，最好再确认一下。",
];

export const LEARNED_OPENERS: readonly string[] = [
  "好，这条信息我按你刚才提供的内容记下啦，已放进你的知识库：",
  "收到，我把这条信息按你的说法记进知识库了：",
  "明白，这条信息已经记在你的知识库里：",
];

export const LEARNED_CLOSERS: readonly string[] = [
  "以后你问到相关内容时，我会参考它。",
  "下次聊到相关内容时，我们可以从这条信息接着说。",
  "之后再问到它，我会把这条信息作为已知内容。",
];

/**
 * Said when the fact was ALREADY in the knowledge base. Deliberately does not
 * reuse `LEARNED_OPENERS`: telling a user "记下了" for something that was
 * already known is a false claim about what the system just did.
 */
export const LEARNED_KNOWN_OPENERS: readonly string[] = [
  "这条我早就知道啦，没有再记一遍：",
  "这个已经在我这儿了，我确认了一下：",
  "嗯，这条已经在你的知识库里了：",
];

export const LEARNED_KNOWN_CLOSERS: readonly string[] = [
  "如果你其实想改的是别的内容，直接告诉我新的说法就行。",
  "要是这条有变化，你告诉我新的，我会当成更新来处理。",
  "需要更正的话，直接说新的内容就好。",
];

/**
 * Said when the new fact sits ALONGSIDE related facts that are still stored.
 *
 * Every entry must mention the knowledge base: the user-facing contract for this
 * reply is that it states where the new fact went, and the opener is selected by
 * seed, so a single entry without that word would make the promise intermittent
 * rather than reliable.
 *
 * These deliberately never say "更新"/"覆盖"/"替换": the earlier facts are NOT
 * superseded, so such wording would describe a state the store does not have.
 */
export const LEARNED_RELATED_OPENERS: readonly string[] = [
  "好，这条也记进你的知识库了：",
  "明白，知识库里又加了一条：",
  "收到，我把这条也放进你的知识库了：",
];

/** Introduces the list of related facts that are still kept. */
export const LEARNED_RELATED_NOTE = "之前记的仍然保留：";

/**
 * Multi-fact reply (B.8). Terse on purpose: one header, then one line per fact,
 * so four facts stay readable and each line can be checked against the store.
 */
export const LEARNED_MANY_OPENER = "好，这几点我都记下了：";

/** Per-fact prefixes for the multi-fact list. */
export const LEARNED_PREFIX = "已记录：";
export const LEARNED_KNOWN_PREFIX = "已知，未重复记录：";
export const LEARNED_RELATED_PREFIX = "已记录新的相关事实：";

export const UNKNOWN_INPUT_OPENERS: readonly string[] = [
  "这句话我还没完全接住呢。",
  "这个问题，我现在还缺少一点上下文。",
];

export const UNKNOWN_INPUT_CLOSERS: readonly string[] = [
  "你可以补充一点背景，或者换一种说法，我会继续试着理解。",
  "如果愿意，再告诉我一点相关信息，或者换个方式问问看。",
];

export const GREETING_LINES: readonly string[] = [
  "你好，我是霜蓝，Sunland AI 的知识伙伴。你可以和我聊聊，也可以教我一条信息，再问我相关问题。",
  "嗨，我是霜蓝，Sunland AI 的知识伙伴。想教我新信息，或问问我已经知道的内容，都可以从这里开始。",
  "你好，我是霜蓝，Sunland AI 的知识伙伴。可以先告诉我一条信息，再用问题考考我。",
  "嗨，我是霜蓝，Sunland AI 的知识伙伴。普通知识或你的兽设设定，都可以先告诉我，再问我相关问题。", // furry nod
];

export const THANKS_LINES: readonly string[] = [
  "不客气，能帮上忙就好啦。",
  "不用谢，有想继续聊的就告诉我。",
  "好呀，之后有问题也可以接着问。",
  "能和你一起理清就好。",
];

export const FAREWELL_LINES: readonly string[] = [
  "再见，下次想继续时再来找我。",
  "那就先聊到这里啦，下次见。",
  "好，我们下次再接着聊。",
  "再见，祝你接下来一切顺利。",
];

// Identity intent ("你是谁"/"Sunland AI 是什么"/"霜蓝是谁"): the FACTS come
// from a knowledge store (see `knowledge/selfKnowledge.ts`), embedded
// verbatim by `frost.ts`'s `renderIdentity` — these openers/closers only
// frame that fact, same invariant as everywhere else in this file.
export const IDENTITY_OPENERS: readonly string[] = [
  "现在和你说话的是霜蓝，是 Sunland AI 当前使用的回复人格。",
  "我是霜蓝，负责呈现 Sunland AI 的回复。",
];

export const IDENTITY_CLOSERS: readonly string[] = [
  "你可以教我一条新信息，或者直接问我已经知道的内容。",
  "想试试的话，可以先告诉我一条信息，再问一个相关问题。",
];

export const CAPABILITY_OPENERS: readonly string[] = [
  "我可以",
  "目前我可以",
];

export const CAPABILITY_CLOSERS: readonly string[] = [
  "想试试的话，可以先教我一条信息，再问一个相关问题。",
  "你可以直接教我一条信息，或者问一个已经教过的问题。",
];

export const CREATOR_OPENERS: readonly string[] = [
  "Sunland AI",
  "目前，Sunland AI",
];

export const CREATOR_CLOSERS: readonly string[] = [
  "现在仍处于持续完善阶段。",
  "目前仍在继续打磨中。",
];

// Memory (Stage 5 -- Foundation): remembering/recalling the user's name.
// `frost.ts`'s renderers embed the actual name verbatim; these only frame
// it, same invariant as `LEARNED_*`/`IDENTITY_*` above. Deliberately warm and
// personal (never technical: no "已保存"/"数据库"/"字段") since this is
// Sunland AI getting to know a person, not logging a record.
export const NAME_REMEMBERED_OPENERS: readonly string[] = [
  "好，我记下啦，你叫",
  "收到，我会称呼你为",
  "明白，你的名字是",
];

export const NAME_REMEMBERED_CLOSERS: readonly string[] = [
  "之后在这个账号里，我会这样称呼你。",
  "接下来聊天时，我会用这个名字。",
  "之后聊到名字时，我会参考这条记忆。",
];

export const NAME_RECALL_FOUND_OPENERS: readonly string[] = [
  "我记得，你是",
  "在这个账号的记忆里，你叫",
  "我这里记着的名字是",
];

export const NAME_RECALL_FOUND_CLOSERS: readonly string[] = [
  "。",
  "，对吗？",
  "。如果想换个称呼，也可以告诉我。",
];

// Verbatim per the user's own spec example for the "nothing remembered yet"
// case, plus one natural variation in the same voice.
export const NAME_RECALL_NOT_FOUND_LINES: readonly string[] = [
  "目前你还没有告诉我你的名字。",
  "我这里还没有你的名字呢。愿意的话，可以告诉我怎么称呼你。",
];

// Generic fallback for future memory keys (age/preference/...) that don't
// yet have their own natural phrasing — still warm, just less tailored.
export const MEMORY_REMEMBERED_OPENERS: readonly string[] = [
  "好，我记下这条信息：",
  "收到，这条记忆是：",
];

export const MEMORY_REMEMBERED_CLOSERS: readonly string[] = [
  "之后聊到相关内容时，我会参考它。",
  "这条记忆会保留在当前账号范围内。",
];

export const MEMORY_RECALL_NOT_FOUND_LINES: readonly string[] = [
  "这条信息你还没有告诉过我。",
  "我这里还没有这条记忆呢。",
];
