import type {
  CommunityComposition,
  CommunityContext,
  CommunityDomain,
  CommunityResolution,
  CommunitySense,
  CommunityTerm,
  CommunityTermMatch,
} from "@/types";
import { COMMUNITY_LEXICON, normalizeCommunityLexeme } from "./communityLexicon";

const ASCII_WORD = /[a-z0-9]/iu;
const DEFINITION_QUERY = /(?:是什么意思|啥意思|指什么|是什么(?:词|梗|意思)?)[？?。！!\s]*$/u;
const MINIMUM_MATCH_CONFIDENCE = 0.62;
const CONTEXTUAL_SELF_EVIDENCE = new Set([
  "同担拒否", "角色厨", "摄影老师", "集邮照", "彻底寄了", "笑不活了",
  "汗流浃背", "狠狠幸福", "狠狠拿捏", "场照返图", "蚌埠住了",
]);

interface MatchCandidate {
  readonly term: CommunityTerm;
  readonly alias: string;
  readonly normalizedAlias: string;
  readonly start: number;
  readonly end: number;
}

interface ScoredSense {
  readonly sense: CommunitySense;
  readonly confidence: number;
}

function isAsciiBoundary(text: string, index: number): boolean {
  return index < 0 || index >= text.length || !ASCII_WORD.test(text[index]!);
}

function hasValidBoundaries(
  text: string,
  alias: string,
  start: number,
  end: number,
): boolean {
  const first = alias[0];
  const last = alias.at(-1);
  return (
    (first === undefined || !ASCII_WORD.test(first) || isAsciiBoundary(text, start - 1)) &&
    (last === undefined || !ASCII_WORD.test(last) || isAsciiBoundary(text, end))
  );
}

function collectCandidates(input: string): readonly MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  for (const term of COMMUNITY_LEXICON) {
    for (const originalAlias of term.aliases) {
      const alias = normalizeCommunityLexeme(originalAlias);
      let searchFrom = 0;
      while (alias.length > 0) {
        const start = input.indexOf(alias, searchFrom);
        if (start < 0) break;
        const end = start + alias.length;
        searchFrom = start + 1;
        if (!hasValidBoundaries(input, alias, start, end)) continue;
        candidates.push(Object.freeze({
          term,
          alias: originalAlias,
          normalizedAlias: alias,
          start,
          end,
        }));
      }
    }
  }
  return Object.freeze(candidates);
}

function cueHits(input: string, cues: readonly string[] | undefined): number {
  if (cues === undefined) return 0;
  return cues.reduce(
    (count, cue) => count + (input.includes(normalizeCommunityLexeme(cue)) ? 1 : 0),
    0,
  );
}

function activeDomainSupport(
  term: CommunityTerm,
  context: CommunityContext | undefined,
): number {
  if (context === undefined) return 0;
  return term.domains.some((domain) => context.activeDomains.includes(domain))
    ? context.confidence * 0.16
    : 0;
}

function scoreSense(
  input: string,
  candidate: MatchCandidate,
  sense: CommunitySense,
  context: CommunityContext | undefined,
): ScoredSense {
  const positiveHits = cueHits(input, sense.positiveCues);
  const negativeHits = cueHits(input, sense.negativeCues);
  const domainSupport = activeDomainSupport(candidate.term, context);
  const selfEvidence = CONTEXTUAL_SELF_EVIDENCE.has(candidate.normalizedAlias)
    ? 0.16
    : 0;
  const contextualEvidence = positiveHits > 0 || domainSupport > 0 || selfEvidence > 0;
  const base = candidate.term.comprehension === "normal" ? 0.86 : 0.5;
  const exactInputBonus = input === candidate.normalizedAlias ? 0.04 : 0;
  const score =
    base +
    Math.min(0.24, positiveHits * 0.12) +
    domainSupport +
    selfEvidence +
    exactInputBonus -
    Math.min(0.8, negativeHits * 0.55);
  return Object.freeze({
    sense,
    confidence: Math.min(
      0.99,
      Math.max(
        0,
        candidate.term.comprehension === "context_required" && !contextualEvidence
          ? Math.min(score, 0.59)
          : score,
      ),
    ),
  });
}

function scoredMatch(
  input: string,
  candidate: MatchCandidate,
  context: CommunityContext | undefined,
): CommunityTermMatch | null {
  const best = candidate.term.senses
    .map((sense) => scoreSense(input, candidate, sense, context))
    .sort((left, right) =>
      right.confidence - left.confidence ||
      left.sense.semanticTag.localeCompare(right.sense.semanticTag),
    )[0];
  if (best === undefined || best.confidence < MINIMUM_MATCH_CONFIDENCE) return null;
  return Object.freeze({
    termId: candidate.term.id,
    canonical: candidate.term.canonical,
    matchedAlias: candidate.alias,
    domains: candidate.term.domains,
    semanticTag: best.sense.semanticTag,
    meaning: best.sense.meaning,
    confidence: best.confidence,
    start: candidate.start,
    end: candidate.end,
    generation: candidate.term.generation,
    generationWeight: candidate.term.generationWeight ?? 0,
    ...(candidate.term.cooldownGroup === undefined
      ? {}
      : { cooldownGroup: candidate.term.cooldownGroup }),
  });
}

