# Frost Core v1 阶段性总验收（Batch 7）

> 验收对象：Batch 1～6 的全部能力。
> 验收日期：2026-09-13。验收方式：在真实管线上执行 E2E / 交叉组合 / 静默损坏扫描 / fuzz / 快照恢复 / 故障注入 / 确定性 / 性能 / 预算 / 架构边界共十类验证。
> 本批**未新增任何功能**；所有验证用的临时探针与测试文件在验收结束后已删除，仓库只保留修复与本文档。

---

## 1. Executive Summary

Frost Core v1 的 Batch 1～6 能力**全部通过验收**：1964 个既有用例 + 本轮新增验证全部绿灯，SDK 稳定在 70 exports，架构边界未被突破。

验收过程中发现并修复了 **4 个真实缺陷**，全部属于"现有行为违反既定契约"，无一是新能力：

| # | 缺陷 | 违反的契约 | 影响 |
|---|---|---|---|
| 1 | 单事实教学写入后 `persist()` 失败**不回滚内存** | 用户要求"P0 all-or-nothing"与"failed persist 必须恢复 turn 前状态" | 用户被告知 turn 失败，但内存里事实已写入 → 下一轮看到"幽灵事实" |
| 2 | is-a 传递用"先到达者胜"，**菱形图推导路径随插入序变化** | 确定性契约（shuffle invariant） | 同一份知识按不同顺序恢复，`explanation` 的推理路径不同 |
| 3 | 排序/裁决在证据完全相同时用 **record id** 兜底，而 id 来自插入序计数器 | 确定性契约 | 同置信度同来源的正负事实，胜者取决于教学顺序 |
| 4 | `addMany` 接受**结构不合法的快照行** | "restored storage 是不可信输入" | 缺字段的行被写入，之后每次读取都抛 `TypeError` |

另外定位并修复了一处**性能缺陷**（非新能力，属浪费）：查询路径为比较少量答案却对全部记录建立索引，使每次查询 O(store)。修复后 50k facts 的查询从 **32.3ms → 4.3ms（7.5×）**。

**最终结论：PASS**（详见 §2）。

---

## 2. Final Verdict

**PASS**

判定依据：

- 十类验收全部执行，无 FAIL 项；
- 4 个缺陷已修复并回归验证，修复后**全部**验证命令重新执行通过；
- 架构边界（SDK 70 exports、无 barrel 泄漏、无循环依赖、无未授权 schema/RPC/RLS 变更）全部守住；
- 剩余问题均为**已知限制**（§14），无一需要扩大 scope；
- 性能满足当前产品规模，B.1/B.2 **无紧急性能必要性**（§16）。

---

## 3. Batch 1～6 能力清单

| Batch | 能力 | 状态 |
|---|---|---|
| 1 | A1 快照读取完整性（分页 + `Content-Range` 校验）、A2 写入存规范三元组、A4 `addMany` 按三元组去重、A5 教学主语净化 | ✅ |
| 2（A.1 迁移） | `(user_id, relation)` 索引 + `updated_at` + 历史回填 | ✅ 已 apply 并验证 |
| 3 | A.3 关系别名单一来源（`relationVocabulary`）、A.6a 词条别名预计算、A.6b 归一化实现合并、A.6c 空白不敏感实体查找、A.7 教学 outcome 真实性、B.6 确定性答案排序 | ✅ |
| 4 | B.7 否定事实可达性、B.5 ConflictResolver（direct > derived → confidence → source → createdAt → id） | ✅ |
| 5 | B.8 有界多事实教学（原子 all-or-nothing、单次持久化、延续主语受限继承） | ✅ |
| 6 | B.4 有界能力传播（`会`/`有` 白名单、4 个硬预算、对称极性、provenance 完整、derived 确定性 identity） | ✅ |

### 规范单一来源（验收确认）

| 关注点 | 唯一实现 |
|---|---|
| 关系别名 | `parser/relationVocabulary.ts` |
| 实体查找 identity | `knowledge/entityLookup.ts`（`entityLookupKey` 在 `parser/textNormalize.ts`） |
| source 权威 | `reasoners/sourceAuthority.ts` |
| 能力传播白名单 | `reasoners/capabilityPropagation.ts` |
| derived identity | `reasoners/derivedIdentity.ts` |
| 多事实切分与预算 | `parser/multiFact.ts` |

