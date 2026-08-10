import type { DialogueTurnContext } from "@/types";
import { pickNonRepeatingText } from "./variation";

function tagsOf(turn: DialogueTurnContext): ReadonlySet<string> {
  return new Set([
    ...turn.understanding.community.compositions.map(({ semanticTag }) => semanticTag),
    ...turn.understanding.community.matches.map(({ semanticTag }) => semanticTag),
  ]);
}

function varied(
  turn: DialogueTurnContext,
  key: string,
  candidates: readonly string[],
): string {
  return pickNonRepeatingText(
    candidates,
    `${turn.raw}:community:${key}:${turn.state.relationship.familiarity}`,
    turn.state.recentAssistantOpeningKeys,
  );
}

function definition(turn: DialogueTurnContext, plain: boolean): string | null {
  if (!turn.understanding.community.definitionRequested) return null;
  const [match] = [...turn.understanding.community.matches].sort(
    (left, right) => right.confidence - left.confidence,
  );
  if (match === undefined) return null;
  return plain
    ? `“${match.matchedAlias}”在当前语境中指${match.meaning}。`
    : `“${match.matchedAlias}”在这里一般就是${match.meaning}。`;
}

function mirrored(turn: DialogueTurnContext): boolean {
  return turn.plan.communityLanguageMode === "mirror";
}

