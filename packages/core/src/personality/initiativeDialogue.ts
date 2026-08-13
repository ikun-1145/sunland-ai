import type { DialogueTurnContext, OpenLoop, WorkingConversationTopic } from "@/types";

function targetLoop(turn: DialogueTurnContext): OpenLoop | undefined {
  const id = turn.plan.initiative.targetOpenLoopId;
  return id === undefined
    ? undefined
    : turn.state.initiative.openLoops.find((loop) => loop.id === id);
}

function targetTopic(turn: DialogueTurnContext): WorkingConversationTopic | undefined {
  const id = turn.plan.initiative.targetTopicId;
  return id === undefined
    ? undefined
    : turn.state.workingMemory.topics.find((topic) => topic.id === id);
}

function frostLoopFollowUp(loop: OpenLoop): string {
  switch (loop.summary) {
    case "考试": return "回来啦 👀 考得咋样？";
    case "面试": return "回来啦。面试那边咋样？";
    case "吃饭": return "回来啦，吃饱没？";
    case "兽展": return "回来啦 😂 兽展逛得咋样？";
    case "系统更新": return "回来了。系统更新顺利吗？";
    case "返图": return "回来啦。之前等的返图有动静没？";
    default: return "回来啦。刚才那件事进展咋样？";
  }
}

function plainLoopFollowUp(loop: OpenLoop): string {
  switch (loop.summary) {
    case "考试": return "欢迎回来。考试怎么样？";
    case "面试": return "欢迎回来。面试怎么样？";
    case "吃饭": return "欢迎回来。吃过饭了吗？";
    case "兽展": return "欢迎回来。兽展怎么样？";
    case "系统更新": return "欢迎回来。系统更新顺利吗？";
    case "返图": return "欢迎回来。之前等待的返图有结果了吗？";
    default: return "欢迎回来。刚才的事情有进展吗？";
  }
}

function frostDeparture(turn: DialogueTurnContext): string | null {
  switch (turn.understanding.initiativeSignals.plannedEvent?.summary) {
    case "考试": return "去吧，先把考试拿下。";
    case "面试": return "去吧，稳住就行。";
    case "吃饭": return "去吧去吧，别饿着。";
    case "兽展": return "去吧，好好逛一圈。";
    case "系统更新": return "行，先让它更新，别半路断电。";
    case "返图": return "行，先蹲着，别让等待把你耗住。";
    default: return null;
  }
}

function plainDeparture(turn: DialogueTurnContext): string | null {
  switch (turn.understanding.initiativeSignals.plannedEvent?.summary) {
    case "考试": return "好，先去考试。";
    case "面试": return "好，先去面试。";
    case "吃饭": return "好，先去吃饭。";
    case "兽展": return "好，先去兽展。";
    case "系统更新": return "好，先完成系统更新。";
    case "返图": return "好，先等待结果。";
    default: return null;
  }
}

export function renderFrostInitiativeDialogue(turn: DialogueTurnContext): string | null {
  if (turn.understanding.pragmatics.requiresSafetyHandling) return null;
  const signals = turn.understanding.initiativeSignals;
  if (turn.plan.initiative.action === "close_topic" && signals.explicitClose) {
    if (turn.understanding.socialInteraction === "farewell") return null;
    return frostDeparture(turn) ?? "行，那先到这儿。";
  }
  if (signals.plannedEvent !== undefined) {
    return frostDeparture(turn);
  }
  if (signals.returned) {
    const loop = targetLoop(turn);
    return loop === undefined ? "回来啦～" : frostLoopFollowUp(loop);
  }
  if (signals.boredom) {
    const topic = targetTopic(turn);
    if (turn.plan.initiative.action === "resume_topic" && topic !== undefined) {
      return `那来捞一下前面的${topic.label}——后来有动静没？`;
    }
    return turn.plan.initiative.action === "expand"
      ? "那正好，来随便扯点有的没的 👀"
      : "无聊确实难熬，先放空一会儿也行。";
  }
  if (signals.storyContinuation) {
    return turn.plan.initiative.action === "expand"
      ? "等下，还有高手——继续继续 😂"
      : "这展开确实越来越离谱了。";
  }
  return null;
}

export function renderPlainInitiativeDialogue(turn: DialogueTurnContext): string | null {
  if (turn.understanding.pragmatics.requiresSafetyHandling) return null;
  const signals = turn.understanding.initiativeSignals;
  if (turn.plan.initiative.action === "close_topic" && signals.explicitClose) {
    if (turn.understanding.socialInteraction === "farewell") return null;
    return plainDeparture(turn) ?? "好，那先到这里。";
  }
  if (signals.plannedEvent !== undefined) {
    return plainDeparture(turn);
  }
  if (signals.returned) {
    const loop = targetLoop(turn);
    return loop === undefined ? "欢迎回来。" : plainLoopFollowUp(loop);
  }
  if (signals.boredom) {
    const topic = targetTopic(turn);
    if (turn.plan.initiative.action === "resume_topic" && topic !== undefined) {
      return `可以继续之前的${topic.label}。后来有进展吗？`;
    }
    return turn.plan.initiative.action === "expand"
      ? "可以随便聊点轻松的。"
      : "可以先休息一会儿。";
  }
  if (signals.storyContinuation) {
    return turn.plan.initiative.action === "expand"
      ? "请继续说后面的事。"
      : "后面的情况似乎更复杂。";
  }
  return null;
}
