import { describe, expect, it } from "vitest";
import {
  advanceCommunityContext,
  createEmptyCommunityContext,
  normalizeCommunityContext,
} from "./communityContext";
import { resolveCommunityLanguage } from "./communityResolver";

describe("Community Context", () => {
  it("builds domain confidence without storing raw conversation text", () => {
    const first = advanceCommunityContext(
      createEmptyCommunityContext(),
      resolveCommunityLanguage("我的兽设准备去兽展出毛"),
    );

    expect(first.activeDomains).toContain("furry");
    expect(first.userVocabularyStyle).toBe("community_heavy");
    expect(first.slangMirroringLevel).toBeGreaterThan(0.25);
    expect(first.recentlyDetectedTerms).toContain("fursuit-activity");
    expect(JSON.stringify(first)).not.toContain("我的兽设准备去兽展出毛");
  });

  it("decays and eventually clears a stale domain after topic changes", () => {
    let context = advanceCommunityContext(
      createEmptyCommunityContext(),
      resolveCommunityLanguage("周末去兽展出毛"),
    );
    for (let index = 0; index < 6; index += 1) {
      context = advanceCommunityContext(
        context,
        resolveCommunityLanguage("今天普通地聊点别的", context),
      );
    }

    expect(context.activeDomains).toEqual([]);
    expect(context.slangMirroringLevel).toBe(0.25);
  });

  it("fails closed when restoring malformed host state", () => {
    expect(normalizeCommunityContext({
      activeDomains: ["furry", "admin"],
      confidence: 99,
      recentlyDetectedTerms: ["fursuit-activity", "raw user prose"],
      userVocabularyStyle: "community_heavy",
      slangMirroringLevel: 99,
    })).toEqual({
      activeDomains: ["furry"],
      confidence: 1,
      recentlyDetectedTerms: ["fursuit-activity"],
      userVocabularyStyle: "community_heavy",
      slangMirroringLevel: 0.7,
    });
  });

  it("uses an active domain to resolve an otherwise ambiguous short term", () => {
    const active = advanceCommunityContext(
      createEmptyCommunityContext(),
      resolveCommunityLanguage("周末准备出角"),
    );

    expect(resolveCommunityLanguage("这个毛还得再修").matches).toEqual([]);
    expect(
      resolveCommunityLanguage("这个毛还得再修", active).matches,
    ).toContainEqual(expect.objectContaining({
      semanticTag: "COSPLAY_WIG",
    }));
  });
});
