/**
 * Bounded capability propagation (B.4).
 *
 * A capability asserted of a CLASS holds for its members:
 *
 *   鸟 会 飞      +  企鹅 属于 鸟   ⇒   企鹅 会 飞
 *   鸟 有 翅膀    +  企鹅 属于 鸟   ⇒   企鹅 有 翅膀
 *
 * What this deliberately is NOT:
 *
 *   - NOT a general rule engine, and NOT open-ended inheritance. Only the
 *     relations in `CAPABILITY_PROPAGATION_RELATIONS` propagate, and only along
 *     属于. Everything else is refused, however it is spelled.
 *   - NOT "whatever parses can be inherited". `喜欢` is a preference and `在` is
 *     a location: a feature of a class does not hold for every member, so
 *     inheriting them would manufacture facts ("哺乳动物喜欢水" does NOT entail
 *     "猫喜欢水"). A relation joins the whitelist only when it means "every
 *     member necessarily has this".
 *   - NOT bidirectional. Propagation flows class -> member only. A member's
 *     exception never contaminates its class or its siblings (see the
 *     direction tests).
 *   - NOT persistent. Nothing is written to the knowledge store, nothing is
 *     cached, and no derived fact is materialized. Every query re-derives from
 *     direct knowledge within the budget below.
 *
 * Bounds (all named, all hard):
 *
 *   MAX_PROPAGATION_DEPTH        how far up the 属于 chain to walk
 *   MAX_DERIVED_FACTS_PER_QUERY  how many derived facts one query may produce
 *   MAX_VISITED_ENTITIES         how many ancestor nodes may be visited
 *   MAX_EDGES_EXAMINED           how many is-a edges may be looked at
 *
 * The four bounds make the SEARCH SPACE constant with respect to store size.
 * They do NOT make the query cost independent of store size: every expansion
 * calls `KnowledgeStore.match`, whose cost can grow with the number of facts the
 * user has stored. Total cost is bounded by `O(edges x matchCost)`.
 */
import {
  CoreRelations,
  type Inference,
  type KnowledgeQuery,
  type KnowledgeRecord,
  type ParsedQuery,
  type ReasoningStep,
  type Relation,
  type Triple,
} from "@/types";
import { ADDITIONAL_RELATIONS } from "@/parser/relationVocabulary";
import { entityLookupKey } from "@/parser/textNormalize";
import { matchByEntity } from "./entityLookup";

/**
 * The ONLY relations that propagate along 属于. Single source of truth: the
 * reasoner, the semantic layer and any future caller all read this list, so
 * there is no second copy to drift.
 *
 * `会` (capability) and `有` (possession/attribute) qualify because both express
 * something a class guarantees for every member. Excluded on purpose:
 *   `喜欢` preference — individuals differ,
 *   `在`   location   — members can be elsewhere,
 *   `意思是` definition and `是` identity — inheriting them produces nonsense.
 */
export const CAPABILITY_PROPAGATION_RELATIONS: readonly Relation[] = Object.freeze([
  CoreRelations.Can,
  ADDITIONAL_RELATIONS.Has,
]);

export const PROPAGATION_RULE_ID = "capability-propagation";

export const PROPAGATION_BUDGET = Object.freeze({
  /** Ancestor hops to walk. Covers real taxonomies with headroom. */
  maxDepth: 4,
  /** Derived facts one query may return. */
  maxDerivedFacts: 16,
  /** Ancestor nodes visited (wide graphs with many parents). */
  maxVisitedEntities: 32,
  /** is-a edges examined (multi-parent / repeated edges). */
  maxEdgesExamined: 128,
});

/** Whether `relation` is allowed to propagate. */
export function isPropagatingRelation(relation: Relation): boolean {
  return CAPABILITY_PROPAGATION_RELATIONS.includes(relation);
}

/** One ancestor reached from the query subject, with the chain that reached it. */
interface AncestorPath {
  readonly node: string;
  /** The is-a records walked, outermost last. */
  readonly records: readonly KnowledgeRecord[];
}

/** Deterministic string form of a triple, for stable ordering. */
function tripleKey(triple: Triple): string {
  return [triple.subject, triple.relation, triple.object, triple.negated ? "1" : "0"].join("\u0000");
}

/**
 * Walk the 属于 chain upward from `subject`, breadth-first and bounded.
 *
 * Node identity uses `entityLookupKey`, the same whitespace-insensitive identity
 * the store lookup uses, so `Alice Chen 属于 Furry Club` is reachable from a
 * query for `AliceChen` AND the chain continues correctly past `Furry Club`.
 *
 * Determinism: ancestors are returned sorted by `(depth, entityLookupKey)`, so
 * the result does not depend on the order records happen to sit in the store.
 */