export function renderFrostCommunityDialogue(
  turn: DialogueTurnContext,
): string | null {
  if (turn.understanding.pragmatics.requiresSafetyHandling) return null;
  if (turn.understanding.community.matches.length === 0) return null;
  const directDefinition = definition(turn, false);
  if (directDefinition !== null) return directDefinition;

  const tags = tagsOf(turn);
  const followUp = turn.plan.shouldAskFollowUp;
  const useSlang = mirrored(turn);
  const technical = turn.understanding.conversationMode === "technical";

  if (technical && tags.has("EMOTIONAL_OVERLOAD")) {
    return followUp
      ? "这 bug 是真会把人折腾破防。现在卡在哪一步？"
      : "这 bug 是真会磨人，先把最可疑的状态变化拎出来。";
  }

  if (tags.has("FURSUIT_EVENT_PLAN") || tags.has("FURSUIT_ACTIVITY")) {
    if (/热|累|闷|汗/u.test(turn.raw)) {
      return useSlang
        ? varied(turn, "fursuit-tired", [
            "今天这趟出毛是被热气狠狠干了一轮吧 😭",
            "这天气出毛，回来感觉像刚蒸完一笼 😭",
            "听着就知道这趟出毛把电量清空了。",
          ])
        : "这一趟听着就又热又耗体力，电量直接见底了吧 😭";
    }
    return useSlang
      ? followUp
        ? varied(turn, "fursuit-plan-question", [
            "周末要出毛啦 👀 准备去哪玩？",
            "出毛计划安排上了。准备去兽展还是外拍？",
            "这周末轮到毛毛营业了啊 😂 去哪边？",
          ])
        : "周末出毛安排上了，感觉会挺热闹 👀"
      : followUp
        ? "周末活动安排上了 👀 准备去哪边？"
        : "周末这场活动听着就挺热闹。";
  }

  if (tags.has("AFFECTIONATE_TOUCH") || tags.has("FURRY_TOUCH_AFFECTION")) {
    return useSlang
      ? varied(turn, "rua", [
          "这毛量看着确实很适合 rua 😂",
          "这谁忍得住不 rua 两下。",
          "光看着就知道手感很犯规 😂",
        ])
      : "这个毛茸茸程度，确实很难忍住不摸两下 😂";
  }

  if (tags.has("FURSUIT_ACQUISITION") || tags.has("FURSUIT")) {
    if (/到|收到|终于|开箱/u.test(turn.raw)) {
      return useSlang
        ? "终于到手了 😂 开箱那一下肯定很有仪式感。"
        : "终于等到了 😂 开箱那一下肯定很有仪式感。";
    }
    return useSlang ? "这个毛的完成度听着挺能打。" : "这个成品听着完成度挺高。";
  }

  if (tags.has("FURRY_CONVENTION") || tags.has("FURRY_MEET")) {
    return followUp
      ? "活动日程安排上了 👀 最期待哪一段？"
      : "这场听着就会很热闹，现场氛围应该不错。";
  }

  if (tags.has("FURSONA") || tags.has("FURRY_MEMBER_OR_CHARACTER")) {
    if (/帅|好看|可爱|怎么样/u.test(turn.raw)) {
      return "这个设定挺抓眼的，尤其轮廓和配色应该很容易留下印象。";
    }
    return followUp
      ? "这个设定有点勾住好奇心了。最先定下来的是哪部分？"
      : "这个设定听着已经有自己的气质了。";
  }

  if (tags.has("SOCIAL_CONNECT")) {
    return "想认识点新同好呀。希望能碰上几个真正聊得来的 👀";
  }

  if (tags.has("FAVORITE_MERCH_RELEASE")) {
    if (/到|收到|到手|终于/u.test(turn.raw)) {
      return useSlang
        ? "我推的谷终于到手了 😂 等这么久，开箱那一下肯定很爽。"
        : "喜欢的角色周边终于到了 😂 等这么久，开箱那一下肯定很爽。";
    }
    return useSlang
      ? "我推突然上新，这下钱包和心情得同时开会了 😂"
      : "喜欢的角色突然上新，这下钱包要开始有意见了 😂";
  }

  if (tags.has("MERCH_PURCHASE")) {
    return useSlang
      ? varied(turn, "buy-merch", [
          "又吃谷了啊 😂 这次是哪一套没忍住？",
          "快乐是到手了，钱包估计也轻了一截 😂",
          "这次买到真正心水的了？👀",
        ])
      : "又买周边了啊 😂 这次是哪一套没忍住？";
  }

  if (tags.has("NEW_MERCH_RELEASE") || tags.has("MERCHANDISE")) {
    if (/到|收到|终于/u.test(turn.raw)) {
      return "终于到了 😂 等那么久，开箱那一下应该很爽。";
    }
    return followUp
      ? "这波周边看着挺会拿捏人的。最想收哪一个？"
      : "这波周边一出，钱包又要承受压力了 😂";
  }

  if (tags.has("ITA_BAG")) {
    return followUp
      ? "痛包工程开工了 👀 已经想好主色和排版了吗？"
      : "痛包排好那一下，快乐确实很具体。";
  }

  if (tags.has("BADGE_MERCH") || tags.has("DISPLAY_MERCH")) {
    return "这个拿来当视觉中心应该挺合适，摆出来会很抓眼。";
  }

  if (tags.has("MERCH_TRADE") || tags.has("MERCH_CONDITION")) {
    return "这类最考验品相和价格，信息对清楚了会省很多麻烦。";
  }

  if (tags.has("CREATOR_COMMISSION") || tags.has("WAITING_COMMISSION_OPEN")) {
    return useSlang
      ? "这位老师一开稿，感觉又是拼手速现场 😂"
      : "这位创作者一开放委托，感觉又得拼手速了 😂";
  }

  if (tags.has("COMMUNITY_HONORIFIC") && /画|作品|稿|兽设|毛/u.test(turn.raw)) {
    return "能让你夸到这个程度，这位创作者确实把感觉画到位了。";
  }

  if (tags.has("COMMISSION_OPEN") || tags.has("ART_COMMISSION")) {
    if (/吗|没|什么时候|蹲/u.test(turn.raw)) {
      return "这阵势看着已经有人守着名额了 😂 真开的时候估计得快。";
    }
    return followUp
      ? "新委托安排上了 👀 这次想约什么方向？"
      : "新稿安排上了，等成品的过程最磨人也最期待。";
  }

  if (tags.has("ORIGINAL_CHARACTER") || tags.has("CHARACTER_SETTING")) {
    if (/立绘|衣设|设定图|三视图/u.test(turn.raw)) {
      return "终于把形象落到图上了，这种“角色真的站起来了”的感觉很爽。";
    }
    return followUp
      ? "这个角色已经有点画面了。你最想保住哪一个核心特征？"
      : "这个设定有自己的记忆点，不是换个配色就忘掉的那种。";
  }

  if (tags.has("COSPLAY_PHOTO_DELIVERY")) {
    return "等返图真的很像开盲盒，明知道拍过还是会一直惦记 😂";
  }

  if (tags.has("CHARACTER_ART") || tags.has("IMAGE_DELIVERY")) {
    return /到|返|终于/u.test(turn.raw)
      ? "终于见到成品了 😂 等待值在这一刻算是兑现了。"
      : "这张要是把角色气质抓住，成品会很有存在感。";
  }

  if (tags.has("SHIPPING_EXCITEMENT") || tags.has("STORY_SUGAR")) {
    return useSlang
      ? "这波确实磕到了，官方递糖的时候谁还装得住 😂"
      : "这段互动确实很会让人上头 😂";
  }

  if (tags.has("STORY_PAIN")) {
    return "这剧情下手是真不留情，看到那一下心口都得空一块 😭";
  }

  if (tags.has("FAVORITE_CHARACTER") || tags.has("CHARACTER_FANDOM")) {
    return followUp
      ? "喜欢到这个程度，肯定有个特别戳你的点。是哪一下入坑的？"
      : "能稳稳坐上本命位，说明这个角色确实很会抓人。";
  }

  if (tags.has("CHARACTER_PAIRING")) {
    return "这对的化学反应听着已经很明显了，难怪会越看越上头 😂";
  }

  if (tags.has("OUT_OF_CHARACTER")) {
    return "这要是连行为逻辑都接不上，就不是小偏差，是真的有点崩了。";
  }

  if (tags.has("ANIME_WATCHING")) {
    return followUp
      ? "这季度想追轻松点的，还是剧情密一点的？"
      : "这季度片单一多，最难的反而是决定先开哪部。";
  }

  if (tags.has("COSPLAY_CHARACTER")) {
    return followUp
      ? "周末出角呀 👀 这次准备还原谁？"
      : "这次角色安排上了，等成片应该挺有意思。";
  }

  if (tags.has("COSPLAY_TEST")) {
    return /翻车|失败|不行/u.test(turn.raw)
      ? "试妆翻车虽然扎心，但至少正式出片前把雷踩出来了 😭"
      : "试妆能把整体感觉跑通，后面正式上妆就稳多了。";
  }

  if (tags.has("COSPLAY_PHOTO")) {
    return "等返图真的很像开盲盒，明知道拍过还是会一直惦记 😂";
  }

  if (tags.has("COSPLAY_PHOTO_MEET")) {
    return "今天这趟合照库存应该涨了不少，回去翻相册会很有成就感。";
  }

  if (tags.has("COSPLAY_SHOOT") || tags.has("COSPLAY_MATERIALS")) {
    return "这套从妆造到道具都挺吃整体配合，顺起来成片会很值。";
  }

  if (
    tags.has("INTERNET_LAUGHTER") ||
    tags.has("CANNOT_HOLD_REACTION")
  ) {
    return "你这已经不是憋笑失败，是当场被节目效果拿下了。";
  }

  if (
    tags.has("FAILED_STATE") ||
    tags.has("EMOTIONAL_OVERLOAD") ||
    tags.has("OVERWHELMED_REACTION")
  ) {
    return followUp
      ? "这下是真给你整麻了。又卡在哪儿了？"
      : "这一下确实够人裂开的，先让情绪落一落。";
  }

  if (tags.has("ABSURD_REACTION")) {
    return "这展开确实很难用正常逻辑评价，离谱得相当完整 😂";
  }

  if (tags.has("BIG_WIN") || tags.has("NAILED_IT")) {
    return "这波是真的稳稳拿下了，爽一下完全合理 😂";
  }

  const primaryDomain = turn.understanding.community.primaryDomain;
  if (primaryDomain === "furry") return "这个展开有点意思，听着就挺有画面。";
  if (primaryDomain === "acg") return "这一下确实很容易让人上头。";
  if (primaryDomain === "goods") return "快乐很具体，钱包的压力也很具体 😂";
  if (primaryDomain === "art") return "这类从想法落到成品的过程，总会让人惦记。";
  if (primaryDomain === "cosplay") return "从准备到成片都挺费功夫，但顺起来会很值。";
  return "这个反应我懂，确实很有当代互联网现场感 😂";
}

