# Sunland AI 性能与知识库改进建议

> 状态：提案。**第一批（A1/A2/A4/A5）已实现并配套测试**，其余仍未实现。
> 依据：本仓库当前代码 + 2026-09-13 在本机实测数据。所有结论都可按文中路径复核。
> 相关文档：[总体架构](architecture.md)、[Core 知识库契约](../packages/core/docs/knowledge.md)、[项目记忆](project-memory.md)。

## 实施进度

| 项 | 状态 | 落地位置 |
|---|---|---|
| A1 读取完整性 | ✅ 已实现 | `apps/api/src/supabaseRepository.ts`：`requestAllRows` 分页读取并校验 `Content-Range`，无法证明读全即 503 失败（含 416 与 unknown total 处理） |
| A2 写入存规范三元组 | ✅ 已实现 | 新增 `packages/core/src/parser/teachingCanonical.ts`；`patterns/statement.ts` 存入规范形，`semantic/legacySideEffectGate.ts` 改为复用同一函数 |
| A4 `addMany` 按三元组去重 | ✅ 已实现 | `packages/core/src/knowledge/store.ts`（同时收紧 `remove()` 的查找项归属） |
| A5 教学主语净化 | ✅ 已实现 | `teachingCanonical.ts` + `engine/sunlandEngine.ts`：解析器与语义层处理同一段文本；姓名教学（`记住 我叫小明`）一并覆盖 |
| A3 / A6 / A7、B1–B9 | ⬜ 未实现 | 见下文第 5 节 |

实现说明：A2 的落点比本提案最初设想更靠前——规范化放在 Legacy statement pattern 内部，写入门控改为调用同一个纯函数，因此"用于判定"的表示与"实际存储"的表示在结构上不可能再分叉。B3 的 `(user_id, subject)` 索引建议在 A1 落地后仍成立（A1 修的是完整性，不是检索效率）。

## 附录 A.1 的 apply 前复核结果（2026-09-13，已实测）

对线上项目 `Sunland Project` (`klyrasrqgxijwrxuoevj`, ap-southeast-1, PG 17.4.1) 执行只读 recon 后，**B3 需要重新界定范围**：

| 观察 | 结论 |
|---|---|
| `sunland_ai_knowledge` 共 9 列，无 `updated_at`，可空性与默认值全部符合预期 | ✅ 与迁移假设一致 |
| 唯一约束列与**列顺序**为 `(user_id, subject, relation, object, negated)` | ✅ 与假设一致 |
| 唯一约束**名称**为 `sunland_ai_knowledge_user_id_subject_relation_object_negate_key`（PG 自动生成） | ⚠️ 与本仓库迁移会生成的名称不同；迁移按**列**匹配、不按名称匹配，故不受影响 |
| 现有索引仅 3 个：`_pkey (user_id,id)`、`_user_created_idx (user_id,created_at,id)`、上述唯一索引 | ✅ 与假设一致 |
| 表行数 = 2（2 个用户各 1 条），`created_at` 无 NULL | ✅ 回填代价可忽略 |
| `RLS enabled=true, forced=true` | ✅ 隔离有效 |
| `(user_id, subject)` 过滤：planner **已使用唯一索引**（`(user_id, subject)` 是其最左前缀） | ❗ 拟新增的 `(user_id, subject)` 索引**冗余，无收益** |
| `(user_id, relation)` 过滤：只能靠唯一索引 + 过滤条件，`relation` 前有 `subject` 挡着 | ✅ `(user_id, relation)` 索引**确有收益**，是 B3 的真正价值 |
| 3 个 RPC 签名与仓库 migration 完全一致；`sunland_commit_turn` 的 INSERT 带显式列清单 | ✅ 新增 `NOT NULL DEFAULT now()` 列不会破坏现有 RPC |
| **仓库 `supabase/migrations/` 下的文件在 `supabase_migrations.schema_migrations`（51 条）中一条都没有** | ❌ **最重要的偏差：线上 schema 由另一条迁移历史创建，本仓库迁移文件当前不是该库的事实来源** |
| `user_profiles` 上**没有** `sunland_db_token_profiles`（仅两条 permissive 策略），`relforcerowsecurity=false` | ❌ 与 `202608080002_prepare_legacy_security.sql` 的预期不符 |

