import type {
  CommunityResolution,
  ConversationState,
  PragmaticCommunicativeGoal,
  PragmaticUnderstanding,
  SocialTone,
} from "@/types";
import { matchCommunityPragmaticPatterns } from "./communityPatterns";
import { resolvePragmaticImplications } from "./implicationRules";
import { resolveOffense } from "./social/offenseResolver";
import { resolveSarcasm } from "./social/sarcasmResolver";
import {
  ABSTRACT_INTERNET_EXPRESSION,
  hasPlayfulMarker,
  LAUGHTER_CUE,
  SAVE_MISHAP,
  SELF_DEPRECATION,
  TASK_CUE,
} from "./social/socialSignals";
import { resolveSocialTone } from "./social/socialToneResolver";
import { resolveTeasing } from "./social/teasingResolver";

const QUESTION_SPEECH_ACT = /(?:为什么|怎么|如何|怎么办|是不是|能否|吗|呢|[?？])/u;
const GENERIC_VENT = /(?:烦|破防|崩|炸了|抽风|麻了|裂开|失败|报错|不行|翻车|寄了|鸽了|延期)/u;

function goalOf(
  input: string,
  patternGoal: PragmaticCommunicativeGoal | undefined,
  sarcasmConfidence: number,
  teasingConfidence: number,
): PragmaticCommunicativeGoal {
  // Mixed emotional + task turns must retain the actionable request.
  if (TASK_CUE.test(input)) return "ask_for_help";
  if (sarcasmConfidence >= 0.7) return "sarcasm";
  if (teasingConfidence >= 0.7) return "tease";
  if (patternGoal !== undefined) return patternGoal;
  if (SELF_DEPRECATION.test(input)) return "vent";
  if (SAVE_MISHAP.test(input)) return "vent";
  if (hasPlayfulMarker(input)) return "joke";
  if (QUESTION_SPEECH_ACT.test(input)) return "seek_opinion";
  if (GENERIC_VENT.test(input)) return "vent";
  return input.length > 0 ? "inform" : "unknown";
}

function toneOf(
  offense: PragmaticUnderstanding["offenseLevel"],
  sarcasmConfidence: number,
  teasingConfidence: number,
  patternTone: SocialTone | undefined,
  generalTone: SocialTone,
): SocialTone {
  if (offense === "hostile" || offense === "rude") return "hostile";
  if (generalTone === "self_deprecating") return "self_deprecating";
  if (sarcasmConfidence >= 0.7) return "sarcastic";
  if (teasingConfidence >= 0.7) return "teasing";
  return patternTone ?? generalTone;
}

function literalMeaningOf(
  goal: PragmaticCommunicativeGoal,
  matchedPattern: string | undefined,
): string | undefined {
  if (matchedPattern !== undefined) return `community-act:${matchedPattern}`;
  if (goal === "unknown") return undefined;
  return `speech-act:${goal}`;
}

