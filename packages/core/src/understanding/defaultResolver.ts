import type {
  ConversationState,
  Parser,
  TurnUnderstanding,
} from "@/types";
import { defaultConversationAnalyzer } from "@/dialogue/conversationAnalyzer";
import { createParser } from "@/parser";
import { analyzeSemanticInput } from "@/semantic";
import {
  createTurnCandidatePool,
  resolveTurnUnderstanding,
} from "./candidateResolver";
import { applyUnifiedEventsToTopicContinuity } from "@/dialogue/topicTracker";

/** Standard composition entry for tests and non-Engine Core consumers. */
export function resolveDefaultTurnUnderstanding(
  input: string,
  context?: ConversationState,
  parser: Parser = createParser(),
): TurnUnderstanding {
  const conversation = defaultConversationAnalyzer.analyze(input, context);
  const parserResult = parser.parse(input);
  const semanticAnalysis = analyzeSemanticInput(
    input,
    undefined,
    conversation.community,
  );
  const understanding = resolveTurnUnderstanding(createTurnCandidatePool({
    rawInput: input,
    parserResult,
    semanticAnalysis,
    conversation,
  }));
  const topicContinuity = applyUnifiedEventsToTopicContinuity(
    understanding.topicContinuity,
    understanding.events,
  );
  return topicContinuity === understanding.topicContinuity
    ? understanding
    : Object.freeze({
        ...understanding,
        topicContinuity,
        topicRelation: Object.freeze({
          ...understanding.topicRelation,
          relation: topicContinuity.transition,
          ...(topicContinuity.activeTopic === undefined
            ? {}
            : { topicId: topicContinuity.activeTopic.id }),
        }),
      });
}
