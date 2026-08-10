import type { BanterPolicy, ConversationState, PragmaticUnderstanding } from "@/types";

export const DEFAULT_BANTER_POLICY: BanterPolicy = Object.freeze({
  enabled: true,
  familiarityThreshold: 0.2,
  maxIntensity: 0.25,
  cooldownTurns: 2,
  neverAttackIdentity: true,
  neverAttackAppearance: true,
  neverAttackIntelligence: true,
});

export function canUseLightBanter(
  pragmatics: PragmaticUnderstanding,
  state?: ConversationState,
  policy: BanterPolicy = DEFAULT_BANTER_POLICY,
): boolean {
  if (!policy.enabled || pragmatics.requiresSafetyHandling) return false;
  if ((state?.banterCooldown ?? 0) > 0) return false;
  const relationshipAllows =
    (state?.relationship.familiarity ?? 0) >= policy.familiarityThreshold &&
    (state?.relationship.teasingPermission ?? 0) >= 0.12;
  if (!relationshipAllows) return false;
  if (pragmatics.socialTone === "self_deprecating") return true;
  if (pragmatics.reactionPattern === "save-mishap") return true;
  return (
    pragmatics.offenseLevel === "banter" &&
    pragmatics.teasing?.direction === "user_to_frost"
  );
}