export function resolvePragmatics(
  input: string,
  community: CommunityResolution,
  state?: ConversationState,
): PragmaticUnderstanding {
  const normalized = input.trim().replace(/\s+/gu, " ");
  const patternMatches = matchCommunityPragmaticPatterns(normalized, community);
  const strongestPattern = patternMatches[0];
  const patternImplications = resolvePragmaticImplications(patternMatches);
  const abstractWithoutCommunityPattern =
    patternMatches.length === 0 &&
    ABSTRACT_INTERNET_EXPRESSION.test(normalized) &&
    !LAUGHTER_CUE.test(normalized);
  const implications = abstractWithoutCommunityPattern
    ? Object.freeze([
        ...patternImplications,
        Object.freeze({
          tag: "figurative_overwhelm_possible",
          confidence: 0.62,
          safeToReflect: false,
        }),
      ])
    : patternImplications;
  const sarcasm = resolveSarcasm(normalized);
  const teasing = resolveTeasing(normalized, state);
  const offenseLevel = resolveOffense(normalized, teasing, state);
  const generalTone = resolveSocialTone(normalized);
  const teasingConfidence = teasing?.confidence ?? 0;
  const communicativeGoal = generalTone.requiresSafetyHandling
    ? TASK_CUE.test(normalized) ? "ask_for_help" : "vent"
    : goalOf(
        normalized,
        strongestPattern?.pattern.communicativeGoal,
        sarcasm.confidence,
        teasingConfidence,
      );
  const matchedPatterns = [
    ...patternMatches.map(({ pattern }) => pattern.id),
    ...(generalTone.requiresSafetyHandling ? ["social-safety-yield"] : []),
    ...(sarcasm.confidence >= 0.7 ? ["social-sarcasm"] : []),
    ...(teasingConfidence >= 0.7 ? ["social-teasing"] : []),
    ...(SELF_DEPRECATION.test(normalized) ? ["social-self-deprecation"] : []),
    ...(SAVE_MISHAP.test(normalized) ? ["social-behavior-mishap"] : []),
    ...(ABSTRACT_INTERNET_EXPRESSION.test(normalized)
      ? ["social-abstract-expression"]
      : []),
  ].filter((id, index, ids) => ids.indexOf(id) === index);
  const impliedEmotion = [
    ...(strongestPattern?.pattern.impliedEmotion ?? []),
    ...generalTone.impliedEmotion,
  ].filter((emotion, index, emotions) => emotions.indexOf(emotion) === index);
  const patternConfidence = strongestPattern?.confidence ?? 0;
  const confidence = normalized.length === 0
    ? 0
    : Math.max(
        0.55,
        patternConfidence,
        sarcasm.confidence,
        teasingConfidence,
        abstractWithoutCommunityPattern ? 0.72 : 0,
      );
  const literalMeaning = literalMeaningOf(
    communicativeGoal,
    strongestPattern?.pattern.id,
  );
  const reactionPattern = generalTone.requiresSafetyHandling
    ? "safety-yield"
    : SELF_DEPRECATION.test(normalized)
      ? "self-deprecation"
      : sarcasm.confidence >= 0.7
        ? "sarcasm-failure"
        : teasingConfidence >= 0.7
          ? teasing?.direction === "user_to_frost"
            ? "teasing"
            : "third-party-remark"
          : SAVE_MISHAP.test(normalized)
            ? "save-mishap"
            : strongestPattern?.pattern.reactionPattern ??
            (abstractWithoutCommunityPattern
              ? "abstract-overwhelm"
              : undefined);

  return Object.freeze({
    ...(literalMeaning === undefined
      ? {}
      : { literalMeaning }),
    implications,
    communicativeGoal,
    socialTone: toneOf(
      offenseLevel,
      sarcasm.confidence,
      teasingConfidence,
      strongestPattern?.pattern.socialTone,
      generalTone.tone,
    ),
    literalness: strongestPattern?.pattern.literalness ??
      (sarcasm.confidence >= 0.7
        ? 0.25
        : ABSTRACT_INTERNET_EXPRESSION.test(normalized)
          ? 0.5
          : generalTone.humorConfidence >= 0.7
            ? 0.45
            : 0.95),
    humorConfidence: Math.max(
      generalTone.humorConfidence,
      strongestPattern?.pattern.communicativeGoal === "joke" ? 0.9 : 0,
      offenseLevel === "banter" ? 0.85 : 0,
    ),
    sarcasmConfidence: sarcasm.confidence,
    teasingConfidence,
    impliedEmotion: Object.freeze(impliedEmotion),
    offenseLevel,
    ...(teasing === undefined ? {} : { teasing }),
    requiresSafetyHandling: generalTone.requiresSafetyHandling,
    matchedPatterns: Object.freeze(matchedPatterns),
    ...(reactionPattern === undefined ? {} : { reactionPattern }),
    confidence: Math.min(0.99, confidence),
  });
}