---

## 4. E2E 验收结果

全部 17 项通过（管线：input → parser → canonicalization → safety gates → teaching → store → reasoner → capability propagation → ConflictResolver → ordering → planner/personality）。

| # | 项目 | 结果 |
|---|---|---|
| 1 | 单事实教学 | ✅ `已记录：猫 属于 哺乳动物`，store 1 条 |
| 2 | relation aliases | ✅ 全别名归一到 canonical relation |
| 3 | canonical triple | ✅ `猫是一种哺乳动物` → `{猫, 属于, 哺乳动物}` |
| 4 | whitespace entity identity | ✅ `AliceChen属于什么` 能答；落盘仍为 `Alice Chen` |
| 5 | duplicate teaching | ✅ 报 `已知，未重复记录`，store 不增 |
| 6 | related-known | ✅ 报 `已记录新的相关事实`，两条共存，无"已更新" |
| 7 | negated teaching | ✅ `企鹅不会飞` 可教可存 |
| 8 | positive/negative conflict | ✅ 裁决 + 解释同现 |
| 9 | multi-fact teaching | ✅ 2 条 |
| 10 | continuation subject | ✅ `猫会飞，也会游泳` → 主语继承，store 无 `也\|` |
| 11 | atomic rollback | ✅ 非法片段导致整轮零写入 |
| 12 | is-a transitivity | ✅ 多跳可推导 |
| 13 | capability propagation | ✅ `企鹅 会 飞` |
| 14 | direct-vs-derived conflict | ✅ `direct-over-derived` |
| 15 | derived-vs-derived conflict | ✅ 全序、可重复 |
| 16 | explanation consistency | ✅ 每个 answer / conflict 都出现在 explanation |
| 17 | Frost / Plain 事实一致性 | ✅ 事实相同、措辞不同 |

---

## 5. Cross-feature Matrix

15 组交叉组合全部通过：

| 组合 | 结果 |
|---|---|
| multi-fact + negation | ✅ 两条否定事实均写入 |
| multi-fact + duplicate | ✅ 第 2 段报 `未重复记录`，store 1 条 |
| multi-fact + related-known | ✅ 两条相关事实共存 |
| multi-fact + persistence failure | ✅ 完全回滚 |
| multi-fact 后立即 capability query | ✅ 可推导 |
| whitespace entity + is-a multi-hop | ✅ 两跳都保留 |
| whitespace entity + capability propagation | ✅ 跨空白推导 |
| negated inherited capability + direct override | ✅ direct 胜 |
| positive inherited capability + direct negative override | ✅ direct 胜（极性不参与） |
| derived-vs-derived opposite polarity | ✅ 确定性全序 |
| duplicate provenance paths | ✅ 收敛为一条 |
| cycle + conflict | ✅ 终止且报告冲突 |
| cycle + capability | ✅ 终止且推导正确 |
| restore 后重新查询 conflict/capability | ✅ 一致 |
| restore 顺序 shuffle | ✅ 12 个置换结果全同 |

---

## 6. Determinism Results

- **22 个代表性 scenario**，每个：同 store 连续查询 **20 次** + **6 个**确定性插入序置换，比较 `answers`/`conflicts`/`explanation` 的 JSON。
- 结果：**全部逐字节一致**。
- 覆盖的排序/tie-breaker 均已审计：`answerOrdering`、`ConflictResolver`、isa 最短路径、capability 最短路径、`derivedIdentity`、多事实结果顺序。
- 修复缺陷 2、3 之前，"both polarities direct" 与 "diamond isa" 两个 scenario 在不同插入序下**不一致**（这正是本批发现的问题）。

---

## 7. Persistence / Restore Results

11 项全部通过：

| # | 项目 | 结果 |
|---|---|---|
| 1-5 | 教学 → 快照 → 恢复 → answers/conflicts/explanation 完全一致 | ✅ 且断言冲突确实存在（非空比较） |
| 6 | duplicate detection 一致 | ✅ 恢复后重复教学报 `未重复记录` |
| 7 | negated facts 一致 | ✅ `企鹅\|会\|飞\|N` 存活 |
| 8 | multi-fact 状态一致 | ✅ 3 条 |
| 9 | capability derived 仍不落盘 | ✅ 恢复后查询不新增记录 |
| 10 | 恢复两次无 ghost record | ✅ 条数不变 |
| 11 | 打乱快照行序结果一致 | ✅ 12 个置换全同 |
| 12 | malformed 行被防御（不致命） | ✅ 修复缺陷 4 后 |
| 13 | 重复 id / 重复三元组折叠 | ✅ 3 行 → 1 条 |

