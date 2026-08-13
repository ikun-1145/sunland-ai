import { describe, expect, it } from "vitest";
import type { ConversationState, TurnUnderstanding } from "@/types";
import { defaultDialoguePlanner } from "./dialoguePlanner";
import { resolveDefaultTurnUnderstanding } from "@/understanding";
import {
  advanceConversationState,
  createEmptyConversationState,
} from "./conversationState";
import {
  normalizeConversationWorkingMemory,
  TOPIC_MEMORY_LIMITS,
} from "./topicTracker";

function conversation() {
  let state: ConversationState = createEmptyConversationState();
  return {
    turn(input: string): TurnUnderstanding {
      const understanding = resolveDefaultTurnUnderstanding(input, state);
      const plan = defaultDialoguePlanner.plan(understanding, state, {
        followUpSelectionSeed: input,
      });
      state = advanceConversationState(state, understanding, plan);
      return understanding;
    },
    state(): ConversationState {
      return state;
    },
  };
}

describe("Topic Tracker + conversational working memory", () => {
  it("creates a bounded problem topic without retaining the raw message", () => {
    const chat = conversation();
    const understanding = chat.turn("我的网站登录又炸了");
    const memory = chat.state().workingMemory;

    expect(understanding.topicContinuity.transition).toBe("new_topic");
    expect(understanding.topicContinuity.activeTopic).toMatchObject({
      label: "网站登录问题",
      status: "active",
      events: [expect.objectContaining({ type: "problem_reported" })],
    });
    expect(JSON.stringify(memory)).not.toContain("我的网站登录又炸了");
  });

  it("binds an implicit failed result to the active problem", () => {
    const chat = conversation();
    chat.turn("我的网站登录又炸了");
    chat.turn("我试了清缓存");
    const failed = chat.turn("结果还是没好");

    expect(failed.topicContinuity.transition).toBe("continued");
    expect(failed.topicContinuity.activeTopic?.label).toBe("网站登录问题");
    expect(failed.topicContinuity.activeTopic?.events.at(-1)?.type).toBe("failed");
  });

  it("resolves a pronoun to Codex inside a Mac/Codex topic", () => {
    const chat = conversation();
    chat.turn("Mac上的Codex连不上");
    const continuation = chat.turn("它一直显示重新连接");
    const reference = continuation.topicContinuity.references.find(({ text }) => text === "它");
    const codex = chat.state().workingMemory.recentEntities.find(
      ({ canonicalName }) => canonicalName === "Codex",
    );

    expect(reference).toMatchObject({ targetType: "entity", confidence: 0.78 });
    expect(reference?.targetId).toBe(codex?.id);
    expect(continuation.topicContinuity.activeTopic?.label).toBe("Codex连接问题");
  });

  it("asks for clarification when two recent problem topics are equally plausible", () => {
    const chat = conversation();
    chat.turn("iPhone连不上");
    chat.turn("Watch也连不上");
    const ambiguous = chat.turn("它还是不行");

    expect(ambiguous.topicContinuity.needsClarification).toBe(true);
    expect(ambiguous.topicContinuity.clarificationCandidates).toEqual([
      "Apple Watch连接问题",
      "iPhone连接问题",
    ]);
  });

  it("uses an explicit entity to resolve the turn after clarification", () => {
    const chat = conversation();
    chat.turn("iPhone连不上");
    chat.turn("Watch也连不上");
    chat.turn("它还是不行");
    const resolved = chat.turn("iPhone那个");

    expect(resolved.topicContinuity.activeTopic?.label).toBe("iPhone连接问题");
    expect(resolved.topicContinuity.transition).toBe("resumed");
    expect(resolved.topicContinuity.activeTopic?.entities.map(({ canonicalName }) => canonicalName))
      .not.toContain("Apple Watch");
  });

  it("does not keep a problem alive through unrelated uses of 又", () => {
    const chat = conversation();
    chat.turn("网站登录炸了");
    const unrelated = chat.turn("我又想吃饭了");

    expect(unrelated.topicContinuity.transition).toBe("none");
    expect(unrelated.topicContinuity.references).toEqual([]);
    expect(unrelated.topicContinuity.activeTopic?.relevance).toBeLessThan(1);
  });

  it("switches topics and reactivates the earlier problem instead of duplicating it", () => {
    const chat = conversation();
    const first = chat.turn("网站登录炸了").topicContinuity.activeTopic?.id;
    chat.turn("对了，周末兽展几点");
    const resumed = chat.turn("回到刚才那个bug");

    expect(resumed.topicContinuity.transition).toBe("resumed");
    expect(resumed.topicContinuity.activeTopic?.id).toBe(first);
    expect(chat.state().workingMemory.topics).toHaveLength(2);
  });

  it("tracks attempted, failed and resolved problem events", () => {
    const chat = conversation();
    chat.turn("接口一直报错");
    chat.turn("我试了方案A");
    chat.turn("还是报错");
    chat.turn("又换了方案B");
    const resolved = chat.turn("好了");
    const topic = chat.state().workingMemory.topics.at(-1);

    expect(topic?.events.map(({ type }) => type)).toEqual([
      "problem_reported", "attempted", "failed", "attempted", "resolved",
    ]);
    expect(topic?.status).toBe("resolved");
    expect(resolved.topicContinuity.transition).toBe("resolved");
  });

  it("fails closed and enforces all capacity limits when restoring state", () => {
    const restored = normalizeConversationWorkingMemory({
      version: 999,
      activeTopicId: "topic-missing",
      currentTurn: 12,
      topics: Array.from({ length: 20 }, (_, index) => ({
        id: `topic-${index}`,
        label: `topic ${index}`,
        summary: `summary ${index}`,
        entities: Array.from({ length: 12 }, (__, entityIndex) => ({
          id: `entity-object-${index}-${entityIndex}`,
          type: "object",
          canonicalName: `entity ${entityIndex}`,
          aliases: [`alias ${entityIndex}`],
        })),
        status: "background",
        relevance: 0.5,
        createdTurn: index,
        lastMentionTurn: index,
        events: Array.from({ length: 10 }, (__, eventIndex) => ({
          type: "mentioned",
          summary: "mentioned",
          turn: eventIndex,
        })),
        domains: [],
      })),
      recentEntities: [],
      recentReferences: Array.from({ length: 30 }, () => ({
        text: "它",
        targetType: "unknown",
        confidence: 0.2,
      })),
    });

    expect(restored.version).toBe(1);
    expect(restored.activeTopicId).toBeUndefined();
    expect(restored.topics).toHaveLength(TOPIC_MEMORY_LIMITS.maximumTopics);
    expect(restored.topics.every(({ entities }) =>
      entities.length <= TOPIC_MEMORY_LIMITS.maximumEntitiesPerTopic)).toBe(true);
    expect(restored.topics.every(({ events }) =>
      events.length <= TOPIC_MEMORY_LIMITS.maximumEventsPerTopic)).toBe(true);
    expect(restored.recentReferences).toHaveLength(
      TOPIC_MEMORY_LIMITS.maximumRecentReferences,
    );
  });
});
