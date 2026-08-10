import type { CommunitySense, CommunityTerm } from "@/types";

function freezeSense(sense: CommunitySense): CommunitySense {
  return Object.freeze({
    ...sense,
    ...(sense.positiveCues === undefined
      ? {}
      : { positiveCues: Object.freeze([...sense.positiveCues]) }),
    ...(sense.negativeCues === undefined
      ? {}
      : { negativeCues: Object.freeze([...sense.negativeCues]) }),
    ...(sense.examples === undefined
      ? {}
      : { examples: Object.freeze([...sense.examples]) }),
  });
}

export function defineCommunityTerms(
  terms: readonly CommunityTerm[],
): readonly CommunityTerm[] {
  return Object.freeze(
    terms.map((term) =>
      Object.freeze({
        ...term,
        aliases: Object.freeze([...term.aliases]),
        domains: Object.freeze([...term.domains]),
        senses: Object.freeze(term.senses.map(freezeSense)),
        ...(term.notes === undefined
          ? {}
          : { notes: Object.freeze([...term.notes]) }),
      }),
    ),
  );
}
