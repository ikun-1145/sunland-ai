# B.7 + B.5 实施计划：negated fact 可达性 → ConflictResolver

> 状态：**已批准（含 9 项修订），执行中。**
> 前置：Batch 1/3 已完成；A.1 迁移已 apply。B.7 之后仍有 B.1/B.2/B.4/B.8，本批不涉及。
> 硬约束：不改 SDK 公开 API（70 exports）、DB schema、RPC、RLS、migrations、deferred。

## 维护者修订（本计划以下章节已按此覆盖）

1. **删除 `negated > positive` 全局优先级。** 极性本身不得决定权威；正向与否定在 resolver 中完全对称。
2. **winner 排序固定为**：`direct > derived` → `confidence DESC` → `source authority DESC` → `createdAt DESC` → `id ASC`。
3. **source authority 固定并集中定义一处**：`user > import > seed > inference`（以仓库真实枚举 `KnowledgeSource = "user" | "inference" | "seed" | "import"` 为准）。
4. **同 direct / 同 source / 同 confidence 时，较新的 `createdAt` 胜**，因此后教的一方推翻同等级旧事实——不论极性，保证对称。
5. **conflict identity**：相同 proposition + 相反 `negated`；`subject` 与 `object` **都**按 A.6c 的 whitespace-only lookup key 对齐，禁止扩大 fuzzy canonicalization。
6. **`Conflict` 结构化保存 `winner` / `suppressed` / `strategy`**；reasoner 只从 `answers` 移除 loser，**不得修改或删除 store/known facts**。
7. 新增两组测试：极性对称（两种教学顺序均由较新者胜）；direct 对 derived（两种极性组合均由 direct 胜）。
8. **B.7 与 B.5 必须同批提交**，不允许单独上线 B.7。
9. 其余约束不变：不做 B.1/B.2/B.4/B.8，不改 SDK/schema/RPC/RLS/migrations。

## 0. 现状实测（决定 B.7 范围的关键证据）

### 0.1 否定事实当前在每一层的真实行为

用 `猫不会飞` 逐层追踪（实测）：

| 层 | 结果 |
|---|---|
| `parser/patterns/statement.ts` | ✅ **已正确解析**：`{猫, 会, 飞, negated: true}`。否定捕获无需改动 |
| `semantic/extract.ts` | ✅ 识别 `negationCues: ["不会"]` |
| `semantic/understandingPlanner.ts:372-378` | ❌ **第一道闸**：`negationPolicy.rejectNegatedSideEffects` 默认 `true` → `required.push("non-negated-assertion")` → `decision = reject-side-effect` |
| `semantic/legacySideEffectGate.ts:269-271` | ⚠️ **第二道闸（当前不触发）**：`negationCues.length > 0` → `block("negation-detected")`。因上一步已 reject，gate 返回 `semantic-side-effect-rejected` |
| `engine/sunlandEngine.ts` statement 分支 | 未到达写入 |
| 用户可见 | `"这个问题我暂时还没理解清楚…"` |

**结论：`negated` 在整个写入链路上完全不可达**，但**解析层本来就会设置它**。所以 B.7 的改动集中在两处判定，不需要碰解析器。

实测四种输入全部被拒：

```
"猫会飞"     -> 已记录：猫 会 飞
"猫不会飞"   -> 这个问题我暂时还没理解清楚…     ❌
"猫喜欢鱼"   -> 已记录：猫 喜欢 鱼
"猫不喜欢鱼" -> 这个问题我暂时还没理解清楚…     ❌
"企鹅不会飞" -> 这个问题我暂时还没理解清楚…     ❌
```

### 0.2 正负事实同时存在时（当前可经 `addMany` 恢复/导入发生）

`knowledge/store.ts` 的 `tripleKey` 含 `negated`，所以两条可以共存。实测 reasoner：

```
加入 {猫,会,飞,neg=false} 与 {猫,会,飞,neg=true}
问 "猫会什么"   -> answers: [飞|neg=false, 飞|neg=true]，conflicts: []，explanation: "猫 会 飞；猫 不会 飞"
问 "猫会不会飞" -> answers: [飞|neg=false, 飞|neg=true]
```

即：**两条并列输出、自相矛盾、`conflicts` 恒为 `[]`**（`graphReasoner.ts` 里硬编码）。这是 B.5 要解决的核心缺陷。

### 0.3 已确认与 B.5 无关的两点

