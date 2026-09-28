import { describe, expect, it } from "vitest";
import {
  canonicalStatementTriple,
  stripTeachingCuePrefix,
} from "./teachingCanonical";

describe("stripTeachingCuePrefix", () => {
  it.each([
    ["记住 猫 属于 哺乳动物", "猫 属于 哺乳动物"],
    ["记住猫属于哺乳动物", "猫属于哺乳动物"],
    ["教你 猫 属于 哺乳动物", "猫 属于 哺乳动物"],
    ["告诉你一个知识 猫 属于 哺乳动物", "猫 属于 哺乳动物"],
    ["记住这个事实 猫 属于 哺乳动物", "猫 属于 哺乳动物"],
    ["记住: 猫 属于 哺乳动物", "猫 属于 哺乳动物"],
  ])("strips the cue from '%s'", (input, expected) => {
    expect(stripTeachingCuePrefix(input)).toBe(expected);
  });

  it.each([
    "猫属于哺乳动物",
    "记住这个事实很重要",
    "记住这个事实是真的",
    "记住这个事实",
    "记住",
    "记住  ",
  ])("leaves '%s' untouched", (input) => {
    // Either there is no cue, or the cue is the subject of the sentence and
    // stripping it would invent a fact that was never taught.
    expect(stripTeachingCuePrefix(input)).toBe(input.trim());
  });

  it("is idempotent", () => {
    const once = stripTeachingCuePrefix("记住 猫 属于 哺乳动物");
    expect(stripTeachingCuePrefix(once)).toBe(once);
  });

  it("strips only one cue", () => {
    expect(stripTeachingCuePrefix("记住 记住 猫 属于 哺乳动物"))
      .toBe("记住 猫 属于 哺乳动物");
  });
});

describe("canonicalStatementTriple", () => {
  it("removes the '一种' wrapper under an is-a relation", () => {
    expect(canonicalStatementTriple("猫", "属于", "一种哺乳动物", false, false))
      .toEqual(["猫", "属于", "哺乳动物", false]);
  });

  it("promotes 是 to 属于 only when Semantic confirmed an is-a cue", () => {
    expect(canonicalStatementTriple("猫", "是", "哺乳动物", false, true))
      .toEqual(["猫", "属于", "哺乳动物", false]);
    // Without the cue, 是 stays identity (苏格拉底 是 人).
    expect(canonicalStatementTriple("苏格拉底", "是", "人", false, false))
      .toEqual(["苏格拉底", "是", "人", false]);
  });

  it("keeps a bare 一种 object when it is the whole object", () => {
    // Nothing would be left after stripping, so the original is preserved.
    expect(canonicalStatementTriple("猫", "属于", "一种", false, false))
      .toEqual(["猫", "属于", "一种", false]);
  });

  it("leaves non-is-a relations alone", () => {
    expect(canonicalStatementTriple("鸟", "会", "一种飞行", false, false))
      .toEqual(["鸟", "会", "一种飞行", false]);
  });

  it("preserves negation and is idempotent", () => {
    const first = canonicalStatementTriple("企鹅", "是", "一种鸟", true, true);
    expect(first).toEqual(["企鹅", "属于", "鸟", true]);
    expect(
      canonicalStatementTriple(first[0], first[1], first[2], first[3], true),
    ).toEqual(first);
  });

  it("normalizes captured whitespace", () => {
    expect(canonicalStatementTriple(" 猫 ", " 属于 ", " 哺乳动物 ", false, false))
      .toEqual(["猫", "属于", "哺乳动物", false]);
  });
});