function collectAncestors(
  known: KnowledgeQuery,
  subject: string,
): readonly AncestorPath[] {
  const visited = new Set<string>([entityLookupKey(subject)]);
  let queue: AncestorPath[] = [{ node: subject, records: [] }];
  let edgesExamined = 0;
  let depth = 0;

  // One entry per ancestor: the SHORTEST chain that reaches it, ties broken by
  // the chain's canonical text. Keeping every path would let two paths to the
  // same ancestor produce two derivations of the same fact -- and "whichever
  // arrived first" is exactly the input-order dependence this module must not
  // have.
  const best = new Map<string, AncestorPath>();
  const chainKey = (path: AncestorPath): string =>
    path.records.map(tripleKey).join("\u0001");

  while (queue.length > 0 && depth < PROPAGATION_BUDGET.maxDepth) {
    depth += 1;
    const next: AncestorPath[] = [];
    for (const current of queue) {
      // `matchByEntity` tries the exact subject first and only then falls back
      // to the whitespace-insensitive key, matching how direct answers are
      // found. Using a bare `match` here would silently break the chain for any
      // entity whose stored spelling carries different spacing from the query.
      const outgoing = matchByEntity(known, {
        subject: current.node,
        relation: CoreRelations.IsA,
        negated: false,
      })
        .slice()
        .sort((left, right) => tripleKey(left).localeCompare(tripleKey(right), "und"));

      for (const edge of outgoing) {
        edgesExamined += 1;
        if (edgesExamined > PROPAGATION_BUDGET.maxEdgesExamined) {
          return Object.freeze([...best.values()]);
        }

        const key = entityLookupKey(edge.object);
        if (visited.has(key)) continue;
        visited.add(key);
        if (visited.size > PROPAGATION_BUDGET.maxVisitedEntities) {
          return Object.freeze([...best.values()]);
        }

        const path: AncestorPath = {
          node: edge.object,
          records: [...current.records, edge],
        };
        next.push(path);

        const existing = best.get(key);
        if (
          existing === undefined ||
          path.records.length < existing.records.length ||
          (path.records.length === existing.records.length &&
            chainKey(path).localeCompare(chainKey(existing), "und") < 0)
        ) {
          best.set(key, path);
        }
      }
    }
    queue = next;
  }

  // Sorted by chain length then canonical chain text, so every downstream
  // consumer sees the same order no matter how the store was populated.
  return Object.freeze(
    [...best.values()].sort(
      (left, right) =>
        left.records.length - right.records.length ||
        chainKey(left).localeCompare(chainKey(right), "und"),
    ),
  );
}

/** Build the is-a hops of a derivation as `ReasoningStep`s. */
function isaSteps(
  subject: string,
  records: readonly KnowledgeRecord[],
): readonly ReasoningStep[] {
  const steps: ReasoningStep[] = [];
  let accumulated: Triple = {
    subject,
    relation: CoreRelations.IsA,
    object: records[0]!.object,
    negated: false,
  };
  for (let index = 1; index < records.length; index += 1) {
    const edge = records[index]!;
    const conclusion: Triple = {
      subject,
      relation: CoreRelations.IsA,
      object: edge.object,
      negated: false,
    };
    steps.push({
      ruleId: "isa-transitivity",
      description:
        `${accumulated.subject} 属于 ${accumulated.object}，` +
        `${edge.subject} 属于 ${edge.object} ⇒ ${conclusion.subject} 属于 ${conclusion.object}`,
      premises: [accumulated, { subject: edge.subject, relation: CoreRelations.IsA, object: edge.object, negated: false }],
      conclusion,
    });
    accumulated = conclusion;
  }
  return steps;
}

/**
 * Derive the capability facts a query subject inherits from its ancestors.
 *
 * Returns `[]` immediately unless the queried relation is whitelisted, so a
 * query about `喜欢` or `在` can never pick up inherited content.
 */
export function derivedCapabilityAnswers(
  query: ParsedQuery,
  known: KnowledgeQuery,
): readonly Inference[] {
  if (!isPropagatingRelation(query.relation)) return Object.freeze([]);

  const ancestors = collectAncestors(known, query.subject);
  const inferences: Inference[] = [];
  const seen = new Set<string>();

  for (const ancestor of ancestors) {
    // Both polarities propagate symmetrically: `negated` is read straight off
    // the ancestor's fact and carried into the conclusion. It is never used to
    // rank, and never filters which facts are eligible.
    const facts = known
      .match({ subject: ancestor.node, relation: query.relation })
      .slice()
      .sort((left, right) => tripleKey(left).localeCompare(tripleKey(right), "und"));

    for (const fact of facts) {
      if (query.object !== undefined && fact.object !== query.object) continue;

      const conclusion: Triple = {
        subject: query.subject,
        relation: query.relation,
        object: fact.object,
        negated: fact.negated,
      };
      const conclusionKey = tripleKey(conclusion);
      if (seen.has(conclusionKey)) continue;
      seen.add(conclusionKey);
      if (inferences.length >= PROPAGATION_BUDGET.maxDerivedFacts) {
        return Object.freeze(inferences);
      }

      // Confidence reuses the EXISTING propagation maths: a product along the
      // supporting chain. It is never raised, so a derived fact is always at
      // most as confident as the weakest fact it rests on.
      const confidence = ancestor.records.reduce(
        (product, record) => product * record.confidence,
        fact.confidence,
      );

      const capabilityStep: ReasoningStep = {
        ruleId: PROPAGATION_RULE_ID,
        description:
          `${query.subject} 属于 ${ancestor.node}，` +
          `${ancestor.node} ${fact.negated ? "不" : ""}${query.relation} ${fact.object} ⇒ ` +
          `${query.subject} ${fact.negated ? "不" : ""}${query.relation} ${fact.object}`,
        premises: [
          {
            subject: query.subject,
            relation: CoreRelations.IsA,
            object: ancestor.node,
            negated: false,
          },
          {
            subject: ancestor.node,
            relation: query.relation,
            object: fact.object,
            negated: fact.negated,
          },
        ],
        conclusion,
      };

      inferences.push({
        conclusion,
        confidence,
        // Provenance is complete: every hop from the subject to the ancestor,
        // then the ancestor's own fact. A caller can always explain where a
        // derived capability came from.
        steps: [...isaSteps(query.subject, ancestor.records), capabilityStep],
        path: [query.subject, ...ancestor.records.map((record) => record.object), fact.object],
      });
    }
  }

  return Object.freeze(inferences);
}
