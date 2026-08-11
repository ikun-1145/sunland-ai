# Sunland AI 部署手册

本文档覆盖 Cloudflare Worker、Supabase 迁移和旧客户端安全门禁。部署、密钥轮换、数据库迁移和生产探测都属于高影响操作，执行前必须获得明确授权。

## 环境与地址

| 环境 | Worker 名称 | 健康检查 |
|---|---|---|
| staging | sunland-ai-core-staging | https://ai-core-staging.sunland.dev/healthz |
| production | sunland-ai-core | https://ai-core.sunland.dev/healthz |

生产与 staging 使用独立的 Worker secret。不要通过复制日志、Issue、聊天或 CI 输出传递 secret。

## Worker 配置

优先配置：

- APP_JWT_PRIMARY_SECRET（Secret）：新的应用 JWT HMAC secret。
- APP_JWT_LEGACY_SECRET（Secret）：轮换窗口内保留的旧应用 JWT HMAC secret。
- SUPABASE_SECRET_KEY（Secret）：服务端专用 sb_secret_...，或迁移期旧 service-role JWT。
- SUPABASE_PROJECT_URL（plain variable）：Supabase 项目 URL。
- APP_JWT_ISSUER（plain variable）：默认 sunland-api。
- CORS_ORIGINS（plain variable）：逗号分隔的精确 Origin allowlist。
- CORE_VERSION（plain variable）：必须与 Core 版本一致。

运行时仍接受 APP_JWT_SECRET、SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY，目的仅是已有环境可以无停机迁移。新环境不得优先使用这些旧名。当前 wrangler.jsonc 的 required secret 元数据仍列出 SUPABASE_URL；运行时代码实际优先读取 SUPABASE_PROJECT_URL，因此发布前必须检查目标环境最终绑定，而不能只依赖该元数据。

SUPABASE_PROJECT_URL 不是凭据，不应包含 key 或 query secret。不要把任何 Secret 值写进 wrangler.jsonc、客户端、APK、日志、构建产物、Issue 或文档。

现代 sb_secret_... 只通过 apikey header 发送。只有旧 JWT service-role key 同时使用 Authorization: Bearer，因为 Supabase 会把现代 secret 误当 JWT 并拒绝。

## 配置 Secret

从 apps/api 目录执行，并分别配置 production 与 staging：

~~~bash
cd apps/api
npx wrangler secret put APP_JWT_PRIMARY_SECRET
npx wrangler secret put APP_JWT_LEGACY_SECRET
npx wrangler secret put SUPABASE_SECRET_KEY

npx wrangler secret put APP_JWT_PRIMARY_SECRET --env staging
npx wrangler secret put APP_JWT_LEGACY_SECRET --env staging
npx wrangler secret put SUPABASE_SECRET_KEY --env staging
~~~

命令会交互读取值，不要把 secret 直接放在命令行参数中。用 Cloudflare Dashboard 或经审核的配置流程设置 plain variable，并在部署前读取目标环境配置确认名称和值的环境归属。

应用网关在 primary 与 legacy 都被 Core/gateway 接受期间继续使用旧应用 secret 签名。后续单独评审后再切换签名到 primary；legacy 验证至少保留一个完整的七天应用 Token 生命周期。

## 发布前验证

从仓库根目录运行：

~~~bash
npm install
npm run typecheck
npm test
npm run build
git diff --check
~~~

确认：

- 工作树只包含本次已审核变更；
- package version、SUNLAND_CORE_VERSION、wrangler CORE_VERSION 和 SDK contract 一致；
- 没有 .dev.vars、真实 Token、Secret、用户数据或生成目录；
- 当前迁移集合与目标数据库状态匹配；
- deferred migration 不在正常迁移 glob 或执行列表中。

## 安全部署顺序

### 1. 数据库准备迁移

只应用 supabase/migrations 直属的编号迁移，并按文件名顺序执行。不要递归应用 deferred 目录。

这些迁移依赖已有 Sunland 表（包括 user_profiles、conversations、usage 等）。先在 staging 获取备份并核对现有 schema、函数签名、角色和策略；任何漂移都必须先评审，不能临时修改生产 SQL。