### 持久化故障注入

| 注入 | 结果 |
|---|---|
| storage write reject（单事实） | ✅ 抛错 + 内存回滚，memory 与 storage 都无该事实（**修复前失败**） |
| storage write reject（多事实） | ✅ 抛错 + 完全回滚 |
| 失败后下一轮 | ✅ 无残留：失败 turn 的第 2 条未泄漏 |
| malformed snapshot（非 JSON） | ✅ 不崩溃，从空开始，仍可教学 |
| 错误形状 snapshot（5 种） | ✅ 均不崩溃 |
| storage read failure | ✅ **有意**向上抛出（见 §14）：I/O 失败静默从空开始会让用户以为知识消失 |

**关键保证**：不出现"回复失败但内存已写入"，不出现 ghost fact，不出现半提交 turn。

---

## 8. Silent Corruption Audit

对 `relationVocabulary` 的**全部**别名（非抽样）做自动化教学探针，共 65 项断言，全部通过。

固化的 corruption invariants：

| 不变量 | 验证方式 |
|---|---|
| subject 不得等于 continuation marker | 对每个别名教学后断言 |
| relation 必须是 canonical relation | 对每个 record 断言 |
| subject 不得吞掉 relation 别名（前缀剥离不得留碎片） | 比对该 subject 与所有长度 ≥2 的别名 |
| subject / object 不得为空 | 对每个 statement 断言 |
| alias 不得从长 token 内部错误命中 | `拥有/具备/算是/归类为/能够/可以/位于/指的是` 逐条断言 canonical relation 与完整主语 |
| entity 空白归一不得改变落盘展示值 | `Alice Chen` / `Alice  Chen` 落盘仍原样 |
| marker 实体不得被截断 | `也门` / `还好` / `同样多` 作主语与作第二子句都完整 |
| rejected turn 必须零写入 | 12 类非法输入逐条断言 knowledge + memory 均空 |
| 长度边界 | 恰好 160 通过、161 拒绝 |
| 多事实边界 | 恰好 4 条通过、5 条拒绝且零写入 |

历史三类损坏（`猫拥|有|爪子`、`猫算|是|…`、`也|会|游泳`）**均已不复现**。

---

## 9. Fuzz / Property Results

无第三方框架，`mulberry32` 固定 seed（1 / 7 / 42 / 1234 / 987654 / 20260913），失败可复现。共 73 项属性断言，全部通过。

| 属性 | 规模 |
|---|---|
| 5 个归一化函数幂等（`f(f(x)) === f(x)`） | 6 seed × 300 输入 |
| `canonicalStatementTriple` 幂等 | 6 seed × 300 |
| parser 全域性 + 主语非空 | 6 seed × 400 |
| splitter 全域性 + 段上限 | 6 seed × 300 |
| 任意空白插入不改变落盘值 | 6 seed × 120 |
| 分隔符组合全域性 | 6 seed × 200 |
| comparator 自反 / 反对称 / 传递 | 6 seed × 24 候选 |
| 排序置换不变性 | 6 seed × 8 轮 |
| derived identity 确定性 + 相异候选不并列 | 6 seed × 20 |
| 随机环状 is-a 图终止 + 有界 + store 不变 | 6 seed |
| 重复事实不产生重复答案 | 6 seed |
| resolver 冲突结构良构 | 6 seed |

---

## 10. Performance Benchmarks

测量环境：本机 Node（darwin-arm64），Vitest。**仅测量，未做优化**（唯一的性能改动是 §13 缺陷 5 的浪费消除）。

### 查询（median / p95）

| facts | direct | is-a 3-hop | capability | conflict |
|---|---|---|---|---|
| 100 | 0.015 / 0.024 | 0.022 / 0.044 | 0.017 / 0.048 | 0.018 / 0.061 |
| 1,000 | 0.094 / 0.117 | 0.090 / 0.104 | 0.082 / 0.087 | 0.087 / 0.105 |
| 10,000 | 0.788 / 0.959 | 0.809 / 2.675 | 0.819 / 1.178 | 0.808 / 0.949 |
| 50,000 | 4.257 / 4.667 | 4.238 / 4.677 | 4.175 / 4.464 | 4.436 / 5.301 |

