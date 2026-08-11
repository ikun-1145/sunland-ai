# Reasoning 边界

Reasoning 位于 Knowledge 之后、Response Planner 和 Personality 之前。它只读知识并产生可解释结论，不负责身份验证、持久化、UI、语气或网络。

## 当前行为

外部宿主可以依赖行为类别，不能依赖内部规则名称或执行步骤：

1. 精确关系和直接事实优先。
2. 属于关系可以沿已知路径做传递推理。
3. 显式“为什么”查询可展示已有推理路径。
4. 精确关系无答案时，可以使用已支持的 Relation fallback；fallback 不写入事实。
5. 非属于关系不自动获得传递语义。
6. 多个答案保留确定性顺序，Planner 根据最低置信度决定整体谨慎表达。
7. 无答案、关系不支持或内部 Reasoner 异常时安全降级，不泄漏内部诊断。

## 分层职责

| 层 | 职责 | 禁止职责 |
|---|---|---|
| Reasoner | 根据查询和只读 Knowledge 产生结论、证据与冲突 | 写 Knowledge、选择语气 |
| Response Planner | 决定直接、解释、澄清或谨慎表达 | 重新推理、发明事实 |
| Personality | 渲染最终表达 | 修改结论、路径或置信度 |
| Engine | 组合 Parser、Reasoner、Planner 与 Personality | 信任外部身份 |
| API | 提供状态快照并持久化结果 | 选择规则、拼装结论 |

## 公开边界

生产客户端只接收最终 response。仓库内宿主使用 engine.respond 或 engine.process 获取结果，不直接编排 reasoners、rules 或 planner。

禁止外部依赖：

- packages/core/src/reasoners/*
- packages/core/src/rules/*
- packages/core/src/planner/*
- 内部 rule ID、policy ID、搜索顺序或候选排序

即使公开 SDK 导出部分 Reasoning 类型，也不表示内部路径或策略是稳定 API。

## 兼容性

- 相同公开输入和状态应保持确定性。
- Relation fallback 与普通查询不得产生 Knowledge 或 Memory 写入。
- Personality 变化不得改变事实和结论。
- 新传递关系必须有明确语义、冲突规则、性能边界和固定测试集。
- 内部算法可重构，但公开契约测试覆盖的行为不能无意变化。
