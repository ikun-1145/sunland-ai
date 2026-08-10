import { describe, expect, it } from "vitest";
import { resolveCommunityLanguage } from "@/community";
import { analyzeSemanticInput } from "./candidates";

describe("Semantic community-language integration", () => {
  it("carries resolved community semantics alongside ordinary candidates", () => {
    const analysis = analyzeSemanticInput("我推新谷终于出了");

    expect(analysis.community?.compositions).toContainEqual(
      expect.objectContaining({ semanticTag: "FAVORITE_MERCH_RELEASE" }),
    );
    expect(analysis.community?.matches.map(({ semanticTag }) => semanticTag)).toEqual(
      expect.arrayContaining(["FAVORITE_CHARACTER", "NEW_MERCH_RELEASE"]),
    );
  });

  it("keeps technical and ordinary ambiguity out of community semantics", () => {
    expect(analyzeSemanticInput("推代码到远端").community?.matches).toEqual([]);
    expect(analyzeSemanticInput("数据库这一列不能为空").community?.matches).toEqual([]);
  });

  it("reuses the resolver result supplied by the dialogue integration", () => {
    const community = resolveCommunityLanguage("我推新谷终于出了");
    expect(analyzeSemanticInput(
      "我推新谷终于出了",
      undefined,
      community,
    ).community).toBe(community);
  });
});
