import type {
  ConversationMode,
  PragmaticCommunicativeGoal,
  PragmaticUnderstanding,
  SocialMetrics,
  SocialResponseStrategy,
} from "@/types";

export interface SocialEvaluationObservation {
  readonly pragmatics: PragmaticUnderstanding;
  readonly strategy: SocialResponseStrategy;
  readonly response: string;
  readonly mode: ConversationMode;
  readonly expectedGoal?: PragmaticCommunicativeGoal;
  readonly expectedSarcasm?: boolean;
  readonly expectedSafetyYield?: boolean;
}

const ASSISTANT_TONE = /当然可以|我来帮你|下面是|总结一下|还有其他问题/u;
const BANTER_STYLE = /这口锅|短路|没对上暗号|判我/u;
const COMMUNITY_SLANG = /(?:出毛|rua|吃谷|我推|发糖|发刀|破防|杀疯了)/iu;

function ratio(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

/** Lower is better for every metric; values are bounded to [0, 1]. */
export function evaluateSocialResponses(
  observations: readonly SocialEvaluationObservation[],
): SocialMetrics {
  let literalMisreads = 0;
  let sarcasmMisreads = 0;
  let overBanter = 0;
  let assistantTone = 0;
  let slangOveruse = 0;
  let contextMismatch = 0;
  for (const observation of observations) {
    if (
      observation.expectedGoal !== undefined &&
      observation.pragmatics.communicativeGoal !== observation.expectedGoal
    ) literalMisreads += 1;
    if (
      observation.expectedSarcasm !== undefined &&
      (observation.pragmatics.sarcasmConfidence >= 0.7) !== observation.expectedSarcasm
    ) sarcasmMisreads += 1;
    if (!observation.strategy.allowBanter && BANTER_STYLE.test(observation.response)) {
      overBanter += 1;
    }
    if (ASSISTANT_TONE.test(observation.response)) assistantTone += 1;
    if (
      (observation.mode === "technical" || observation.mode === "task") &&
      COMMUNITY_SLANG.test(observation.response)
    ) slangOveruse += 1;
    if (
      observation.expectedSafetyYield !== undefined &&
      observation.pragmatics.requiresSafetyHandling !== observation.expectedSafetyYield
    ) contextMismatch += 1;
    if (
      observation.pragmatics.requiresSafetyHandling &&
      (observation.strategy.joinJoke || observation.strategy.allowBanter)
    ) contextMismatch += 1;
  }
  return Object.freeze({
    literalMisreadScore: ratio(literalMisreads, observations.length),
    sarcasmMisreadScore: ratio(sarcasmMisreads, observations.length),
    overBanterScore: ratio(overBanter, observations.length),
    assistantToneScore: ratio(assistantTone, observations.length),
    slangOveruseScore: ratio(slangOveruse, observations.length),
    contextMismatchScore: ratio(contextMismatch, observations.length),
  });
}