- `猫会飞` 与 `猫喜欢鱼`（不同 relation）、`猫会飞` 与 `猫会游泳`（**同 relation 不同 object**）当前都正常共存、无冲突。这是**正确**行为，B.5 必须保留。
- derived 路径与否定**当前不会互相矛盾**：`traverseIsAForQuery` 只沿 `negated: false` 的 `属于` 边（`rules/isaTransitivity.ts:54`），且 **capability 继承根本未实现**（`rules/registry.ts` 只有 isaTransitivity）。实测 `企鹅属于鸟 + 鸟会飞` 问 `企鹅会什么` → `[]`。所以"derived 与 negated 冲突"目前只能由 `属于` 上的传递闭包产生，B.5 必须按"未来会有更多规则"来设计。

---

## 1. B.7 — negated fact 的完整可达性

### 1.1 目标

让 `猫不会飞` 能被**教**、能被**存**、能被**问**，且不改变既有安全不变量。**只解决可达性**，冲突如何裁决交给 B.5。

### 1.2 拟修改

| 文件 | 变更 | 理由 |
|---|---|---|
| `semantic/understandingPolicy.ts` | 新增 `NegationPolicy.allowCompleteNegatedStatements`（默认 `true`）；`rejectNegatedSideEffects` 保留但语义收窄为"拒绝**不完整**的否定写入" | 现在的一刀切拒绝使 `negated` 字段永远为 false |
| `semantic/understandingPlanner.ts:372-378` | `non-negated-assertion` 只在候选**缺少完整三元组**时要求；完整且通过结构安全的否定语句不再要求它 | 同上 |
| `semantic/legacySideEffectGate.ts:269-271` | `negation-detected` 从"检测到即拒"改为"**完整且结构安全的否定三元组放行**"。仍然拦截：否定 + 缺 slot、否定 + 疑问、否定 + 复合句 | 保持 side-effect safety 不变量 |
| `engine/sunlandEngine.ts` | **无改动**（statement 分支已把 `parsed.negated` 写进 triple） | — |
| `knowledge/store.ts` | **无改动** | — |

**不改**：`parser/patterns/statement.ts`（已正确）、DB schema、RPC。

### 1.3 仍然必须被拒绝的否定输入（回归护栏）

| 输入 | 期望 | 原因 |
|---|---|---|
| `猫不会` | 拒 | object 缺失 |
| `不会飞` | 拒 | subject 缺失 |
| `猫不会飞吗` | 拒（走 query/澄清） | 疑问结构 |
| `猫不会飞，鸟也不会飞` | 拒 | 复合句，超 `maxRelationMentions` |
| `不要记住猫不会飞` | 拒 | `hasExplicitSideEffectProhibition` |
| `猫不会飞还是会游泳` | 拒 | 选择/序列 cue |

### 1.4 数据流（改动后）

```
"猫不会飞"
  -> normalizeInput（删空白）
  -> statement pattern: { 猫, 会, 飞, negated: true }   [不变]
  -> semantic analyze: negationCues: ["不会"]           [不变]
  -> understandingPlanner: 完整三元组 + 结构安全 -> accept（不再因否定 reject）
  -> legacySideEffectGate: canonical key
       "knowledge:猫|会|飞|true" 两侧一致 -> allow-legacy-side-effect
  -> store.add({猫,会,飞,negated:true})  [tripleKey 含 negated，与正向事实共存]
  -> A.7 outcome: 首教 "已记录：猫 不会 飞"
```

### 1.5 兼容性与风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| **安全面收窄** | 这是本批唯一真正放宽的闸门 | 只放宽"完整 + 结构安全 + 语义确认"的否定三元组；1.3 的六类输入逐条测试；`sideEffectSafety` 的门限一律不动 |
| 存量库出现正负并存 | 放行后用户可能真的教出 `猫会飞` + `猫不会飞` | 这是 B.5 存在的理由；B.7 与 B.5 必须**同批**上线，否则会引入用户可见自相矛盾 |
| A.7 文案 | `猫不会飞` 的 fact 行需要正确渲染"不" | 现有 `factLine`/Plain 已处理 `negated`，加测试即可 |
| 待调查 drift | B.7 不碰 RLS/policy | 保持 |

**B.7 与 B.5 的耦合是硬性的**：只做 B.7 会让系统开始输出矛盾答案。建议同批实现、同批合并。

---

## 2. B.5 — ConflictResolver

### 2.1 Conflict identity（先定义，再谈裁决）

已存在 `types/reasoning.ts` 的 `ConflictResolver` 接口（`detect(candidates, known)`）与 `Conflict` 结构（`description`/`winner`/`loser`/`strategy`），本批首次实现它。

**冲突（同一命题的正反两说）当且仅当：**