**因此 A.1 未 apply，并暂停。** 需要维护者裁决：仓库迁移是否应接管该库（若是，先补齐 baseline 对齐），以及 `(user_id, subject)` 索引是否直接删除以省一次写放大。详见 `supabase/verification/202609130005_preflight_recon.sql`。

### 裁决与执行结果（2026-09-13）

维护者裁决：不做 lineage baseline/repair，不让仓库旧 migrations 接管 live 历史；A.1 删除冗余的 `(user_id, subject)` 索引，仅保留 `(user_id, relation)` + `updated_at`；`sunland_db_token_profiles` 缺失仅记为待调查 drift，本批不动任何 RLS/policy/grant。

已按裁决 apply 到 live 生产库（无独立 staging）：

| 项 | 结果 |
|---|---|
| 迁移记录 | `schema_migrations` version `20260913014653`，name `add_knowledge_user_relation_idx_and_updated_at` |
| `(user_id, relation)` 索引 | ✅ 存在且 valid，定义 `btree (user_id, relation)` |
| 冗余 `(user_id, subject)` 索引 | ✅ 未创建（按裁决） |
| `updated_at` | ✅ `timestamptz NOT NULL DEFAULT now()` |
| 历史回填 | ✅ 2 行全部满足 `updated_at = created_at` |
| 新行行为 | ✅ 事务内探针 INSERT 取得新 `now()`，探针已回滚，行数仍为 2 |
| 原 3 个索引/唯一约束 | ✅ 不变（总数 4 = 3 原有 + 1 新增） |
| 唯一约束列与顺序 | ✅ `(user_id, subject, relation, object, negated)` 未变 |
| RLS | ✅ 仍 enabled + forced |
| 3 个 RPC 签名 | ✅ 与 apply 前逐字一致 |
| 知识行数与事实内容 | ✅ 行数 2，两条事实逐字段不变 |
| 根 typecheck / test / build | ✅ 全绿（Core 73 文件、API 6 文件） |

apply 过程中发现并修掉两个自身缺陷（第一次 apply 因此失败且**未产生任何变更**，MCP 在事务中回滚）：`array_agg` 两参数形式在 PG 17 解析失败（改为 `array_agg(x::text order by ...)`）；`apply_migration` 自身包裹事务，显式 `begin/commit` 与之冲突（已移除）。

**仍未处理**：migration lineage reconciliation、`sunland_db_token_profiles` 缺失、A.3/A.6/A.7、B1/B2/B4–B9。


## 1. 结论摘要

1. **当前每轮 CPU 不是瓶颈。** 实测单轮 `process()` 在 0–50,000 条事实区间为 0.38–0.61 ms（p50 0.37–0.46 ms），符号引擎本身足够快。
2. **真正的性能瓶颈在"每轮全量状态往返"。** 每轮都要完整下载、重建、再完整上传全部 Knowledge：10,000 条事实的 JSON 快照为 **1.5 MB**，写一条事实在本进程内就要重新序列化整个 store（50,000 条事实时 **约 9 ms/轮**），数据库侧还要逐行跑 `INSERT ... ON CONFLICT`。
3. **知识库最大的问题不是速度，是"教不会 / 想不起 / 改不掉"。** 实测确认：`企鹅不会飞` 完全无法写入（否定事实被门控拦截）；`猫是一种哺乳动物` 以原始字符串入库，对推理不可见；`猫是哺乳动物` 之后问 `猫属于什么` 能答上，但多跳（`企鹅属于鸟` + `鸟会飞` ⇒ `企鹅会飞`）不成立。
4. **存在一个静默的数据截断风险。** `loadSnapshot` 的知识查询没有 `limit` 也没有分页循环，Supabase/PostgREST 的默认行数上限会让超出部分"消失"且不报错。

建议的顺序是：先修数据完整性缺口（几乎零风险、收益立刻可见），再改每轮 I/O 拓扑（收益最大、需要一次迁移），最后才扩展推理能力。

---

