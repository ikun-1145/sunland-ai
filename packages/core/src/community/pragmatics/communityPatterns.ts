import type {
  CommunityDomain,
  CommunityResolution,
  PragmaticCommunicativeGoal,
  SocialTone,
} from "@/types";

export interface CommunityPragmaticPattern {
  readonly id: string;
  readonly expression: RegExp;
  readonly domains?: readonly CommunityDomain[];
  readonly semanticTags?: readonly string[];
  readonly requiresCommunityContext?: boolean;
  /** Resolves deliberate overlaps between a phrase and its shorter base act. */
  readonly priority?: number;
  readonly communicativeGoal: PragmaticCommunicativeGoal;
  readonly socialTone: SocialTone;
  readonly literalness: number;
  readonly impliedEmotion: readonly string[];
  readonly reactionPattern: string;
  readonly confidence: number;
}

export interface CommunityPragmaticMatch {
  readonly pattern: CommunityPragmaticPattern;
  readonly confidence: number;
}

function pattern(
  value: CommunityPragmaticPattern,
): CommunityPragmaticPattern {
  return Object.freeze({
    ...value,
    ...(value.domains === undefined
      ? {}
      : { domains: Object.freeze([...value.domains]) }),
    ...(value.semanticTags === undefined
      ? {}
      : { semanticTags: Object.freeze([...value.semanticTags]) }),
    impliedEmotion: Object.freeze([...value.impliedEmotion]),
  });
}

/**
 * Phrase-level community patterns. The ordinary lexicon remains responsible
 * for word senses; these rules only describe common utterance-shaped acts.
 */
