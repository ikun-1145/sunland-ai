import type { ConversationState, OffenseLevel, TeasingContext } from "@/types";
import {
  hasPlayfulMarker,
  INSULT,
  SELF_DEPRECATION,
  STRONG_ATTACK,
  THREAT,
  USER_TO_FROST,
} from "./socialSignals";

export function resolveOffense(
  input: string,
  teasing: TeasingContext | undefined,
  state?: ConversationState,
): OffenseLevel {
  if (THREAT.test(input)) return "hostile";
  if (!INSULT.test(input)) return "none";
  if (SELF_DEPRECATION.test(input) && !USER_TO_FROST.test(input)) return "none";
  if (teasing?.direction !== "user_to_frost") return "none";
  if (
    teasing?.direction === "user_to_frost" &&
    teasing.severity === "light" &&
    hasPlayfulMarker(input)
  ) {
    return "banter";
  }
  if (STRONG_ATTACK.test(input) || (state?.recentHostileTurns ?? 0) >= 2) {
    return "hostile";
  }
  return "rude";
}
