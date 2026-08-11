# 为 Sunland AI 贡献

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md)

感谢你帮助改进 Sunland AI。本项目倾向小而有证据支持的变更，并要求保持确定性 Core 与服务端安全边界。

## 开始之前

请先阅读：

1. [README.zh-CN.md](README.zh-CN.md)：产品与仓库概览。
2. [docs/architecture.md](docs/architecture.md)：运行链路和状态所有权。
3. Core 变更对应的 [packages/core/docs](packages/core/docs/) 详细文档。
4. 使用 AI 编程工具时阅读 [AGENTS.md](AGENTS.md)。

提出新抽象前，先搜索仓库中已有代码、测试和文档。新增功能或做重要设计决策时，应查看持续维护的上游项目和官方文档，借鉴已验证的模式，并说明所选方案为什么适合本仓库。

## 开发环境

要求：

- Node.js 20 或更高版本
- 支持 workspaces 的 npm

~~~bash
npm install
npm run typecheck
npm test
npm run build
~~~

本地服务和环境变量配置见 [docs/development.md](docs/development.md)。

## 仓库约定

- 运行时代码变更应尽可能小，并严格限定在需求范围。
- 复用已有抽象，保持包边界。
- 不新增第二套解析器、推理链路、持久化所有者或客户端 Core。
- 遵循现有严格 TypeScript 与 ESM 风格。
- 行为变更需要补充聚焦的 Vitest 测试和有意义的边界用例。
- Context、持久化快照、HTTP 输入和迁移载荷都必须视为不可信。
- 禁止提交凭据、JWT、用户数据、.dev.vars、依赖目录或生成的构建产物。
- 共同的入门事实变化时，同时更新英文与简中 README。

## 测试

迭代时先运行最小相关检查：

~~~bash
npm test --workspace @sunland-ai/core
npm run test:contract --workspace @sunland-ai/core
npm test --workspace @sunland-ai/api
~~~

提交运行时或配置变更前运行：

~~~bash
npm run typecheck
npm test
npm run build
git diff --check
~~~

仅修改文档时，应根据当前仓库验证命令和链接，并运行 git diff --check。仓库目前没有 lint 脚本。

## 数据库、认证与公开契约

数据库 Schema、认证、权限、破坏性 API 和大型重构必须先经过明确设计评审。

正常开发或部署不得应用 supabase/migrations/deferred 下的迁移。不能为了放过意外导出而直接修改 Core API Surface 契约。参见：

- [docs/deployment.md](docs/deployment.md)
- [packages/core/docs/security-boundary.md](packages/core/docs/security-boundary.md)
- [packages/core/docs/versioning.md](packages/core/docs/versioning.md)

## Commit 与 Pull Request

使用描述清楚的分支和 Conventional Commit 标题：

~~~text
feat(core): add a bounded reasoning capability
fix(api): reject conflicting turn replay
docs: refresh contributor documentation
~~~

每个 Commit 都应便于审查。Pull Request 应说明用户可见结果、受影响的架构边界、执行过的测试、安全或迁移注意事项，以及明确不支持的情况。

除非维护者明确授权，否则贡献过程中不得部署、应用迁移、轮换密钥、创建 Tag 或发布版本。
