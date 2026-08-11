import type {
  ConversationWorkingMemory,
  ResolvedReference,
  TopicEntity,
  WorkingConversationTopic,
} from "@/types";

const REFERENCE_EXPRESSION = /刚才那个|前面那个|之前那个|这个问题|那个问题|这个bug|那个bug|这破玩意|那破玩意|这玩意|那玩意|它|这个|那个/giu;
const OLD_TOPIC_REFERENCE = /(?:刚才|前面|之前)那个/u;
const PROBLEM_REFERENCE = /(?:问题|bug|这破玩意|那破玩意|这玩意|那玩意)/iu;
const GENERIC_PRONOUN = /^(?:它|这个|那个|这破玩意|那破玩意|这玩意|那玩意)$/u;

export interface ReferenceResolutionResult {
  readonly references: readonly ResolvedReference[];
  readonly ambiguousTopics: readonly WorkingConversationTopic[];
}

function liveTopics(
  memory: ConversationWorkingMemory,
): readonly WorkingConversationTopic[] {
  return Object.freeze(
    memory.topics
      .filter(({ status, relevance, lastMentionTurn }) =>
        status !== "resolved" &&
        status !== "abandoned" &&
        relevance >= 0.28 &&
        memory.currentTurn - lastMentionTurn <= 12,
      )
      .sort((left, right) =>
        right.lastMentionTurn - left.lastMentionTurn ||
        right.relevance - left.relevance,
      ),
  );
}

function isProblemTopic(topic: WorkingConversationTopic): boolean {
  return topic.entities.some(({ type }) => type === "problem") ||
    /(?:问题|bug|报错|连接|登录|崩|炸)/iu.test(topic.label);
}

function referenceEntity(topic: WorkingConversationTopic): TopicEntity | undefined {
  const reversed = [...topic.entities].reverse();
  return reversed.find(({ type }) => type === "software" || type === "project") ??
    reversed.find(({ type }) => type !== "problem") ??
    topic.entities.at(-1);
}

function possibleAmbiguity(
  text: string,
  memory: ConversationWorkingMemory,
  explicitEntities: readonly TopicEntity[],
): readonly WorkingConversationTopic[] {
  if (!GENERIC_PRONOUN.test(text) || explicitEntities.length > 0) return [];
  const recentProblems = liveTopics(memory).filter((topic) =>
    isProblemTopic(topic) &&
    memory.currentTurn - topic.lastMentionTurn <= 3 &&
    topic.relevance >= 0.4,
  );
  if (recentProblems.length < 2) return [];
  const [first, second] = recentProblems;
  if (
    first === undefined ||
    second === undefined ||
    first.label === second.label ||
    first.lastMentionTurn - second.lastMentionTurn > 1
  ) return [];
  return Object.freeze(recentProblems.slice(0, 3));
}

function targetTopic(
  text: string,
  memory: ConversationWorkingMemory,
): WorkingConversationTopic | undefined {
  const topics = liveTopics(memory);
  const active = memory.activeTopicId === undefined
    ? undefined
    : memory.topics.find(({ id }) => id === memory.activeTopicId);
  if (OLD_TOPIC_REFERENCE.test(text)) {
    const inactive = topics.find((topic) =>
      topic.id !== active?.id && (!PROBLEM_REFERENCE.test(text) || isProblemTopic(topic)),
    );
    return inactive ?? active;
  }
  if (PROBLEM_REFERENCE.test(text)) {
    return [active, ...topics].find(
      (topic): topic is WorkingConversationTopic =>
        topic !== undefined && isProblemTopic(topic),
    );
  }
  return active ?? topics[0];
}

export function resolveTopicReferences(
  input: string,
  memory: ConversationWorkingMemory,
  explicitEntities: readonly TopicEntity[],
): ReferenceResolutionResult {
  const texts = [...input.matchAll(REFERENCE_EXPRESSION)]
    .map(([text]) => text)
    .filter((text, index, values) => values.indexOf(text) === index)
    .slice(0, 4);
  const references: ResolvedReference[] = [];
  let ambiguousTopics: readonly WorkingConversationTopic[] = [];

  for (const text of texts) {
    const ambiguity = possibleAmbiguity(text, memory, explicitEntities);
    if (ambiguity.length > 1) {
      ambiguousTopics = ambiguity;
      references.push(Object.freeze({
        text,
        targetType: "unknown",
        confidence: 0.35,
      }));
      continue;
    }
    const topic = targetTopic(text, memory);
    if (topic === undefined) {
      references.push(Object.freeze({
        text,
        targetType: "unknown",
        confidence: 0.2,
      }));
      continue;
    }
    const entity = GENERIC_PRONOUN.test(text) ? referenceEntity(topic) : undefined;
    references.push(Object.freeze({
      text,
      targetType: entity === undefined ? "topic" : "entity",
      targetId: entity?.id ?? topic.id,
      confidence: OLD_TOPIC_REFERENCE.test(text) ? 0.9 : entity === undefined ? 0.82 : 0.78,
    }));
  }

  return Object.freeze({
    references: Object.freeze(references),
    ambiguousTopics,
  });
}