## 2. 项目框架速览

```text
已认证客户端
  -> Cloudflare Worker (apps/api)
       handler.ts       健康检查 / CORS 白名单 / HS256 JWT 校验 / DO 路由
       userBrain.ts     DO：60 req/min 限频、幂等、revision 冲突重试一次
       coreSession.ts   从快照重建引擎并执行一轮
       supabaseRepository.ts  REST 读删 + RPC 事务提交
  -> 每用户一个 Durable Object（串行化 + 限频窗口）
  -> @sunland-ai/core（纯符号引擎，唯一外部入口 src/sdk.ts）
  -> Supabase（Knowledge / Memory / Context / revision / turn result）
```

Core 内部分层：`parser / semantic / community / knowledge / memory / dialogue` → `understanding` → `reasoners / planner` → `personality` → `engine`（组合根 `engine/sunlandEngine.ts`）→ `sdk`。

每轮执行顺序（实测总耗时 0.4–0.6 ms）：

1. `normalizeSemanticContext` + `defaultConversationAnalyzer.analyze`
2. `parser.parse(input)`（legacy 正则解析器）
3. `analyzeSemanticInput`（归一化 → `extractSemanticFeatures` → 3 个候选生产者 → 排序去重）
4. `createTurnCandidatePool` + `resolveTurnUnderstanding`（统一理解总线）
5. `eventStateResolver` / `topicTracker` 投影
6. `defaultDialoguePlanner.plan` + `advanceConversationState`
7. 知识写入或 `answerGraphQuery`（reasoner）
8. `defaultResponsePlanner.plan` → Frost/Plain 渲染
9. `completeConversationState` + 语义 Context 更新

代码规模：Core 209 个 TS 文件 / 约 31k 行；测试 71 个文件 / 1389 个用例，当前全部通过。

---

## 3. 性能实测数据

测试方法：在 `packages/core` 内用 Vitest 构造 N 条 `KnowledgeRecord`，经 `StorageAdapter` 注入引擎，对 8 类典型输入（寒暄、自述姓名、定义查询、单跳查询、教学、情绪、因果提问、告别）重复采样，`performance.now()` 计时。运行环境：本机 Node（darwin-arm64）。

### 3.1 单轮延迟与知识规模基本无关

| 事实数 | 冷启动重建 | 单轮 mean | 单轮 p50 | 单轮 p95 |
|---|---|---|---|---|
| 0 | 1.1 ms | 0.49 ms | 0.46 ms | 0.70 ms |
| 200 | 0.5 ms | 0.41 ms | 0.40 ms | 0.52 ms |
| 2,000 | 2.9 ms | 0.42 ms | 0.37 ms | 0.72 ms |
| 10,000 | 13.9 ms | 0.60 ms | 0.37 ms | 2.04 ms |
| 50,000 | 71.2 ms | 0.38–0.48 ms（教学轮除外） | — | — |

50,000 条事实下逐输入拆分：

```text
"你好"              0.48 ms      "实体10属于什么"      0.45 ms
"我叫小明"          0.41 ms      "记住 实体10 属于 分类99"  9.06 ms   <-- 唯一的异常
"猫是什么"          0.39 ms      "我今天很累..."       0.38 ms
"为什么天是蓝的"    0.40 ms      "谢谢你的帮助，再见"  0.41 ms
```

结论：查询路径是索引化的（`store.match()` 取最小索引集合求交，`graphReasoner` 单跳 + `属于` 传递闭包），**规模上可接受**。唯一随规模劣化的是**写入**。

### 3.2 写入是 O(N)：`persist()` 每次全量序列化

`engine/sunlandEngine.ts:617` 的 `persist()` 调用 `saveKnowledgeStore`，而 `knowledge/persistence.ts:17` 的实现是：

```ts
adapter.setItem(key, JSON.stringify(store.all()));
```

即"新增一条事实"要重新序列化整个知识库。实测：

| 事实数 | 单次教学轮耗时 |
|---|---|
| 2,000 | 约 0.9 ms |
| 10,000 | 约 2 ms |
| 50,000 | **9.06 ms（p95 11.97 ms）** |

