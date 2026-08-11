# Conversation Context 契约

Semantic Context 用于跨轮指代、话题连续性、查询补全和受限对话状态。它不是聊天历史、Memory、Knowledge 或用户身份。

## 所有权

- Core 负责规范化输入快照、读取当前轮所需信息并产生乐观更新。
- 服务端宿主负责把快照绑定到已验证用户和原始 conversationId。
- Supabase 以 user_id + conversation_id 持久化 Context。
- Core 不使用模块级状态保存 Context。
- 客户端不读取或合并 Context；它只提交 conversationId。

## Envelope

~~~ts
interface SemanticContext {
  readonly schemaVersion: 1;
  readonly version: number;
  readonly recentTurns: readonly SemanticTurnSummary[];
  readonly conversationState?: ConversationState;
}
~~~

recentTurns 只保留有界 turn ID、Intent、概念、实体引用、焦点关系和查询形状。conversationState 是经过规范化的有界对话摘要，可承载话题、社交与主动性连续性，但不保存原始消息。

Context 不应包含用户 ID、邮箱、Token、完整输入、完整回复、Knowledge、Memory 或聊天 transcript。

## 处理流程

~~~ts
import {
  applySemanticContextUpdate,
  createSunlandEngine,
  normalizeSemanticContext,
} from "@sunland-ai/core";

const engine = createSunlandEngine({
  semanticMode: "passive",
  semanticContextMode: "enabled",
});

const context = normalizeSemanticContext(restoredValue);
const result = engine.process("它会什么", {
  semanticContext: context,
  turnId: requestId,
  canCommitSemanticContext: () => requestStillOwnsConversation(),
});

const nextContext = applySemanticContextUpdate(
  context,
  result.semanticContextUpdate,
);
~~~

生产 API 在已验证用户的 Durable Object 中加载 Context，执行 Core，然后把 nextContext 与 Knowledge、Memory 和 turn result 放进同一 Supabase RPC。

宿主不得复制 normalizeSemanticContext 或 applySemanticContextUpdate 的实现。

## 乐观并发

更新包含 baseVersion，replace 更新还包含 nextVersion。applySemanticContextUpdate 只接受精确基于当前版本、并且 nextVersion = baseVersion + 1 的更新。迟到结果不能覆盖更新快照。

API 还使用用户级 revision 对 Knowledge、Memory 和全部会话状态做事务并发控制。一次冲突会重新加载并重算；继续冲突则失败。

取消、身份变化、会话删除或请求失效时，宿主的 canCommitSemanticContext 必须拒绝 Context 更新。生产 API 的用户与会话归属由认证路由和数据库键额外保护。

## 损坏数据

恢复值是不可信输入，必须交给 normalizeSemanticContext。无效 envelope、非法版本或损坏 turn 会安全归一化；合法相邻记录可保留。宿主不能自行跳过规范化或接受未来 schema。

## 兼容性

- schemaVersion 当前为 1。
- version 是同一用户同一会话内的乐观并发值，不是 Core SemVer。
- schema、字段含义或 ConversationState 持久化变化需要显式迁移与恢复测试。
- HTTP 客户端不应依赖 Context 内部结构；服务端 API 是生产边界。
