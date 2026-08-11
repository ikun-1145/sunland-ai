import { assistantOpeningKey } from "@/personality/variation";
import type { InitiativeDecision, InitiativeMetrics } from "@/types";

export interface PersonalityMetrics {
  readonly assistantLikeScore: number;
  readonly repetitionScore: number;
  readonly followUpOveruseScore: number;
  readonly furryOveruseScore: number;
  readonly verbosityScore: number;
}

const ASSISTANT_FRAMING = /当然可以|没问题|我来帮你|下面是|首先|其次|总结一下|如果你愿意，我可以|还有其他问题/u;
const FURRY_EXPRESSION = /尾巴|耳朵|爪子|叼回来|🐾/u;

function ratio(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

export function evaluatePersonalityResponses(
  responses: readonly string[],
): PersonalityMetrics {
  const openings = responses.map(assistantOpeningKey);
  const repeatedAdjacentOpenings = openings.reduce(
    (count, opening, index) =>
      index > 0 && opening === openings[index - 1] ? count + 1 : count,
    0,
  );
  const assistantLikeCount = responses.filter((response) =>
    ASSISTANT_FRAMING.test(response),
  ).length;
  const followUpCount = responses.filter((response) =>
    /[？?]/u.test(response),
  ).length;
  const furryCount = responses.filter((response) =>
    FURRY_EXPRESSION.test(response),
  ).length;
  const verboseCount = responses.filter((response) => {
    const sentenceCount = response.split(/[。！？!?\n]/u).filter(Boolean).length;
    return response.length > 180 || sentenceCount > 5;
  }).length;

  return Object.freeze({
    assistantLikeScore: ratio(assistantLikeCount, responses.length),
    repetitionScore: ratio(
      repeatedAdjacentOpenings,
      Math.max(0, openings.length - 1),
    ),
    followUpOveruseScore: ratio(followUpCount, responses.length),
    furryOveruseScore: ratio(furryCount, responses.length),
    verbosityScore: ratio(verboseCount, responses.length),
  });
}

export interface InitiativeMetricTurn {
  readonly conversationId?: string;
  readonly input: string;
  readonly response: string;
  readonly initiative: InitiativeDecision;
  readonly targetTopicAge?: number;
}

const EXPLICIT_ENDING = /(?:不说了|不聊了|先这样|就这样|回头再说|先睡了|晚安)/u;
const BOREDOM_INPUT = /(?:好无聊|无聊死了|不知道干嘛|没事干|闲得慌)/u;
const SIGNIFICANT_INITIATIVE = new Set<InitiativeDecision["action"]>([
  "follow_up", "expand", "resume_topic", "offer_related_topic",
]);

export function evaluateInitiativeTurns(
  turns: readonly InitiativeMetricTurn[],
): InitiativeMetrics {
  let consecutiveQuestions = 0;
  let overQuestioning = 0;
  let initiativeCount = 0;
  let deadConversation = 0;
  let forcedResume = 0;
  let poorClosure = 0;
  let staleRevival = 0;
  let previousConversationId: string | undefined;

  for (const turn of turns) {
    if (
      turn.conversationId !== undefined &&
      turn.conversationId !== previousConversationId
    ) {
      consecutiveQuestions = 0;
      previousConversationId = turn.conversationId;
    }
    const askedQuestion = /[？?]/u.test(turn.response);
    consecutiveQuestions = askedQuestion ? consecutiveQuestions + 1 : 0;
    if (consecutiveQuestions >= 3) overQuestioning += 1;
    if (SIGNIFICANT_INITIATIVE.has(turn.initiative.action)) initiativeCount += 1;
    if (BOREDOM_INPUT.test(turn.input) && turn.initiative.action === "none") {
      deadConversation += 1;
    }
    if (turn.initiative.action === "resume_topic" && !BOREDOM_INPUT.test(turn.input)) {
      forcedResume += 1;
    }
    if (EXPLICIT_ENDING.test(turn.input) && askedQuestion) poorClosure += 1;
    if (turn.initiative.action === "resume_topic" && (turn.targetTopicAge ?? 0) > 12) {
      staleRevival += 1;
    }
  }

  return Object.freeze({
    overQuestioningScore: ratio(overQuestioning, turns.length),
    overInitiativeScore: ratio(initiativeCount, turns.length),
    deadConversationScore: ratio(deadConversation, turns.length),
    forcedTopicResumeScore: ratio(forcedResume, turns.length),
    poorClosureScore: ratio(poorClosure, turns.length),
    staleTopicRevivalScore: ratio(staleRevival, turns.length),
  });
}