export function renderPlainCommunityDialogue(
  turn: DialogueTurnContext,
): string | null {
  if (turn.understanding.pragmatics.requiresSafetyHandling) return null;
  if (turn.understanding.community.matches.length === 0) return null;
  const directDefinition = definition(turn, true);
  if (directDefinition !== null) return directDefinition;
  const tags = tagsOf(turn);

  if (tags.has("FURSUIT_ACTIVITY")) return "这次活动听起来很消耗体力。";
  if (tags.has("AFFECTIONATE_TOUCH")) return "这个毛茸茸的质感确实很吸引人。";
  if (tags.has("SOCIAL_CONNECT")) return "你想认识一些新的同好。";
  if (tags.has("FAVORITE_MERCH_RELEASE")) return "喜欢的角色推出新周边了。";
  if (tags.has("MERCH_PURCHASE")) return "这次又买了新的周边。";
  if (tags.has("ITA_BAG")) return "这个主题包需要先确定排版和主色。";
  if (tags.has("COMMISSION_OPEN") || tags.has("ART_COMMISSION")) return "你在关注新的委托名额。";
  if (tags.has("ORIGINAL_CHARACTER") || tags.has("CHARACTER_SETTING")) return "这个原创角色的设定已经比较明确。";
  if (tags.has("SHIPPING_EXCITEMENT") || tags.has("STORY_SUGAR")) return "这段角色互动确实令人高兴。";
  if (tags.has("STORY_PAIN")) return "这段剧情确实很令人难受。";
  if (tags.has("COSPLAY_CHARACTER")) return "周末的角色扮演已经安排好了。";
  if (tags.has("COSPLAY_TEST")) return "这次测试暴露了需要调整的妆造问题。";
  if (tags.has("COSPLAY_PHOTO")) return "你正在等这次拍摄的成片。";
  if (tags.has("INTERNET_LAUGHTER")) return "这件事确实很好笑。";
  if (tags.has("FAILED_STATE") || tags.has("EMOTIONAL_OVERLOAD")) return "这件事确实让人很挫败。";
  return "这件事我明白了。";
}