```
subject 相同（按 entityLookupKey 比较，仅删空白）
AND relation 相同
AND object 相同（同样按 entityLookupKey 比较 —— 见下方说明）
AND negation 相反
```

即 `(s, r, o, true)` 与 `(s, r, o, false)` 互为冲突。这是唯一进入裁决的关系。

**object 的实体 identity 与 A.6c 一致**：A.6c 的 `matchByEntity` 对 `subject` 与 `object` **都**使用 `entityLookupKey`（仅删 Unicode 空白，无大小写/全半角/标点/繁简/拼音/fuzzy）。resolver 复用同一函数，因此 `Alice Chen 会飞` 与 `AliceChen 不会飞` 判定为冲突（同一 entity），而 `Alice` 与 `AliceChen` 不冲突。**不扩大**任何 fuzzy canonicalization。

**只是"相关但可共存"（绝不裁决、绝不覆盖）：**

| 情形 | 例 | 为何不冲突 |
|---|---|---|
| 同 subject+relation，object 不同 | `猫会飞` / `猫会游泳` | 两条可以同时为真 |
| subject 或 relation 不同 | `猫会飞` / `鸟会飞` | 不同命题 |
| 同 subject，不同 relation | `猫会飞` / `猫喜欢鱼` | 不同属性 |
| object 只差空白 | `Alice Chen` / `AliceChen` | 经 `entityLookupKey` 视为同一 entity → **会**冲突（与 A.6c 一致） |
| 同 subject+relation+object 且 negated 相同 | 重复事实 | 不是冲突，是重复（A.4 已按三元组去重） |

**明确禁止**：不得因为 subject+relation 相同就互相覆盖。`猫会飞` 与 `猫会游泳` 必须都留下，这与 B.5 无关，是 B.5 的边界。

### 2.2 裁决优先级（有序，全部显式）

对每一对冲突 `(P, N)`（仅 `negated` 相反），按下列顺序判定赢家。**比较键全部来自显式字段，不依赖顺序或随机；polarity 不出现在任何一级**：

| 级 | 键 | 方向 | 依据 |
|---|---|---|---|
| 1 | `isDerived` | **直接事实优先**（direct < derived）。derived 不得压制任何直接事实，无论极性 | 原始事实是用户亲口教的；推理结论可由规则变化推翻 |
| 2 | `confidence` | **高者胜**（DESC） | 置信度是既有的信念强度语义（`types/knowledge.ts`，[0,1]） |
| 3 | `source` 权威 | **DESC**：`user > import > seed > inference` | 用户亲授优先于导入/种子/推断。**集中定义一处**（见 2.2.1） |
| 4 | `createdAt` | **新者胜**（DESC） | 同级证据下，后教的更正生效——这就是极性对称的落点 |
| 5 | `id` | 升序 | **保证全序**；仅在前 4 级全等时使用，使结果与输入顺序无关 |

**极性对称性如何成立**：`negated` 不在任何一级里。先教 `猫会飞` 再教 `猫不会飞`，与反过来，两条在 1–3 级全部相等，于是都由第 4 级（更新的 `createdAt`）决定胜负。两条测试分别钉住两个方向，断言 winner 就是较晚的那条。

**与 B.6 排序键的关系**：B.5 的 winner 键是**独立**的比较函数，不复用 B.6 的展示排序元组（后者含 `negated ASC` 与 `pathLength`，是展示关注点）。二者职责分离：B.5 决定谁被压制，B.6 决定剩下谁先展示。

#### 2.2.1 source authority 的唯一定义

```
user(3) > import(2) > seed(1) > inference(0)
```

集中在一个导出常量（`reasoners/sourceAuthority.ts`），resolver 只读它，**不得**在别处再写一份排序。理由：`semantic/lexicon.ts` 已有"别名冲突"检测，如果再散落一份 source 排序，两处判据分歧会导致同一对事实在不同路径得到不同胜负。测试断言 rank 表覆盖 `KnowledgeSource` 的全部 4 个取值（`Record<KnowledgeSource, number>`，漏一个就编译失败）。

### 2.3 裁决时机：**reasoner-time（查询期视图），不落盘**

| 时机 | 采用 | 理由 |
|---|---|---|
| persistence-time（写入时删除/降权旧事实） | ❌ | 破坏原始事实，且 `sunland_commit_turn` 是全量回传，删除需改 RPC（本批禁止） |
| **reasoner-time** | ✅ | 与既有 `ConflictResolver.detect(candidates, known)` 接口一致；store 只读；原始事实永不改写；同一份数据可随规则演进重新解释 |
| query-time（planner/personality） | ❌ | planner 是纯渲染器，不该做事实判断；放这里会让 explanation 与 answers 不一致 |

