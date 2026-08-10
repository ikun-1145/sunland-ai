import type { PragmaticImplication } from "@/types";
import type { CommunityPragmaticMatch } from "./communityPatterns";

interface ImplicationRule {
  readonly tag: string;
  readonly confidence: number;
  readonly safeToReflect: boolean;
}

const RULES: Readonly<Record<string, readonly ImplicationRule[]>> = Object.freeze({
  "furry-out-hot": [{ tag: "physical_exhaustion_possible", confidence: 0.9, safeToReflect: true }],
  "furry-no-rua": [{ tag: "playful_social_disappointment", confidence: 0.88, safeToReflect: true }],
  "furry-con-return": [{ tag: "positive_event_afterglow", confidence: 0.86, safeToReflect: true }],
  "furry-suit-arrived": [{ tag: "anticipated_item_arrived", confidence: 0.95, safeToReflect: true }],
  "furry-suit-delay": [{ tag: "anticipated_item_delayed", confidence: 0.9, safeToReflect: true }],
  "furry-fursona-commission": [{ tag: "creative_project_anticipated", confidence: 0.88, safeToReflect: true }],
  "furry-photo-return": [{ tag: "event_memories_available", confidence: 0.87, safeToReflect: true }],
  "furry-social-wait": [{ tag: "community_connection_wanted", confidence: 0.82, safeToReflect: true }],
  "goods-favorite-release": [
    { tag: "purchase_interest_possible", confidence: 0.72, safeToReflect: false },
    { tag: "wallet_pressure_joke", confidence: 0.91, safeToReflect: true },
  ],
  "goods-repeat-release": [
    { tag: "purchase_interest_possible", confidence: 0.62, safeToReflect: false },
    { tag: "wallet_pressure_joke", confidence: 0.94, safeToReflect: true },
  ],
  "goods-too-much": [{ tag: "collection_overflow", confidence: 0.86, safeToReflect: true }],
  "goods-eat-soil": [
    { tag: "budget_pressure_joke", confidence: 0.96, safeToReflect: true },
    { tag: "actual_financial_hardship", confidence: 0.3, safeToReflect: false },
  ],
  "goods-cannot-afford": [{ tag: "budget_limit_stated", confidence: 0.88, safeToReflect: true }],
  "goods-trade": [{ tag: "collection_goal_progress", confidence: 0.82, safeToReflect: true }],
  "goods-box-buy": [{ tag: "full_box_purchase_stated", confidence: 0.9, safeToReflect: true }],
  "goods-cannot-collect": [{ tag: "collection_limit", confidence: 0.87, safeToReflect: true }],
  "goods-recover-budget": [{ tag: "budget_recovery_intent", confidence: 0.9, safeToReflect: true }],
  "art-commission-open": [
    { tag: "commission_opportunity", confidence: 0.92, safeToReflect: true },
    { tag: "intent_to_commission_possible", confidence: 0.66, safeToReflect: false },
  ],
  "art-commission-finally": [{ tag: "commission_slot_secured", confidence: 0.91, safeToReflect: true }],
  "art-delivered": [{ tag: "creative_result_received", confidence: 0.93, safeToReflect: true }],
  "art-delayed": [{ tag: "creative_delivery_delayed", confidence: 0.88, safeToReflect: true }],
  "art-wait-open": [{ tag: "commission_interest_possible", confidence: 0.8, safeToReflect: false }],
  "art-character-new-look": [{ tag: "character_design_update", confidence: 0.89, safeToReflect: true }],
  "acg-favorite-failed": [{ tag: "fictional_character_loss", confidence: 0.95, safeToReflect: true }],
  "acg-official-sugar": [{ tag: "positive_story_development", confidence: 0.94, safeToReflect: true }],
  "acg-official-knife": [{ tag: "painful_story_development", confidence: 0.94, safeToReflect: true }],
  "acg-official-wild": [{ tag: "intense_fandom_reaction", confidence: 0.83, safeToReflect: true }],
  "acg-episode-great": [{ tag: "episode_enjoyment", confidence: 0.89, safeToReflect: true }],
  "acg-episode-absurd": [{ tag: "amused_episode_disbelief", confidence: 0.88, safeToReflect: true }],
  "acg-shipping-hit": [{ tag: "shipping_excitement", confidence: 0.93, safeToReflect: true }],
  "acg-fan-power": [{ tag: "fandom_enthusiasm", confidence: 0.88, safeToReflect: true }],
  "acg-ooc": [{ tag: "characterization_disappointment", confidence: 0.9, safeToReflect: true }],
});

export function resolvePragmaticImplications(
  matches: readonly CommunityPragmaticMatch[],
): readonly PragmaticImplication[] {
  const strongest = new Map<string, PragmaticImplication>();
  for (const match of matches) {
    for (const rule of RULES[match.pattern.id] ?? []) {
      const implication = Object.freeze({
        tag: rule.tag,
        confidence: Math.min(rule.confidence, match.confidence),
        safeToReflect: rule.safeToReflect,
      });
      const previous = strongest.get(rule.tag);
      if (previous === undefined || implication.confidence > previous.confidence) {
        strongest.set(rule.tag, implication);
      }
    }
  }
  return Object.freeze(
    [...strongest.values()].sort((left, right) =>
      right.confidence - left.confidence || left.tag.localeCompare(right.tag),
    ),
  );
}