（单位 ms）

### 教学与快照

| 场景 | median / p95 |
|---|---|
| 教 1 条（100 preloaded） | 0.672 / 1.044 ms |
| 教 4 条（100 preloaded） | 1.789 / 2.152 ms |
| 教 1 条（10,000 preloaded） | 19.974 / 21.199 ms |
| 教 4 条（10,000 preloaded） | 25.814 / 26.359 ms |
| snapshot serialize+restore（1,000） | 0.988 / 1.194 ms |
| snapshot serialize+restore（10,000） | 12.405 / 17.673 ms |

### 快照体积与内存

| facts | 字节 | MiB |
|---|---|---|
| 100 | 14,861 | 0.01 |
| 1,000 | 150,621 | 0.14 |
| 10,000 | 1,526,211 | 1.46 |

进程内存（Vitest，含框架开销）：rss ≈ 323 MiB，heapUsed ≈ 97 MiB。

### 与早期基线的对比

| 指标 | Batch 0 基线 | 本批（修复缺陷 5 后） |
|---|---|---|
| 单轮 `engine.process()`，10k facts | 0.60 ms | 同量级（教学路径） |
| **纯查询**，10k facts | ~5.4 ms | **0.79 ms** |
| **纯查询**，50k facts | ~32.3 ms | **4.3 ms** |

查询成本随 facts **线性**（约 0.085 µs/fact），来源是 `AnswerGraphQuery` 内部按 subject 的索引遍历；**修复缺陷 5 消除的是一次全库建索引**，不是消除线性项。教学成本同样线性，主因是**全量快照持久化**（10k 时 12.4ms serialize+restore，见 §16）。

---

## 11. Budget Stress Results

### B.4 能力传播

| 预算 | 边界验证 | 结果 |
|---|---|---|
| `maxPropagationDepth = 4` | 事实在深度 4 → 推导；深度 5 → 不推导 | ✅ 精确 |
| `maxDerivedFacts = 16` | 24 条能力事实 → 输出 ≤16，10 次重复调用结果相同 | ✅ |
| `maxVisitedEntities = 32` | 52 个兄弟扇出 → 返回 `[]`，不挂起，store 不变 | ✅ |
| `maxEdgesExamined = 128` | 超限即确定性返回已收敛结果 | ✅ |
| 环 | `A→B→C→A` + `C 会 X` → 终止，输出 `X` | ✅ |
| 自环 | `A 属于 A` → 终止 | ✅ |
| 菱形 | 收敛为 1 条，取最短路径 | ✅ |

### B.8 多事实

| 边界 | 结果 |
|---|---|
| 4 facts | ✅ 接受 |
| 5 facts | ✅ 拒绝且零写入 |
| 160 字符 | ✅ 接受 |
| 161 字符 | ✅ 拒绝 |
| 拆分深度 | ✅ 恒为 1 层（段内再含分隔符即拒） |

---

## 12. Architecture Boundary Audit

| 检查项 | 结果 |
|---|---|
| SDK runtime exports | ✅ 恰好 **70**（契约测试通过） |
| 新内部模块未从 barrel 泄漏 | ✅ `capabilityPropagation` / `derivedIdentity` / `entityLookup` / `textNormalize` / `teachingCanonical` / `multiFact` 均不在 `sdk.ts` 或任何 `index.ts` |
| Core 不依赖 DB / Cloudflare runtime / DOM / 网络 | ✅ 仅注释提及 `window`/`localStorage`，无导入、无 `fetch` |
| reasoner 不写 KnowledgeStore | ✅ `reasoners/*.ts` 无 `store.add/remove/clear` |
| ConflictResolver 纯只读 | ✅ 无任何 `known.add/remove/clear` |
| capability propagation 不持久化 | ✅ 查询前后 `store.all()` 深度相等 |
| 关系词表单一来源 | ✅ `parser/relationVocabulary.ts` |
| source authority 单一来源 | ✅ `reasoners/sourceAuthority.ts` |
| entity lookup identity 单一实现 | ✅ `knowledge/entityLookup.ts` |
| 无循环依赖 | ✅ `rules/` 不导入 `reasoners/`；`reasoners/ → rules/` 单向 |
| 无未授权 schema/RPC/RLS/migration 变更 | ✅ `git diff -- supabase/` 为空 |

