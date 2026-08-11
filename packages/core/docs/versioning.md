# Sunland Core 版本规则

## 当前版本来源

Core 使用 MAJOR.MINOR.PATCH Semantic Version，当前为 0.1.0。变更版本时必须保持以下位置一致：

- 根 package.json；
- packages/core/package.json；
- apps/api/package.json；
- apps/playground/package.json；
- packages/core/src/observation/types.ts 的 SUNLAND_CORE_VERSION；
- packages/core/contracts/sdk-api-surface.v0.1.0.json 的 sdkVersion；
- apps/api/wrangler.jsonc 中 production 与 staging 的 CORE_VERSION。

仓库当前没有自动版本同步、Bundle manifest 或公开包发布脚本，因此维护者必须在评审中逐项核对，并由测试保护 Core constant 与 contract。

## 0.x 政策

| 变化 | 版本要求 |
|---|---|
| 纯文档或测试说明，运行行为与契约不变 | 通常不单独升级；随下一发布记录 |
| 向后兼容修复，不改公开 API/schema/持久化语义 | PATCH |
| 新增公开导出、能力、HTTP 可观察行为或 schema | MINOR |
| 删除/重命名导出、改签名/响应/默认行为或不兼容持久化 | MINOR，且必须有迁移说明 |

即使 SemVer 允许 0.x 快速变化，0.1.x 也不接受无迁移的破坏性变更。

## 1.x 以后

- PATCH：向后兼容修复。
- MINOR：向后兼容新能力或 API 扩展。
- MAJOR：任何破坏性变化。

## 公开契约

以下变化需要兼容性评审：

- @sunland-ai/core 的运行时导出与公共 TypeScript 签名；
- Engine option、默认值、response 或异常/降级语义；
- Semantic Context 与 Observation schema；
- Knowledge、Memory、Context 或 turn result 的持久含义；
- HTTP path、请求/响应字段、error code、幂等与限频语义；
- 数据库表、RPC 参数和权限；
- 默认 Personality 或已测试的用户可见行为；
- 新的宿主运行时依赖。

内部文件路径、Candidate、Rule ID、Policy ID 和搜索顺序不属于公开契约，但内部变化仍不能破坏固定行为测试。

## API Surface 基线

contracts/sdk-api-surface.v0.1.0.json 冻结 0.1.0 的 70 个运行时导出。修改基线不是解决意外导出测试失败的方法。

只有经批准的版本变化才能新建或替换对应基线，并同时更新：

- package 与常量版本；
- SDK/HTTP 文档；
- 兼容性或迁移说明；
- contract 与恢复测试；
- Worker CORE_VERSION；
- [项目长期记忆](../../../docs/project-memory.md)中的稳定版本事实。

## Schema 版本

SEMANTIC_SCHEMA_VERSION、CONTEXT_SCHEMA_VERSION 和 OBSERVATION_SCHEMA_VERSION 与 Core SemVer 独立。Schema 变化必须提供规范化/迁移路径，覆盖旧快照、损坏值、迟到更新与未来未知版本，不能只升级 Core version。
