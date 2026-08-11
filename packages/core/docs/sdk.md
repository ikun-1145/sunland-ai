# Sunland Core SDK

## 定位

@sunland-ai/core 是本单仓库内的 private workspace package。apps/api 是当前生产宿主；外部客户端通过 HTTP API 使用 Sunland，不安装或嵌入 Core。

源码级唯一公开入口是 packages/core/src/sdk.ts。仓库内消费者使用：

~~~ts
import { createSunlandEngine } from "@sunland-ai/core";
~~~

禁止从 packages/core/src 的其他路径导入实现。

## 最小调用

~~~ts
import { createSunlandEngine } from "@sunland-ai/core";

const engine = createSunlandEngine({
  semanticMode: "passive",
  semanticContextMode: "enabled",
});

const reply = engine.respond("你好");
~~~

respond 适合无宿主 Context 的单轮调用。需要跨轮 Context、提交检查或 Observation Summary 时使用 process。

## createSunlandEngine

主要 options：

| 选项 | 作用 |
|---|---|
| knowledgeStore | 注入 KnowledgeStore；省略时创建空 Store |
| memory | 注入 MemoryManager；省略时创建空 Manager |
| personalityId | 选择已注册人格；默认 Frost |
| parser | 注入满足公开 Parser 契约的实现 |
| storage | 注入同步 StorageAdapter 与隔离 key |
| seedDemoData | 仅本地演示；空 Store 时写入示例事实，生产默认 false |
| semanticMode | off、passive 或 shadow；API 使用 passive |
| semanticContextMode | off 或 enabled；API 使用 enabled |
| semanticDebug | 仅内存保留最近隐私安全 Shadow 摘要，默认 false |
| semanticRuntime | 测试用纯运行时接缝 |
| understandingPolicy | 中央理解策略 |
| observationRuntime | Observation 的测试运行时接缝 |

生产 API 不使用 seedDemoData。

## Engine 接口

### engine.respond(input)

- 同步返回最终用户文本；
- 无法理解时安全降级；
- 明确教学或记忆输入可能更新当前 Engine 状态；
- Engine 保证异常不向调用者泄漏。

### engine.process(input, options)

options：

- semanticContext：宿主持有的不可信可序列化快照；
- turnId：稳定的宿主请求 ID；
- canCommitSemanticContext：提交前的取消、身份和原会话检查；
- observationMode：off 或 summary，默认 off。

结果：

~~~ts
interface SunlandProcessResult {
  readonly response: string;
  readonly semanticContextUpdate: SemanticContextUpdate;
  readonly observationSummary?: ObservationSummary;
}
~~~

Core 不保存 Context；宿主使用 applySemanticContextUpdate 合并乐观更新。

## Context 辅助函数

- createEmptySemanticContext()
- normalizeSemanticContext(value)
- applySemanticContextUpdate(current, update)

它们是 Context 规范化与更新的唯一公开入口。宿主不得复制 schema 合并逻辑。

## 其他公开面

src/sdk.ts 统一导出 Engine、Knowledge、Parser、Personality、Observation、Storage 的公开工厂、常量与类型，以及 src/types 的公共类型。

“从 SDK 导出”只表示可以从统一入口使用，不表示实现文件路径稳定。公开运行时导出由 contracts/sdk-api-surface.v0.1.0.json 锁定为 Core 0.1.0 的 70 个名称。

## 契约测试

从仓库根目录：

~~~bash
npm run test:contract --workspace @sunland-ai/core
~~~

契约覆盖 Greeting、Identity、Memory、Knowledge teaching、Relation fallback、Context follow-up、安全副作用、Knowledge/Memory 恢复、损坏存储降级、迟到 Context 更新拒绝、API Surface、Core 版本与 schema 常量。

完整验证：

~~~bash
npm run typecheck
npm test
npm run build
~~~

仓库当前没有 release:core、check:core-release 或公开 Bundle 发布脚本。