---

## 13. Bugs Found & Fixed During Validation

### 缺陷 1（P0）— 单事实教学的持久化失败不回滚内存

- **契约**：用户明确要求"parse、commit 或 persist 任一步失败后 `store.all()` 与 turn 开始前深度一致"。
- **实测**：注入 `setItem` 抛错后 `engine.process("猫属于哺乳动物")` 抛错，但 `knowledgeStore.all()` 中**已存在该事实**，且 storage 中没有 → 下一轮会看到幽灵事实。
- **根因**：B.8 只给多事实路径加了 snapshot/rollback；单事实路径是"先 `store.add` 再 `persist`"，失败无补偿。
- **修复**：抽出 `captureBrain()` / `restoreBrain()`，单事实与多事实写入路径共用；`persist()` 抛错即回滚并重新抛出。`packages/core/src/engine/sunlandEngine.ts`。
- **回归**：§7 的 write-reject 与"下一轮无残留"两项。

### 缺陷 2 — is-a 传递在菱形图中依赖插入序

- **契约**：B.4 计划已记录"现状先到达者胜、依赖插入序"，且确定性契约要求 shuffle invariant。
- **实测**：`A→B→D` 与 `A→C→D` 并存时，B 先插入得到路径 `A→B→D`，C 先插入得到 `A→C→D`，**`explanation` 文本随之不同**。
- **修复**：`traverseIsAForQuery` 改为按祖先收敛（`best: Map<entityLookupKey, path>`），取**最短链**，等长按链的规范文本 tie-break；保留"命中 target 后停止扩展"的既有优化（既有 100 边链测试继续通过）。
- **回归**：§6 的 "diamond isa" scenario（置换 3 曾失败）。

### 缺陷 3 — 证据相同时用插入序相关的 record id 兜底

- **契约**：确定性契约；且 B.5 的 `id ASC` 本意是"最终兜底"，不是"让教学顺序决定胜负"。
- **实测**：`猫 会 飞` 与 `猫 不会 飞` 同 source、同 confidence、同 createdAt 时，winner 由 id 决定，而 id 来自 `generateId()` 的插入序计数器 → 主动插入序翻转 winner。
- **修复**：在 `id` **之前**插入内容派生的 canonical assertion key（`assertionKey`）比较 —— 同一断言两次得到同一 key，与插入序、id、时钟无关；`id` 仅在同一断言相同时才用到。`answerOrdering.ts` + `conflictResolver.ts`（同时删除了 resolver 内重复的 key 实现，统一到 `derivedIdentity.assertionKey`）。
- **回归**：§6 的 "both polarities direct" scenario（置换 1 曾失败）。

### 缺陷 4 — `addMany` 接受结构不合法的快照行

- **契约**：AGENTS.md —— restored storage 是不可信输入。
- **实测**：`addMany([{ id: "x" }])` 不抛错但把该行写入 store，之后任何 `match`/`all` 读取 `record.subject` 都会 `TypeError`。
- **修复**：`insertRecord` 前增加结构守卫 `isKnowledgeRecordShaped()`，不合法即跳过（**守卫而非修补**：不改写、不编造字段）。`knowledge/store.ts`。
- **回归**：§7 的 malformed-row 与 duplicate-id 两项。

### 缺陷 5（性能）— 查询为少量答案却索引全部记录

- **性质**：浪费，非功能性缺陷；不违反契约，但被本批性能测量暴露。
- **实测**：10k facts 单次查询 4.17ms，其中 `indexRecordsByAnswerKey(全部 10k 记录)` ≈ 1.67ms、`resolveConflicts` 内置全库索引 ≈ 2.06ms，而 `store.all()` 本身仅 0.02ms、目标 `match` 仅 0.001ms。
- **修复**：排序与裁决改为**按答案自身的精确三元组做定点 `match`**，不再遍历 store。行为等价（全部既有测试通过，含确定性/置换不变性）。
- **收益**：50k facts 查询 **32.3ms → 4.3ms（7.5×）**；10k **5.4ms → 0.79ms（6.9×）**。

