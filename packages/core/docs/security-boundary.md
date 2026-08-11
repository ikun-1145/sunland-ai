# 安全边界

## 信任模型

Sunland Core 是确定性的符号引擎，不是认证、权限或网络安全系统。

| 数据/组件 | 信任状态 | 责任方 |
|---|---|---|
| 用户输入 | 不可信 | API 限制 + Core 解析与安全降级 |
| application JWT | 不可信直到验证 | Worker auth |
| verified user id | Worker 内可信、Core 不可见 | Worker/Durable Object |
| Conversation owner | Core 不可见 | API 与数据库键 |
| 恢复的 Context | 不可信 | Core normalize |
| Knowledge/Memory snapshot | 不可信持久化数据 | Repository 映射 + Core 加载器 |
| legacy migration payload | 不可信 | API validation + DB constraints |
| Observation Summary | 受限诊断 | Core 白名单与二次校验 |
| UI 渲染 | Core 外部 | 客户端安全渲染 |

## 身份与路由

Worker 只接受 Bearer JWT，要求 HS256、有效签名、未过期 exp 和长度受限的字符串 id。配置 issuer 时，存在但不匹配的 iss 会被拒绝。

用户身份来自已验证 JWT id，不来自 body、query、email 或客户端缓存。Worker 转发 Durable Object 前删除 Authorization，并写入内部 x-sunland-user-id。公网客户端不能依赖或伪造该内部 header 获得其他用户状态，因为路由层会覆盖它。

## 状态隔离

- Durable Object 以 verified id 命名，每个用户串行处理请求。
- Supabase 查询和 RPC 都包含 user_id。
- Knowledge 与 Memory 按用户隔离。
- Context 按用户 + conversationId 隔离。
- turn result 按用户 + turnId 隔离。
- sunland_ai_* 表撤销 public、anon 与 authenticated 访问，只授予服务端角色。

Core 不读取 Token、邮箱、Supabase Session 或用户账号对象。

## 输入与副作用

- 默认 JSON body 最大 64 KiB；legacy migration 最大 8 MiB。
- turn、cursor、ID、输入、记录数量、字符串、时间、confidence、source 和 Context 版本都有界。
- Semantic 分析不直接写 Knowledge/Memory。
- 不完整、歧义、冲突、禁止或证据不足的副作用输入必须澄清或安全拒绝。
- 未知输入和内部异常不能向用户泄漏 Candidate、Policy ID、置信度、堆栈或数据库详情。
- API Repository 日志只记录固定事件、HTTP 状态、无 query 的资源路径和 Supabase request ID。

## 幂等、并发与失败

turn 请求 hash 与结果一起持久化。相同载荷重放返回已有结果，不同载荷复用 ID 返回 409。用户 revision 在事务内锁定，API 最多重算一次。

Knowledge、Memory、Context、revision 和 response 在同一 RPC 中提交。Supabase 失败返回 503；不能返回尚未持久化的成功文本。

## 数据最小化

Context 只保存有界实体、关系、话题和 ConversationState。Observation Summary 只允许固定枚举与分桶值。两者都不得包含原始输入、用户 ID、邮箱、Token、完整 Knowledge/Memory 或 transcript。

turn result 会保存最终 response 用于七天幂等重试，因此其访问和过期清理属于敏感持久化边界。

## 依赖边界

Core 不得依赖 React、DOM、Flutter、Cloudflare、Supabase、HTTP、认证或外部 AI Provider。生产客户端不能导入 Core 内部文件或嵌入 Core Bundle。

其他模型 Provider 必须保持独立，不能复制 Sunland/Frost 身份与状态，也不能把其结果冒充 Core response。

## Core 之外的职责

- 登录、Token 签发/刷新和账号权限；
- CORS、TLS、域名与网络可达性；
- Supabase 角色、RLS、备份和迁移；
- Markdown/HTML/XSS 过滤；
- transcript、文件上传与付费；
- 客户端取消和迟到 UI 响应；
- Secret 管理和供应链保护。

这些职责由宿主实现，但不能借此复制或绕过 Core 算法。

## Legacy 数据库门禁

新 sunland_ai_* 表与旧 conversations/usage 等表的安全状态不同。准备迁移期间，旧表的最终 RLS 收紧仍受历史签名强制升级门禁约束。不能把已安装但尚未强制执行的 policy 描述为完整隔离。详见 [部署手册](../../../docs/deployment.md)。
