# 本地开发指南

## 环境要求

- Node.js 20 或更高版本
- 支持 npm workspaces 的 npm
- 运行 API 时需要可访问的 Supabase 开发项目和对应服务端密钥
- 部署时需要 Cloudflare 账号与 Wrangler 登录状态

从仓库根目录安装依赖：

~~~bash
npm install
~~~

不要提交 node_modules、dist、.wrangler、tsbuildinfo 或本地密钥文件。

## 常用命令

| 命令 | 作用 |
|---|---|
| npm run typecheck | 对所有有 typecheck script 的 workspace 做类型检查 |
| npm test | 运行 Core 与 API 的 Vitest |
| npm run build | 检查 Core、构建 Playground，并对 Worker 做 dry-run build |
| npm run dev:playground | 启动 Vite Playground |
| npm run dev:api | 启动 Wrangler 本地开发服务 |
| npm run test:contract --workspace @sunland-ai/core | 运行 Core SDK、恢复与 API Surface 契约 |
| npm test --workspace @sunland-ai/api | 只运行 Worker/API 测试 |

仓库当前没有 lint script。不要把 npm run lint 写进发布或贡献步骤。

## Core 开发

Core 测试通常与源码放在 packages/core/src 下。修改某个模块时先运行对应测试文件：

~~~bash
npm exec --workspace @sunland-ai/core -- vitest run src/parser/parser.test.ts
~~~

然后运行 workspace 检查：

~~~bash
npm run typecheck --workspace @sunland-ai/core
npm test --workspace @sunland-ai/core
npm run test:contract --workspace @sunland-ai/core
~~~

外部代码必须从 @sunland-ai/core 导入，不能引用 src 下的实现路径。API Surface 契约失败时先判断是否发生了意外导出；不要直接更新基线。

## Playground 开发

~~~bash
npm run dev:playground
~~~

Playground 根据以下顺序选择语言：

1. localStorage 中支持的 lang 值；
2. 浏览器语言；
3. 英文回退。

支持 zh、zh-Hant、en、ja、ko、es。当前面板都是占位界面，开发时不要假设已有 API 请求、推理可视化或知识编辑行为。

## API 本地环境

复制示例文件：

~~~bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
~~~

填写仅用于开发的值：

~~~dotenv
APP_JWT_PRIMARY_SECRET=development-primary-secret
APP_JWT_LEGACY_SECRET=development-legacy-secret
SUPABASE_PROJECT_URL=https://example.supabase.co
SUPABASE_SECRET_KEY=development-server-only-key
~~~

不要使用示例字符串作为部署密钥，也不要把真实值写进文档、测试或 Git。

启动 Worker：

~~~bash
npm run dev:api
~~~

Wrangler 默认本地地址通常是 http://localhost:8787；以终端实际输出为准。

健康检查：

~~~bash
curl http://localhost:8787/healthz
~~~

调用 /v1/* 需要测试应用签发的 HS256 JWT。JWT 至少需要有效 exp 和字符串 id；生产配置还提供预期 issuer。使用专门测试账号和非敏感输入，不能把真实 JWT 放进 shell history、截图或问题描述。

完整请求格式见 [HTTP API](api.md)。

## 配置名称

优先使用：

- APP_JWT_PRIMARY_SECRET
- APP_JWT_LEGACY_SECRET
- SUPABASE_PROJECT_URL
- SUPABASE_SECRET_KEY

APP_JWT_SECRET、SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 只是为了无停机轮换保留的旧别名。新环境不应从旧名开始。

APP_JWT_ISSUER、CORS_ORIGINS 和 CORE_VERSION 由 wrangler.jsonc 提供。不要在本地代码中写死另一套值。

## 变更后的验证

运行时代码或配置变化：

~~~bash
npm run typecheck
npm test
npm run build
git diff --check
~~~

纯文档变化：

~~~bash
git diff --check
~~~

同时确认：

- 文档中的每个命令都存在；
- 相对链接指向真实文件；
- 没有把 Playground 计划能力写成已实现；
- 没有把客户端 Bundle 旧架构写成当前生产架构；
- git status 中没有密钥、构建产物或无关文件。