### 2. 部署 staging

~~~bash
cd apps/api
npx wrangler deploy --env staging
curl --fail --silent --show-error https://ai-core-staging.sunland.dev/healthz
~~~

健康检查只证明 Worker 能响应。还必须使用专门测试账号运行认证契约：

- 有效、无效、过期、错误算法与错误 issuer JWT；
- CORS allowlist 和拒绝路径；
- 同一 turnId + 相同 body 的幂等重放；
- 同一 turnId + 不同 body 的 409；
- revision conflict 重试；
- migration receipt 重放和冲突；
- 用户 A/B Knowledge、Memory 与 Context 隔离；
- 删除 Knowledge、姓名 Memory 与单会话 Context 的边界；
- 请求大小、字段长度与 60/min 限频；
- 强制 Supabase 失败时不返回成功。

测试数据必须非敏感，日志不能记录 JWT 或请求正文。

### 3. 大陆可达性门禁

从至少三个大陆城市，分别通过中国移动、中国联通和中国电信探测 staging 与 production 两次。记录 DNS、TLS、HTTP 状态和总延迟，不记录 JWT 或请求体。

如果直连 custom domain 不满足验收阈值，可在已有 api.sunland.dev Worker 中增加 Cloudflare Service Binding，并把同一 API 暴露到 /sunland/v1/*；不能创建开放 HTTP 代理。重复相同探测。两条路径都失败时，停止客户端清理和发布提升。

### 4. 部署 production

只有 staging 契约、大陆可达性、数据库检查和变更评审都通过后执行：

~~~bash
cd apps/api
npx wrangler deploy
curl --fail --silent --show-error https://ai-core.sunland.dev/healthz
~~~

随后用生产专用合成账号做最小认证 smoke test。不要用真实用户数据。

## 定时清理与监控

Worker cron 在每天 03:17 UTC 调用清理逻辑，删除过期的 sunland_ai_turn_results。每条 turn result 的过期时间由服务端设置为提交后七天。

发布后检查：

- Worker 5xx、503、409 与 429 比例；
- Supabase 请求失败事件和 request ID；
- Durable Object 异常；
- cron 是否运行；
- turn result 过期行是否下降；
- 不包含输入、Token、用户 ID 或状态快照的结构化日志。

## Deferred legacy RLS gate

不得应用 supabase/migrations/deferred/20260808_enforce_legacy_rls_after_forced_upgrade.sql，除非全部条件满足：

1. 历史 Android keystore、alias 和密码可用。
2. 历史签名 APK 可覆盖安装到 1.2.1+27，且不需要卸载。
3. GitHub Release 与 checksum 已发布。
4. 大陆 APK 下载验证成功。
5. update.json 已提升到强制版本，旧 App 无法绕过升级。
6. staging 上以 anon、authenticated 用户 A、用户 B 和 service_role 完成权限矩阵测试。
7. 已准备数据库备份、回滚步骤、维护窗口和负责人。

准备阶段的 restrictive policy 不等于最终隔离：PostgreSQL 在表未启用 RLS 时不会执行策略，而 restrictive policy 也需要允许访问的 permissive policy 配合。conversations 和 usage 在门禁前保留旧客户端兼容状态，不能被描述为已经完成跨用户 RLS 隔离。

Deferred 迁移后，重新以 anon、用户 A、用户 B、authenticated 与 service_role 测试全部旧表，再运行 Supabase Security 和 Performance Advisors。

## 回滚原则

- Worker 回滚使用 Cloudflare 已验证的上一部署版本，不修改或暴露 Secret。
- 代码回滚不能假设数据库迁移自动回滚；先评估新旧 Worker 对当前 schema 的兼容性。
- 不直接反向执行 destructive SQL。数据库回滚必须使用预先审核的恢复方案或备份。
- 如果持久化正确性、身份隔离或跨用户数据边界无法证明，停止流量提升并保留证据；不要用客户端重试掩盖问题。
