import { NEGATIVE_CONTEXT, POSITIVE_SURFACE } from "./socialSignals";

export interface SarcasmResolution {
  readonly confidence: number;
  readonly positiveSurface: boolean;
  readonly negativeContext: boolean;
}

const EXPLICIT_IRONY = /(?:呵呵|可真有你的|真有你的|谢谢你啊|好一个|这下好了|这下舒服了).{0,16}(?:崩|失败|报错|删|丢|错|翻车|寄|没了|延期|鸽|炸|挂)/u;
const IRONIC_ORDER = /(?:真棒|真不错|真聪明|太好了|(?:好|太)贴心|真厉害|漂亮|完美|优秀|可真行|天才|聪明绝顶|这下舒服了).{0,24}(?:崩|失败|报错|删|没保存|没备份|忘保存|丢|坏|又错|全错|翻车|寄|延期|鸽|炸|挂)|(?:崩|失败|报错|删|没保存|没备份|忘保存|丢|坏|又错|全错|翻车|寄|延期|鸽|炸|挂).{0,24}(?:真棒|真不错|真聪明|太好了|(?:好|太)贴心|真厉害|漂亮|完美|优秀|可真行|天才|聪明绝顶|这下舒服了)/u;

export function resolveSarcasm(input: string): SarcasmResolution {
  const positiveSurface = POSITIVE_SURFACE.test(input);
  const negativeContext = NEGATIVE_CONTEXT.test(input);
  let confidence = 0.05;
  if (EXPLICIT_IRONY.test(input)) confidence = 0.94;
  else if (IRONIC_ORDER.test(input)) confidence = 0.88;
  else if (positiveSurface && negativeContext) confidence = 0.76;
  else if (positiveSurface) confidence = 0.08;
  return Object.freeze({ confidence, positiveSurface, negativeContext });
}
