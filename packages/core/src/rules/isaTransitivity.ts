/**
 * isA (属于 / subclass-of) transitivity — Sunland AI's first real inference
 * rule (Stage 6 — Knowledge Graph v1).
 *
 * If A 属于 B and B 属于 C, then A 属于 C — and this chains through any
 * number of hops (A 属于 B 属于 C 属于 D ⇒ A 属于 D, etc.). This is the
 * ONLY inference rule implemented at this stage, per the user's explicit
 * scope: "第一阶段只支持 isA... 不要急于支持几十种 Relation。" Every other
 * relation (会/喜欢/在/是) is still answered by direct fact lookup only —
 * this rule never looks at anything except un-negated `CoreRelations.IsA`
 * ("属于") edges.
 *
 * Design-decision flag: "isA" in the user's spec is mapped onto the
 * pre-existing `CoreRelations.IsA` ("属于"), documented since Stage 1 as
 * "Inheritance / subclass-of" — semantically exactly "isA" in the
 * knowledge-representation sense. `CoreRelations.Is` ("是") is documented as
 * "Identity / instance-of" instead (e.g. "苏格拉底 是 人") and is
 * deliberately NOT made transitive here — a judgment call, not an
 * oversight, kept consistent with the types already established before this
 * stage began.
 *
 * Deliberately excludes negated edges ("A 不属于 B" is a denial, not a
 * subclass relationship to chain through) and deliberately guards against
 * cycles (a malformed or adversarial graph like A属于B, B属于A must not hang
 * or infinite-loop) via a per-path `visited` set.
 *
 * Pure and side-effect-free per the `InferenceRule` contract: reads
 * `known: KnowledgeQuery` only, never mutates a store.
 */
import type { Inference, InferenceRule, KnowledgeQuery, KnowledgeRecord, ReasoningStep, Triple } from "@/types";
import { CoreRelations } from "@/types";
import { matchByEntity } from "@/knowledge/entityLookup";
import { entityLookupKey } from "@/parser/textNormalize";

const RULE_ID = "isa-transitivity";

interface PathState {
  readonly node: string;
  readonly path: readonly string[];
  readonly records: readonly KnowledgeRecord[];
}

interface QueryPathState {
  readonly node: string;
  readonly records: readonly KnowledgeRecord[];
}

export interface IsAQueryTraversal {
  readonly subject: string;
  /** When present, stop as soon as BFS reaches this object. */
  readonly targetObject?: string;
}

/** Build the adjacency list of un-negated 属于 edges: subject -> outgoing edges. */
function buildAdjacency(known: KnowledgeQuery): Map<string, KnowledgeRecord[]> {
  const edges = known.match({ relation: CoreRelations.IsA, negated: false });
  const adjacency = new Map<string, KnowledgeRecord[]>();
  for (const edge of edges) {
    const outgoing = adjacency.get(edge.subject) ?? [];
    outgoing.push(edge);
    adjacency.set(edge.subject, outgoing);
  }
  return adjacency;
}

/**
 * Turns a chain of edges (A属于B, B属于C, ...) into the iterative derivation
 * `ReasoningStep`s the `ReasoningStep` doc comment illustrates: each step
 * combines the conclusion accumulated so far with the next edge, e.g. for
 * 猫→动物→生物: one step, "猫 属于 动物，动物 属于 生物 ⇒ 猫 属于 生物".
 */
