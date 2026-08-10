export type CommunityDomain =
  | "furry"
  | "acg"
  | "art"
  | "cosplay"
  | "goods"
  | "internet";

export type CommunityComprehension = "normal" | "context_required";

export type CommunityGeneration =
  | "never"
  | "safe"
  | "familiar_only"
  | "rare";

export interface CommunitySense {
  readonly meaning: string;
  readonly semanticTag: string;
  readonly positiveCues?: readonly string[];
  readonly negativeCues?: readonly string[];
  readonly examples?: readonly string[];
}

export interface CommunityTerm {
  readonly id: string;
  readonly canonical: string;
  readonly aliases: readonly string[];
  readonly domains: readonly CommunityDomain[];
  readonly senses: readonly CommunitySense[];
  readonly comprehension: CommunityComprehension;
  readonly generation: CommunityGeneration;
  readonly familiarityThreshold?: number;
  readonly generationWeight?: number;
  readonly cooldownGroup?: string;
  readonly notes?: readonly string[];
}

export interface CommunityTermMatch {
  readonly termId: string;
  readonly canonical: string;
  readonly matchedAlias: string;
  readonly domains: readonly CommunityDomain[];
  readonly semanticTag: string;
  readonly meaning: string;
  readonly confidence: number;
  /** UTF-16 offsets in the transient input, expressed as [start, end). */
  readonly start: number;
  readonly end: number;
  readonly generation: CommunityGeneration;
  readonly generationWeight: number;
  readonly cooldownGroup?: string;
}

export interface CommunityComposition {
  readonly semanticTag: string;
  readonly termIds: readonly string[];
  readonly confidence: number;
}

export interface CommunityResolution {
  readonly matches: readonly CommunityTermMatch[];
  readonly compositions: readonly CommunityComposition[];
  readonly activeDomains: readonly CommunityDomain[];
  readonly primaryDomain?: CommunityDomain;
  readonly confidence: number;
  readonly definitionRequested: boolean;
}

export type CommunityVocabularyStyle =
  | "standard"
  | "mixed"
  | "community_heavy";

/** Privacy-safe rolling summary. It stores term ids, never raw utterances. */
export interface CommunityContext {
  readonly activeDomains: readonly CommunityDomain[];
  readonly confidence: number;
  readonly recentlyDetectedTerms: readonly string[];
  readonly userVocabularyStyle: CommunityVocabularyStyle;
  readonly slangMirroringLevel: number;
}

export type CommunityLanguageMode = "none" | "recognize" | "mirror";
