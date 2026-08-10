import type { DialogueTurnContext } from "@/types";

function mixedTaskFrost(turn: DialogueTurnContext): string | null {
  if (turn.understanding.pragmatics.communicativeGoal !== "ask_for_help") {
    return null;
  }
  const emotional = turn.plan.socialStrategy.acknowledgeEmotion;
  if (!emotional) return null;
  if (/保存|文件|恢复|找回/u.test(turn.raw)) {
    return turn.plan.socialStrategy.allowBanter
      ? "你和保存按钮今天看来又没对上暗号。先查自动保存、临时文件和版本历史。"
      : "这一下确实够懊恼的。先查自动保存、临时文件和版本历史。";
  }
  if (/bug|报错|代码|接口|编译|部署/iu.test(turn.raw)) {
    return "这一下确实很磨人。把报错、复现步骤和关键代码发来，敏感内容遮一下。";
  }
  return "先别急着给自己下结论。把要解决的现象和手头信息发来，我们从最可逆的一步开始。";
}

function mixedTaskPlain(turn: DialogueTurnContext): string | null {
  if (
    turn.understanding.pragmatics.communicativeGoal !== "ask_for_help" ||
    !turn.plan.socialStrategy.acknowledgeEmotion
  ) return null;
  if (/保存|文件|恢复|找回/u.test(turn.raw)) {
    return "这确实令人懊恼。先检查自动保存、临时文件和版本历史。";
  }
  if (/bug|报错|代码|接口|编译|部署/iu.test(turn.raw)) {
    return "这确实很令人挫败。请提供报错、复现步骤和关键代码，并移除敏感内容。";
  }
  return "先不要否定自己。请提供要解决的现象和已有信息。";
}

function repeatedAcknowledgement(turn: DialogueTurnContext): string | null {
  if (
    turn.understanding.pragmatics.reactionPattern === undefined ||
    turn.plan.socialStrategy.reactionPattern !== undefined
  ) return null;
  switch (turn.understanding.pragmatics.communicativeGoal) {
    case "vent":
    case "complain":
      return "嗯，这一下确实够折腾人的。";
    case "celebrate":
      return "这一下确实值得高兴。";
    case "joke":
    case "tease":
    case "sarcasm":
      return "这句里的意思我接到了。";
    default:
      return "嗯，这个意思我接到了。";
  }
}

export function renderFrostSocialDialogue(
  turn: DialogueTurnContext,
): string | null {
  const pragmatics = turn.understanding.pragmatics;
  const strategy = turn.plan.socialStrategy;
  if (pragmatics.requiresSafetyHandling) return null;

  const taskResponse = mixedTaskFrost(turn);
  if (taskResponse !== null) return taskResponse;

  if (pragmatics.offenseLevel === "hostile") {
    return "玩笑先停。我刚才具体错在哪一步，直接说，我按问题重来。";
  }
  if (pragmatics.offenseLevel === "rude") {
    return "刚才那下应该是没答到点上。具体哪一步不对，我重来。";
  }
  if (pragmatics.offenseLevel === "banter") {
    return strategy.allowBanter
      ? "行，这口锅我先顶一下。具体是哪一步把你气到了？"
      : "可能是我这一步判断歪了，指出具体位置吧。";
  }

  const repeat = repeatedAcknowledgement(turn);
  if (repeat !== null) return repeat;

  switch (strategy.reactionPattern) {
    case "sarcasm-failure":
      return turn.understanding.conversationMode === "technical"
        ? "这句反话我接到了：结果又失败，确实够烦。"
        : "这句“夸奖”听着已经快咬牙切齿了 😂";
    case "self-deprecation":
    case "save-mishap":
      if (/保存/u.test(turn.raw)) {
        return strategy.allowBanter
          ? "你和保存按钮今天看来又没对上暗号。先看看自动保存还在不在。"
          : "惨，这一下确实够懊恼的。先看看自动保存还在不在。";
      }
      return "这次失误归这次，先别顺手把自己也一起否定了。";
    case "teasing":
      return strategy.allowBanter
        ? "好好好，这一票先判我短路。"
        : "可能是我刚才判断歪了，具体哪句不对？";
    case "third-party-remark":
      return "听着你是在吐槽对方；具体发生了什么，还是得看上下文。";
    case "furry-heat":
      return "这一趟出毛是被热气狠狠干了一轮吧，电量直接见底了 😭";
    case "furry-no-rua":
      return "毛茸茸都在眼前了还没 rua 到，这委屈确实很具体 😂";
    case "furry-event-return":
      return "刚从现场回来，脑子估计还在热闹里没完全下线。";
    case "furry-arrival":
      return "终于到手了 😂 开箱那一下肯定很有仪式感。";
    case "furry-delay":
      return "等了这么久还延期，这一下确实挺磨人的。";
    case "fursona-commission":
      return "兽设终于往成图迈了一步，等第一版草图最让人惦记。";
    case "photo-return":
      return "返图一到，活动像是又续了一小段命 😂";
    case "community-connect":
      return "扩列信号已经放出去了，希望这次能蹲到几个真聊得来的 👀";
    case "wallet-pressure":
      return "官方是真不给钱包喘气啊 😂";
    case "merch-overflow":
      return "快乐库存很充足，收纳空间已经开始抗议了 😂";
    case "budget-limit":
      return "喜欢归喜欢，预算线还是得保住；不默认你一定要收。";
    case "merch-trade":
      return "能把想换的顺利换到，这口气总算顺下来了。";
    case "merch-box":
      return "直接端盒，这次收藏目标很明确啊 😂";
    case "collection-limit":
      return "这波是真的收不动了，先让钱包和柜子一起喘口气。";
    case "budget-recovery":
      return "出谷回血安排上了，至少先把钱包从红线边上拉回来。";
    case "commission-open":
      return "老师一开稿，空气里立刻有了拼手速的味道 😂 不过想不想约还是你说了算。";
    case "commission-success":
      return "终于约到了，这个名额拿得漂亮。";
    case "art-delivered":
      return "终于看到成图了，等待值在这一刻算是兑现了。";
    case "commission-delay":
      return "期待吊了这么久又延期，确实很消耗耐心。";
    case "commission-wait":
      return "稿位还没开，蹲守的气氛已经先到位了 😂";
    case "character-new-look":
      return "设子的新造型安排上了，角色又多长出一层气质。";
    case "favorite-pain":
      return "我懂，是剧情把你推到了刀口上，不是在说现实里的事。";
    case "official-sugar":
      return "官方亲自递糖的时候，谁还装得住啊 😂";
    case "official-knife":
      return "官方这刀下得是真准，专挑人心口的位置 😭";
    case "official-wild":
      return "这波官方确实把节目效果拉满了。";
    case "episode-great":
      return "这集能把人夸到这个程度，看来是真打到点上了。";
    case "episode-absurd":
      return "这展开已经离谱得相当完整了 😂";
    case "shipping-hit":
      return "这一下确实磕到了，角色间那点化学反应藏不住了 😂";
    case "fan-power":
      return "厨力拉满的时候，产出和热情都拦不住了。";
    case "character-ooc":
      return "要是连角色自己的行为逻辑都接不上，这确实不是小偏差。";
    case "abstract-overwhelm":
      return "这一下冲击力确实够大，先让情绪缓半拍。";
    default:
      return null;
  }
}

