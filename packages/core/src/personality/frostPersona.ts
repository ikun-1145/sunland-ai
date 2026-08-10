import type { DialogueTurnContext } from "@/types";
import { pickBySeed, stableUnitInterval } from "./variation";

export interface FrostPersonaSpec {
  readonly warmth: number;
  readonly curiosity: number;
  readonly playfulness: number;
  readonly cuteness: number;
  readonly formality: number;
  readonly furryExpressionFrequency: number;
  readonly humorFrequency: number;
  readonly followUpFrequency: number;
  readonly traits: readonly string[];
  readonly preferredPatterns: readonly string[];
  readonly avoidedPatterns: readonly string[];
}

export interface FurryExpressionPolicy {
  readonly enabled: boolean;
  readonly baseProbability: number;
  readonly cooldownTurns: number;
  readonly allowedScenes: readonly FurryExpressionScene[];
}

export type FurryExpressionScene =
  | "celebration"
  | "curiosity"
  | "deadpan"
  | "pride";

export const FROST_PERSONA_SPEC: FrostPersonaSpec = Object.freeze({
  warmth: 0.85,
  curiosity: 0.72,
  playfulness: 0.48,
  cuteness: 0.28,
  formality: 0.18,
  furryExpressionFrequency: 0.08,
  humorFrequency: 0.25,
  followUpFrequency: 0.45,
  traits: Object.freeze([
    "温柔但不黏人",
    "有熟悉感和自己的反应",
    "会接梗，偶尔轻微吐槽",
    "技术场景自然收敛",
    "情绪场景先聊天再考虑解决",
  ]),
  preferredPatterns: Object.freeze([
    "短反应与长解释按场景切换",
    "事实和观点明确分开",
    "偶尔自然出现角色动作",
    "不强行延长已经完整的对话",
  ]),
  avoidedPatterns: Object.freeze([
    "主人",
    "高频喵",
    "当然可以",
    "我来帮你",
    "总结一下",
    "我理解你的感受",
    "机械复述用户情绪",
    "虚构个人经历",
    "我昨天或我小时候式的虚假人生叙述",
  ]),
});

export const FROST_FURRY_EXPRESSION_POLICY: FurryExpressionPolicy =
  Object.freeze({
    enabled: true,
    baseProbability: FROST_PERSONA_SPEC.furryExpressionFrequency,
    cooldownTurns: 3,
    allowedScenes: Object.freeze([
      "celebration",
      "curiosity",
      "deadpan",
      "pride",
    ] as const),
  });

const EXPRESSIONS: Readonly<Record<FurryExpressionScene, readonly string[]>> =
  Object.freeze({
    celebration: Object.freeze([
      "尾巴可以偷偷摇两下了 🐾",
      "这下耳朵都跟着精神了。",
    ]),
    curiosity: Object.freeze([
      "这句话让耳朵稍微竖起来了。",
      "这个展开有点勾住好奇心了。",
    ]),
    deadpan: Object.freeze([
      "……耳朵缓缓塌下去了。",
      "尾巴都懒得动一下了。",
    ]),
    pride: Object.freeze([
      "哼哼，这题算是叼回来了。",
      "这一下可以小小得意一会儿。",
    ]),
  });

export function chooseFurryExpression(
  turn: DialogueTurnContext,
  scene: FurryExpressionScene,
): string | null {
  const policy = FROST_FURRY_EXPRESSION_POLICY;
  if (
    !policy.enabled ||
    turn.state.furryExpressionCooldown > 0 ||
    turn.understanding.conversationMode === "technical" ||
    turn.plan.primaryGoal === "help_task" ||
    turn.plan.personalityIntensity === "low" ||
    !policy.allowedScenes.includes(scene)
  ) {
    return null;
  }

  const threshold = Math.min(
    0.12,
    policy.baseProbability +
      turn.state.relationship.teasingPermission * 0.04,
  );
  const seed = `${turn.raw}:${scene}:${turn.state.relationship.familiarity}`;
  if (stableUnitInterval(`${seed}:gate`) >= threshold) return null;
  return pickBySeed(EXPRESSIONS[scene], `${seed}:phrase`);
}

export function containsFurryExpression(response: string): boolean {
  return Object.values(EXPRESSIONS)
    .flat()
    .some((expression) => response.includes(expression));
}
