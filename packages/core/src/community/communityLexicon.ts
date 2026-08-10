import type { CommunityTerm } from "@/types";
import { ACG_COMMUNITY_TERMS } from "./dictionaries/acg";
import { ART_COMMUNITY_TERMS } from "./dictionaries/art";
import { COSPLAY_COMMUNITY_TERMS } from "./dictionaries/cosplay";
import { FURRY_COMMUNITY_TERMS } from "./dictionaries/furry";
import { GOODS_COMMUNITY_TERMS } from "./dictionaries/goods";
import { INTERNET_COMMUNITY_TERMS } from "./dictionaries/internet";

export const COMMUNITY_LEXICON: readonly CommunityTerm[] = Object.freeze([
  ...FURRY_COMMUNITY_TERMS,
  ...ACG_COMMUNITY_TERMS,
  ...ART_COMMUNITY_TERMS,
  ...COSPLAY_COMMUNITY_TERMS,
  ...GOODS_COMMUNITY_TERMS,
  ...INTERNET_COMMUNITY_TERMS,
]);

const TERM_BY_ID = new Map(COMMUNITY_LEXICON.map((term) => [term.id, term]));

if (TERM_BY_ID.size !== COMMUNITY_LEXICON.length) {
  throw new Error("Community lexicon term ids must be unique.");
}

export function findCommunityTermById(id: string): CommunityTerm | null {
  return TERM_BY_ID.get(id) ?? null;
}

export function normalizeCommunityLexeme(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("und");
}