**不变量**：
- `store.all()` 在裁决前后完全相同（写测试断言）。
- 被压制的事实**不被删除、不被降 confidence、不被标记 superseded**。
- 恢复/导入的 payload 不受影响（AGENTS.md：restored storage 是 untrusted input，只读不重写）。

### 2.4 输出契约与 explainability

`Conflict` 现有字段足够表达，无需改类型：

`Conflict` 结构改为结构化保存三者（`winner` / `suppressed` / `strategy`）：

```ts
{
  description: "猫 会 飞 与 猫 不会 飞 冲突：以较新的记录为准",
  winner:     { subject: "猫", relation: "会", object: "飞", negated: true },
  suppressed: [{ subject: "猫", relation: "会", object: "飞", negated: false }],
  strategy:   "more-recent"   // 稳定、机器可读的规则 id
}
```

`suppressed` 是**数组**：同一命题理论上可被多条同向记录断言（`addMany` 恢复的 payload 是 untrusted input），一条 winner 可以压制多条 loser，因此不能是单值。类型改动只涉及 `types/reasoning.ts` 的类型形状，**不新增运行时导出**（`Conflict`/`ConflictResolver` 均为 type-only，70 exports 不受影响）。

`strategy` 取值集合（每条对应 2.2 的一级，且是**稳定的机器可读 id**）：

| strategy id | 含义 |
|---|---|
| `direct-over-derived` | 直接事实压制推理结论 |
| `higher-confidence` | 置信度高者胜 |
| `source-authority` | `user > import > seed > inference` |
| `more-recent` | `createdAt` 新者胜（**极性对称的落点**） |
| `total-order-id` | 前四级全等，按 id 定序（罕见，但保证确定性） |

注意：**没有 `negation-precedence`** —— 极性不是判据。

**用户可见解释**：`ResponsePlan.explanation` 追加一句，由 planner 从 `result.conflicts` 生成（Personality 仍只嵌入 `plan.explanation`，不读 `reasoning-result` 的字段，保持既有边界）：

```
猫 不会 飞（另有 猫 会 飞，因"以较新的记录为准"被压制）
```

即："被什么事实、依据什么规则压制"都出现在文本里。若某事实被压制，`conflicts` 必有对应条目，且该条目同时出现在 explanation 中——加测试断言二者一致。

### 2.5 与 B.6 排序的关系

B.5 **不新增排序键**，而是复用并收敛到 B.6 已有的单一 tuple：
`isDerived ASC, negated ASC, confidence DESC, pathLength ASC, object ASC, relation ASC, subject ASC, createdAt DESC, id ASC`。

B.5 的 winner 键与 B.6 的展示元组是**两个独立关注点**，不共享实现：B.5 用 2.2 的裁决键（不含 polarity），B.6 用展示元组（含 `negated ASC`、`pathLength`）。

交互处理：裁决先跑，被压制者从 `answers` **移出到 `conflicts`**（不删除、仍可解释）；因此正常路径下 `answers` 里不会同时出现同一命题的正反两说，B.6 的 `negated` 级只作用于**不同命题**之间的展示排序。两条规则职责清晰，`answers` 不再自相矛盾。

---

## 3. 测试矩阵

### 3.1 B.7 可达性

| 用例 | 期望 |
|---|---|
| `猫会飞` 后 `猫不会飞` | 两条都存；`tripleKey` 含 negated 故共存 |
| `猫喜欢鱼` 后 `猫不喜欢鱼` | 同上 |
| `企鹅属于鸟` + `鸟会飞` + `企鹅不会飞` | 三条都存 |
| `猫不会飞` 首次教学文案 | `已记录：猫 不会 飞`（"不"渲染正确，A.7 三种 outcome 各自正确） |
| 1.3 的六类不安全否定输入 | 全部仍被拒 |
| 否定事实参与 `属于` 传递 | `traverseIsAForQuery` 仍**忽略**否定边（现有不变量，须保持） |
| 问 `猫会什么`（正负并存） | 不再并列两条；见 3.2 |

### 3.2 B.5 裁决（要求的最小集）