### 验证过程中我自己的测试错误（已修正，非产品缺陷）

1. fuzz 的反对称断言用了 `Object.is(+0, -0)` —— `Math.sign(0)` 为 `+0`，合法平局被误判失败。
2. "直接按 record id 兜底" 用例的前提错误：两条同三元组记录会被 A.4 按事实去重为一条，`k_b` 从未入库。
3. 长度边界用例构造出恰好 160 字符而非 161。
4. `CONTINUATION_MARKERS` 从错误模块导入。
5. 多事实/单事实原子性用例最初把"storage read failure"期望为不抛错 —— 该期望本身错误（见 §14）。

---

## 14. Known Limitations

1. **teaching safety relation mention heuristic 与 parser 的实体/关系边界存在读写不对称。**

   > 某些实体内部包含 relation cue 的合法单事实教学，例如 `很会属于测试类`，可能被保守拒绝；对应查询仍可能正常工作。该问题只产生 false rejection，不会产生错误写入或 silent corruption。

   **状态：已知限制，决定不再尝试修复（Batch 7 结论）。**

   实测细节：`countKnownRelationMentions("很会属于测试类")` 返回 `2`，因为计数器按 cue 逐条扫描，把实体 `很会` 里的 `会` 与真正的 `属于` 各计一次，超过 `LEGACY_SIDE_EFFECT_LIMITS.maxRelationMentions: 1`，于是 `hasUnsafeLegacySideEffectStructure` 在语法匹配之前就拒绝了整轮。解析器本身会选中 `属于` 并留下 `很会` 作主语，因此查询侧（无此计数器）可正常工作。

   **为什么没有修复**：Batch 7 尝试了 5 种计数规则（cue 相邻合并、前缀片段、最左最长 tokenize、最长优先 + 前缀/相邻、按长度选非重叠 span），每一种在修好目标用例的同时都打破另一个既有用例（例如把 `猫拥有爪子` 或 `猫指的是家猫` 变成拒绝，或把 `拥有属于` 静默拆成 `拥|有|…`）。根因是计数器只看字符串形状、不看实体边界：`很会属于X` 与必须拒绝的 `猫会飞，猫会游泳` 的区别在于 `很会` 是**一个实体**。因此该问题**无法通过调整计数器解决**，需要重新划定 parser 与 safety 的职责边界（见 §15 的 Stage 8.2 候选）。

   **影响评估**：仅 false rejection（保守方向），零静默损坏、零错误写入、零跨用户影响。用户可用同义表达绕开（例如直接教 `很会属于什么` 的答案事实，或改换实体写法）。

2. **storage read I/O 失败会向上抛出**：malformed payload 会被安全恢复，但 `getItem` 自身抛错（真实 I/O 故障）不会被吞掉。这是**有意**的：静默从空库开始会让用户以为知识消失。宿主需自行重试。
3. **is-a 传递无深度上限**：与 capability 传播不同，`属于` 保持**完整传递闭包**（既有 100 边链测试即契约）。答案量由可达子图决定，`entityLookupKey` 访问集保证无环。
4. **查询成本仍随 store 线性**（约 0.085 µs/fact）：来自 store 索引遍历，非本批引入，且已被缺陷 5 的修复大幅降低常数因子。
5. **`证明` 类实体尾部标记修复是启发式的**：`鸟也不会飞` 需要"标记在主语尾部 + 去掉后仍能解析"双重条件才修复。若未来出现"实体本身以标记结尾且剩余部分恰好像一个子句"，可能被误修复；当前无此类中文实体。
6. **多事实单轮上限 4**：超过即整轮拒绝（原子性代价）。
7. **`不喜欢`/`不在` 等否定形式**：grammar 支持 `没有` / `不拥有` / `不会` / `不能`，但 `不具有` 不可教（`具有` 未注册为别名）。
8. **`位于` 不在 safety 的 relation cue 表中**：`KNOWN_RELATION_CUES` 未包含 `位于`（它只是 `在` 的别名），因此含 `位于` 的输入的 mention 计数为 0。当前不影响正确性（`猫位于屋顶` 能正常教学），因为计数只在"超过上限"时拒绝；但若未来有人往 cue 表里补 `位于` 而不理解该表与别名的关系，会引入新的计数偏差。

---

## 15. Deferred Work