export const COMMUNITY_PRAGMATIC_PATTERNS: readonly CommunityPragmaticPattern[] =
  Object.freeze([
    pattern({ id: "furry-out-hot", expression: /(?:出毛|穿毛|毛装).{0,10}(?:热|闷|汗|蒸|累)|(?:热|闷|汗|蒸|累).{0,10}(?:出毛|穿毛|毛装)/u, domains: ["furry"], communicativeGoal: "vent", socialTone: "playful", literalness: 0.7, impliedEmotion: ["exhaustion"], reactionPattern: "furry-heat", confidence: 0.94 }),
    pattern({ id: "furry-no-rua", expression: /(?:没人|没有|都不|没得).{0,5}(?:rua|撸毛|摸毛)|(?:rua|撸毛|摸毛)不到|毛.{0,6}摸不到|摸不到.{0,6}毛/u, domains: ["furry"], communicativeGoal: "complain", socialTone: "playful", literalness: 0.58, impliedEmotion: ["playful_disappointment"], reactionPattern: "furry-no-rua", confidence: 0.91 }),
    pattern({ id: "furry-con-return", expression: /(?:兽展|兽聚|毛聚).{0,8}(?:回来|结束|返程)|(?:刚从|从).{0,6}(?:兽展|兽聚|毛聚).{0,5}(?:回来|回家)/u, domains: ["furry"], communicativeGoal: "share", socialTone: "excited", literalness: 0.9, impliedEmotion: ["afterglow"], reactionPattern: "furry-event-return", confidence: 0.93 }),
    pattern({ id: "furry-suit-arrived", expression: /(?:毛装|毛毛|兽装).{0,8}(?:到了|到手|收到|出货|做好)|(?:终于|总算).{0,5}(?:到手|收到).{0,5}(?:毛装|毛毛|兽装)/u, domains: ["furry"], semanticTags: ["FURSUIT", "FURSUIT_ACQUISITION"], communicativeGoal: "celebrate", socialTone: "excited", literalness: 0.94, impliedEmotion: ["excitement"], reactionPattern: "furry-arrival", confidence: 0.96 }),
    pattern({ id: "furry-suit-delay", expression: /(?:毛装|毛毛|兽装).{0,10}(?:延期|延迟|没发|没好|鸽了|翻车)/u, domains: ["furry"], communicativeGoal: "vent", socialTone: "annoyed", literalness: 0.86, impliedEmotion: ["disappointment"], reactionPattern: "furry-delay", confidence: 0.94 }),
    pattern({ id: "furry-fursona-commission", expression: /(?:兽设|fursona).{0,8}(?:约稿|委托|找画师|立绘)|(?:约|委托).{0,5}(?:兽设|fursona)/iu, domains: ["furry", "art"], communicativeGoal: "share", socialTone: "excited", literalness: 0.92, impliedEmotion: ["anticipation"], reactionPattern: "fursona-commission", confidence: 0.93 }),
    pattern({ id: "furry-photo-return", expression: /(?:场照|返图|合照).{0,8}(?:到了|出来|返了|收到)|(?:兽展|兽聚).{0,8}(?:场照|返图|合照)/u, domains: ["furry", "cosplay"], communicativeGoal: "celebrate", socialTone: "excited", literalness: 0.9, impliedEmotion: ["excitement"], reactionPattern: "photo-return", confidence: 0.92 }),
    pattern({ id: "furry-social-wait", expression: /(?:扩列|求扩).{0,8}(?:蹲|等)|(?:蹲|等).{0,8}(?:扩列|求扩)/u, domains: ["furry", "internet"], communicativeGoal: "invite_interaction", socialTone: "friendly", literalness: 0.82, impliedEmotion: ["social_anticipation"], reactionPattern: "community-connect", confidence: 0.88 }),

    pattern({ id: "goods-favorite-release", expression: /(?:我推|本命|自推).{0,8}(?:出谷|上新|新谷|周边)|(?:出谷|上新|新谷).{0,8}(?:我推|本命|自推)/u, domains: ["goods", "acg"], semanticTags: ["FAVORITE_MERCH_RELEASE"], communicativeGoal: "share", socialTone: "excited", literalness: 0.66, impliedEmotion: ["purchase_temptation"], reactionPattern: "wallet-pressure", confidence: 0.96 }),
    pattern({ id: "goods-repeat-release", expression: /(?:又|怎么又|居然又).{0,8}(?:出谷|上新|新谷|周边)|(?:出谷|上新).{0,5}(?:没完|不停)/u, domains: ["goods"], communicativeGoal: "complain", socialTone: "playful", literalness: 0.54, impliedEmotion: ["overwhelmed_excitement"], reactionPattern: "wallet-pressure", confidence: 0.93 }),
    pattern({ id: "goods-too-much", expression: /(?:谷|周边).{0,6}(?:太多|爆了|堆满|塞不下)|(?:买|收).{0,5}(?:太多|一堆).{0,5}(?:谷|周边)/u, domains: ["goods"], communicativeGoal: "vent", socialTone: "self_deprecating", literalness: 0.74, impliedEmotion: ["overwhelm"], reactionPattern: "merch-overflow", confidence: 0.91 }),
    pattern({ id: "goods-eat-soil", expression: /(?:吃谷.{0,8}吃土|吃土.{0,8}(?:谷|周边)|钱包.{0,3}(?:空|瘪|阵亡|没了))|(?:买|收|吃谷).{0,8}(?:破产|没钱)/u, domains: ["goods"], communicativeGoal: "joke", socialTone: "self_deprecating", literalness: 0.2, impliedEmotion: ["budget_pressure"], reactionPattern: "wallet-pressure", confidence: 0.97 }),
    pattern({ id: "goods-cannot-afford", expression: /(?:谷|周边|徽章|吧唧).{0,8}(?:买不起|收不起|预算不够|超预算)|(?:买不起|收不起|预算不够|超预算).{0,8}(?:谷|周边|徽章|吧唧)/u, domains: ["goods"], communicativeGoal: "vent", socialTone: "annoyed", literalness: 0.9, impliedEmotion: ["budget_pressure"], reactionPattern: "budget-limit", confidence: 0.9 }),
    pattern({ id: "goods-trade", expression: /(?:换谷|换物|出物|回收|收物|交换).{0,10}(?:成功|到了|有人|蹲)|(?:成功|终于).{0,5}(?:换到|收到|出掉)/u, domains: ["goods"], communicativeGoal: "share", socialTone: "excited", literalness: 0.92, impliedEmotion: ["relief"], reactionPattern: "merch-trade", confidence: 0.89 }),
    pattern({ id: "goods-box-buy", expression: /(?:我|又|这次|直接)?.{0,3}端盒(?:了|走|拿下)?/u, domains: ["goods"], communicativeGoal: "share", socialTone: "excited", literalness: 0.88, impliedEmotion: ["collection_commitment"], reactionPattern: "merch-box", confidence: 0.91 }),
    pattern({ id: "goods-cannot-collect", expression: /(?:谷|周边|吧唧).{0,6}(?:收不动|吃不动|端不动)|(?:收不动|吃不动|端不动).{0,6}(?:谷|周边|吧唧)/u, domains: ["goods"], communicativeGoal: "vent", socialTone: "annoyed", literalness: 0.66, impliedEmotion: ["collection_fatigue"], reactionPattern: "collection-limit", confidence: 0.9 }),
    pattern({ id: "goods-recover-budget", expression: /(?:出谷|出物).{0,6}回血|回血.{0,6}(?:出谷|周边|谷子)/u, domains: ["goods"], communicativeGoal: "share", socialTone: "playful", literalness: 0.42, impliedEmotion: ["budget_recovery"], reactionPattern: "budget-recovery", confidence: 0.93 }),

    pattern({ id: "art-commission-open", expression: /(?:老师|画师|太太).{0,8}(?:开稿|开委托|放档期|开槽)|(?:开稿|开委托|放档期|开槽).{0,8}(?:老师|画师|太太)/u, domains: ["art"], semanticTags: ["COMMISSION_OPEN", "CREATOR_COMMISSION"], communicativeGoal: "share", socialTone: "excited", literalness: 0.73, impliedEmotion: ["opportunity"], reactionPattern: "commission-open", confidence: 0.95 }),
    pattern({ id: "art-commission-finally", expression: /(?:终于|总算|抢到|约到).{0,8}(?:稿|委托|档期)/u, domains: ["art"], communicativeGoal: "celebrate", socialTone: "excited", literalness: 0.93, impliedEmotion: ["relief", "excitement"], reactionPattern: "commission-success", confidence: 0.95 }),
    pattern({ id: "art-delivered", expression: /(?:稿|成图|立绘|设定图|委托).{0,8}(?:到了|返了|完成|交付)|(?:终于|总算).{0,5}(?:返稿|出图|收到稿)/u, domains: ["art"], communicativeGoal: "celebrate", socialTone: "excited", literalness: 0.95, impliedEmotion: ["satisfaction"], reactionPattern: "art-delivered", confidence: 0.94 }),
    pattern({ id: "art-delayed", expression: /(?:稿|委托|画师|老师).{0,8}(?:鸽了|延期|拖了|没回|失联)|(?:鸽|拖).{0,5}(?:稿|委托)/u, domains: ["art"], communicativeGoal: "vent", socialTone: "annoyed", literalness: 0.84, impliedEmotion: ["disappointment"], reactionPattern: "commission-delay", confidence: 0.93 }),
    pattern({ id: "art-wait-open", expression: /(?:蹲|等).{0,8}(?:开稿|开委托|档期)|(?:开稿|开委托).{0,8}(?:蹲|等)/u, domains: ["art"], priority: 1, communicativeGoal: "invite_interaction", socialTone: "excited", literalness: 0.7, impliedEmotion: ["anticipation"], reactionPattern: "commission-wait", confidence: 0.97 }),
    pattern({ id: "art-character-new-look", expression: /(?:设子|OC).{0,8}(?:新衣|新设|新造型|新立绘)|(?:新衣|新设|新造型).{0,8}(?:设子|OC)/iu, domains: ["art", "acg"], communicativeGoal: "share", socialTone: "excited", literalness: 0.88, impliedEmotion: ["creative_excitement"], reactionPattern: "character-new-look", confidence: 0.92 }),

    pattern({ id: "acg-favorite-failed", expression: /(?:我推|本命|自推).{0,8}(?:寄了|没了|退场|下线|被刀|凉了)/u, domains: ["acg"], communicativeGoal: "vent", socialTone: "playful", literalness: 0.22, impliedEmotion: ["fictional_grief"], reactionPattern: "favorite-pain", confidence: 0.96 }),
    pattern({ id: "acg-official-sugar", expression: /(?:官方|编剧|制作组).{0,8}(?:发糖|递糖|撒糖|喂糖)|(?:发糖|递糖|撒糖).{0,8}(?:官方|编剧|制作组)/u, domains: ["acg"], communicativeGoal: "celebrate", socialTone: "excited", literalness: 0.38, impliedEmotion: ["shipping_excitement"], reactionPattern: "official-sugar", confidence: 0.97 }),
    pattern({ id: "acg-official-knife", expression: /(?:官方|编剧|制作组).{0,8}(?:发刀|递刀|捅刀|刀我)|(?:发刀|递刀|捅刀).{0,8}(?:官方|编剧|制作组)/u, domains: ["acg"], communicativeGoal: "vent", socialTone: "playful", literalness: 0.28, impliedEmotion: ["story_pain"], reactionPattern: "official-knife", confidence: 0.97 }),
    pattern({ id: "acg-official-wild", expression: /官方.{0,5}(?:杀疯了|疯了|不做人)/u, domains: ["acg"], requiresCommunityContext: true, communicativeGoal: "joke", socialTone: "excited", literalness: 0.16, impliedEmotion: ["overwhelmed_excitement"], reactionPattern: "official-wild", confidence: 0.88 }),
    pattern({ id: "acg-episode-great", expression: /(?:这集|这一集|这一话|本集|新一集).{0,8}(?:神了|封神|太爽|绝了|好看)/u, domains: ["acg"], communicativeGoal: "share", socialTone: "excited", literalness: 0.68, impliedEmotion: ["excitement"], reactionPattern: "episode-great", confidence: 0.91 }),
    pattern({ id: "acg-episode-absurd", expression: /(?:这集|这一话|本集|新一集).{0,8}(?:离谱|逆天|什么鬼|抽象)/u, domains: ["acg"], communicativeGoal: "joke", socialTone: "playful", literalness: 0.5, impliedEmotion: ["amused_disbelief"], reactionPattern: "episode-absurd", confidence: 0.91 }),
    pattern({ id: "acg-shipping-hit", expression: /(?:磕到了|磕死(?:我了)?|磕疯了)/u, domains: ["acg"], semanticTags: ["SHIPPING_EXCITEMENT"], communicativeGoal: "celebrate", socialTone: "excited", literalness: 0.3, impliedEmotion: ["shipping_excitement"], reactionPattern: "shipping-hit", confidence: 0.95 }),
    pattern({ id: "acg-fan-power", expression: /(?:厨力).{0,6}(?:爆发|全开|拉满)|(?:我厨|厨爆).{0,8}(?:了|这次|今天)?/u, domains: ["acg"], semanticTags: ["CHARACTER_FANDOM"], communicativeGoal: "celebrate", socialTone: "excited", literalness: 0.48, impliedEmotion: ["fandom_enthusiasm"], reactionPattern: "fan-power", confidence: 0.91 }),
    pattern({ id: "acg-ooc", expression: /(?:OOC|崩人设).{0,8}(?:了|严重|太|得)?|(?:角色|剧情).{0,8}(?:OOC|崩人设)/iu, domains: ["acg"], semanticTags: ["OUT_OF_CHARACTER"], communicativeGoal: "complain", socialTone: "annoyed", literalness: 0.75, impliedEmotion: ["characterization_disappointment"], reactionPattern: "character-ooc", confidence: 0.93 }),
  ]);

