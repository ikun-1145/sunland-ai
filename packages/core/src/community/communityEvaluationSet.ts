import type { CommunityDomain } from "@/types";

export type CommunityEvaluationCategory =
  | "furry"
  | "acg"
  | "goods"
  | "art"
  | "cosplay"
  | "ambiguity";

export interface CommunityLanguageEvalCase {
  readonly id: string;
  readonly category: CommunityEvaluationCategory;
  readonly input: string;
  readonly shouldResolve: boolean;
  readonly expectedDomain?: CommunityDomain;
}

function positiveCases(
  category: Exclude<CommunityEvaluationCategory, "ambiguity">,
  expectedDomain: CommunityDomain,
  inputs: readonly string[],
): readonly CommunityLanguageEvalCase[] {
  return inputs.map((input, index) => Object.freeze({
    id: `${category}-${String(index + 1).padStart(2, "0")}`,
    category,
    input,
    shouldResolve: true,
    expectedDomain,
  }));
}

function ambiguityCases(inputs: readonly string[]): readonly CommunityLanguageEvalCase[] {
  return inputs.map((input, index) => Object.freeze({
    id: `ambiguity-${String(index + 1).padStart(2, "0")}`,
    category: "ambiguity" as const,
    input,
    shouldResolve: false,
  }));
}

const FURRY_CASES = positiveCases("furry", "furry", [
  "周末准备出毛",
  "今天出毛热死了",
  "周末有人一起出毛吗",
  "下周去兽展出毛",
  "这个兽装头壳太帅了",
  "全装终于做好了",
  "半装带出去方便点",
  "毛装的配色很舒服",
  "这个 fursuit 好有辨识度",
  "我的兽设终于定稿了",
  "fursona 的三视图画完了",
  "兽圈新人来报道",
  "我是刚入坑的兽迷",
  "这个兽控朋友太会选设定了",
  "周末想约毛拍照",
  "这次毛聚人好多",
  "下周兽展见",
  "最近准备收毛",
  "我的毛终于到了",
  "好想 rua 毛毛",
  "这个毛好想 rua",
  "今天给毛毛拍照去了",
  "装主说可以拍照",
  "这次让毛替上场",
  "出毛的时候有人陪同吗",
]);

const ACG_CASES = positiveCases("acg", "acg", [
  "最近又掉进 ACG 坑了",
  "二次元浓度有点高",
  "这季度新番好多",
  "最近在追番",
  "准备补番了",
  "这部我中途弃番了",
  "这部真的是神作",
  "这剧情写得像厕纸",
  "最后两集彻底烂尾",
  "这个角色是我推",
  "这位稳坐本命位",
  "我厨爆这个角色",
  "我是纯纯角色厨",
  "居然碰到同担了",
  "她有点同担拒否",
  "这对 CP 我磕到了",
  "官方终于认了官配",
  "这个拉郎居然很好吃",
  "别突然拆 CP 啊",
  "我不太吃逆 CP",
  "这段互动真的磕死我了",
  "官方今天又发糖了",
  "这个剧情刀子太狠了",
  "这段表现有点 OOC",
  "这个反差就是萌点",
]);

const GOODS_CASES = positiveCases("goods", "goods", [
  "今天新谷子到了",
  "我最近开始混谷圈",
  "今天又吃谷了",
  "忍不住买谷了",
  "第一次做谷美",
  "周末准备摆谷阵",
  "这个吧唧好好看",
  "徽章背面有点小瑕疵",
  "这个亚克力通透度不错",
  "立牌摆桌上正合适",
  "这张色纸构图很好",
  "透卡叠起来效果不错",
  "准备扎个痛包",
  "痛柜终于整理完了",
  "这个柄图太会选了",
  "我推的官谷终于出了",
  "这套同人谷做得真好",
  "特典居然比本体还香",
  "这盒准备直接端盒",
  "最近想出谷回血",
]);

const ART_CASES = positiveCases("art", "art", [
  "我的 OC 终于画完了",
  "这个原创角色很有记忆点",
  "最近想约个设子",
  "这套人设挺完整",
  "世界观终于补齐了",
  "刚约稿成功",
  "稿子已经排到了下个月",
  "老师什么时候开稿",
  "这个画师开委托了吗",
  "最近准备接稿",
  "排单已经排满了",
  "档期要等到年底",
  "单主把需求写得很清楚",
  "这个画师的构图好稳",
  "这个老师画得好神",
  "这位太太的新图太强了",
  "大触随手一画都好看",
  "这张是私稿不能商用",
  "商稿授权范围要看清",
  "新立绘和三视图终于齐了",
]);

const COSPLAY_CASES = positiveCases("cosplay", "cosplay", [
  "第一次尝试 cosplay",
  "这个 coser 还原度好高",
  "周末准备出 cos",
  "这次漫展想出角",
  "妆娘把眼妆改好了",
  "毛娘正在修假发",
  "等摄影老师返图",
  "昨天试妆翻车了",
  "晚上再试毛一次",
  "正片终于修完了",
  "这组场照氛围很好",
  "场照返图速度好快",
  "周末约了外拍",
  "这次准备拍私影",
  "今天在漫展集邮",
  "集邮照已经塞满相册",
  "太热了先撤装",
  "假毛还要重新修一下",
  "道具和服化道终于齐了",
  "我的 CN 和圈名是同一个",
]);

const AMBIGUITY_CASES = ambiguityCases([
  "把代码推到远端",
  "请把门推开",
  "这个工具值得推荐",
  "执行 git push",
  "今天早餐吃谷物",
  "山谷里的风很大",
  "今年稻谷丰收",
  "五谷杂粮很健康",
  "老师今天讲数学",
  "学校老师通知开会",
  "班主任老师在教室",
  "老师今天讲了函数",
  "我家猫最近掉毛",
  "狗狗正在换毛",
  "头发有一点毛躁",
  "数据库这一列不能为空",
  "Excel 这一列要填日期",
  "数组和列表有什么区别",
  "厨师正在厨房做饭",
  "周末准备亲自下厨",
  "快递已经寄了",
  "我去邮寄一份文件",
  "我老婆说今晚回家吃饭",
  "我女儿今天去上学",
  "他从小喜欢收集邮票",
  "这颗糖果有点甜",
  "菜刀需要磨一下",
  "仓库里还有很多粮食",
  "草地刚刚修剪过",
  "这个对象的属性字段为空",
]);

export const COMMUNITY_LANGUAGE_EVALUATION_SET: readonly CommunityLanguageEvalCase[] =
  Object.freeze([
    ...FURRY_CASES,
    ...ACG_CASES,
    ...GOODS_CASES,
    ...ART_CASES,
    ...COSPLAY_CASES,
    ...AMBIGUITY_CASES,
  ]);
