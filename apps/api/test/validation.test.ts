import { describe, expect, it } from "vitest";

import { validateMigrationRequest, validateTurnRequest } from "../src/validation";

describe("public request validation", () => {
  it("does not accept a request-body user id as part of the turn contract", () => {
    expect(validateTurnRequest({
      userId: "attacker",
      conversationId: "conversation-a",
      turnId: "turn-a",
      input: "你好",
    })).toEqual({
      conversationId: "conversation-a",
      turnId: "turn-a",
      input: "你好",
      observationMode: "off",
    });
  });

  it("rejects damaged legacy records without deleting them", () => {
    expect(() => validateMigrationRequest({
      migrationId: "migration-a",
      knowledge: [{ id: "broken" }],
      memory: [],
      contexts: [],
    })).toThrow(/可信度/u);
  });

  it("rejects malformed semantic Context before it reaches PostgreSQL", () => {
    expect(() => validateMigrationRequest({
      migrationId: "migration-context",
      knowledge: [],
      memory: [],
      contexts: [{
        conversationId: "conversation-a",
        context: { schemaVersion: 1, version: 2, recentTurns: "damaged" },
      }],
    })).toThrow(/上下文版本/u);
  });

  it("enforces bounded input", () => {
    expect(() => validateTurnRequest({ conversationId: "c", turnId: "t", input: "x".repeat(4001) }))
      .toThrow(/长度/u);
  });
});
