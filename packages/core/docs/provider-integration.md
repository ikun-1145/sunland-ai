# API 客户端集成指南

当前生产边界是 Cloudflare Worker HTTP API。Web、Flutter 和未来客户端不得嵌入 Core Bundle，也不得在客户端复制符号决策。

## 客户端职责

客户端应：

1. 从应用认证系统获取短期 application JWT；
2. 为每个用户 turn 生成稳定且唯一的 turnId；
3. 提交 conversationId、turnId、input 和可选 observationMode；
4. 对网络失败使用同一 turnId 和完全相同的 body 重试；
5. 将最终 response 当作普通文本安全渲染；
6. 根据 HTTP status 与 error.code 处理认证、冲突、限频和服务不可用；
7. 对删除 Knowledge、Memory 或 Context 提供清楚的范围说明与确认。

客户端不得：

- 发送或信任 body userId；
- 解析 Intent、Semantic Candidate 或 Observation 以建立第二套路由；
- 直接写 Knowledge、Memory 或 Context；
- 根据关键词伪造 Core 回复；
- 把其他 AI Provider 回复冒充 Sunland Core；
- 把 JWT、用户输入或诊断写入公开日志。

## Turn 请求

~~~ts
interface TurnRequest {
  conversationId: string;
  turnId: string;
  input: string;
  observationMode?: "off" | "summary";
}

const response = await fetch(
  "https://ai-core.sunland.dev/v1/turns",
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${applicationJwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      conversationId,
      turnId,
      input,
      observationMode: "off",
    }),
  },
);
~~~

客户端应在请求开始时捕获原始 conversationId 和 turnId。切换会话、退出登录或取消后，迟到 response 不能写入当前 UI 会话。

完整字段与错误见 [HTTP API](../../../docs/api.md)。

## 幂等重试

turnId 是同一用户下的幂等键。超时或 503 后重试必须保留：

- 相同 turnId；
- 相同 conversationId；
- 相同 input；
- 相同 observationMode。

任何字段变化都应生成新 turnId。服务端对不同载荷复用 turnId 返回 409，而不是猜测客户端意图。

## 状态范围

- Knowledge 与姓名 Memory 属于用户，可跨会话使用。
- Semantic Context 属于用户 + conversationId。
- 聊天 transcript 由本仓库外的聊天层拥有。
- 删除一个 Context 不会删除 Knowledge、Memory 或 transcript。
- 删除 Knowledge 不会删除姓名 Memory 或 Context。

客户端 UI 必须准确表达这些边界。

## Observation

observationMode 默认为 off。summary 只用于经批准的隐私安全诊断。Observation Summary 是白名单、分桶、版本化对象，不包含原始输入，但客户端仍不能用它推断用户身份、改变回复或决定状态写入。

## Provider 隔离

其他模型 Provider 与 Sunland 是独立路径。客户端可以在新会话中选择 Provider，但不能在已建立的 Sunland 会话中静默切换并保留同一身份。Sunland 的 Knowledge、Memory、Context 与 Personality 规则不能复制到其他 Provider Prompt。
