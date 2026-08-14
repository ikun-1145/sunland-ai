import type { DialogueTurnContext, TopicEvent, WorkingConversationTopic } from "@/types";

function latestTurnTopic(turn: DialogueTurnContext): WorkingConversationTopic | undefined {
  return turn.state.workingMemory.topics.find(
    ({ lastMentionTurn }) => lastMentionTurn === turn.state.workingMemory.currentTurn,
  );
}

function latestEvent(topic: WorkingConversationTopic | undefined): TopicEvent | undefined {
  return topic?.events.at(-1);
}

function clarification(turn: DialogueTurnContext, plain: boolean): string | null {
  const candidates = turn.understanding.topicContinuity.clarificationCandidates;
  if (!turn.understanding.topicContinuity.needsClarification || candidates.length < 2) {
    return null;
  }
  const alternatives = candidates.length === 2
    ? `${candidates[0]}，还是${candidates[1]}`
    : `${candidates.slice(0, -1).join("、")}，还是${candidates.at(-1)}`;
  return plain
    ? `你指的是${alternatives}？`
    : `等等，你说的是${alternatives}？`;
}

export function renderFrostTopicDialogue(turn: DialogueTurnContext): string | null {
  if (turn.understanding.pragmatics.requiresSafetyHandling) return null;
  const clarificationResponse = clarification(turn, false);
  if (clarificationResponse !== null) return clarificationResponse;
  const continuity = turn.understanding.topicContinuity;
  const topic = latestTurnTopic(turn);
  const event = latestEvent(topic);

  if (continuity.transition === "paused") return "行，这个先放着，等你想继续了再接上。";
  if (continuity.transition === "abandoned") return "行，那这条先收住，不跟它继续耗了。";
  if (continuity.transition === "resolved" || event?.type === "resolved") {
    if (topic?.createdTurn === turn.state.workingMemory.currentTurn && topic.events.length === 1) {
      return null;
    }
    return "终于好了。这口气总算顺下来了。";
  }
  if (
    continuity.references.some(({ confidence }) => confidence >= 0.7) &&
    /(?:重新连接|重连)/u.test(turn.raw)
  ) {
    return "那就还是卡在重新连接这一步。这个现象可以接着往下排。";
  }
  if (event?.type === "failed") {
    return turn.understanding.conversationMode === "technical"
      ? "嗯，结果还是没好。那就沿着刚才那条排查线继续看。"
      : "啧，结果还是没好，确实磨人。";
  }
  if (event?.type === "succeeded" && /(?:终于|总算|到了|发了)/u.test(turn.raw)) {
    return "终于等到了。这下前面的等待没白熬。";
  }
  if (continuity.transition === "resumed" && topic !== undefined) {
    return `对，刚才那个${topic.label}。后来咋样了？`;
  }
  return null;
}

export function renderPlainTopicDialogue(turn: DialogueTurnContext): string | null {
  if (turn.understanding.pragmatics.requiresSafetyHandling) return null;
  const clarificationResponse = clarification(turn, true);
  if (clarificationResponse !== null) return clarificationResponse;
  const continuity = turn.understanding.topicContinuity;
  const topic = latestTurnTopic(turn);
  const event = latestEvent(topic);

  if (continuity.transition === "paused") return "这个话题先暂停。";
  if (continuity.transition === "abandoned") return "这个话题先结束。";
  if (continuity.transition === "resolved" || event?.type === "resolved") {
    if (topic?.createdTurn === turn.state.workingMemory.currentTurn && topic.events.length === 1) {
      return null;
    }
    return "问题已经解决。";
  }
  if (
    continuity.references.some(({ confidence }) => confidence >= 0.7) &&
    /(?:重新连接|重连)/u.test(turn.raw)
  ) return "当前问题仍停留在重新连接这一步。";
  if (event?.type === "failed") return "此前的处理没有解决问题，请继续提供结果。";
  if (event?.type === "succeeded") return "等待的结果已经出现。";
  if (continuity.transition === "resumed" && topic !== undefined) {
    return `继续刚才的${topic.label}。请说后续情况。`;
  }
  return null;
}