| # | 场景 | 期望 |
|---|---|---|
| 1 | **先否定后肯定**：`猫不会飞`(旧) 然后 `猫会飞`(新)，其余证据相同 | **较新者（正向）胜**；strategy `more-recent`；suppressed = 旧否定 |
| 2 | **先肯定后否定**：`猫会飞`(旧) 然后 `猫不会飞`(新)，其余证据相同 | **较新者（否定）胜**；strategy `more-recent`；suppressed = 旧正向 |
| 3 | `企鹅会飞` vs `企鹅不会飞`（同时间、同 source、同 confidence） | 由 `id ASC` 决定（strategy `total-order-id`），且与输入顺序无关 |
| 4 | 同 relation 不同 object：`猫会飞` vs `猫会游泳` | **无冲突**；两条都在 answers；conflicts 为空 |
| 5 | **direct positive vs derived negative** | **direct 胜**；strategy `direct-over-derived`；即使 derived confidence 更高 |
| 6 | **direct negative vs derived positive** | **direct 胜**；同上，证明极性不参与 |
| 7 | 不同 confidence：`猫会飞`(0.4) vs `猫不会飞`(0.9)，同 source、createdAt 相同 | 高置信（否定）胜；strategy `higher-confidence`；须断言**不是** `more-recent` |
| 8 | 同 confidence、不同 source：`user` vs `import` | `user` 胜；strategy `source-authority` |
| 9 | 全等（同 direct/source/confidence/createdAt） | `id ASC`，strategy `total-order-id`；shuffle 输入顺序结果不变 |
| 10 | 同极性重复 | 不是冲突（A.4 已按三元组去重）；conflicts 为空 |
| 11 | 空白差异 entity：`Alice Chen 会飞` vs `AliceChen 不会飞` | 经 `entityLookupKey` 视为同一 entity → **冲突**；`Alice` vs `AliceChen` 则**不**冲突 |

### 3.3 不变量测试（每条都必须有）

| 不变量 | 断言方式 |
|---|---|
| **不破坏原始事实** | 裁决前后 `store.all()` 深度相等（含 id/confidence/source/createdAt） |
| 不依赖输入顺序 | B.6 已有 shuffle invariant；B.5 对 candidates 打乱 25 次，answers/conflicts 恒等 |
| 全序 | 任意相异 conflict 对比较非 0、反对称（复用 B.6 的全序测试手法） |
| explainability 一致性 | 每个被压制事实（不在 answers 中但存在于 store）必须在 `conflicts` 中有条目；每条 conflict 的 `description` 必出现在 `plan.explanation` 中 |
| 无 subject+relation 越权覆盖 | 穷举 `(同 s 同 r 不同 o)`、`(不同 s)`、`(不同 r)` 组合，断言 conflicts 恒为空、answers 含全部事实 |
| SDK 面 | `sdk.api-surface.contract.test.ts` 70 exports 保持 |

---

## 4. 不变量与验收清单

- [ ] SDK 运行时导出仍恰好 70 个；`ConflictResolver` 已存在于 `types/reasoning.ts`（不是新增导出）
- [ ] 未改 DB schema / RPC / RLS / policy / grant / migration / deferred
- [ ] 未进入 B.1、B.2、B.4、B.8
- [ ] 未引入模糊匹配、LLM 或向量检索
- [ ] 裁决只发生在 reasoner-time；store 只读；被压制事实不删除、不降权、不 superseded
- [ ] 禁止仅凭 subject+relation 相同互相覆盖（有穷举测试）
- [ ] 每条被压制事实都能说明"被什么事实、依据什么规则"
- [ ] derived 永不压制 direct（即使 derived confidence 更高）
- [ ] 否定边继续被 `属于` 传递忽略
- [ ] B.7 与 B.5 同批合并，避免中间状态输出矛盾答案

## 5. 建议落地顺序（同批内）

1. **B.7 可达性** + 1.3 的六类拒绝回归 + 否定教学文案测试
2. **B.5 冲突检测**（identity + `ConflictStrategyId` 常量 + `detect` 实现），先只填充 `conflicts`，不动 `answers`
3. **B.5 压制与解释**：把被压制者移出 `answers`、写入 `conflicts`、planner 追加 explanation
4. **穷举与不变量测试**：3.3 全部
5. 根 `npm run typecheck && npm test && npm run build`

## 6. 本批明确不做

- 不实现 capability/attribute 继承（B.4）——本计划只保证 B.5 在它到来时无需重写。
- 不做 `updated_at` 相关裁决或写入（需改 RPC/schema）。
- 不做记忆的冲突（`MemoryManager` 是覆盖语义，与知识冲突不同，另议）。
- 不迁移存量正负并存数据。
- `Conflict` 结构按修订 6 改为 `winner` / `suppressed[]` / `strategy`（type-only，不影响 70 exports）；除此之外不新增字段。