10,000 条事实的快照序列化成本：`bytes=1,525,781`、`stringify=1.8 ms`、`parse=3.6 ms`。快照本身在 Worker 内是内存操作，但同一份数组还要走网络。

### 3.3 真正的瓶颈：每轮全量 I/O

- `apps/api/src/supabaseRepository.ts:79`：`loadSnapshot` 拉取该用户**全部**知识行，无 `limit`、无游标、不检查 `Content-Range`。
- `apps/api/src/coreSession.ts:42-63`：每轮都 `createSunlandEngine` 重建引擎 + `JSON.parse` 整份快照（10k 事实 3.6 ms，50k 事实 71 ms 冷启动）。
- `apps/api/src/userBrain.ts:106-133`：`commitTurn` 把**完整数组**回传。
- `supabase/migrations/202608080001_create_sunland_ai_schema.sql:132-138`：RPC 对数组里每条记录跑一次 `INSERT ... ON CONFLICT DO NOTHING`。

一轮对话因此包含"下载 N 行 + JSON 重建 + 上传 N 行 + N 次插入"，N 随用户使用单调增长。10k 事实下这是 1.5 MB 出站 + 1.5 MB 入站，**网络与数据库往返远大于 0.6 ms 的引擎计算**。

### 3.4 数据库层

`sunland_ai_knowledge` 上唯一的索引是 `(user_id, created_at, id)`（迁移第 65 行）。按 `subject` 或 `relation` 检索没有可用索引；也没有 `tsvector` / `pg_trgm` / 向量列，检索完全靠全量拉取后在内存 `Map` 索引里做——这解释了 3.1 的"快"，也解释了 3.3 的"贵"。

### 3.5 次要热点（代码级）

- `semantic/extract.ts:164-167`：`findLexiconOccurrences` 对**每个**词条每次调用都执行 `[...entry.aliases].sort(...)`，然后在 3.2 的循环里对每个别名做 `trim/replace/toLocaleLowerCase`。这些都可以在模块加载时预计算（`semantic/lexicon.ts:58`）。
- `semantic/candidates.ts:234` 与 `semantic/engineAdapter.ts:99` 各自实现了相同的 `normalized()`；候选去重与等价比较会对同一字符串反复归一化。
- `rules/isaTransitivity.ts:52`：`buildAdjacency` 每次查询都 `match({relation: "属于"})` 重建全图邻接表。当前数据量下无感，但它是随知识规模增长的 O(N)。
- Core 内没有任何缓存/记忆化设施（全仓 grep `memo|cache` 无命中）。

---

## 4. 知识库实测：教不会、想不起、改不掉

以下行为均在本次分析中用一个临时探针实测确认（探针已删除）。

### 4.1 教学与存储

| 输入 | 结果 |
|---|---|
| `猫是一种哺乳动物` | 存成 `{猫, 是, 一种哺乳动物}` |
| `猫是哺乳动物` | 存成 `{猫, 是, 哺乳动物}` |
| `猫咪属于哺乳动物` | 存成 `{猫咪, 属于, 哺乳动物}` |
| `企鹅不会飞` | **未写入**，回复"还缺少一点上下文" |
| `猫不喜欢鱼` | **未写入** |
| `猫属于哺乳动物，而且猫喜欢鱼` | **未写入**（多事实被拒） |
| `记住 猫 属于 哺乳动物` | 存成 `{记住 猫, 属于, 哺乳动物}`（主语多吃两个字） |

### 4.2 检索与推理

| 输入 | 结果 |
|---|---|
| `猫属于什么`（已教 `猫是哺乳动物`） | 答"猫 属于 哺乳动物"（`是→属于` 回退生效） |
| `猫属于动物吗` | 无答案（无多跳 `是`/`属于` 链路） |
| `企鹅会飞吗`（已教 `企鹅属于鸟`、`鸟会飞`） | **无答案**（只有 `属于` 支持传递） |
| `猫属于什么`（先教哺乳动物，后教爬行动物） | 答"猫 属于 哺乳动物；猫 属于 爬行动物"——两条并列，无纠正、无冲突提示 |
| `猫咪属于什么` | 答"猫咪 属于 哺乳动物"（字符串不同即视为不同实体） |

