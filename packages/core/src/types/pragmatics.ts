export type PragmaticCommunicativeGoal =
  | "inform"
  | "share"
  | "vent"
  | "joke"
  | "tease"
  | "complain"
  | "celebrate"
  | "seek_validation"
  | "seek_opinion"
  | "invite_interaction"
  | "ask_for_help"
  | "sarcasm"
  | "unknown";

export type SocialTone =
  | "neutral"
  | "friendly"
  | "playful"
  | "excited"
  | "self_deprecating"
  | "teasing"
  | "sarcastic"
  | "annoyed"
  | "hostile"
  | "unknown";

export interface PragmaticImplication {
  readonly tag: string;
  readonly confidence: number;
  readonly safeToReflect: boolean;
}

export type OffenseLevel = "none" | "banter" | "rude" | "hostile";

export interface TeasingContext {
  readonly confidence: number;
  readonly direction: "user_to_frost" | "frost_to_user" | "third_party";
  readonly severity: "light" | "medium" | "strong";
  readonly relationshipSafe: boolean;
}

export interface PragmaticUnderstanding {
  readonly literalMeaning?: string;
  readonly implications: readonly PragmaticImplication[];
  readonly communicativeGoal: PragmaticCommunicativeGoal;
  readonly socialTone: SocialTone;
  readonly literalness: number;
  readonly humorConfidence: number;
  readonly sarcasmConfidence: number;
  readonly teasingConfidence: number;
  readonly impliedEmotion: readonly string[];
  readonly offenseLevel: OffenseLevel;
  readonly teasing?: TeasingContext;
  /** Social style must yield when a dedicated safety layer needs the literal input. */
  readonly requiresSafetyHandling: boolean;
  /** Privacy-safe rule ids used for explainable tests, never raw phrases. */
  readonly matchedPatterns: readonly string[];
  /** Concept-level renderer key used for cooldown; never response prose. */
  readonly reactionPattern?: string;
  readonly confidence: number;
}

export type DialogueSecondaryGoal =
  | "acknowledge_frustration"
  | "join_joke"
  | "deescalate"
  | "preserve_ambiguity";

export interface SocialResponseStrategy {
  readonly mirrorTone: number;
  readonly joinJoke: boolean;
  readonly allowBanter: boolean;
  readonly acknowledgeEmotion: boolean;
  readonly deescalate: boolean;
  readonly answerLiterally: boolean;
  readonly preserveAmbiguity: boolean;
  readonly reactionPattern?: string;
  readonly jokeConcept?: string;
}

export interface BanterPolicy {
  readonly enabled: boolean;
  readonly familiarityThreshold: number;
  readonly maxIntensity: number;
  readonly cooldownTurns: number;
  readonly neverAttackIdentity: boolean;
  readonly neverAttackAppearance: boolean;
  readonly neverAttackIntelligence: boolean;
}

export interface SocialMetrics {
  readonly literalMisreadScore: number;
  readonly sarcasmMisreadScore: number;
  readonly overBanterScore: number;
  readonly assistantToneScore: number;
  readonly slangOveruseScore: number;
  readonly contextMismatchScore: number;
}
