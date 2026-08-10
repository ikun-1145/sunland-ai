export const LAUGHTER_CUE = /(?:哈哈+|嘿嘿+|233+|笑死|绷不住|lol|lmao|😂|🤣|😆|😅|～|~)/iu;
export const PLAYFUL_PUNCTUATION = /(?:[！!]{2,}|[？?]{2,}|[～~]|[！？?!]{3,})/u;
export const TASK_CUE = /(?:帮我|麻烦|请(?:帮|看|分析|解释|修复|排查|写|做)|能不能|可以帮|给我(?:写|做|分析|整理)|你(?:帮我)?(?:看看|看下)|看一下)/u;
export const NEGATIVE_CONTEXT = /(?:崩|失败|报错|删了|没保存|没备份|丢了|坏了|又错|三个错误|全错|翻车|寄了|没了|延期|鸽了|不行|卡住|超时|拒绝|炸了|挂了|撤回)/u;
export const POSITIVE_SURFACE = /(?:真棒|真不错|真聪明|太好了|(?:好|太)贴心|真厉害|漂亮|完美|优秀|感谢|谢谢|可真行|干得漂亮|天才|聪明绝顶|这下舒服了)/u;
export const SELF_DEPRECATION = /(?:我(?:真|也太|怎么这么|是不是).{0,4}(?:蠢|笨|菜|废|垃圾)|我又搞砸|我真没用|我脑子呢|我和保存按钮.{0,5}(?:不熟|有仇)|我.{0,5}(?:天才|聪明绝顶).{0,12}(?:忘|没保存|搞砸|删|错|丢))/u;
export const SAVE_MISHAP = /(?:我)?(?:又)?(?:忘(?:了)?|没(?:有)?)保存/u;
export const USER_TO_FROST = /(?:^|[，,。！!？?\s])(?:你|霜蓝|ai)(?:这|也|真|是不是|怎么|就|可)?/iu;
export const INSULT = /(?:傻|笨|蠢|垃圾|废物|智障|没脑子|脑残|有病|恶心|滚|闭嘴)/u;
export const STRONG_ATTACK = /(?:废物|智障|脑残|去死|滚开|闭嘴|恶心死了|垃圾\s*ai)/iu;
export const THREAT = /(?:弄死你|杀了你|砸了你|毁了你|威胁你)/u;
export const SERIOUS_TONE_OVERRIDE = /(?:(?:别|不要|先别|停止|别再).{0,6}(?:玩梗|开玩笑|调侃)|认真(?:点|说)|说正经的|我没开玩笑|不是开玩笑)/u;

const SERIOUS_SAFETY_CUE = /(?:我(?:真的)?(?:想死|不想活|要自杀|准备自杀|想伤害自己)|自杀计划|伤害自己|有人(?:要)?杀我|生命危险|大量流血|割腕|吞药自杀)/u;
export const ABSTRACT_INTERNET_EXPRESSION = /(?:我死了|我要没了|笑死(?:我了)?|好看死了|累死了|困死了|烦死了|气死了|吓死了|贵死了|创死我|我推(?:寄了|没了|死了)|官方刀死我|甜死我|可爱死了|人麻了|裂开了?|杀疯了)/u;

export function requiresDedicatedSafetyHandling(input: string): boolean {
  return SERIOUS_SAFETY_CUE.test(input);
}

export function hasPlayfulMarker(input: string): boolean {
  if (SERIOUS_TONE_OVERRIDE.test(input)) return false;
  return LAUGHTER_CUE.test(input) || PLAYFUL_PUNCTUATION.test(input);
}