### 4.3 根因定位

1. **否定事实被一刀切拦截。** `semantic/legacySideEffectGate.ts:267-269` 只要 `negationCues.length > 0` 就 `block("negation-detected")`。而 `types/knowledge.ts:46-52` 明确把 `negated` 定义为一等公民、`parser/patterns/statement.ts:5-6` 明确支持 `企鹅不会飞 → negated: true`。**结果是 `negated` 字段永远只能是 `false`**，`conflicts: []`（`reasoners/graphReasoner.ts:100`）也因此永远是空数组——矛盾检测、例外推理、`knowledge/seed.ts` 里企鹅的例子全部无法成立。
2. **门控算了规范形，写入却用原始形。** `legacySideEffectGate.ts:109-118` 会把 `是→属于`、去掉 `一种` 前缀得到比较键，但 `engine/sunlandEngine.ts:770-772` 直接 `store.add(parsed)` 存原始三元组。于是"用于判定"的表示和"实际存储"的表示分叉，`一种哺乳动物` 这类记录永远不会进入 `属于` 邻接表。
3. **事实身份是原始字符串。** `knowledge/store.ts:33-35` 的 `tripleKey` 与迁移第 22 行的唯一约束都用 `subject/relation/object` 原文。没有别名表、没有实体规范化、没有大小写/空白统一（教学路径只折叠内部空白 `sideEffectSafety.ts:94-97`，查询路径却去掉全部空白 `parser/normalize.ts:20`）。读写规范化不一致，`记住 猫` 这类脏主语就是这么产生的。
4. **没有排序与时效。** `graphReasoner.ts:46-59` 保持 Map 插入序，`planner/responsePlanner.ts:101` 按该顺序输出。没有 `updatedAt`/`supersedes`/`validFrom`，所以"更正"在数据模型里不可表达。
5. **`addMany` 按 `id` 去重而非按三元组**（`store.ts:169-174`），重复三元组不同 `id` 会让 `idByTripleKey` 指向最后一条，`remove()` 之后残留"幽灵记录"。

---

## 5. 改进建议

按"风险从低到高、收益从即时到结构性"排序。

### A. 立即可做（无需迁移，改动小，直接提升回答正确率）

| # | 建议 | 关键改动 | 工作量 |
|---|---|---|---|
| A1 | **修正 `loadSnapshot` 的静默截断** ✅ | `supabaseRepository.ts:79` 加分页循环并校验读回条数；若与数据库不一致则失败而非"成功但丢数据" | S |
| A2 | **写入时存规范三元组** ✅ | 在 `sunlandEngine.ts:770` 之前复用 `legacySideEffectGate` 的规范化（`是→属于`、剥离 `一种`、实体空白/大小写统一），让存储表示与判定表示一致 | S |
| A3 | **课程式别名与实体规范化** | 新增 `knowledge/canonical.ts`：显式、可审计的关系别名表 + 实体 surface 规范化；不引入相似度猜测 | S/M |
| A4 | **`addMany` 按三元组去重** ✅ | `store.ts:169-174`，顺带修 `remove()` 的幽灵记录 | S |
| A5 | **教学主语净化** ✅ | 修 `记住 猫` 类前缀污染（教学提示词应在解析阶段剥离，而不是进主语） | S |
| A6 | **读路径预计算** | `extract.ts:164-167` 的别名排序/归一化移到 `lexicon.ts:58` 模块加载期；合并两处重复的 `normalized()` | S |
| A7 | **重教返回真实结果** | `store.add` 命中已有三元组时返回既有记录，人格层应说"这条我已经知道了"而不是"已记下" | S |

### B. 结构性改进（收益最大，需要一次数据库迁移 → 需维护者明确批准）

