import { describe, expect, it } from "vitest";
import { InMemoryKnowledgeStore } from "@/knowledge";
import type { KnowledgeRecord } from "@/types";
import { matchByEntity } from "./entityLookup";

function storeWith(...records: readonly [string, string, string][]): InMemoryKnowledgeStore {
  const store = new InMemoryKnowledgeStore();
  for (const [subject, relation, object] of records) {
    store.add({ subject, relation, object, negated: false });
  }
  return store;
}

describe("matchByEntity", () => {
  it("prefers an exact subject match over a whitespace-insensitive one", () => {
    // Both records could satisfy the whitespace-insensitive comparison; the
    // exact one must win, so precision is never traded for recall.
    const store = storeWith(
      ["AliceChen", "属于", "精确"],
      ["Alice Chen", "属于", "宽松"],
    );

    const exact = matchByEntity(store, { subject: "AliceChen", relation: "属于" });
    expect(exact.map((record) => record.object)).toEqual(["精确"]);

    const spaced = matchByEntity(store, { subject: "Alice Chen", relation: "属于" });
    expect(spaced.map((record) => record.object)).toEqual(["宽松"]);
  });

  it("finds a spaced entity from a whitespace-stripped query", () => {
    // The Legacy query grammar deletes whitespace, so a question about
    // "Alice Chen" arrives as "AliceChen".
    const store = storeWith(["Alice Chen", "属于", "Furry Club"]);

    const found = matchByEntity(store, { subject: "AliceChen", relation: "属于" });
    expect(found.map((record) => record.object)).toEqual(["Furry Club"]);
  });

  it("does not match a different entity that merely shares a prefix", () => {
    const store = storeWith(["Alice Chen", "属于", "Furry Club"]);
    expect(matchByEntity(store, { subject: "Alice", relation: "属于" })).toEqual([]);
  });

  it("keeps a fixed object fixed instead of widening the query", () => {
    // `猫是不是生物` must not degrade into "what does 猫 belong to".
    const store = storeWith(["猫", "属于", "动物"], ["动物", "属于", "生物"]);
    expect(matchByEntity(store, { subject: "猫", relation: "属于", object: "生物" })).toEqual([]);
    expect(
      matchByEntity(store, { subject: "猫", relation: "属于", object: "动物" }).map((r) => r.object),
    ).toEqual(["动物"]);
  });

  it("re-compares a spaced object through the lookup key too", () => {
    const store = storeWith(["Alice Chen", "属于", "Furry Club"]);
    expect(
      matchByEntity(store, { subject: "AliceChen", relation: "属于", object: "FurryClub" }).map(
        (record) => record.object,
      ),
    ).toEqual(["Furry Club"]);
  });

  it("does not widen a bare subject scan when the subject cannot be matched exactly", () => {
    // A bare-subject scan has no relation to bound a whitespace-insensitive
    // fallback, so it must NOT degrade into a full-store scan: exact results or
    // nothing.
    const store = storeWith(["Alice Chen", "属于", "Furry Club"], ["猫", "属于", "动物"]);
    expect(matchByEntity(store, { subject: "AliceChen" })).toEqual([]);
    expect(matchByEntity(store, { subject: "猫" }).map((r) => r.object)).toEqual(["动物"]);
  });

  it("never mutates what is persisted or returned", () => {
    const store = storeWith(["Alice Chen", "属于", "Furry Club"]);
    const before: readonly KnowledgeRecord[] = store.all();

    matchByEntity(store, { subject: "AliceChen", relation: "属于" });

    expect(store.all()).toEqual(before);
    expect(store.all()[0]?.subject).toBe("Alice Chen");
  });
});
