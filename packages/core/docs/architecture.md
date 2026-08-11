# Sunland Core 架构

本文档定义 packages/core 的当前内部架构与外部边界。仓库级运行链路见 [总体架构](../../../docs/architecture.md)。

## 唯一 Core 原则

1. packages/core 是 Sunland AI 唯一符号决策核心。
2. packages/core/src/engine/sunlandEngine.ts 是组合根。
3. packages/core/src/sdk.ts 与包名 @sunland-ai/core 是唯一支持的外部导入边界。
4. apps/api 是生产宿主；客户端通过 HTTP API 使用 Core，不加载 Core Bundle。
5. 宿主只负责身份、会话归属、请求校验、持久化、并发、取消与呈现，不能复制 Core 决策。

Core 当前是 private workspace package，没有公开 npm 发布或客户端 Bundle 生成流程。

## 内部模块

| 模块 | 职责 |
|---|---|
| parser | 确定性 Intent 与结构化关系解析、安全副作用初筛 |
| semantic | 归一化、候选生成、理解策略、结构化澄清与 Context 更新 |
| community | ACG、绘画、Cosplay、兽圈、谷子、互联网等词典和社区语用 |
| dialogue | 会话分析、话题连续性、指代、社交策略与主动性状态 |
| knowledge | 用户教学三元组、内置 Self Knowledge 与持久化辅助 |
| memory | 关于用户的受限键值记忆 |
| reasoners / rules | 直接事实、关系回退与图推理 |
| planner | 决定直接、解释、谨慎或澄清的回答策略 |
| personality | Frost/Plain 表达，不改变事实和推理 |
| observation | 隐私安全、白名单、分桶的单轮诊断摘要 |
| storage | Core 可注入的同步 StorageAdapter 边界 |
| engine | 组合以上模块并公开 respond/process |

## 依赖方向

~~~text
types / utils
  -> parser / semantic / community / dialogue
  -> knowledge / memory
  -> reasoners / rules
  -> planner
  -> personality
  -> engine
  -> sdk
~~~

模块可以通过公开类型协作，但不能让低层模块依赖宿主或 UI。Personality 只能渲染已经决定的 ResponseContext；不能修改事实、证据路径、置信度或持久化状态。

## Engine 执行

createSunlandEngine 创建隔离实例，并根据 options 注入 KnowledgeStore、MemoryManager、Parser、StorageAdapter 或测试运行时。

process 的高层流程：

1. 规范化输入和不可信 Semantic Context。
2. 运行既有 Parser 与对话分析。
3. 根据 semanticMode 运行候选分析、理解策略和安全接纳。
4. 对教学/记忆副作用执行既有安全门控。
5. 对查询运行只读 Knowledge/Reasoner 与 Response Planner。
6. 由 Personality 渲染用户文本。
7. 在允许时产生基于原版本的 Context 乐观更新。
8. 仅在显式 summary 模式下返回白名单 Observation Summary。

respond 是无宿主 Context 的简化入口；process 才能接收并返回会话更新。Core 自身不保存 Semantic Context。

## 状态边界

- Knowledge：用户教给 Core 的结构化世界事实。
- Memory：关于用户的受限事实，当前公开行为包括姓名。
- Self Knowledge：Sunland/Frost 身份与能力，不属于用户状态。
- Semantic Context：最近跨轮实体、关系、话题与受限 conversationState。
- Transcript：不属于 Core。
- Identity：Core 不可见，由 API 验证。

Core 自带的 StorageAdapter 支持本地测试或宿主重建，但生产 API 会从 Supabase snapshot 构造同步适配器，并把最终状态交给事务提交。

## 外部禁止依赖的路径

外部 workspace 不得导入：

- packages/core/src/engine/*
- packages/core/src/parser/*
- packages/core/src/semantic/*
- packages/core/src/community/*
- packages/core/src/dialogue/*
- packages/core/src/knowledge/*
- packages/core/src/memory/*
- packages/core/src/reasoners/*
- packages/core/src/rules/*
- packages/core/src/planner/*
- packages/core/src/personality/*
- packages/core/src/observation/*
- packages/core/src/types/*

即使某项能力通过 SDK 导出，消费者也必须从 @sunland-ai/core 导入。内部类名、Candidate、Rule ID、Policy ID 与排序步骤都不是兼容承诺。

## Core 禁止依赖

Core 不得依赖 React、DOM、Cloudflare Workers、Durable Objects、Supabase、HTTP、浏览器 session、Flutter、账号认证或外部 AI Provider。需要时间、存储或可替换策略时使用已有注入边界。

## 变更约束

- 新能力优先进入既有流水线，不能建立平行 Core。
- 新写入必须经过 Parser/Semantic 的副作用安全规则。
- 公共导出、默认值、Context/Observation schema 与持久化语义变化需要版本评审。
- 内部重构不能无意改变 SDK contract、固定评估集与用户可见结果。
- 外部契约测试只允许通过 @sunland-ai/core 或 src/sdk.ts 观察行为。
