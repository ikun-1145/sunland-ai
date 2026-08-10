import { describe, expect, it } from "vitest";
import {
  advanceConversationState,
  completeConversationState,
  createEmptyConversationState,
  defaultConversationAnalyzer,
  defaultDialoguePlanner,
  evaluateSocialResponses,
  normalizeConversationState,
} from "@/dialogue";
import {
  renderFrostSocialDialogue,
  renderPlainSocialDialogue,
} from "@/personality/socialDialogue";
import type { DialogueTurnContext } from "@/types";

function turn(
  raw: string,
  state = createEmptyConversationState(),
): DialogueTurnContext {
  const understanding = defaultConversationAnalyzer.analyze(raw, state);
  const plan = defaultDialoguePlanner.plan(understanding, state, {
    followUpSelectionSeed: raw,
  });
  return Object.freeze({ raw, understanding, plan, state });
}

describe("Social Intelligence planning", () => {
  it("keeps a mixed vent + technical request actionable", () => {
    const current = turn("太好了代码又崩了，帮我看看 bug");
    expect(current.understanding.intent).toBe("command");
    expect(current.understanding.conversationMode).toBe("technical");
    expect(current.plan.socialStrategy).toMatchObject({
      answerLiterally: true,
      acknowledgeEmotion: true,
      joinJoke: false,
      allowBanter: false,
    });
    expect(renderFrostSocialDialogue(current)).toContain("报错");
  });

  it("does not turn a standalone compliment into sarcasm", () => {
    const current = turn("这个实现真不错");
    expect(current.understanding.pragmatics.sarcasmConfidence)
      .toBeLessThan(0.2);
    expect(current.understanding.pragmatics.socialTone)
      .not.toBe("sarcastic");
  });

  it("lets safety handling disable jokes and banter", () => {
    const current = turn("我真的想死，但刚才又笑死我了");
    expect(current.understanding.pragmatics.requiresSafetyHandling).toBe(true);
    expect(current.plan.socialStrategy).toMatchObject({
      joinJoke: false,
      allowBanter: false,
      answerLiterally: true,
    });
    expect(renderFrostSocialDialogue(current)).toBeNull();
    expect(renderPlainSocialDialogue(current)).toBeNull();
  });

  it.each([
    ["这个房子我买不起", "goods-cannot-afford"],
    ["没人摸这个按钮", "furry-no-rua"],
    ["终于见到数学老师了", "art-commission-finally"],
    ["我今天吃土豆", "goods-eat-soil"],
  ] as const)("does not apply a community pattern to ordinary language: %s", (
    input,
    forbiddenPattern,
  ) => {
    const current = turn(input);
    expect(current.understanding.pragmatics.matchedPatterns)
      .not.toContain(forbiddenPattern);
  });

  it("does not treat an insult aimed at a third party as an attack on Frost", () => {
    const current = turn("他是不是傻哈哈哈");
    expect(current.understanding.pragmatics.offenseLevel).toBe("none");
    expect(current.plan.socialStrategy.reactionPattern).toBe("third-party-remark");
  });

  it("permits only relationship-gated, cooldown-controlled behavior banter", () => {
    const familiar = {
      ...createEmptyConversationState(),
      relationship: {
        familiarity: 0.4,
        casualness: 0.4,
        teasingPermission: 0.2,
      },
    };
    const first = turn("我真蠢，又忘了保存", familiar);
    expect(first.plan.socialStrategy.allowBanter).toBe(true);
    expect(renderFrostSocialDialogue(first)).toContain("保存按钮");
    expect(renderFrostSocialDialogue(first)).not.toMatch(/智商|脑子不好|你就是蠢/u);

    const cooledState = completeConversationState(familiar, {
      askedQuestion: false,
      furryExpressionUsed: false,
      assistantOpeningKey: "opening-a1",
      communityLanguageUsed: false,
      banterUsed: true,
      ...(first.plan.socialStrategy.reactionPattern === undefined
        ? {}
        : { reactionPattern: first.plan.socialStrategy.reactionPattern }),
      ...(first.plan.socialStrategy.jokeConcept === undefined
        ? {}
        : { jokeConcept: first.plan.socialStrategy.jokeConcept }),
    });
    expect(turn("我真蠢，又忘了保存", cooledState).plan.socialStrategy.allowBanter)
      .toBe(false);
  });

  it("stores only bounded strategy ids and drops raw-looking values", () => {
    const normalized = normalizeConversationState({
      ...createEmptyConversationState(),
      recentReactionPatterns: ["wallet-pressure", "用户原话：我很生气"],
      recentJokeConcepts: ["situational-irony", "raw text!"],
      banterCooldown: 99,
      recentHostileTurns: 99,
    });
    expect(normalized?.recentReactionPatterns).toEqual(["wallet-pressure"]);
    expect(normalized?.recentJokeConcepts).toEqual(["situational-irony"]);
    expect(normalized?.banterCooldown).toBe(2);
    expect(normalized?.recentHostileTurns).toBe(3);
  });

  it("cools down concept-level reactions and lets them recover", () => {
    const base = createEmptyConversationState();
    const first = turn("我推又出谷了", base);
    expect(first.plan.socialStrategy.reactionPattern).toBe("wallet-pressure");
    const afterFirst = completeConversationState(
      advanceConversationState(base, first.understanding, first.plan),
      {
        askedQuestion: false,
        furryExpressionUsed: false,
        assistantOpeningKey: "opening-wallet1",
        communityLanguageUsed: false,
        reactionPattern: "wallet-pressure",
      },
    );
    const repeated = turn("我推又出谷了", afterFirst);
    expect(repeated.plan.socialStrategy.reactionPattern).toBeUndefined();
    const afterRepeat = completeConversationState(
      advanceConversationState(afterFirst, repeated.understanding, repeated.plan),
      {
        askedQuestion: false,
        furryExpressionUsed: false,
        assistantOpeningKey: "opening-neutral1",
        communityLanguageUsed: false,
      },
    );
    expect(turn("我推又出谷了", afterRepeat).plan.socialStrategy.reactionPattern)
      .toBe("wallet-pressure");
  });

  it("switches from community context to technical register in one turn", () => {
    const base = createEmptyConversationState();
    const community = turn("我推又出谷了", base);
    const contextual = advanceConversationState(
      base,
      community.understanding,
      community.plan,
    );
    const technical = turn("顺便问下 RSA 2048 为什么安全？", contextual);
    expect(technical.understanding.conversationMode).toBe("technical");
    expect(technical.plan.tone).toBe("technical");
    expect(technical.plan.socialStrategy.joinJoke).toBe(false);
    expect(technical.plan.communityLanguageMode).not.toBe("mirror");
  });

  it("reports zero error scores for a correctly aligned observation", () => {
    const current = turn("真棒，又崩了");
    const response = renderFrostSocialDialogue(current) ?? "";
    expect(evaluateSocialResponses([{
      pragmatics: current.understanding.pragmatics,
      strategy: current.plan.socialStrategy,
      response,
      mode: current.understanding.conversationMode,
      expectedGoal: "sarcasm",
      expectedSarcasm: true,
      expectedSafetyYield: false,
    }])).toEqual({
      literalMisreadScore: 0,
      sarcasmMisreadScore: 0,
      overBanterScore: 0,
      assistantToneScore: 0,
      slangOveruseScore: 0,
      contextMismatchScore: 0,
    });
  });
});
