# Knowledge 与 Memory 边界

## 状态分类

| 状态 | 内容 | 生产作用域 |
|---|---|---|
| Knowledge | 用户明确教给 Core 的世界事实三元组 | 已验证用户 |
| Memory | 关于当前用户的受限记忆，例如姓名 | 已验证用户 |
| Conversation Context | 跨轮指代、话题与查询补全的最小快照 | 已验证用户 + 会话 |
| Self Knowledge | Sunland/Frost 的内置身份与能力事实 | Core 内置，只读 |

聊天 transcript 和账号身份不属于以上 Core 状态。

## Knowledge 模型

事实采用结构化记录：

~~~ts
interface KnowledgeRecord {
  id: string;
  subject: string;
  relation: string;
  object: string;
  negated: boolean;
  confidence: number;
  source: "user" | "inference" | "seed" | "import";
  createdAt: string;
}
~~~

Knowledge 不是 Prompt 或任意文本。生产存储以 user_id 隔离，并对字段长度、confidence、source 和时间做数据库及导入校验。

## 教学契约

- 只有明确、完整、非冲突且通过 Core 安全门控的陈述可以写入。
- Semantic Candidate 只能提出理解，不能直接执行副作用。
- 查询、禁止写入、证据不足、复合冲突或不完整表达不能被宿主转成写入。
- 教学后的事实可以在同一用户状态中查询和推理。
- Relation fallback、Context 补全和普通查询都是只读操作。
- API 只接受自然语言 turn；没有绕过 Core 的任意 Knowledge 创建接口。

## Memory 契约

Memory 保存关于用户的受限键值记录，与世界知识严格分离。当前公开对话行为包括记住与回忆姓名，API 提供单独删除姓名的路由。

宿主不得把账号资料、邮箱、Token、完整聊天历史或推断偏好自动写入 Memory。新增 Memory key 需要产品边界、输入证据、删除语义、迁移和隐私评审。

## Self Knowledge

Core 身份事实位于独立 Self Knowledge：

- 不属于用户 Knowledge；
- 不写入 Supabase 用户状态；
- 不计入空用户的 KnowledgeStore；
- Identity 回复由这些事实、Planner 和 Personality 共同生成。

客户端、API 和外部 Provider 不得定义第二份 Sunland/Frost 身份事实。

## 生产持久化

apps/api 从 Supabase 加载 Knowledge 和 Memory，构造临时同步 StorageAdapter，执行 Engine，再把完整下一状态交给 sunland_commit_turn RPC 原子提交。

Core 自身只认识同步 StorageAdapter：

~~~ts
interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
~~~

该接口不负责身份或数据库隔离。生产隔离由已验证 JWT id、Repository 查询条件、数据库外键/权限和事务函数共同保证。

## 外部调用

仓库内宿主可以从 @sunland-ai/core 使用 createSunlandEngine、createKnowledgeStore 与公开类型，但不能导入内部 Self Knowledge、Memory 实现或持久化文件。生产客户端通过 [HTTP API](../../../docs/api.md) 查询或删除状态，不直接调用 SDK。