function semanticTagsOf(resolution: CommunityResolution): ReadonlySet<string> {
  return new Set([
    ...resolution.matches.map(({ semanticTag }) => semanticTag),
    ...resolution.compositions.map(({ semanticTag }) => semanticTag),
  ]);
}

function contextSupport(
  pattern: CommunityPragmaticPattern,
  resolution: CommunityResolution,
): number {
  const tags = semanticTagsOf(resolution);
  if (pattern.semanticTags?.some((tag) => tags.has(tag))) return 0.05;
  if (pattern.domains?.some((domain) => resolution.activeDomains.includes(domain))) {
    return 0.03;
  }
  return 0;
}

export function matchCommunityPragmaticPatterns(
  input: string,
  resolution: CommunityResolution,
): readonly CommunityPragmaticMatch[] {
  return Object.freeze(
    COMMUNITY_PRAGMATIC_PATTERNS
      .filter((candidate) =>
        candidate.expression.test(input) &&
        (
          candidate.requiresCommunityContext !== true ||
          candidate.domains?.some((domain) =>
            resolution.activeDomains.includes(domain),
          ) === true
        ),
      )
      .map((candidate) => Object.freeze({
        pattern: candidate,
        confidence: Math.min(
          0.99,
          candidate.confidence + contextSupport(candidate, resolution),
        ),
      }))
      .sort((left, right) =>
        right.confidence - left.confidence ||
        (right.pattern.priority ?? 0) - (left.pattern.priority ?? 0) ||
        left.pattern.id.localeCompare(right.pattern.id),
      ),
  );
}
