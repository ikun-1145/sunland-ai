import { describe, expect, it } from "vitest";
import { createRememberNameIntentMatcher } from "./rememberName";

describe("createRememberNameIntentMatcher", () => {
  const matcher = createRememberNameIntentMatcher();

  it.each([
    ["我叫刘锡泽", "刘锡泽"],
    ["我的名字是刘锡泽", "刘锡泽"],
    ["叫我锡泽", "锡泽"],
    ["你可以叫我霜蓝", "霜蓝"],
    ["我的名字是 Alice Chen", "Alice Chen"],
    ["你好，我叫小明", "小明"],
  ])("recognizes '%s' as RememberName with name entity '%s'", (input, name) => {
    const result = matcher.match(input);
    expect(result).not.toBeNull();
    expect(result?.entities).toEqual([name]);
    expect(matcher.intent).toBe("RememberName");
  });

  it("does not treat '我叫什么' as RememberName (would otherwise capture '什么' as a name)", () => {
    expect(matcher.match("我叫什么")).toBeNull();
  });

  it.each([
    ["记住 我叫小明", "小明"],
    ["教你 我叫小明", "小明"],
    ["记住这个事实 我叫小明", "小明"],
  ])("ignores a leading teaching cue in '%s' and keeps the name '%s'", (input, name) => {
    // The cue is a wrapper, not part of the name. Without stripping, the name
    // patterns never match and the name is silently never learned.
    const result = matcher.match(input);
    expect(result).not.toBeNull();
    expect(result?.entities).toEqual([name]);
  });

  it("still refuses a name when the cue removal would invent one", () => {
    // "记住这个事实很重要" is a sentence about the cue, not a name.
    expect(matcher.match("记住这个事实很重要")).toBeNull();
  });

  it("does not recognize an unrelated sentence", () => {
    expect(matcher.match("猫属于哺乳动物")).toBeNull();
  });

  it.each([
    "名字小明",
    "我不是小明",
    "不要记住我叫小明",
    "我叫小明，猫属于动物",
    "我叫",
    "我叫？？？",
  ])("rejects unsafe or incomplete name input '%s'", (input) => {
    expect(matcher.match(input)).toBeNull();
  });
});
