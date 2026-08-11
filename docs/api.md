# Sunland AI HTTP API

本文记录 apps/api 当前实现的 HTTP 契约。生产地址和部署顺序见 [部署手册](deployment.md)。

## 通用规则

- GET /healthz 公开可用。
- 所有 /v1/* 路由都需要 Authorization: Bearer <application-jwt>。
- JWT 必须使用 HS256，包含未过期的整数 exp 和长度 1–128 的字符串 id。
- Worker 从已验证 id 推导用户；请求中的 userId 不会成为身份依据。
- 带 Origin 的请求必须命中 CORS_ORIGINS allowlist。
- 成功 JSON 响应使用 application/json、no-store 和 nosniff。
- 每个已验证用户在一个一分钟计数窗口内最多 60 个 Durable Object 请求。

错误使用统一结构：

~~~json
{
  "error": {
    "code": "invalid_request",
    "message": "面向用户的错误说明"
  }
}
~~~

## 健康检查

### GET /healthz

不需要认证。

~~~bash
curl https://ai-core.sunland.dev/healthz
~~~

~~~json
{
  "status": "ok",
  "service": "sunland-ai-core",
  "coreVersion": "0.1.0"
}
~~~

健康检查只证明 Worker 可响应，不证明 Supabase、认证 turn 或客户端链路正常。

## 执行 turn

### POST /v1/turns

~~~bash
curl --request POST https://ai-core.sunland.dev/v1/turns \
  --header "Authorization: Bearer <application-jwt>" \
  --header "Content-Type: application/json" \
  --data '{
    "conversationId": "conversation-123",
    "turnId": "turn-456",
    "input": "你好",
    "observationMode": "off"
  }'
~~~

请求字段：

| 字段 | 类型 | 约束 |
|---|---|---|
| conversationId | string | trim 后 1–128 字符 |
| turnId | string | trim 后 1–128 字符；同一用户下的幂等键 |
| input | string | trim 后 1–4000 字符 |
| observationMode | off 或 summary | 可选，默认 off |

响应：

~~~json
{
  "conversationId": "conversation-123",
  "turnId": "turn-456",
  "response": "你好。",
  "stateRevision": 8
}
~~~

observationMode 为 summary 时，响应可能增加 observationSummary。该对象经过白名单与分桶校验，不包含原始输入或用户身份。客户端应把它视为版本化、不透明的诊断数据，不能用它驱动业务决策。

### 幂等与并发

服务端会对校验后的请求计算 hash：

- 相同用户、相同 turnId、相同请求：返回已保存响应，不重复写入；
- 相同用户、相同 turnId、不同请求：返回 409 turn_id_reused；
- 并发造成 revision conflict：服务端最多重新加载和重算一次；
- 持久化失败：返回错误，不返回未提交的 response。

客户端重试失败 turn 时必须复用原 turnId 和完全相同的请求内容。

## Knowledge

### GET /v1/knowledge

查询参数：

- limit：默认 50，整数时限制到 1–100；非整数回退为 50。
- cursor：可选，上一页 nextCursor，最长 128 字符。

~~~bash
curl "https://ai-core.sunland.dev/v1/knowledge?limit=50" \
  --header "Authorization: Bearer <application-jwt>"
~~~

~~~json
{
  "items": [],
  "nextCursor": null
}
~~~

### DELETE /v1/knowledge

删除当前已验证用户的全部教学 Knowledge，成功返回 204。

### DELETE /v1/knowledge/:id

删除当前已验证用户指定 ID 的 Knowledge，成功返回 204。路径 ID 必须做 URL 编码。

这些路由不会删除姓名 Memory、Conversation Context 或聊天 transcript。

## Memory

### DELETE /v1/memory/name

删除当前已验证用户 key=name 的 Memory，成功返回 204。它不会删除 Knowledge、Context 或 transcript。

## Conversation Context

### DELETE /v1/conversations/:conversationId/context

删除当前已验证用户在指定会话下的 Semantic Context，成功返回 204。conversationId URL 解码并 trim 后必须为 1–128 字符。

它不会删除用户级 Knowledge、Memory 或外部聊天记录。

## 导入旧本地状态

### POST /v1/migrations/local-state

该路由用于把旧客户端状态迁入服务端。请求体最大 8 MiB。

~~~json
{
  "migrationId": "migration-001",
  "knowledge": [],
  "memory": [],
  "contexts": []
}
~~~

限制：

- migrationId：1–128 字符；
- knowledge：最多 5000 条；
- memory：最多 100 条；
- contexts：最多 500 条；
- 时间必须可解析并规范化为 ISO 时间；
- Knowledge confidence 必须在 0–1；
- Context 必须是 schemaVersion 1、非负安全整数 version，并包含 recentTurns 数组。

同一用户和 migrationId 可幂等重放相同载荷；不同载荷复用 migrationId 会返回 409 migration_id_reused。

## 常见状态码

| 状态码 | 典型含义 |
|---|---|
| 200 | JSON 请求成功 |
| 204 | 删除成功或 CORS preflight 成功 |
| 400 | JSON、字段、cursor 或迁移状态无效 |
| 401 | 缺少、无效或过期 JWT |
| 403 | Origin 不在 allowlist |
| 404 | 路由不存在 |
| 409 | turnId/migrationId 冲突或并发 revision 冲突 |
| 413 | 请求体过大 |
| 429 | 用户级限频 |
| 500 | 未处理的服务端错误 |
| 503 | 认证配置、存储或持久化暂时不可用 |

客户端应根据 HTTP 状态与 error.code 处理错误，不应解析中文 message 来决定程序分支。
