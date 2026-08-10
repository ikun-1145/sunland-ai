import { assistantOpeningKey } from "@/personality/variation";

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