| # | 建议 | 关键改动 | 工作量 |
|---|---|---|---|
| B1 | **改为增量写入** | RPC 增加 `p_knowledge_added` / `p_knowledge_removed` 两个 delta 数组，替代每轮全量数组；`persist()` 改为记录脏集合 | M/L |
| B2 | **每轮不再重建引擎** | 知识/记忆快照缓存在 Durable Object 的 `ctx.storage`（每用户隔离、已串行化），只从 Supabase 取 delta；`coreSession` 复用引擎实例 | M |
| B3 | **补齐检索索引** | `(user_id, subject)`、`(user_id, relation)` 索引；为 `GET /v1/knowledge?subject=` 提供过滤参数 | S/M |
| B4 | **有界规则继承 + 例外阻断** | 新增 `rules/capabilityPropagation.ts`（`企鹅属于鸟` + `鸟会飞` + `企鹅不会飞` ⇒ 不推出 `企鹅会飞`），注册进 `rules/registry.ts:12`，复用现有 `traverseIsAForQuery` | M |
| B5 | **实现已声明的 `ConflictResolver`** | 填充 `ReasoningResult.conflicts`，让正/负事实冲突可见而不是并列输出 | M |
| B6 | **答案排序** | 特异性 → confidence → `createdAt` 倒序，让"更正"至少能排在前面 | S/M |
| B7 | **解除否定事实的教学封锁** | 把 `legacySideEffectGate.ts:267` 的"检测到否定即拒"改为"带 `negated: true` 的完整三元组可写入"，仍需通过结构安全门控 | M（风险点，需测试覆盖） |
| B8 | **受限多事实教学** | 允许 2–3 个句子分隔的事实，每条独立通过现有门控，全有或全无；绝不放松语义候选不得写库的红线 | M/L |
| B9 | **时效与溯源字段** | `updatedAt` + 可选 `validFrom/validUntil/supersedesId` | M |

### 6. 明确不做

- 不引入 LLM / 向量库 / 外部模型做抽取或检索——违反"确定性符号引擎、Core 无外部模型依赖"的不变量。
- 不把知识存成自由文本，事实必须保持三元组。
- 不按编辑距离/相似度自动合并实体，不引入概率式置信度学习；别名只能是显式可审计的表。
- 不把推理闭包物化入库（路径爆炸），`materialize()` 继续只服务可视化/调试。
- 不放宽 `legacySideEffectGate` / `sideEffectSafety` 的安全语义，不允许语义候选直接写库。
- 不在没有维护者批准的情况下改 schema、RLS 或 `supabase/migrations/deferred/` 下的文件。

---

## 7. 建议的执行顺序

1. **第一批（数据完整性，低风险）** ✅ 已实现：A1 A2 A4 A5 + 对应回归测试。消掉了"教了想不起"和"静默丢数据"两类最伤用户信任的问题。
2. **第二批（检索质量）**：A3 A6 A7 + B6。建立规范化与排序，为后续推理打基础。
3. **第三批（I/O 拓扑，需迁移审批）**：B1 B2 B3。在事实数破千之前完成，避免被迫做数据迁移。
4. **第四批（推理能力）**：B7 → B5 → B4 + B8。B7（否定可写入）是 B4/B5 的前置条件，必须先做且有充分测试。

## 8. 验收建议

- 每批都必须补 `packages/core` 的行为测试（`npm test --workspace @sunland-ai/core`），并跑根 `npm run typecheck && npm test && npm run build`。
- B1/B2 需要新增一个基准测试固化"单轮 I/O 与知识规模无关"这一目标，防止回退。
- 本文件中的实测数据可复现：建议把性能探针沉淀为仓库内的 benchmark 脚本（当前仓库没有 benchmark）。

---

## 附录 A：迁移草案（**未批准、未 apply、未落盘为迁移文件**）

> 以下 SQL 仅用于评审。按 [`AGENTS.md`](../AGENTS.md) 的数据库安全条款，在维护者明确批准前**不得**写入 `supabase/migrations/` 编号目录、不得 apply、不得修改 `deferred/` 下的门禁文件。
> 草案刻意拆成两个**相互独立**的迁移，可分别批准；两者都不触碰 RLS、权限、legacy 表，也不修改既有函数签名。

### A.1 迁移一：检索索引 + `updated_at`（低风险，B3 + B9 的一半）

