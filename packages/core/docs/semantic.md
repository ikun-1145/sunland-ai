# Semantic 边界

Semantic 层从输入产生结构化理解候选，并由统一策略选择接受、澄清或安全降级。它是 Core 内部能力，不是客户端可编排服务。

## 可观察入口

仓库内 SDK 宿主只能通过以下公开面影响 Semantic：

- createSunlandEngine({ semanticMode })
- createSunlandEngine({ semanticContextMode })
- engine.respond(input)
- engine.process(input, options)
- 三个公开 Context 辅助函数

生产 API 固定使用 semanticMode=passive 与 semanticContextMode=enabled。HTTP 客户端不能选择内部 Mode。

Candidate、Producer、抽取证据、Confidence、Diagnostic 和 UnderstandingDecision 都是实现细节。宿主不能读取它们建立第二套路由或写入规则。

## Mode

- off：关闭 Semantic 接纳，保留 Parser 兼容路径。
- passive：接纳策略允许的只读理解与结构化澄清；写入仍走既有副作用安全路径。
- shadow：比较 Semantic 与兼容路径，用于内部评估，不是产品能力开关。
- semanticDebug：默认关闭；启用时只在内存保留最近的隐私安全 Shadow 摘要。

Mode 的算法含义由 Core 管理，客户端和 API Adapter 不得复制分支。

## Candidate 与策略

候选来自词典、Context、关系模式和 legacy regex 等 Producer。Understanding Planner 根据完整槽位、置信度、候选差距、否定、复合结构、证据单元和风险级别做统一决策。

候选可以：

- 被接受为已有只读 Intent/Query；
- 触发结构化 Clarification；
- 回退到兼容 Parser；
- 作为无理解或副作用拒绝安全结束。

候选本身不能写状态。

## 副作用边界

只有完整、明确且通过 Core 现有安全门控的教学或姓名记忆路径可以写入。以下情况必须澄清或拒绝：

- 缺少 subject、relation 或 object；
- 否定或明确禁止写入；
- 复合、冲突或歧义教学；
- 姓名或事实证据不足；
- 可能把问题误判成陈述；
- 无法解析的输入。

宿主不得根据关键词直接写 Knowledge 或 Memory。

## Context

Context Producer 可用最近有界实体和话题补全指代。恢复值先 normalize；Core 只产生基于 baseVersion 的乐观更新。Context 使用不能改变用户归属，也不能自动产生持久 Memory。

## 用户可见边界

最终回复不能暴露 Parser、Intent、Candidate、Confidence、Reason Code、Policy ID 或诊断文本。用户可见表达只能来自 Engine 交给 Personality 的已决结果。

Observation Summary 是独立的白名单诊断，不是用户解释，也不能驱动业务逻辑。

## 禁止外部依赖

外部包不得导入 packages/core/src/semantic 下的 analyze、candidate、planner、adapter、producer 或其他实现。公开 Context helper 也只能从 @sunland-ai/core 导入。
