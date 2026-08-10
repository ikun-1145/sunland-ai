import { describe, expect, it } from "vitest";
import { resolveCommunityLanguage } from "./communityResolver";

function tags(input: string): readonly string[] {
  return resolveCommunityLanguage(input).matches.map(({ semanticTag }) => semanticTag);
}

describe("Community Resolver", () => {
  it.each([
    ["周末准备出毛", "FURSUIT_ACTIVITY"],
    ["这个毛好想rua", "AFFECTIONATE_TOUCH"],
    ["有人扩列吗", "SOCIAL_CONNECT"],
    ["这个角色是我推", "FAVORITE_CHARACTER"],
    ["官方又发糖了", "STORY_SUGAR"],
    ["今天又吃谷了", "MERCH_PURCHASE"],
    ["准备扎个痛包", "ITA_BAG"],
    ["老师开稿了吗", "COMMISSION_OPEN"],
    ["我的OC终于有新立绘了", "ORIGINAL_CHARACTER"],
    ["周末出角", "COSPLAY_CHARACTER"],
    ["昨天试妆翻车", "COSPLAY_TEST"],
    ["等摄影老师返图", "COSPLAY_PHOTOGRAPHER"],
    ["这下彻底寄了", "FAILED_STATE"],
  ] as const)("resolves %s as %s", (input, expectedTag) => {
    expect(tags(input)).toContain(expectedTag);
  });

  it.each([
    "推代码到远端",
    "请把门推开",
    "今天吃谷物",
    "老师今天讲数学",
    "猫最近一直掉毛",
    "数据库这一列不能为空",
    "厨师正在厨房做饭",
    "快递已经寄了",
    "我女儿今天上学",
    "他在收集邮票",
  ])("does not contaminate ordinary semantics for %s", (input) => {
    expect(resolveCommunityLanguage(input).matches).toEqual([]);
  });

  it("composes phrases instead of flattening them into one dictionary meaning", () => {
    expect(
      resolveCommunityLanguage("我推新谷终于出了").compositions,
    ).toContainEqual(expect.objectContaining({
      semanticTag: "FAVORITE_MERCH_RELEASE",
    }));
    expect(
      resolveCommunityLanguage("周末去兽展出毛").compositions,
    ).toContainEqual(expect.objectContaining({
      semanticTag: "FURSUIT_EVENT_PLAN",
    }));
  });

  it("only marks an explanation when the user asks for one", () => {
    expect(resolveCommunityLanguage("准备出毛").definitionRequested).toBe(false);
    expect(resolveCommunityLanguage("出毛是什么意思？").definitionRequested).toBe(true);
  });
});
