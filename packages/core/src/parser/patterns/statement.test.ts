import { describe, expect, it } from "vitest";
import { CoreRelations } from "@/types";
import { createStatementPattern } from "./statement";

describe("createStatementPattern", () => {
  const isAPattern = createStatementPattern(CoreRelations.IsA); // 属于
  const canPattern = createStatementPattern(CoreRelations.Can); // 会

  it("parses a plain (non-negated) statement", () => {
    expect(isAPattern.match("猫属于哺乳动物")).toEqual({
      type: "statement",
      subject: "猫",
      relation: "属于",
      object: "哺乳动物",
      negated: false,
      raw: "猫属于哺乳动物",
    });
  });

  it("parses a negated statement", () => {
    expect(canPattern.match("企鹅不会飞")).toEqual({
      type: "statement",
      subject: "企鹅",
      relation: "会",
      object: "飞",
      negated: true,
      raw: "企鹅不会飞",
    });
  });

  it("returns null when the relation is absent", () => {
    expect(isAPattern.match("猫喜欢鱼")).toBeNull();
  });

  it("returns null when subject or object would be empty", () => {
    expect(isAPattern.match("属于哺乳动物")).toBeNull(); // no subject
    expect(isAPattern.match("猫属于")).toBeNull(); // no object
  });

  it("is parameterized per relation with no shared mutable state", () => {
    const likesPattern = createStatementPattern(CoreRelations.Likes);
    expect(likesPattern.match("猫喜欢鱼")).toMatchObject({
      subject: "猫",
      relation: "喜欢",
      object: "鱼",
      negated: false,
    });
    // A pattern only recognizes its own relation.
    expect(likesPattern.match("猫属于哺乳动物")).toBeNull();
  });

  it("preserves meaningful spaces in raw statement entities", () => {
    expect(
      isAPattern.match(
        "Alice Chen 属于 Furry Club",
        "Alice Chen 属于 Furry Club",
      ),
    ).toMatchObject({
      subject: "Alice Chen",
      object: "Furry Club",
    });
  });

  it.each([
    "猫会飞还是会游泳",
    "鸟有没有翅膀",
    "猫会飞，鸟会游泳",
    `${"这是一段很长的输入，".repeat(30)}请问这是什么？`,
  ])("rejects unsafe side-effect structure '%s'", (input) => {
    expect(canPattern.match(input, input)).toBeNull();
  });

  describe("canonical stored form", () => {
    it("drops the '一种' wrapper so the fact is visible to 属于 inference", () => {
      const isACuePattern = createStatementPattern("属于", ["属于", "是一种"]);
      expect(isACuePattern.match("猫是一种哺乳动物")).toMatchObject({
        subject: "猫",
        relation: "属于",
        object: "哺乳动物",
      });
    });

    it("keeps a bare 是 statement as identity, not classification", () => {
      // 苏格拉底 是 人 is instance-of; promoting it to 属于 would change
      // answers on the Legacy-only path.
      const isPattern = createStatementPattern(CoreRelations.Is);
      expect(isPattern.match("苏格拉底是人")).toMatchObject({
        relation: "是",
        object: "人",
      });
    });

    it("promotes a 是 statement whose object carries the 一种 wrapper", () => {
      // The wrapper is itself the is-a signal, so this holds even when no
      // semantic is-a cue is available to the Legacy layer.
      const isPattern = createStatementPattern(CoreRelations.Is);
      expect(isPattern.match("猫是一种哺乳动物")).toMatchObject({
        relation: "属于",
        object: "哺乳动物",
      });
    });

    it("is idempotent for an already-canonical statement", () => {
      expect(isAPattern.match("猫属于哺乳动物")).toMatchObject({
        subject: "猫",
        relation: "属于",
        object: "哺乳动物",
      });
    });

    it.each([
      "记住 猫 属于 哺乳动物",
      "教你 猫 属于 哺乳动物",
      "告诉你一个知识 猫 属于 哺乳动物",
      "记住这个事实 猫 属于 哺乳动物",
      "记住猫属于哺乳动物",
    ])("strips the teaching cue from '%s'", (input) => {
      expect(isAPattern.match(input, input)).toMatchObject({
        subject: "猫",
        relation: "属于",
        object: "哺乳动物",
      });
    });

    it.each([
      "记住这个事实很重要",
      "记住这个事实是真的",
      "记住猫属于哺乳动物吗",
    ])("does not strip a cue that is part of the statement itself: '%s'", (input) => {
      // Stripping here would invent a fact that was never taught.
      const result = isAPattern.match(input, input);
      expect(result === null || result.type !== "statement" || result.subject !== "猫")
        .toBe(true);
    });

    it("keeps the user's original text in raw", () => {
      expect(isAPattern.match("记住 猫 属于 哺乳动物", "记住 猫 属于 哺乳动物"))
        .toMatchObject({ raw: "记住 猫 属于 哺乳动物" });
    });

    it("still applies the safety gate to the original wording", () => {
      // Stripping a cue must never turn a rejected input into an accepted one.
      expect(isAPattern.match("记住 猫会飞还是会游泳", "记住 猫会飞还是会游泳"))
        .toBeNull();
    });
  });
});
