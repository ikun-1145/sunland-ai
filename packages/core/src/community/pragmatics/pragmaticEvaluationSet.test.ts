import { describe, expect, it } from "vitest";
import { createEmptyConversationState } from "@/dialogue";
import { resolveCommunityLanguage } from "../communityResolver";
import { PRAGMATIC_EVALUATION_SET } from "./pragmaticEvaluationSet";
import { resolvePragmatics } from "./pragmaticResolver";

describe("Pragmatics fixed evaluation corpus", () => {
  it("contains at least 100 stable, uniquely named cases", () => {
    expect(PRAGMATIC_EVALUATION_SET.length).toBeGreaterThanOrEqual(100);
    expect(new Set(PRAGMATIC_EVALUATION_SET.map(({ id }) => id)).size)
      .toBe(PRAGMATIC_EVALUATION_SET.length);
  });

  for (const candidate of PRAGMATIC_EVALUATION_SET) {
    it(candidate.id, () => {
      const community = resolveCommunityLanguage(candidate.input);
      const result = resolvePragmatics(
        candidate.input,
        community,
        createEmptyConversationState(),
      );
      if (candidate.expectedGoal !== undefined) {
        expect(result.communicativeGoal).toBe(candidate.expectedGoal);
      }
      if (candidate.expectedTone !== undefined) {
        expect(result.socialTone).toBe(candidate.expectedTone);
      }
      if (candidate.expectedPattern !== undefined) {
        expect(result.matchedPatterns).toContain(candidate.expectedPattern);
      }
      if (candidate.forbiddenPattern !== undefined) {
        expect(result.matchedPatterns).not.toContain(candidate.forbiddenPattern);
      }
      if (candidate.expectedImplication !== undefined) {
        expect(result.implications.map(({ tag }) => tag))
          .toContain(candidate.expectedImplication);
      }
      if (candidate.minimumSarcasm !== undefined) {
        expect(result.sarcasmConfidence).toBeGreaterThanOrEqual(
          candidate.minimumSarcasm,
        );
      }
      if (candidate.maximumSarcasm !== undefined) {
        expect(result.sarcasmConfidence).toBeLessThanOrEqual(
          candidate.maximumSarcasm,
        );
      }
      if (candidate.expectedOffense !== undefined) {
        expect(result.offenseLevel).toBe(candidate.expectedOffense);
      }
      if (candidate.requiresSafetyHandling !== undefined) {
        expect(result.requiresSafetyHandling)
          .toBe(candidate.requiresSafetyHandling);
      }
    });
  }
});