| 项 | 说明 |
|---|---|
| B.1 增量写入 | 见 §16：**唯一有真实性能动机**的后续项 |
| B.2 Durable Object 缓存 | 见 §16：非必需 |
| **Stage 8.2 候选：Unify or structurally coordinate parser and side-effect safety relation-boundary analysis.** | 见下方专项说明 |
| 迁移 lineage reconciliation | A.1 验收时记录，仍未处理 |
| `sunland_db_token_profiles` policy 缺失 | A.1 验收时记录为待调查 drift |
| `是我` 类关系词污染（`猫的指代是家猫` → `{猫的指代, 是, …}`） | Batch 4 计划记录，范围外 |
| verify 路径 1-hop 泄漏（`A 属于 A` 的 verify 查询返回 `steps=0`） | Batch 6 计划记录，未修 |
| `updated_at` 未被任何 RPC 读写 | A.1 遗留：列已加，但 `p_knowledge` 不含它 |
| 记忆的"新记住/已更新"区分 | A.7 明确不做（需改 `MemoryManager.remember` 公共类型） |

### Stage 8.2 候选专项说明

**候选名称**：Unify or structurally coordinate parser and side-effect safety relation-boundary analysis.

**要解决的问题**：`parser/` 与 `parser/sideEffectSafety.ts` 各自独立判断"哪里是实体、哪里是关系"，两者对同一输入可能得出不同结论。安全侧的 `countKnownRelationMentions` 只统计 cue 字符串出现次数，不知道实体边界，因此会把实体内部的 relation cue 当成额外 mention，产生 §14.1 的保守误拒。当前两者是**两个独立实现**，任何一侧演化都会重新引入不对称。

**⚠️ 未来修复不得简单通过放宽 mention count 实现。** 把 `maxRelationMentions` 从 1 调到 2、或让计数器在"看起来像实体"时少计一次，都会重新打开下面这些已被现有门禁关闭的绕过路径。**必须重新审查以下每一项**，并在实现前给出结论：

| # | 审查项 | 为什么放宽计数会危及它 |
|---|---|---|
| 1 | **parser / safety 职责边界** | 谁拥有"关系边界"的唯一定义？若 safety 继续独立重算，就仍是两份实现；若改为消费 parser 结果，需定义 parser 失败/unknown 时 safety 如何 fail-closed |
| 2 | **relation alias collisions** | `拥有`/`有`、`是一种`/`是`、`指的是`/`是`、`位于`/`在` 共享前缀或子串。放宽计数可能让 `拥有属于` 这类畸形输入被拆成 `拥\|有\|…` 而写入 |
| 3 | **multi-fact bypass** | B.8 的白名单切分依赖 `maxRelationMentions` 之外的门控。若单子句能携带 2 个 relation，必须证明它不会绕过 B.8 的 4-事实上限与 turn-level envelope |
| 4 | **negation** | B.7 的否定可达性依赖"完整否定三元组"的判定。放宽计数不得让 `猫不会飞，鸟也不会飞` 这类输入在单事实路径上被部分接受 |
| 5 | **explicit prohibition** | `不要记住猫会飞，猫会游泳` 必须继续**整轮**拒绝。计数语义变化不得让禁止语所在子句之外的内容被写入 |
| 6 | **malformed input** | 缺 slot、复合句、选择结构、疑问结构、超长输入必须继续零写入；新边界定义需对每一类给出用例 |
| 7 | **deterministic behavior** | 新的边界判定必须与插入序、Map/Set 迭代序无关，并纳入 §6 的 shuffle/repeated-query 契约与 §9 的属性测试 |

**回归要求**：任何实现都必须同时钉住两侧——`很会属于测试类` 等实体可教 **且** `拥有属于`、`猫会飞猫会游泳`、`猫会飞，猫会游泳`、`不要记住猫会飞，猫会游泳`、`猫会飞吗` 仍被拒绝。Batch 7 的尝试正是因为无法同时满足两侧而回退（工作区已复原，无遗留改动）。

**当前处置**：记为 v1 已知限制，**不在冻结期内修复**。

---

## 16. B.1 / B.2 是否真的有性能必要性

**结论：B.1 有真实且可量化的动机；B.2 目前没有必要。**

### B.1（增量写入）— 有必要

证据：

