import type {
  CommunityLanguageMode,
  CommunityResolution,
  ConversationMode,
  ConversationState,
  RelationshipState,
} from "@/types";
import { stableUnitInterval } from "@/utils/deterministic";
import { COMMUNITY_LEXICON, normalizeCommunityLexeme } from "./communityLexicon";

export const COMMUNITY_LANGUAGE_COOLDOWN_TURNS = 2;

function generationEligible(
  resolution: CommunityResolution,
  relationship: RelationshipState,
): boolean {
  return resolution.matches.some((match) => {
    if (match.generation === "never" || match.generationWeight <= 0) return false;
    if (match.generation !== "familiar_only") return true;
    const term = COMMUNITY_LEXICON.find(({ id }) => id === match.termId);
    return relationship.familiarity >= (term?.familiarityThreshold ?? 0.2);
  });
}

export function planCommunityLanguage(
  resolution: CommunityResolution,
  state: ConversationState | undefined,
  conversationMode: ConversationMode,
  generationBias = 0,
): CommunityLanguageMode {
  if (resolution.matches.length === 0) return "none";
  if (
    resolution.definitionRequested ||
    conversationMode === "technical" ||
    (state?.communityLanguageCooldown ?? 0) > 0
  ) {
    return "recognize";
  }
  const relationship = state?.relationship ?? {
    familiarity: 0,
    casualness: 0,
    teasingPermission: 0,
  };
  if (!generationEligible(resolution, relationship)) return "recognize";

  const contextLevel = state?.communityContext?.slangMirroringLevel ?? 0.25;
  const strongestWeight = Math.max(
    ...resolution.matches.map(({ generation, generationWeight }) =>
      generation === "rare" ? generationWeight * 0.45 : generationWeight,
    ),
  );
  const furryBoost = resolution.activeDomains.includes("furry") ? generationBias : 0;
  const threshold = Math.min(
    0.72,
    contextLevel * (0.62 + strongestWeight) + furryBoost,
  );
  const seed = resolution.matches.map(({ termId }) => termId).join(":");
  const sample = stableUnitInterval(
    `community-mirror:${seed}:${relationship.familiarity}`,
  );
  return sample < threshold ? "mirror" : "recognize";
}

export function containsCommunityLanguage(response: string): boolean {
  const normalized = normalizeCommunityLexeme(response);
  return COMMUNITY_LEXICON.some((term) =>
    term.generation !== "never" &&
    term.aliases.some((alias) => {
      const candidate = normalizeCommunityLexeme(alias);
      return candidate.length >= 2 && normalized.includes(candidate);
    }),
  );
}