function buildSteps(records: readonly KnowledgeRecord[]): readonly ReasoningStep[] {
  const steps: ReasoningStep[] = [];
  let accumulated: Triple = {
    subject: records[0]!.subject,
    relation: CoreRelations.IsA,
    object: records[0]!.object,
    negated: false,
  };

  for (let i = 1; i < records.length; i += 1) {
    const edge = records[i]!;
    const conclusion: Triple = {
      subject: accumulated.subject,
      relation: CoreRelations.IsA,
      object: edge.object,
      negated: false,
    };
    steps.push({
      ruleId: RULE_ID,
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

function buildInference(records: readonly KnowledgeRecord[]): Inference {
  const subject = records[0]!.subject;
  const object = records[records.length - 1]!.object;
  const path = [subject, ...records.map((record) => record.object)];
  const confidence = records.reduce((product, record) => product * record.confidence, 1);

  return {
    conclusion: { subject, relation: CoreRelations.IsA, object, negated: false },
    confidence,
    steps: buildSteps(records),
    path,
  };
}

/**
 * Traverse only the is-a subgraph reachable from one query subject.
 *
 * Unlike `isaTransitivityRule.apply()`, this does not materialize closure for
 * unrelated subjects. `KnowledgeQuery.match()` is deliberately called with
 * both subject and relation so the store's existing indexes can constrain
 * every expansion. BFS retains the existing shortest, deterministic Evidence
 * path and its per-query visited set provides cycle detection.
 */
export function traverseIsAForQuery(
  known: KnowledgeQuery,
  query: IsAQueryTraversal,
): readonly Inference[] {
  // `visited` uses the whitespace-insensitive ENTITY identity, not the literal
  // string, and neighbour lookup uses `matchByEntity` (exact first, then the
  // lookup key). Both are the same identity the store uses for direct answers.
  //
  // Before this, the first hop matched through the lookup key but every later
  // hop used a literal `match`, so a chain broke as soon as an entity's stored
  // spelling differed from the query's spacing:
  //   Alice Chen 属于 Furry Club ; Furry Club 属于 Community
  //   "AliceChen 属于什么" -> only ["Furry Club"], the second hop was lost.
  //
  // One entry per reachable ancestor, keeping the SHORTEST chain and breaking
  // equal-length ties on the chain's canonical text. Standard BFS "first arrival
  // wins" was insertion-order dependent, so in a diamond
  // (A->B->D, A->C->D) the reported derivation path -- and therefore the
  // explanation the user reads -- changed when the same facts were restored in a
  // different order.
  const best = new Map<string, QueryPathState>();
  let queue: QueryPathState[] = [{ node: query.subject, records: [] }];
  const chainKey = (state: QueryPathState): string =>
    state.records.map((record) => `${record.subject}\u0000${record.object}`).join("\u0001");
  // No artificial depth ceiling: the established contract for is-a is the
  // full transitive closure (verified against a 100-edge chain), and answer
  // volume is inherently bounded by the reachable subgraph, which
  // `entityLookupKey` visitation keeps acyclic. Capability propagation is
  // where a hard budget belongs, because there the branching factor is
  // facts-per-ancestor rather than graph shape.
  while (queue.length > 0) {
    const next: QueryPathState[] = [];
    // Stop expanding once the asked-for target has been REACHED at this depth.
    // A query looking for one object must not walk a 100-link chain to the end,
    // and the answer is already determined: the best path to the target was
    // recorded while this level was queued. Earlier levels are unaffected, and
    // levels are processed in order, so the chosen path is still the shortest.
    if (query.targetObject !== undefined) {
      const wanted = entityLookupKey(query.targetObject);
      if (best.has(wanted)) break;
    }
    for (const current of queue) {
      const outgoing = matchByEntity(known, {
        subject: current.node,
        relation: CoreRelations.IsA,
        negated: false,
      });
      for (const edge of outgoing) {
        const objectKey = entityLookupKey(edge.object);
        if (objectKey === entityLookupKey(query.subject)) continue; // cycle back to the start
        const records = [...current.records, edge];
        const existing = best.get(objectKey);
        if (
          existing !== undefined &&
          (existing.records.length < records.length ||
            (existing.records.length === records.length &&
              chainKey(existing) <= chainKey({ node: edge.object, records })))
        ) {
          continue;
        }
        const path: QueryPathState = { node: edge.object, records };
        best.set(objectKey, path);
        next.push(path);
      }
    }
    queue = next;
  }

  const ordered = [...best.values()].sort(
    (left, right) =>
      left.records.length - right.records.length ||
      chainKey(left).localeCompare(chainKey(right), "und"),
  );

  if (query.targetObject !== undefined) {
    const wanted = entityLookupKey(query.targetObject);
    const match = ordered.find((state) => entityLookupKey(state.node) === wanted);
    if (match === undefined || match.records.length < 2) return [];
    return [buildInference(match.records)];
  }

  // A single direct edge is already returned by direct lookup.
  return ordered
    .filter((state) => state.records.length >= 2)
    .map((state) => buildInference(state.records));
}

export const isaTransitivityRule: InferenceRule = {
  id: RULE_ID,
  name: "isA transitivity",
  description: "若 A 属于 B 且 B 属于 C，则推出 A 属于 C（可多级传递）。",

  apply(known: KnowledgeQuery): readonly Inference[] {
    const adjacency = buildAdjacency(known);
    const inferences: Inference[] = [];

    for (const startSubject of adjacency.keys()) {
      const visited = new Set<string>([startSubject]);
      const queue: PathState[] = [{ node: startSubject, path: [startSubject], records: [] }];

      while (queue.length > 0) {
        const current = queue.shift()!;
        const outgoing = adjacency.get(current.node) ?? [];

        for (const edge of outgoing) {
          if (visited.has(edge.object)) continue; // guard against cycles
          visited.add(edge.object);
          const records = [...current.records, edge];
          queue.push({ node: edge.object, path: [...current.path, edge.object], records });

          // A single direct edge is already a known fact, not a derivation --
          // only emit once transitivity has actually chained through >=2 hops.
          if (records.length >= 2) {
            inferences.push(buildInference(records));
          }
        }
      }
    }

    return inferences;
  },
};