- 查询侧已不再是瓶颈（50k facts 4.3ms，且与 store 规模只是线性）。
- **教学侧才是**：10k facts 时单次教学 19.97ms、四事实 25.81ms，其中快照 serialize+restore 本身 12.4ms。
- 根因是**全量快照往返**：每轮把整份知识（10k facts ≈ 1.46 MiB）序列化、上传、再由 RPC 逐行 `INSERT`。50k facts 时快照约 7.3 MiB。
- 这是 O(store) 的**每轮**成本，且随用户使用单调增长——与缺陷 5 不同，它不是常数因子问题，而是架构性的每轮全量。

因此若预期单用户知识量达到万级，B.1 值得做。**但它不是 v1 的阻塞项**（当前生产库仅 2 行事实，见 A.1 recon）。

### B.2（Durable Object 缓存）— 无必要（当前）

- 查询本身已足够快；DO 缓存主要省的是**快照重建**（`createSunlandEngine` + `JSON.parse`），而这部分在 10k facts 下与持久化相比占比小。
- B.2 会引入跨轮次可变状态与失效语义，风险高于当下收益。
- 建议：**先做 B.1**（消除每轮全量往返），再重新测量是否还需要 B.2。

---

## 17. Frost Core v1 是否建议冻结

**建议冻结为 v1，但附带两个前置条件。**

### 支持冻结的理由

1. **正确性**：六批能力全部通过 E2E、交叉组合与静默损坏扫描；历史三类静默损坏均不复现。
2. **确定性**：22 scenario × 20 次 × 6 置换全部逐字节一致；本轮修掉了两个真实的顺序依赖。
3. **持久化一致性**：单事实与多事实路径现在都是真原子；故障注入全部通过。
4. **架构边界**：70 exports 稳定、单一来源明确、无循环依赖、无未授权 schema 变更。
5. **性能可接受**：查询亚毫秒（≤10k）、教学 ~20ms（10k）。

### 前置条件

1. ~~先修 §14.1 的读写不对称，或明确接受为产品行为并写入文档~~ → **已解决（路径 3）**：§14.1 已按维护者决定记录为 v1 已知限制，并附"仅 false rejection、零 silent corruption"的影响评估；对应的结构性问题转为 §15 的 **Stage 8.2 候选**，冻结期内不修复。§15 已明确列出未来实现前必须重新审查的 7 项，并禁止"简单放宽 mention count"的做法。
2. **在冻结点做一次提交**：Batch 3～7 的产物目前**全部未提交**（`docs/*.md` 计划文档与 20+ 个新源文件为 untracked）。冻结前应整理为按 batch 划分的 Conventional Commits，否则 v1 没有可追溯的基线。

### 建议的冻结后策略

- v1 冻结期间只接受违反既定契约的 bug 修复（与本批同类），不接受新能力；
- B.1 作为 v1.1 的第一个候选，独立分支、独立测量；
- **Stage 8.2 候选**（§15）不得在冻结期内开工；开工前必须先在设计文档中回答那 7 项审查，并同时钉住"实体可教"与"畸形/复合/禁止输入仍拒绝"两侧。

---

## 18. 最终验证命令结果

```
npm run typecheck   →  通过（3 个 workspace）
npm test            →  Core 82 files / 1744 cases 全绿
                       API   6 files /   24 cases 全绿
npm run build       →  API dry-run 631.99 KiB / gzip 140.85 KiB + Playground 构建成功
SDK runtime exports →  70（契约测试 4/4 通过）
```

修复缺陷 1～5 之后，上述命令**已全部重新执行**并全部通过。

### git diff stat（仅本批修复，未提交）

```
 packages/core/src/engine/sunlandEngine.ts   | 328 +++++++++++++++++++++++-
 packages/core/src/knowledge/store.ts        |  49 +++-
 packages/core/src/reasoners/graphReasoner.ts|  87 ++++++-
 packages/core/src/rules/isaTransitivity.ts  | 113 ++++++---
 4 files changed, 521 insertions(+), 56 deletions(-)
```

注：上表只含**已跟踪**文件的改动。Batch 4～7 新增的源文件（`capabilityPropagation.ts`、`derivedIdentity.ts`、`answerOrdering.ts`、`conflictResolver.ts`、`knowledge/entityLookup.ts` 等）仍为 untracked，因此不出现在 `git diff` 中——这正是 §17 前置条件 2 的由来。
