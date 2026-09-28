import { describe, expect, it } from "vitest";
import { normalizeSemanticMatchText } from "@/semantic/normalize";
import { normalizeCapturedValue } from "./sideEffectSafety";
import { canonicalStatementTriple, stripTeachingCuePrefix } from "./teachingCanonical";
import { entityLookupKey, normalizeMatchText } from "./textNormalize";

/**
 * Double-normalization is the failure mode these tests exist to prevent.
 *
 * Parse-side and write-side code both normalize, and some values are normalized
 * again on the way back out, so every canonicalizer must be IDEMPOTENT:
 * `f(f(x)) === f(x)`. If one is not, a value's form depends on how many times
 * it passed through the pipeline, and a fact can be approved under one form and
 * stored under another -- exactly the defect that made
 * `猫是一种哺乳动物` be validated as `猫 属于 哺乳动物` and stored as
 * `猫 是 一种哺乳动物`.
 */
const SAMPLE_INPUTS: readonly string[] = Object.freeze([
  "",
  " ",
  "猫",
  " 猫 ",
  "猫  属于   哺乳动物",
  "Alice Chen",
  "  Alice   Chen  ",
  "Alice Chen 属于 Furry Club",
  "猫是一种哺乳动物",
  "记住 猫 属于 哺乳动物",
  "HELLO World",
  "café",
  "全角　空格",
  "企鹅不会飞",
  "猫\t属于\n哺乳动物",
]);

describe("canonical form idempotence (double-normalization safety)", () => {
  it.each(SAMPLE_INPUTS)("normalizeMatchText is idempotent for %j", (input) => {
    const once = normalizeMatchText(input);
    expect(normalizeMatchText(once)).toBe(once);
  });

  it.each(SAMPLE_INPUTS)("entityLookupKey is idempotent for %j", (input) => {
    const once = entityLookupKey(input);
    expect(entityLookupKey(once)).toBe(once);
  });

  it.each(SAMPLE_INPUTS)("normalizeSemanticMatchText is idempotent for %j", (input) => {
    const once = normalizeSemanticMatchText(input);
    expect(normalizeSemanticMatchText(once)).toBe(once);
  });

  it.each(SAMPLE_INPUTS)("normalizeCapturedValue is idempotent for %j", (input) => {
    const once = normalizeCapturedValue(input);
    expect(normalizeCapturedValue(once)).toBe(once);
  });

  it.each(SAMPLE_INPUTS)("stripTeachingCuePrefix is idempotent for %j", (input) => {
    const once = stripTeachingCuePrefix(input);
    expect(stripTeachingCuePrefix(once)).toBe(once);
  });

  it.each(SAMPLE_INPUTS)("canonicalStatementTriple is idempotent for %j", (input) => {
    const subject = normalizeCapturedValue(input);
    const first = canonicalStatementTriple(subject, "是", "一种" + subject, false, true);
    const second = canonicalStatementTriple(first[0], first[1], first[2], first[3], true);
    expect(second).toEqual(first);
  });
});

describe("the two canonical forms stay distinct", () => {
  it("display form keeps meaningful spaces, lookup key drops them", () => {
    expect(normalizeMatchText("  Alice   Chen  ")).toBe("Alice Chen");
    expect(entityLookupKey("  Alice   Chen  ")).toBe("AliceChen");
  });

  it("lookup key does NOT fold case, width or punctuation (explicitly out of scope)", () => {
    // Bounded on purpose: whitespace only. These pairs must stay distinct.
    expect(entityLookupKey("Alice")).not.toBe(entityLookupKey("alice"));
    expect(entityLookupKey("ABC")).not.toBe(entityLookupKey("ＡＢＣ"));
    expect(entityLookupKey("猫。")).not.toBe(entityLookupKey("猫"));
    expect(entityLookupKey("猫")).not.toBe(entityLookupKey("貓"));
  });

  it("lookup key collapses any Unicode whitespace, not just spaces", () => {
    expect(entityLookupKey("Alice\u00a0Chen")).toBe("AliceChen");
    expect(entityLookupKey("猫\t属\n于")).toBe("猫属于");
  });
});
