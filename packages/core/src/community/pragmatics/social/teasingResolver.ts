import type { ConversationState, TeasingContext } from "@/types";
import {
  hasPlayfulMarker,
  INSULT,
  SELF_DEPRECATION,
  STRONG_ATTACK,
  USER_TO_FROST,
} from "./socialSignals";

export function resolveTeasing(
  input: string,
  state?: ConversationState,
): TeasingContext | undefined {
  if (!INSULT.test(input)) return undefined;
  if (SELF_DEPRECATION.test(input) && !USER_TO_FROST.test(input)) {
    return undefined;
  }
  const playful = hasPlayfulMarker(input);
  const direction = USER_TO_FROST.test(input)
    ? "user_to_frost"
    : "third_party";
  const severity = STRONG_ATTACK.test(input)
    ? "strong"
    : playful
      ? "light"
      : "medium";
  const relationshipSafe =
    direction === "user_to_frost" &&
    playful &&
    severity === "light" &&
    (state?.relationship.teasingPermission ?? 0) >= 0.12;
  return Object.freeze({
    confidence: playful ? 0.91 : 0.76,
    direction,
    severity,
    relationshipSafe,
  });
}