function rangesOverlap(
  left: Pick<CommunityTermMatch, "start" | "end">,
  right: Pick<CommunityTermMatch, "start" | "end">,
): boolean {
  return left.start < right.end && right.start < left.end;
}

function selectNonOverlapping(
  matches: readonly CommunityTermMatch[],
): readonly CommunityTermMatch[] {
  const ranked = [...matches].sort(
    (left, right) =>
      right.confidence - left.confidence ||
      (right.end - right.start) - (left.end - left.start) ||
      left.start - right.start ||
      left.termId.localeCompare(right.termId),
  );
  const selected: CommunityTermMatch[] = [];
  for (const match of ranked) {
    if (!selected.some((existing) => rangesOverlap(existing, match))) {
      selected.push(match);
    }
  }
  return Object.freeze(selected.sort((left, right) => left.start - right.start));
}

function composition(
  semanticTag: string,
  matches: readonly CommunityTermMatch[],
  requiredTags: readonly string[],
): CommunityComposition | null {
  const selected = requiredTags.map((tag) =>
    matches.find((match) => match.semanticTag === tag),
  );
  if (selected.some((match) => match === undefined)) return null;
  const resolved = selected.filter((match): match is CommunityTermMatch => match !== undefined);
  return Object.freeze({
    semanticTag,
    termIds: Object.freeze([...new Set(resolved.map(({ termId }) => termId))]),
    confidence: Math.min(...resolved.map(({ confidence }) => confidence)),
  });
}

function compose(matches: readonly CommunityTermMatch[]): readonly CommunityComposition[] {
  const definitions: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["FAVORITE_MERCH_RELEASE", ["FAVORITE_CHARACTER", "NEW_MERCH_RELEASE"]],
    ["WAITING_COMMISSION_OPEN", ["COMMISSION_OPEN", "WAIT_OR_JOIN"]],
    ["FURSUIT_EVENT_PLAN", ["FURSUIT_ACTIVITY", "FURRY_CONVENTION"]],
    ["FURRY_TOUCH_AFFECTION", ["AFFECTIONATE_TOUCH", "FURRY_MEMBER_OR_CHARACTER"]],
    ["CREATOR_COMMISSION", ["COMMUNITY_HONORIFIC", "COMMISSION_OPEN"]],
    ["COSPLAY_PHOTO_DELIVERY", ["COSPLAY_PHOTOGRAPHER", "IMAGE_DELIVERY"]],
  ];
  return Object.freeze(
    definitions
      .map(([tag, required]) => composition(tag, matches, required))
      .filter((item): item is CommunityComposition => item !== null),
  );
}

function domainSummary(matches: readonly CommunityTermMatch[]): {
  readonly activeDomains: readonly CommunityDomain[];
  readonly primaryDomain?: CommunityDomain;
} {
  const weights = new Map<CommunityDomain, number>();
  for (const match of matches) {
    for (const domain of match.domains) {
      weights.set(domain, (weights.get(domain) ?? 0) + match.confidence);
    }
  }
  const ordered = [...weights.entries()].sort(
    ([leftDomain, left], [rightDomain, right]) =>
      right - left || leftDomain.localeCompare(rightDomain),
  );
  return Object.freeze({
    activeDomains: Object.freeze(ordered.map(([domain]) => domain)),
    ...(ordered[0] === undefined ? {} : { primaryDomain: ordered[0][0] }),
  });
}

export function resolveCommunityLanguage(
  raw: string,
  context?: CommunityContext,
): CommunityResolution {
  const input = normalizeCommunityLexeme(raw);
  if (input.length === 0) {
    return Object.freeze({
      matches: Object.freeze([]),
      compositions: Object.freeze([]),
      activeDomains: Object.freeze([]),
      confidence: 0,
      definitionRequested: false,
    });
  }
  const matches = selectNonOverlapping(
    collectCandidates(input)
      .map((candidate) => scoredMatch(input, candidate, context))
      .filter((match): match is CommunityTermMatch => match !== null),
  );
  const compositions = compose(matches);
  const domains = domainSummary(matches);
  const confidence = matches.length === 0
    ? 0
    : Math.min(
        0.99,
        Math.max(...matches.map((match) => match.confidence)) +
          Math.min(0.06, compositions.length * 0.03),
      );
  return Object.freeze({
    matches,
    compositions,
    activeDomains: domains.activeDomains,
    ...(domains.primaryDomain === undefined
      ? {}
      : { primaryDomain: domains.primaryDomain }),
    confidence,
    definitionRequested: matches.length > 0 && DEFINITION_QUERY.test(input),
  });
}
