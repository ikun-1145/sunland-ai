# Sunland AI 总体架构

本文描述当前仓库中的生产架构、包边界与状态所有权。更细的 Core 内部约束见 [Core 架构](../packages/core/docs/architecture.md)。

## 设计目标

Sunland AI 把确定性的符号决策集中在一个与框架无关的 Core 中，并由服务端统一执行。客户端只负责获取应用身份、发送请求和渲染最终文本，不能下载 Core 或复制其中的解析、推理与写入规则。

系统需要同时满足：

- 同一输入与状态得到确定性结果；
- 用户状态和会话 Context 隔离；
- 同一 turn 可安全重试；
- 并发 turn 不覆盖彼此；
- 持久化失败不返回虚假成功；
- 旧客户端升级期间保留明确、可审计的数据库安全门禁。

## 运行时组件

~~~mermaid
flowchart TD
  Client["Web / Flutter / 其他已认证客户端"] -->|"Bearer application JWT"| Edge["Cloudflare Worker handler"]
  Edge --> CORS["Origin allowlist"]
  Edge --> JWT["HS256 signature, expiry, issuer/id validation"]
  JWT --> Brain["SunlandUserBrain Durable Object"]
  Brain --> Rate["Per-user rate window"]
  Brain --> Repo["SupabaseRepository"]
  Repo --> Snapshot["Load user revision, Knowledge, Memory, Context"]
  Snapshot --> Session["coreSession"]
  Session --> Core["@sunland-ai/core"]
  Core --> Result["Response + next state"]
  Result --> RPC["sunland_commit_turn RPC"]
  RPC --> DB[("Supabase durable state")]
~~~

公开的 GET /healthz 在认证前返回服务状态。其他路由先检查带 Origin 请求的 allowlist，再验证 JWT，最后用 JWT id claim 选择 Durable Object。请求体中的任何用户标识都不是身份来源。

Worker 转发到 Durable Object 前会移除 Authorization header，并注入仅供内部使用的已验证用户 ID。Durable Object 为每个用户串行处理请求，并在持久层执行乐观并发与幂等检查。

## 包边界

### Core

packages/core 是唯一符号决策核心。外部包只从 @sunland-ai/core 导入；源码级唯一入口是 packages/core/src/sdk.ts。

Core 内部总体方向为：

~~~text
types / utils
  -> parser / semantic / community / knowledge / memory / dialogue
  -> reasoners / planner
  -> personality
  -> engine
  -> sdk
~~~

engine/sunlandEngine.ts 是组合根。Personality 只负责最终表达，不能改变事实、推理结果、置信度或状态所有权。

Core 不依赖 Cloudflare、Supabase、HTTP、认证、React、DOM 或外部模型。时间、Storage 等需要测试的运行时行为通过接口注入。

### Worker API

apps/api 是生产宿主，负责 Core 明确不拥有的边界：

- JWT 验证与 CORS；
- HTTP 路由、输入大小和字段校验；
- 每用户限频；
- idempotency 与 revision conflict；
- Supabase 读写和失败转换；
- 旧本地状态的一次性导入；
- 过期 turn result 的定时清理。

Core 无权信任用户身份或选择数据库行；API 也无权复制 Core 的 Intent、Semantic、Reasoner 或 Personality 决策。

### Playground

apps/playground 是独立的 Vite/React 开发脚手架。当前只实现根据浏览器语言或 localStorage 的 lang 值显示六种语言的四面板占位界面。它不连接 API，也没有可交互的推理图或知识编辑器。

## 状态所有权

| 状态 | 作用域 | 所有者 | 说明 |
|---|---|---|---|
| Knowledge | 用户 | Supabase | 用户明确教给 Core 的结构化事实 |
| Memory | 用户 | Supabase | 关于用户的受限记忆，例如姓名 |
| Semantic Context | 用户 + 会话 | Supabase | 跨轮指代、话题和查询补全所需的最小快照 |
| revision | 用户 | Supabase | 所有持久化状态的乐观并发版本 |
| turn result | 用户 + turnId | Supabase | 七天内的幂等响应与请求 hash |
| migration receipt | 用户 + migrationId | Supabase | 本地状态导入的幂等回执 |
| rate window | 用户 | Durable Object storage | 一分钟窗口内最多 60 次请求 |
| transcript | 用户 + 会话 | 本仓库外的客户端/聊天服务 | 不属于 Core 状态 |
| verified identity | 应用会话 | 应用认证系统与 Worker | Core 不可见 |

Knowledge 和 Memory 可跨会话共享；Context 必须绑定原用户和原会话。账号资料、Token、完整聊天记录和原始输入不能自动写进 Core Memory 或 Context。

## Turn 一致性

POST /v1/turns 的一致性流程：

1. 校验 conversationId、turnId、input 与 observationMode。
2. 对规范化请求计算 SHA-256。
3. 如果同一用户已有 turnId：
   - hash 相同：直接返回已保存响应；
   - hash 不同：返回 409 turn_id_reused。
4. 加载最新用户 revision、Knowledge、Memory 与该会话 Context。
5. 在内存中重建 Engine 并执行一次 turn。
6. RPC 在锁定用户 revision 后原子写入新状态、响应与下一 revision。
7. 发生一次 revision conflict 时重新加载并重算；第二次冲突或其他持久化失败直接失败。

该流程保证响应与副作用一起提交，不会出现“回复成功但记忆未保存”的已确认 turn。

## 数据库边界

sunland_ai_* 表对 public、anon 和 authenticated 关闭，由服务端凭据访问。数据库函数完成 turn 原子提交与旧状态导入。

仓库还包含旧 Sunland 表的分阶段安全迁移。准备迁移不会提前破坏历史客户端；deferred 迁移只有在签名强制升级门禁完成后才启用旧表的最终 RLS/权限收紧。详细顺序见 [部署手册](deployment.md)。

## 演进规则

- 新客户端协议应扩展 HTTP API，而不是把 Core 移到客户端。
- 新持久化字段必须明确用户/会话作用域、校验、迁移、并发和清理策略。
- 新 Core 能力必须通过 engine 组合，并有固定评估或契约测试。
- 公开 SDK、HTTP 请求/响应、Context schema 和数据库函数变化都要按兼容性边界评审。
- 不能把历史文档中的计划或早期 Bundle 架构重新当作当前事实。
