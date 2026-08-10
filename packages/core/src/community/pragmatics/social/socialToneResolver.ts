import type { SocialTone } from "@/types";
import {
  ABSTRACT_INTERNET_EXPRESSION,
  hasPlayfulMarker,
  LAUGHTER_CUE,
  NEGATIVE_CONTEXT,
  requiresDedicatedSafetyHandling,
  SAVE_MISHAP,
  SELF_DEPRECATION,
} from "./socialSignals";

export interface SocialToneResolution {
  readonly tone: SocialTone;
  readonly humorConfidence: number;
  readonly impliedEmotion: readonly string[];
  readonly requiresSafetyHandling: boolean;
}

const EXCITED = /(?:太好了|好耶|终于|爽|绝了|封神|起飞|激动|兴奋|期待|[！!]{2,}|✨|🥳)/u;
const ANNOYED = /(?:烦|无语|崩溃|心累|破防|受不了|气死|怎么又|折腾|翻车|鸽了|延期)/u;
const FRIENDLY = /(?:谢谢|辛苦|麻烦|拜托|请问|你好|早安|晚安)/u;

export function resolveSocialTone(input: string): SocialToneResolution {
  const requiresSafetyHandling = requiresDedicatedSafetyHandling(input);
  const playful = hasPlayfulMarker(input);
  const impliedEmotion: string[] = [];
  let tone: SocialTone = "neutral";
  if (requiresSafetyHandling) {
    tone = "neutral";
    impliedEmotion.push("possible_crisis");
  } else if (SELF_DEPRECATION.test(input)) {
    tone = "self_deprecating";
    impliedEmotion.push("self_directed_frustration");
  } else if (SAVE_MISHAP.test(input)) {
    tone = "annoyed";
    impliedEmotion.push("frustration");
  } else if (ABSTRACT_INTERNET_EXPRESSION.test(input)) {
    tone = "annoyed";
    impliedEmotion.push("figurative_overwhelm");
  } else if (ANNOYED.test(input) || NEGATIVE_CONTEXT.test(input)) {
    tone = playful ? "playful" : "annoyed";
    impliedEmotion.push("frustration");
  } else if (EXCITED.test(input)) {
    tone = "excited";
    impliedEmotion.push("excitement");
  } else if (playful) {
    tone = "playful";
    impliedEmotion.push("amusement");
  } else if (FRIENDLY.test(input)) {
    tone = "friendly";
  }
  return Object.freeze({
    tone,
    humorConfidence: requiresSafetyHandling
      ? 0
      : LAUGHTER_CUE.test(input)
        ? 0.9
        : ABSTRACT_INTERNET_EXPRESSION.test(input)
          ? /(?:创死|杀疯|笑死)/u.test(input)
            ? 0.72
            : 0.55
          : playful
            ? 0.7
            : 0.08,
    impliedEmotion: Object.freeze(impliedEmotion),
    requiresSafetyHandling,
  });
}
