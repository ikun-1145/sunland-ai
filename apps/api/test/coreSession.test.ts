import { describe, expect, it } from "vitest";

import { executeTurn } from "../src/coreSession";

describe("remote Core session", () => {
  it("hydrates knowledge, learns a new fact, and returns server-owned context", () => {
    const result = executeTurn({
      revision: 4,
      knowledge: [],
      memory: [],
      context: { schemaVersion: 1, version: 0, recentTurns: [] },
    }, {
      conversationId: "conversation-a",
      turnId: "turn-a",
      input: "猫属于哺乳动物",
      observationMode: "summary",
    });
    expect(result.response).toBeTruthy();
    expect(result.knowledge).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "猫", relation: "属于", object: "哺乳动物" }),
    ]));
    expect(result.context).toMatchObject({ schemaVersion: 1, version: 1 });
    expect(result.observationSummary).toBeTruthy();
    expect(result).not.toHaveProperty("understanding");
    expect(JSON.stringify(result)).not.toContain("rawInput");
  });

  it("keeps user memory independent from profile fields", () => {
    const result = executeTurn({ revision: 0, knowledge: [], memory: [], context: null }, {
      conversationId: "conversation-a",
      turnId: "turn-name",
      input: "我叫小蓝",
      observationMode: "off",
    });
    expect(result.memory).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "name", value: "小蓝" }),
    ]));
  });
});