```sql
-- 建议文件名：supabase/migrations/<新时间戳>_add_knowledge_lookup_indexes.sql
begin;

-- 按 subject / relation 检索目前没有可用索引，检索只能靠全量拉取后在内存做。
-- 现有唯一约束 (user_id, subject, relation, object, negated) 的前缀不是 subject，
-- 无法服务 GET /v1/knowledge?subject= 这类过滤。
create index if not exists sunland_ai_knowledge_user_subject_idx
  on public.sunland_ai_knowledge (user_id, subject);
create index if not exists sunland_ai_knowledge_user_relation_idx
  on public.sunland_ai_knowledge (user_id, relation);

-- 纠正/重教需要"这条事实什么时候被改过"。默认值回填为 created_at，
-- 历史行不会被赋予伪造的新时间。
alter table public.sunland_ai_knowledge
  add column if not exists updated_at timestamptz;
update public.sunland_ai_knowledge set updated_at = created_at where updated_at is null;
alter table public.sunland_ai_knowledge alter column updated_at set not null;
alter table public.sunland_ai_knowledge alter column updated_at set default now();

commit;
```

影响评估：**无知识语义改写**——`subject`、`relation`、`object`、`negated`、`confidence`、`source`、`created_at` 均不被重写；但**会对历史行回填 `updated_at = created_at`**，这是新列的初始取值，不是对既有事实的改写。索引为纯新增，权限、RLS、RPC、legacy 表均不涉及。回滚见 `supabase/rollback/202609130005_add_knowledge_lookup_indexes_rollback.sql`。

> 已落盘的实际迁移为 `supabase/migrations/202609130005_add_knowledge_lookup_indexes.sql`，比下面的草案更强：加了 apply 前的 schema 前置断言（不符即中止）、重复执行保护，以及配套的只读验证脚本。**该迁移尚未 apply**：本地无数据库凭据，apply 前的线上复核未完成。

### A.2 迁移二：增量提交 RPC（B1，收益最大）

要点：**不改动** `sunland_commit_turn`，而是新增 `sunland_commit_turn_delta`。旧函数原样保留，Worker 可灰度切换、可即时回退；`turn_id` 幂等与 `revision` 乐观并发语义完全照搬。

