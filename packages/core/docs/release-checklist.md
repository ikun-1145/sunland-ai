# Sunland Core 变更发布清单

本清单用于发布包含 Core 变化的 Worker 版本。当前 Core 是 private workspace package，不生成公开 npm 包或客户端 Bundle。本清单不授权 commit、push、部署、迁移或密钥操作。

## 1. 范围与版本

- [ ] 变更已限定在批准的能力、修复或内部重构范围。
- [ ] 按 [versioning.md](./versioning.md) 判断是否需要版本变化。
- [ ] packages/core/package.json、SUNLAND_CORE_VERSION、API Surface sdkVersion、apps/api/package.json 和 wrangler CORE_VERSION 一致。
- [ ] 没有把 Playground 计划或历史 Bundle 流程写成已发布能力。

## 2. 公开契约

- [ ] 宿主仍只从 @sunland-ai/core 导入。
- [ ] 检查公开导出、类型签名、默认值、Context/Observation schema、持久化格式和用户可见行为。
- [ ] 运行 Core contract suite；失败时不直接改基线。
- [ ] 经批准的兼容性变化有版本决策、迁移与恢复测试。

## 3. 验证

~~~bash
npm run typecheck
npm test
npm run build
git diff --check
~~~

- [ ] Core SDK、恢复和 70-export API Surface 契约通过。
- [ ] API 认证、隔离、幂等、revision conflict 与持久化失败测试通过。
- [ ] 固定 community、pragmatics、dialogue 与 initiative 评估集通过。
- [ ] 没有未跟踪 Secret、.dev.vars、dist、依赖或本机文件。

## 4. 行为与安全

- [ ] 生产客户端仍通过 HTTP API 使用 Core。
- [ ] Identity 只来自已验证 JWT id。
- [ ] Knowledge、Memory 与 Context 作用域未被放宽。
- [ ] 写入仍通过副作用安全门控。
- [ ] Observation 不包含原始输入、身份或精确隐私数据。
- [ ] 持久化失败不返回成功。
- [ ] 数据库或认证变化已经单独批准。

## 5. Staging 与生产

- [ ] 按 [部署手册](../../../docs/deployment.md) 配置 staging。
- [ ] 认证 contract、幂等重试、跨用户隔离、删除范围与强制 Supabase 失败全部验证。
- [ ] 大陆三网可达性门禁通过。
- [ ] deferred legacy RLS migration 仍未被正常部署应用。
- [ ] 获得明确授权后才执行 commit、push、部署或迁移。
