import { describe, expect, it } from "vitest";
import {
  applySemanticContextUpdate,
  createEmptySemanticContext,
  type SemanticContext,
} from "@/semantic";
import { createSunlandEngine } from "@/engine";
import { defaultDialoguePlanner } from "./dialoguePlanner";
import { resolveDefaultTurnUnderstanding } from "@/understanding";
import {
  INITIATIVE_LOCAL_EVALUATION_SET,
  INITIATIVE_MULTI_TURN_EVALUATION_SET,
} from "./initiativeEvaluationSet";
import {
  evaluateInitiativeTurns,
  type InitiativeMetricTurn,
} from "./personalityEvaluator";

describe("Initiative Evaluation Set", () => {
  it("contains 100 local cases and 30 multi-turn conversations", () => {
    expect(INITIATIVE_LOCAL_EVALUATION_SET).toHaveLength(100);
    expect(INITIATIVE_MULTI_TURN_EVALUATION_SET).toHaveLength(30);
    expect(new Set(INITIATIVE_LOCAL_EVALUATION_SET.map(({ id }) => id)).size).toBe(100);
    expect(new Set(INITIATIVE_MULTI_TURN_EVALUATION_SET.map(({ id }) => id)).size).toBe(30);
    expect(INITIATIVE_MULTI_TURN_EVALUATION_SET.every(({ turns }) => turns.length >= 2)).toBe(true);
  });

  for (const candidate of INITIATIVE_LOCAL_EVALUATION_SET) {
    it(candidate.id, () => {
      const understanding = resolveDefaultTurnUnderstanding(candidate.input);
      const plan = defaultDialoguePlanner.plan(understanding, undefined, {
        followUpSelectionSeed: candidate.input,
      });
      const expected = candidate.expected;

      if (expected.signal !== undefined) {
        expect(understanding.initiativeSignals[expected.signal]).toBe(true);
      }
      if (expected.action !== undefined) {
        expect(plan.initiative.action).toBe(expected.action);
      }
      if (expected.plannedEventSummary !== undefined) {
        expect(understanding.initiativeSignals.plannedEvent?.summary)
          .toBe(expected.plannedEventSummary);
      }
    });
  }

  for (const candidate of INITIATIVE_MULTI_TURN_EVALUATION_SET) {
    it(candidate.id, () => {
      const engine = createSunlandEngine({ semanticContextMode: "enabled" });
      let context: SemanticContext = createEmptySemanticContext();
      const responses: string[] = [];
      let finalAction = "none";

      for (const [index, input] of candidate.turns.entries()) {
        const understanding = resolveDefaultTurnUnderstanding(
          input,
          context.conversationState,
        );
        const plan = defaultDialoguePlanner.plan(
          understanding,
          context.conversationState,
          { followUpSelectionSeed: input },
        );
        const result = engine.process(input, {
          semanticContext: context,
          turnId: `${candidate.id}-${index}`,
        });
        responses.push(result.response);
        finalAction = plan.initiative.action;
        context = applySemanticContextUpdate(context, result.semanticContextUpdate);
      }

      const expected = candidate.expected;
      const finalResponse = responses.at(-1) ?? "";
      if (expected.maximumQuestionResponses !== undefined) {
        expect(responses.filter((response) => /[？?]/u.test(response)).length)
          .toBeLessThanOrEqual(expected.maximumQuestionResponses);
      }
      if (expected.finalEngagementAtMost !== undefined) {
        expect(context.conversationState?.initiative.userEngagement)
          .toBeLessThanOrEqual(expected.finalEngagementAtMost);
      }
      if (expected.finalResponseIncludes !== undefined) {
        expect(finalResponse).toMatch(expected.finalResponseIncludes);
      }
      if (expected.finalResponseExcludes !== undefined) {
        expect(finalResponse).not.toMatch(expected.finalResponseExcludes);
      }
      if (expected.noOpenLoopSummary !== undefined) {
        expect(context.conversationState?.initiative.openLoops.some(
          ({ status, summary }) => status === "open" && summary === expected.noOpenLoopSummary,
        )).toBe(false);
      }
      if (expected.finalAction !== undefined) {
        expect(finalAction).toBe(expected.finalAction);
      }
    });
  }

  it("keeps aggregate initiative regression metrics within conservative bounds", () => {
    const metricTurns: InitiativeMetricTurn[] = [];
    for (const candidate of INITIATIVE_MULTI_TURN_EVALUATION_SET) {
      const engine = createSunlandEngine({ semanticContextMode: "enabled" });
      let context: SemanticContext = createEmptySemanticContext();
      for (const [index, input] of candidate.turns.entries()) {
        const understanding = resolveDefaultTurnUnderstanding(input, context.conversationState);
        const plan = defaultDialoguePlanner.plan(understanding, context.conversationState, {
          followUpSelectionSeed: input,
        });
        const targetTopic = plan.initiative.targetTopicId === undefined
          ? undefined
          : context.conversationState?.workingMemory.topics.find(
              ({ id }) => id === plan.initiative.targetTopicId,
            );
        const result = engine.process(input, {
          semanticContext: context,
          turnId: `metrics-${candidate.id}-${index}`,
        });
        metricTurns.push(Object.freeze({
          conversationId: candidate.id,
          input,
          response: result.response,
          initiative: plan.initiative,
          ...(targetTopic === undefined || context.conversationState === undefined
            ? {}
            : {
                targetTopicAge:
                  context.conversationState.workingMemory.currentTurn -
                  targetTopic.lastMentionTurn,
              }),
        }));
        context = applySemanticContextUpdate(context, result.semanticContextUpdate);
      }
    }
    const metrics = evaluateInitiativeTurns(metricTurns);
    expect(metrics.overQuestioningScore).toBe(0);
    expect(metrics.deadConversationScore).toBe(0);
    expect(metrics.forcedTopicResumeScore).toBe(0);
    expect(metrics.poorClosureScore).toBe(0);
    expect(metrics.staleTopicRevivalScore).toBe(0);
    expect(metrics.overInitiativeScore).toBeLessThan(0.5);
  });
});
