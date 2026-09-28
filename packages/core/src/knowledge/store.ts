/**
 * In-memory `KnowledgeStore` implementation.
 *
 * Indexing strategy: alongside the primary `Map<Id, KnowledgeRecord>`, three
 * secondary indexes (by subject / relation / object) map each field value to
 * the set of record ids sharing it. `match()` intersects only the indexes
 * implied by the fields actually present in the pattern (wildcards are
 * skipped), then does a final exact check (including `negated`) against the
 * candidate records -- this keeps lookups close to O(smallest matching
 * index) instead of scanning every record for every query.
 */
import type {
  AddOptions,
  Id,
  KnowledgeRecord,
  KnowledgeStore,
  Triple,
  TriplePattern,
} from "@/types";

let idCounter = 0;

/** Monotonic, collision-free id: timestamp + in-process counter, both base36. */
function generateId(): Id {
  idCounter += 1;
  return `k_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

const DEFAULT_CONFIDENCE = 1;
const DEFAULT_SOURCE: KnowledgeRecord["source"] = "user";

/**
 * Structural guard for a record arriving from outside (a persisted snapshot or a
 * legacy import). Checks only that the identifying fields are usable strings and
 * that `negated`/`confidence` are the right shape; it does not validate business
 * rules, which stay where they already live.
 */
function isKnowledgeRecordShaped(value: unknown): value is KnowledgeRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<KnowledgeRecord>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.subject === "string" &&
    typeof candidate.relation === "string" &&
    typeof candidate.object === "string" &&
    typeof candidate.negated === "boolean" &&
    typeof candidate.confidence === "number" &&
    Number.isFinite(candidate.confidence)
  );
}

/** Stable key identifying a triple's *fact identity* (ignores id/provenance). */
function tripleKey(triple: Triple): string {
  return `${triple.subject} ${triple.relation} ${triple.object} ${triple.negated}`;
}

function addToIndex(index: Map<string, Set<Id>>, key: string, id: Id): void {
  const existing = index.get(key);
  if (existing === undefined) {
    index.set(key, new Set([id]));
  } else {
    existing.add(id);
  }
}

function removeFromIndex(index: Map<string, Set<Id>>, key: string, id: Id): void {
  const existing = index.get(key);
  if (existing === undefined) return;
  existing.delete(id);
  if (existing.size === 0) index.delete(key);
}

/** Intersection of several id sets, smallest-first for efficiency. */
function intersect(sets: readonly Set<Id>[]): Set<Id> {
  const bySizeAsc = [...sets].sort((a, b) => a.size - b.size);
  const [smallest, ...rest] = bySizeAsc;
  if (smallest === undefined) return new Set();
  let result = smallest;
  for (const set of rest) {
    const next = new Set<Id>();
    for (const id of result) {
      if (set.has(id)) next.add(id);
    }
    result = next;
    if (result.size === 0) break;
  }
  return result;
}

function matchesPattern(record: KnowledgeRecord, pattern: TriplePattern): boolean {
  if (pattern.subject !== undefined && record.subject !== pattern.subject) return false;
  if (pattern.relation !== undefined && record.relation !== pattern.relation) return false;
  if (pattern.object !== undefined && record.object !== pattern.object) return false;
  if (pattern.negated !== undefined && record.negated !== pattern.negated) return false;
  return true;
}

/**
 * `KnowledgeRecord.confidence` is documented as "belief strength in the
 * closed interval [0, 1]" (`types/knowledge.ts`). Enforced at the one place
 * new confidence values enter the store (`add()`), so every record already
 * inside the store can be trusted to satisfy the invariant without every
 * consumer re-checking it.
 */
function assertValidConfidence(confidence: number): void {
  if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    throw new RangeError(`confidence must be within [0, 1], got ${confidence}`);
  }
}

/**
 * In-memory `KnowledgeStore`.
 *
 * `add()` is idempotent per fact identity: re-adding an exact duplicate
 * (same subject+relation+object+negated) returns the already-stored record
 * unchanged rather than inserting a second copy -- the store models a set of
 * *facts*, not a log of every assertion ever made. To change a fact's
 * confidence/source, `remove()` it and `add()` again.
 *
 * `addMany()` is for bulk restore (seed data now; Supabase hydration in
 * Stage 5): input records already carry their own `id`, and re-adding a
 * record whose `id` is already present is a no-op -- safe to call repeatedly
 * (e.g. re-seeding on every app start).
 *
 * Deduplication is by *fact identity*, not by `id`. A restored payload is
 * untrusted input: it may legitimately contain the same triple under two
 * different ids (two devices taught the same fact, a legacy import used its
 * own ids, ...). Inserting both would contradict the class invariant that
 * `records` holds a set of facts, and `idByTripleKey` could only remember one
 * of the two ids -- so `remove()` would delete one row while the other stayed
 * matchable forever as an unreachable "ghost". `addMany()` therefore refuses
 * a triple that is already known, and only the record that `idByTripleKey`
 * points at may release that lookup entry, which keeps `records`,
 * `idByTripleKey`, and the secondary indexes mutually consistent.
 */
export class InMemoryKnowledgeStore implements KnowledgeStore {
  private readonly records = new Map<Id, KnowledgeRecord>();
  private readonly bySubject = new Map<string, Set<Id>>();
  private readonly byRelation = new Map<string, Set<Id>>();
  private readonly byObject = new Map<string, Set<Id>>();
  private readonly idByTripleKey = new Map<string, Id>();

  all(): readonly KnowledgeRecord[] {
    return Array.from(this.records.values());
  }

  has(triple: Triple): boolean {
    return this.idByTripleKey.has(tripleKey(triple));
  }

  match(pattern: TriplePattern): readonly KnowledgeRecord[] {
    const candidateSets: Set<Id>[] = [];
    if (pattern.subject !== undefined) {
      candidateSets.push(this.bySubject.get(pattern.subject) ?? new Set());
    }
    if (pattern.relation !== undefined) {
      candidateSets.push(this.byRelation.get(pattern.relation) ?? new Set());
    }
    if (pattern.object !== undefined) {
      candidateSets.push(this.byObject.get(pattern.object) ?? new Set());
    }

    const candidateIds: Iterable<Id> =
      candidateSets.length > 0 ? intersect(candidateSets) : this.records.keys();

    const results: KnowledgeRecord[] = [];
    for (const id of candidateIds) {
      const record = this.records.get(id);
      if (record !== undefined && matchesPattern(record, pattern)) {
        results.push(record);
      }
    }
    return results;
  }

  add(triple: Triple, options?: AddOptions): KnowledgeRecord {
    const existingId = this.idByTripleKey.get(tripleKey(triple));
    if (existingId !== undefined) {
      const existing = this.records.get(existingId);
      if (existing !== undefined) return existing;
    }

    const confidence = options?.confidence ?? DEFAULT_CONFIDENCE;
    assertValidConfidence(confidence);

    const record: KnowledgeRecord = {
      subject: triple.subject,
      relation: triple.relation,
      object: triple.object,
      negated: triple.negated,
      id: generateId(),
      confidence,
      source: options?.source ?? DEFAULT_SOURCE,
      createdAt: new Date().toISOString(),
    };
    this.insertRecord(record);
    return record;
  }

  addMany(records: readonly KnowledgeRecord[]): void {
    for (const record of records) {
      // A restored snapshot is untrusted input. A row missing its identifying
      // fields would otherwise be inserted and then crash every later read
      // (`tripleKey` dereferences subject/relation/object), so such rows are
      // dropped rather than allowed to poison the store. This is a guard, not a
      // repair: it never invents or rewrites field values.
      if (!isKnowledgeRecordShaped(record)) continue;
      if (this.records.has(record.id)) continue;
      // Same triple under a different id: the fact is already known, so the
      // restored copy is dropped rather than inserted twice.
      if (this.idByTripleKey.has(tripleKey(record))) continue;
      this.insertRecord(record);
    }
  }

  remove(id: Id): void {
    const record = this.records.get(id);
    if (record === undefined) return;
    this.records.delete(id);
    // Only drop the lookup entry when it still points at the record being
    // removed. A snapshot restored through `addMany()` may predate the
    // triple-level dedupe, in which case the surviving twin keeps ownership.
    const key = tripleKey(record);
    if (this.idByTripleKey.get(key) === id) {
      this.idByTripleKey.delete(key);
    }
    removeFromIndex(this.bySubject, record.subject, id);
    removeFromIndex(this.byRelation, record.relation, id);
    removeFromIndex(this.byObject, record.object, id);
  }

  clear(): void {
    this.records.clear();
    this.bySubject.clear();
    this.byRelation.clear();
    this.byObject.clear();
    this.idByTripleKey.clear();
  }

  private insertRecord(record: KnowledgeRecord): void {
    this.records.set(record.id, record);
    this.idByTripleKey.set(tripleKey(record), record.id);
    addToIndex(this.bySubject, record.subject, record.id);
    addToIndex(this.byRelation, record.relation, record.id);
    addToIndex(this.byObject, record.object, record.id);
  }
}
