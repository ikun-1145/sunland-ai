import { describe, expect, it } from "vitest";
import type { ConversationState } from "@/types";
import { defaultConversationAnalyzer } from "./conversationAnalyzer";
import { defaultDialoguePlanner } from "./dialoguePlanner";
import {
  advanceConversationState,
  completeConversationState,
  createEmptyConversationState,
} from "./conversationState";
import {
  INITIATIVE_LIMITS,
  normalizeInitiativeState,
} from "./initiativeState";
import { rankTopicResumeCandidates } from "./initiativePlanner";

function turn(state: ConversationState, input: string): ConversationState {
  const understanding = defaultConversationAnalyzer.analyze(input, state);
  const plan = defaultDialoguePlanner.plan(understanding, state, {
    followUpSelectionSeed: input,
  });
  return completeConversationState(
    advanceConversationState(state, understanding, plan),
    {
      askedQuestion: plan.shouldAskFollowUp,
      furryExpressionUsed: false,
      assistantOpeningKey: `opening-${state.workingMemory.currentTurn.toString(36)}`,
      communityLanguageUsed: false,
      initiativeAction: plan.initiative.action,
    },
  );
}

describe("Initiative State", () => {
  it("reduces engagement across repeated acknowledgements without treating laughter as cold", () => {
    let cold = createEmptyConversationState();
    for (const input of ["嗯", "哦", "行"]) cold = turn(cold, input);
    const laughter = turn(createEmptyConversationState(), "哈哈哈哈");

    expect(cold.initiative.userEngagement).toBeLessThan(0.3);
    expect(cold.initiative.silenceTolerance).toBeGreaterThan(0.65);
    expect(laughter.initiative.userEngagement).toBeGreaterThan(0.55);
  });

  it("suppresses a third consecutive optional question", () => {
    const base = createEmptyConversationState();
    const fatigued: ConversationState = {
      ...base,
      initiative: {
        ...base.initiative,
        consecutiveQuestionTurns: 2,
        followUpFatigue: 0.72,
      },
      lastAssistantAskedQuestion: false,
      followUpCooldown: 0,
    };
    const understanding = defaultConversationAnalyzer.analyze("我刚吃完饭", fatigued);
    const plan = defaultDialoguePlanner.plan(understanding, fatigued, {
      followUpFrequency: 1,
      followUpSelectionSeed: "fatigue",
    });

    expect(plan.shouldAskFollowUp).toBe(false);
    expect(plan.initiative.action).not.toBe("follow_up");
  });

  it("lets safety override initiative even with a familiar conversation", () => {
    const base = createEmptyConversationState();
    const familiar: ConversationState = {
      ...base,
      relationship: {
        familiarity: 0.65,
        casualness: 0.7,
        teasingPermission: 0.35,
      },
    };
    const understanding = defaultConversationAnalyzer.analyze("我真的想死", familiar);
    const plan = defaultDialoguePlanner.plan(understanding, familiar, {
      followUpFrequency: 1,
      followUpSelectionSeed: "safety",
    });

    expect(understanding.pragmatics.requiresSafetyHandling).toBe(true);
    expect(plan.initiative.action).toBe("none");
    expect(plan.shouldAskFollowUp).toBe(false);
  });

  it("ranks only recent paused/background topics for proactive resumption", () => {
    let state = createEmptyConversationState();
    state = turn(state, "网站登录炸了");
    state = turn(state, "对了周末去兽展");
    const candidates = rankTopicResumeCandidates(state);

    expect(candidates[0]?.topicId).toBe(state.workingMemory.topics[0]?.id);
    expect(candidates[0]?.resumeScore).toBeGreaterThan(0.5);

    const stale: ConversationState = {
      ...state,
      workingMemory: {
        ...state.workingMemory,
        currentTurn: state.workingMemory.currentTurn + 20,
      },
    };
    expect(rankTopicResumeCandidates(stale)).toEqual([]);
  });

  it("allows a recent relevant topic to resume only when cooldown and sampling allow it", () => {
    let state = createEmptyConversationState();
    state = turn(state, "网站登录炸了");
    state = turn(state, "对了周末去兽展");
    state = {
      ...state,
      lastAssistantAskedQuestion: false,
      initiative: {
        ...state.initiative,
        initiativeCooldownTurns: 0,
        recentAssistantInitiativeCount: 0,
        consecutiveQuestionTurns: 0,
        followUpFatigue: 0,
      },
    };
    const understanding = defaultConversationAnalyzer.analyze("好无聊", state);
    const plan = defaultDialoguePlanner.plan(understanding, state, {
      followUpSelectionSeed: "seed-0",
    });

    expect(plan.initiative).toMatchObject({
      action: "resume_topic",
      targetTopicId: state.workingMemory.topics[0]?.id,
    });
  });

  it("normalizes restored initiative state and enforces open-loop capacity", () => {
    const normalized = normalizeInitiativeState({
      version: 99,
      drive: 10,
      userEngagement: -2,
      topicMomentum: 5,
      userInitiativePreference: 2,
      silenceTolerance: 2,
      recentAssistantInitiativeCount: 99,
      initiativeCooldownTurns: 99,
      consecutiveQuestionTurns: 99,
      followUpFatigue: 5,
      openLoops: Array.from({ length: 12 }, (_, index) => ({
        id: `loop-${index}`,
        type: "planned_event",
        summary: index === 11 ? "arbitrary raw text" : "考试",
        status: "open",
        createdTurn: index,
        lastUpdatedTurn: index,
        relevance: 1,
      })),
    });

    expect(normalized.version).toBe(1);
    expect(normalized.drive).toBe(1);
    expect(normalized.userEngagement).toBe(0);
    expect(normalized.recentAssistantInitiativeCount)
      .toBe(INITIATIVE_LIMITS.maximumRecentInitiatives);
    expect(normalized.openLoops).toHaveLength(INITIATIVE_LIMITS.maximumOpenLoops);
    expect(JSON.stringify(normalized)).not.toContain("arbitrary raw text");
  });

  it("keeps open loops transient and bounded while resolving explicit outcomes", () => {
    let state = createEmptyConversationState();
    state = turn(state, "我要去面试了");
    expect(state.initiative.openLoops).toHaveLength(1);
    expect(state.initiative.openLoops[0]).toMatchObject({
      summary: "面试",
      status: "open",
    });

    state = turn(state, "面试完了");
    expect(state.initiative.openLoops[0]).toMatchObject({ status: "resolved" });
  });
});
