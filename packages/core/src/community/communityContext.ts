import type {
  CommunityContext,
  CommunityDomain,
  CommunityResolution,
  CommunityVocabularyStyle,
} from "@/types";
import { findCommunityTermById } from "./communityLexicon";

export const COMMUNITY_CONTEXT_LIMITS = Object.freeze({
  maximumDomains: 3,
  maximumRecentTerms: 10,
  defaultMirroringLevel: 0.25,
  maximumMirroringLevel: 0.7,
});

const COMMUNITY_DOMAINS: ReadonlySet<CommunityDomain> = new Set([
  "furry", "acg", "art", "cosplay", "goods", "internet",
]);
const VOCABULARY_STYLES: ReadonlySet<CommunityVocabularyStyle> = new Set([
  "standard", "mixed", "community_heavy",
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function boundedRatio(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

export function createEmptyCommunityContext(): CommunityContext {
  return Object.freeze({
    activeDomains: Object.freeze([]),
    confidence: 0,
    recentlyDetectedTerms: Object.freeze([]),
    userVocabularyStyle: "standard",
    slangMirroringLevel: COMMUNITY_CONTEXT_LIMITS.defaultMirroringLevel,
  });
}

export function normalizeCommunityContext(value: unknown): CommunityContext {
  if (!isRecord(value)) return createEmptyCommunityContext();
  const activeDomains = Object.freeze(
    (Array.isArray(value.activeDomains) ? value.activeDomains : [])
      .filter((domain): domain is CommunityDomain =>
        typeof domain === "string" && COMMUNITY_DOMAINS.has(domain as CommunityDomain),
      )
      .filter((domain, index, domains) => domains.indexOf(domain) === index)
      .slice(0, COMMUNITY_CONTEXT_LIMITS.maximumDomains),
  );
  const recentlyDetectedTerms = Object.freeze(
    (Array.isArray(value.recentlyDetectedTerms) ? value.recentlyDetectedTerms : [])
      .filter((id): id is string =>
        typeof id === "string" && findCommunityTermById(id) !== null,
      )
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .slice(-COMMUNITY_CONTEXT_LIMITS.maximumRecentTerms),
  );
  const userVocabularyStyle =
    typeof value.userVocabularyStyle === "string" &&
    VOCABULARY_STYLES.has(value.userVocabularyStyle as CommunityVocabularyStyle)
      ? value.userVocabularyStyle as CommunityVocabularyStyle
      : "standard";
  return Object.freeze({
    activeDomains,
    confidence: boundedRatio(value.confidence, 0),
    recentlyDetectedTerms,
    userVocabularyStyle,
    slangMirroringLevel: Math.min(
      COMMUNITY_CONTEXT_LIMITS.maximumMirroringLevel,
      boundedRatio(
        value.slangMirroringLevel,
        COMMUNITY_CONTEXT_LIMITS.defaultMirroringLevel,
      ),
    ),
  });
}

function nextVocabularyStyle(
  previous: CommunityContext,
  detectedCount: number,
  nextConfidence: number,
): CommunityVocabularyStyle {
  if (detectedCount >= 3 || (
    detectedCount >= 2 && previous.userVocabularyStyle !== "standard"
  )) {
    return "community_heavy";
  }
  if (detectedCount > 0 || nextConfidence >= 0.3) return "mixed";
  return "standard";
}

export function advanceCommunityContext(
  current: CommunityContext | undefined,
  resolution: CommunityResolution,
): CommunityContext {
  const previous = normalizeCommunityContext(current);
  const detectedIds = resolution.matches.map(({ termId }) => termId);
  if (detectedIds.length === 0) {
    const confidence = previous.confidence * 0.68;
    return Object.freeze({
      activeDomains: confidence >= 0.25
        ? previous.activeDomains
        : Object.freeze([]),
      confidence,
      recentlyDetectedTerms: Object.freeze(
        previous.recentlyDetectedTerms.slice(1),
      ),
      userVocabularyStyle: nextVocabularyStyle(previous, 0, confidence),
      slangMirroringLevel: Math.max(
        COMMUNITY_CONTEXT_LIMITS.defaultMirroringLevel,
        previous.slangMirroringLevel - 0.06,
      ),
    });
  }

  const activeDomains = Object.freeze(
    [...resolution.activeDomains, ...previous.activeDomains]
      .filter((domain, index, domains) => domains.indexOf(domain) === index)
      .slice(0, COMMUNITY_CONTEXT_LIMITS.maximumDomains),
  );
  const recentlyDetectedTerms = Object.freeze(
    [...previous.recentlyDetectedTerms, ...detectedIds]
      .filter((id, index, ids) => ids.lastIndexOf(id) === index)
      .slice(-COMMUNITY_CONTEXT_LIMITS.maximumRecentTerms),
  );
  const confidence = Math.min(
    0.98,
    Math.max(resolution.confidence, previous.confidence * 0.72) + 0.03,
  );
  const mirroringIncrease = detectedIds.length >= 3 ? 0.1 : detectedIds.length >= 2 ? 0.07 : 0.04;
  return Object.freeze({
    activeDomains,
    confidence,
    recentlyDetectedTerms,
    userVocabularyStyle: nextVocabularyStyle(previous, detectedIds.length, confidence),
    slangMirroringLevel: Math.min(
      COMMUNITY_CONTEXT_LIMITS.maximumMirroringLevel,
      previous.slangMirroringLevel + mirroringIncrease,
    ),
  });
}