```sql
-- 建议文件名：supabase/migrations/<新时间戳>_add_delta_turn_commit.sql
begin;

create or replace function public.sunland_commit_turn_delta(
  p_user_id text, p_conversation_id text, p_turn_id text, p_expected_revision bigint,
  p_request_hash text, p_knowledge_added jsonb, p_knowledge_removed jsonb,
  p_memory jsonb, p_context jsonb, p_response jsonb, p_expires_at timestamptz
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_revision bigint;
  v_existing_hash text;
  v_existing_response jsonb;
  v_next_revision bigint;
  v_response jsonb;
  v_record jsonb;
begin
  if jsonb_typeof(p_knowledge_added) <> 'array'
    or jsonb_typeof(p_knowledge_removed) <> 'array'
    or jsonb_typeof(p_memory) <> 'array'
    or jsonb_typeof(p_context) <> 'object'
    or jsonb_typeof(p_response) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_turn_payload';
  end if;

  -- 幂等：与 sunland_commit_turn 完全一致。
  select request_hash, response into v_existing_hash, v_existing_response
    from public.sunland_ai_turn_results where user_id = p_user_id and turn_id = p_turn_id;
  if found then
    if v_existing_hash <> p_request_hash then
      raise exception using errcode = '23505', message = 'turn_id_reused';
    end if;
    return v_existing_response;
  end if;

  -- 乐观并发：与 sunland_commit_turn 完全一致。
  insert into public.sunland_ai_user_state (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  select revision into v_revision
    from public.sunland_ai_user_state where user_id = p_user_id for update;
  if v_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'revision_conflict';
  end if;

  -- 只写新增的事实，不再回传/遍历整张表。
  for v_record in select value from jsonb_array_elements(p_knowledge_added) loop
    insert into public.sunland_ai_knowledge
      (user_id, id, subject, relation, object, negated, confidence, source, created_at, updated_at)
    values (p_user_id, v_record->>'id', v_record->>'subject', v_record->>'relation',
      v_record->>'object', (v_record->>'negated')::boolean,
      (v_record->>'confidence')::double precision, v_record->>'source',
      (v_record->>'createdAt')::timestamptz, now())
    on conflict do nothing;
  end loop;

  -- 删除按 id 定位，仍带 user_id 约束，越权删除不可能生效。
  delete from public.sunland_ai_knowledge
    where user_id = p_user_id
      and id in (select value->>'id' from jsonb_array_elements(p_knowledge_removed));

  -- Memory 保持全量 upsert（key 数量天然很少），语义不变。
  for v_record in select value from jsonb_array_elements(p_memory) loop
    insert into public.sunland_ai_memory (user_id, key, id, value, created_at, updated_at)
    values (p_user_id, v_record->>'key', v_record->>'id', v_record->>'value',
      (v_record->>'createdAt')::timestamptz, (v_record->>'updatedAt')::timestamptz)
    on conflict (user_id, key) do update set id = excluded.id, value = excluded.value,
      created_at = excluded.created_at, updated_at = excluded.updated_at;
  end loop;

  insert into public.sunland_ai_context (user_id, conversation_id, version, context, updated_at)
  values (p_user_id, p_conversation_id, coalesce((p_context->>'version')::integer, 0), p_context, now())
  on conflict (user_id, conversation_id) do update set version = excluded.version,
    context = excluded.context, updated_at = excluded.updated_at;

  v_next_revision := v_revision + 1;
  v_response := jsonb_set(p_response, '{stateRevision}', to_jsonb(v_next_revision), true);
  update public.sunland_ai_user_state
    set revision = v_next_revision, updated_at = now() where user_id = p_user_id;
  insert into public.sunland_ai_turn_results
    (user_id, turn_id, conversation_id, request_hash, response, state_revision, expires_at)
  values (p_user_id, p_turn_id, p_conversation_id, p_request_hash, v_response,
    v_next_revision, p_expires_at);
  return v_response;
end;
$$;

revoke all on function public.sunland_commit_turn_delta(
  text, text, text, bigint, text, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.sunland_commit_turn_delta(
  text, text, text, bigint, text, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz)
  to service_role;

commit;
```

### A.3 采纳这块草案前必须一起解决的三个问题

1. **并发下的 delta 正确性。** 现在全量回传之所以安全，靠的是唯一约束 + `ON CONFLICT DO NOTHING` 兜底：即使另一台设备已写入同样的事实，重复插入也无害。改成 delta 后语义变为"基于 revision N 的差异"，`revision_conflict` 后 Worker 必须**重新加载快照并重算 delta**再重试。`apps/api/src/userBrain.ts:106-133` 现有的"冲突后重试一次"循环需要改成"重载 → 重算 diff → 重试"，否则会出现事实丢失。这是本次改动最容易出错的地方。
2. **Core 需要暴露脏集合。** `persist()`（`engine/sunlandEngine.ts:617`）现在只有"保存全部"一个语义。需要新增 `takeKnowledgeDelta()` 之类的只读接口，让宿主拿到"本轮新增/删除的 id"，同时**不改变** `StorageAdapter` 的既有契约。这一步属于 Core 公共面（`contracts/sdk-api-surface.v0.1.0.json` 冻结 70 个导出），需要一次有意的版本决策。
3. **灰度与回退。** 建议按用户或按百分比切流：旧函数保留期内两个 RPC 并存；一旦 delta 路径出现异常，切回 `sunland_commit_turn` 即可，无需再次迁移。

### A.4 不在本草案范围内（需要单独评审）

- **否定事实可写入（B7）** 不涉及 schema 变更，但必须先扩充安全测试，建议与第一批一起做、单独提交。
- **`supersedes_id` / `valid_from` / `valid_until`（B9 的另一半）** 会改变知识语义与推理行为，建议等 B5/B6（冲突与排序）落地、明确"更正"的产品语义后再设计，现在加列只会留下无人使用的字段。
- **`deferred/20260808_enforce_legacy_rls_after_forced_upgrade.sql`** 的部署门禁不受本草案影响，仍须满足 [`deployment.md`](deployment.md) 的全部条件。
