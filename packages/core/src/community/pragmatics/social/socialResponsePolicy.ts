import type {
  ConversationMode,
  ConversationState,
  DialogueSecondaryGoal,
  PragmaticUnderstanding,
  SocialResponseStrategy,
} from "@/types";
import { canUseLightBanter } from "./banterPolicy";

export interface SocialResponsePlan {
  readonly strategy: SocialResponseStrategy;
  readonly secondaryGoals: readonly DialogueSecondaryGoal[];
}

function unusedConcept(
  concept: string | undefined,
  recent: readonly string[] | undefined,
): string | undefined {
  return concept !== undefined && !(recent ?? []).includes(concept)
    ? concept
    : undefined;
}

function jokeConceptFor(
  reactionPattern: string | undefined,
  sarcasmConfidence: number,
  allowBanter: boolean,
): string | undefined {
  if (sarcasmConfidence >= 0.7) return "situational-irony";
  if (allowBanter) return "behavior-banter";
  if (reactionPattern === undefined) return undefined;
  if (/^(?:wallet|budget|merch|collection)/u.test(reactionPattern)) {
    return "spending-pressure";
  }
  if (/^(?:commission|art|character-new-look)/u.test(reactionPattern)) {
    return "creative-wait";
  }
  if (/^(?:official|episode|favorite|shipping|fan-power|character-ooc)/u.test(reactionPattern)) {
    return "fandom-reaction";
  }
  if (/^(?:furry|fursona|photo|community-connect)/u.test(reactionPattern)) {
    return "community-moment";
  }
  return reactionPattern;
}

export function planSocialResponse(
  pragmatics: PragmaticUnderstanding,
  mode: ConversationMode,
  state?: ConversationState,
): SocialResponsePlan {
  const safetyYield = pragmatics.requiresSafetyHandling;
  const technical = mode === "technical";
  const deescalate =
    pragmatics.offenseLevel === "rude" ||
    pragmatics.offenseLevel === "hostile";
  const allowBanter = !technical && canUseLightBanter(pragmatics, state);
  const joinJoke =
    !safetyYield &&
    !technical &&
    !deescalate &&
    (pragmatics.humorConfidence >= 0.7 ||
      pragmatics.sarcasmConfidence >= 0.7 ||
      pragmatics.communicativeGoal === "joke" ||
      allowBanter);
  const candidatePattern = safetyYield ? undefined : pragmatics.reactionPattern;
  const reactionPattern = unusedConcept(
    candidatePattern,
    state?.recentReactionPatterns,
  );
  const jokeConcept = unusedConcept(
    joinJoke
      ? jokeConceptFor(
          candidatePattern,
          pragmatics.sarcasmConfidence,
          allowBanter,
        )
      : undefined,
    state?.recentJokeConcepts,
  );
  const acknowledgeEmotion =
    pragmatics.impliedEmotion.length > 0 ||
    pragmatics.communicativeGoal === "vent" ||
    pragmatics.communicativeGoal === "complain";
  const preserveAmbiguity = pragmatics.implications.some(
    ({ safeToReflect }) => !safeToReflect,
  );
  const secondaryGoals: DialogueSecondaryGoal[] = [];
  if (acknowledgeEmotion) secondaryGoals.push("acknowledge_frustration");
  if (joinJoke) secondaryGoals.push("join_joke");
  if (deescalate) secondaryGoals.push("deescalate");
  if (preserveAmbiguity) secondaryGoals.push("preserve_ambiguity");

  return Object.freeze({
    strategy: Object.freeze({
      mirrorTone: safetyYield || technical ? 0 : deescalate ? 0.08 : 0.55,
      joinJoke,
      allowBanter,
      acknowledgeEmotion,
      deescalate,
      answerLiterally:
        safetyYield ||
        technical ||
        pragmatics.communicativeGoal === "ask_for_help" ||
        pragmatics.communicativeGoal === "inform",
      preserveAmbiguity,
      ...(reactionPattern === undefined ? {} : { reactionPattern }),
      ...(jokeConcept === undefined ? {} : { jokeConcept }),
    }),
    secondaryGoals: Object.freeze(secondaryGoals),
  });
}