export function renderPlainSocialDialogue(
  turn: DialogueTurnContext,
): string | null {
  const pragmatics = turn.understanding.pragmatics;
  const strategy = turn.plan.socialStrategy;
  if (pragmatics.requiresSafetyHandling) return null;
  const taskResponse = mixedTaskPlain(turn);
  if (taskResponse !== null) return taskResponse;
  if (pragmatics.offenseLevel === "hostile") return "请直接指出需要纠正的具体问题，我会重新处理。";
  if (pragmatics.offenseLevel === "rude") return "刚才的回答可能没有切中问题，请指出具体错误。";
  if (pragmatics.offenseLevel === "banter") return "我可能判断错了，请指出具体问题。";
  const repeat = repeatedAcknowledgement(turn);
  if (repeat !== null) return repeat;
  switch (strategy.reactionPattern) {
    case "sarcasm-failure": return "我理解这是在反讽失败的结果。";
    case "self-deprecation": return "这次失误不等于你能力不足。";
    case "save-mishap": return "先检查自动保存、临时文件和版本历史。";
    case "teasing": return "我可能判断错了，请指出具体问题。";
    case "third-party-remark": return "你在评价第三方，具体含义需要结合上下文。";
    case "furry-heat": return "这次穿毛装的活动听起来又热又累。";
    case "furry-no-rua": return "你在开玩笑地抱怨没能摸到毛茸茸的角色。";
    case "furry-event-return": return "你刚从活动现场回来，仍然很兴奋。";
    case "furry-arrival": return "期待的毛装终于到手了。";
    case "furry-delay": return "期待的毛装延期了，这确实令人失望。";
    case "fursona-commission": return "你的兽设委托已经安排上了。";
    case "photo-return": return "活动照片终于收到了。";
    case "community-connect": return "你希望认识一些能聊得来的同好。";
    case "wallet-pressure": return "你在开玩笑地表达新周边带来的预算压力。";
    case "merch-overflow": return "周边很多，收纳已经成为问题。";
    case "budget-limit": return "这个周边超出了当前预算。";
    case "merch-trade": return "这次交换取得了进展。";
    case "merch-box": return "你明确表示这次购买了整盒周边。";
    case "collection-limit": return "你在表达暂时无法继续收周边。";
    case "budget-recovery": return "你准备通过转出周边缓解预算压力。";
    case "commission-open": return "你关注的创作者开放了委托名额。";
    case "commission-success": return "你终于获得了委托名额。";
    case "art-delivered": return "等待的作品终于交付了。";
    case "commission-delay": return "作品交付延期了，这确实令人失望。";
    case "commission-wait": return "你正在等待创作者开放委托。";
    case "character-new-look": return "原创角色有了新的造型设计。";
    case "favorite-pain": return "你在表达对虚构角色剧情的难过。";
    case "official-sugar": return "这段正向剧情发展让你很高兴。";
    case "official-knife": return "这段剧情发展让你很难受。";
    case "official-wild": return "官方内容引发了很强烈的同好反应。";
    case "episode-great": return "你很喜欢这一集。";
    case "episode-absurd": return "你觉得这一集的展开很荒诞。";
    case "shipping-hit": return "这段角色互动让你很兴奋。";
    case "fan-power": return "你在表达强烈的角色喜爱和创作热情。";
    case "character-ooc": return "你对角色塑造偏离既有设定感到失望。";
    case "abstract-overwhelm": return "这是带有夸张成分的强烈反应。";
    default: return null;
  }
}
