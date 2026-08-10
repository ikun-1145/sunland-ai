import { describe, expect, it } from "vitest";
import { createSunlandEngine } from "@/engine";
import { COMMUNITY_LANGUAGE_EVALUATION_SET } from "./communityEvaluationSet";
import { COMMUNITY_LEXICON, normalizeCommunityLexeme } from "./communityLexicon";
import { resolveCommunityLanguage } from "./communityResolver";

const REQUIRED_ALIASES = [
  "福瑞", "furry", "兽圈", "兽迷", "兽控", "毛毛", "兽设", "fursona", "OC", "设子",
  "兽装", "毛装", "fursuit", "全装", "半装", "头壳", "装主", "毛替", "陪同", "出毛",
  "收毛", "约毛", "毛聚", "兽展", "rua", "rua毛", "rua一下", "rua毛毛", "扩列",
  "求扩列", "来扩列", "扩个列", "蹲扩列", "原创角色", "人设", "设定", "世界观",
  "约稿", "稿子", "稿件", "开稿", "开委托", "委托", "接稿", "排单", "档期", "单主",
  "画师", "老师", "太太", "大触", "无偿", "有偿", "私稿", "商稿", "模板稿", "白菜",
  "心水", "蹲蹲", "蹭蹭", "返图", "设定图", "立绘", "头像稿", "半身", "全身", "三视图",
  "参考图", "ref", "refsheet", "二次元", "ACG", "番", "新番", "追番", "补番", "弃番",
  "神作", "厕纸", "烂尾", "推", "我推", "本命", "厨", "担", "同担", "同担拒否", "CP",
  "磕CP", "磕到了", "官配", "拉郎", "拆CP", "逆CP", "逆家", "对家", "地雷", "老婆",
  "老公", "女儿", "儿子", "厨力", "产粮", "吃粮", "发粮", "粮", "刀子", "发刀", "糖",
  "发糖", "萌", "萌点", "属性", "OOC", "崩人设", "谷子", "吃谷", "买谷", "谷圈", "谷美",
  "谷阵", "吧唧", "徽章", "亚克力", "立牌", "色纸", "透卡", "痛包", "痛柜", "痛桌", "痛屋",
  "柄图", "官谷", "同人谷", "特典", "景品", "set", "大盘", "端盒", "初伤", "瑕", "无瑕",
  "回血", "出谷", "收谷", "cos", "cosplay", "coser", "出cos", "出角", "角色", "妆娘",
  "毛娘", "摄影", "摄影老师", "试妆", "试毛", "正片", "场照", "场照返图", "外拍", "私影",
  "集邮", "集邮照", "撤装", "假毛", "毛", "假发", "道具", "服化道", "CN", "圈名", "绷",
  "绷不住", "蚌埠住了", "寄", "寄了", "彻底寄了", "破防", "红温", "汗流浃背", "逆天",
  "离谱", "抽象", "草", "草生", "笑死", "笑不活了", "狠狠", "狠狠地", "狠狠幸福", "蹲",
  "码住", "插眼", "狠狠拿捏", "拿捏了", "赢麻了", "麻了", "裂开",
] as const;

describe("Community Language Evaluation Set", () => {
  it("contains the requested 140 fixed cases with balanced domains", () => {
    expect(COMMUNITY_LANGUAGE_EVALUATION_SET).toHaveLength(140);
    for (const [category, expected] of Object.entries({
      furry: 25,
      acg: 25,
      goods: 20,
      art: 20,
      cosplay: 20,
      ambiguity: 30,
    })) {
      expect(
        COMMUNITY_LANGUAGE_EVALUATION_SET.filter((item) => item.category === category),
      ).toHaveLength(expected);
    }
    expect(new Set(COMMUNITY_LANGUAGE_EVALUATION_SET.map(({ id }) => id)).size).toBe(140);
  });

  it("contains every required first-batch lexeme", () => {
    const aliases = new Set(
      COMMUNITY_LEXICON.flatMap(({ aliases: termAliases }) =>
        termAliases.map(normalizeCommunityLexeme),
      ),
    );
    for (const alias of REQUIRED_ALIASES) {
      expect(aliases, `missing community alias: ${alias}`).toContain(
        normalizeCommunityLexeme(alias),
      );
    }
  });

  it("resolves every positive case into its expected domain", () => {
    for (const item of COMMUNITY_LANGUAGE_EVALUATION_SET) {
      if (!item.shouldResolve) continue;
      const resolution = resolveCommunityLanguage(item.input);
      expect(
        resolution.matches.length,
        `expected a community match for ${item.id}: ${item.input}`,
      ).toBeGreaterThan(0);
      expect(
        resolution.activeDomains,
        `expected ${item.expectedDomain} for ${item.id}: ${item.input}`,
      ).toContain(item.expectedDomain);
    }
  });

  it("keeps all 30 ordinary ambiguity cases outside community semantics", () => {
    for (const item of COMMUNITY_LANGUAGE_EVALUATION_SET) {
      if (item.shouldResolve) continue;
      expect(
        resolveCommunityLanguage(item.input).matches,
        `false positive for ${item.id}: ${item.input}`,
      ).toEqual([]);
    }
  });

  it("never explains known vocabulary unless the input asks for a definition", () => {
    const engine = createSunlandEngine();
    for (const item of COMMUNITY_LANGUAGE_EVALUATION_SET.filter(
      ({ shouldResolve }) => shouldResolve,
    )) {
      const response = engine.respond(item.input);
      expect(response.length, item.id).toBeGreaterThan(0);
      expect(response, `${item.id}: ${item.input}`).not.toMatch(
        /(?:是一个|是一种).{0,8}(?:术语|网络词)|你的意思是|翻译成标准中文/u,
      );
    }
  });
});
