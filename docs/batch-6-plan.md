# Batch 6 / B.4 实施计划：bounded capability propagation

> 状态：**待审批，未改任何代码。** 本文件只描述拟议变更。
> 前置：Batch 1/3/4/5 已完成（A.1 迁移已 apply；B.7+B.5 已合并；B.8 multi-fact 已合并）。
> 硬约束：不改 SDK 公开 API（70 exports）、DB schema、RPC、RLS、migrations、deferred。
> 本轮禁止修改任何 `.ts`、测试、schema、RPC、RLS、migration、SDK。

---

## 1. Current Behavior / 实测结果

全部结论来自本轮实际探针（探针已删除），**不是源码推断**。

### 1.1 五组指定探针

| 探针 | 输入 | 实测结果 |
|---|---|---|
| A | `A 属于 B`、`B 属于 C` | ✅ **能**推出 `A 属于 C`（`steps=1`、`path=A>B>C`、`conf=1`） |
| B | `A 属于 B`、`B 会 X` | ❌ `[]` —— **无 capability 传播** |
| C | `A 属于 B`、`B 有 X` | ❌ `[]` —— **无 capability 传播** |
| D | `A 属于 B`、`B 不会 X` | ❌ `[]` —— 无否定 capability 传播 |
| E | `A 属于 B`、`B 有 X (negated)` | ❌ `[]` —— 无否定 capability 传播 |

`[G]` 单独确认 grammar 真实支持的否定形式：

```
"鸟有翅膀"     -> {鸟, 有, 翅膀, neg=false}
"鸟没有翅膀"   -> {鸟, 有, 翅膀, neg=true}    ✅ 可教
"鸟不拥有翅膀" -> {鸟, 有, 翅膀, neg=true}    ✅ 可教
"鸟不具有翅膀" -> []                          ❌ 不可教（"具有" 未注册为别名）
"鸟不会飞"     -> {鸟, 会, 飞, neg=true}      ✅ 可教
"鸟不能飞"     -> {鸟, 会, 飞, neg=true}      ✅ 可教
```

**计划前假设被推翻 #1**：任务书示例写的是 "B 不具有/没有 X"。实测 `不具有` **不可教**（`具备` 是 `有` 的别名，但 `具有` 不是）。B.4 的否定 has 传播测试必须使用 `没有` / `不拥有`。

### 1.2 其余关键实测

| 项 | 实测 |
|---|---|
| confidence 传播 | **乘积**：`A属B(0.8)` + `B属C(0.5)` → `C conf=0.4` |
| 深度上界 | **无**：12 跳链返回全部 12 条，`depth=1..12` 全在 |
| cycle | `A→B→C→A` 不死循环，返回 `B`(depth1)、`C`(depth2)，`A` 不再返回 |
| self-loop | `A 属于 A` → 返回 `A`（**见下方 bug**） |
| 重复路径 | 菱形 `A→B→D`、`A→C→D`：**只返回先到达的那条**（`A>B>D`），另一条被 `visited` 吞掉 |
| derived 落盘 | **不落盘**：查询前后 `store.all()` 完全一致，store size 不变 |
| derived 字段 | 只有 4 个键：`conclusion` / `confidence` / `steps` / `path`。**没有** `id`/`source`/`createdAt` |
| 非能力 relation | `喜欢`/`在`/`意思是` 传播结果全部 `[]`（当前无任何传播） |
| sibling / parent 方向 | `企鹅不会飞` 不会推出 `麻雀不会飞`，也不会推出 `鸟不会飞`（当前无传播，天然满足） |
| B.8 兼容 | 同轮教学 `鸟会飞，企鹅属于鸟` 正确写入 2 条；查询 `企鹅会什么` → `目前还没有已知的相关事实。` |

### 1.3 调查中发现的两个既有缺陷（B.4 必须绕开或修正）

**缺陷 A — entity identity 不一致（重要）**

```
存: Alice Chen 属于 Furry Club ; Furry Club 属于 Community
问 "Alice Chen 属于什么"  -> ["Furry Club", "Community"]   ✅
问 "AliceChen 属于什么"   -> ["Furry Club"]                ❌ 第二跳丢失
问 "FurryClub 属于什么"   -> ["Community"]                 ✅
```

原因：首跳走 `directAnswers` → `matchByEntity`（whitespace-insensitive），但 BFS 的后续跳用 `known.match({ subject: current.node })` **精确匹配**，且 `visited` 用字面量字符串。于是 `AliceChen` 能匹配到 `Alice Chen`，却无法从 `Alice Chen` 继续走向 `Furry Club`。

**这与任务书第十二节的要求直接冲突**：B.4 若沿用同一条 BFS，就必须修正这个不一致，否则 `Alice Chen 属于 Furry Club` + `FurryClub 会 X` 无法传播。计划采用"统一走 `entityLookupKey` 解析相邻节点"（见 §12），并把它列为 B.4 的前置修正。

**缺陷 B — verify 路径的 1-hop 泄漏**

`traverseIsAForQuery` 在命中 `targetObject` 时（`isaTransitivity.ts:149-153`）返回 `records.length >= 2 ? [buildInference(records)] : []`，而实际行为是返回了 1-hop 结果（实测 `A 属于 A` 的 verify 查询返回了 `A|steps=0`）。该分支与"直接边不算推导"的既有约定不一致。**B.4 不依赖该分支**，但新增规则必须避免复制这个模式；列为附带记录项，不在本批修复。

---

## 2. Existing Data Flow

```text
query (ParsedQuery: subject, relation, kind, object?)
  -> answerGraphQuery(query, known, options, policy)          reasoners/graphReasoner.ts
       -> answerExact(query, known)
            -> directAnswers(query, known)
                 -> matchByEntity(known, pattern)             reasoners/entityLookup.ts
                      (exact first, then entityLookupKey)     ← A.6c
            -> if (query.object !== undefined && direct.length > 0) return direct
            -> knownObjects = Set(direct.objects)
            -> derivedIsAAnswers(query, known)
                 -> traverseIsAForQuery(known, {...})          rules/isaTransitivity.ts
                      BFS over 属于 edges, per-query visited
                      confidence = Π(edge.confidence)
                      path = [subject, ...objects]
                      steps = iterative ReasoningStep[]
                 -> only when query.relation === 属于
            -> [...direct, ...derived.filter(o => !knownObjects.has(o))]
       -> reasoningResult(query, answers, known)
            -> sortAnswers(answers, known)                     reasoners/answerOrdering.ts  ← B.6
            -> resolveConflicts(ordered, known)                reasoners/conflictResolver.ts ← B.5
            -> explanation = factSentences + conflictSentences
  -> planner.plan(result)   → plan.explanation
  -> personality.respond(...)
```

关键约束（实测 + 源码确认）：

- `derivedIsAAnswers` 在 `query.relation !== 属于` 时**立即返回 `[]`** —— 这就是 B.4 的插入点。
- `reasoningResult` 是唯一同时产出 `answers`、`conflicts`、`explanation` 的地方。
- 排序在裁决**之前**，裁决从 `answers` 移除被压制者。

---

## 3. Proposed Propagation Semantics

新增一条**独立的、有界的 capability 传播规则**，与 `isaTransitivity` 并列，不修改它。

```text
对查询 (S, R) 其中 R ∈ capability whitelist：

  从 S 出发，沿 属于 边向上 BFS（同一方向：member → ancestor）
  对每个到达的祖先节点 T：
      若 known 中存在 direct fact (T, R, X, negated=n) 且 n ∈ {false, true}
        -> derived conclusion (S, R, X, n)
           path = [S, ...isaChain, T, X]
           steps = [ ...isa 链步骤..., capability 步骤 ]
  受 §6 的预算约束
```

**方向严格单向**：只从 `属于` 的**子**向**父**传播能力，绝不反向（§5、§7）。

**不建立通用规则引擎**：不新增 `InferenceRule` 注册表项也可以（见 §11），只在 `graphReasoner` 内新增一个模块级函数，保持改动面最小。

---

## 4. Allowed Relation Whitelist

集中定义一处，**唯一 source of truth**：

```ts
// reasoners/capabilityPropagation.ts（新）
export const CAPABILITY_PROPAGATION_RELATIONS: readonly Relation[] = Object.freeze([
  CoreRelations.Can,        // "会"
  ADDITIONAL_RELATIONS.Has, // "有"
]);
```

实测确认的 canonical 名称来自 `relationVocabulary.ts`（`[M]` probe 与源码一致）：

| canonical | 别名 | 允许传播 |
|---|---|---|
| `属于` | 属于 / 是一种 / 算是 / 归类为 | 传播**载体**（is-a 边），本身不作为能力传播 |
| `会` | 会 / 能 / 能够 / 可以 | ✅ **白名单** |
| `有` | 有 / 拥有 / 具备 | ✅ **白名单** |
| `喜欢` | 喜欢 / 喜爱 | ❌ 禁止 |
| `在` | 在 / 位于 | ❌ 禁止 |
| `意思是` | 意思是 / 指的是 | ❌ 禁止 |
| `是` | 是 | ❌ 禁止（identity，非 inheritance） |

**为什么 `喜欢`/`在` 不能进白名单**：两者都**不是**严格普适的继承语义。反例是可构造的且符合常识——"哺乳动物喜欢水"不等于"每一只猫都喜欢水"（个体偏好）；"动物在地球"在语义上成立但属于**蕴含**而非**属性继承**，且 `在` 是空间位置，子类可以完全不在同一位置（"企鹅在南极" vs "鸟在天空"）。**只有当 relation 表示"该类的每个成员必然具备"时才可传播**，`会`（能力）与 `有`（属性/部件）满足，`喜欢`（偏好）与 `在`（位置）不满足。`意思是`/`是` 是定义与同一性，传播会产生无意义结论。

白名单**不**允许由 registry、semantic 或 persona 各自维护副本；测试用 `Object.isFrozen` + 内容断言钉住，并断言 `喜欢/在/意思是/是` 不在其中。

---

## 5. Propagation Direction

严格 **ancestor-only**：

```
      T (ancestor)  ── 会 ──> X
      ▲
      │ 属于（子→父，唯一允许的方向）
      │
      S (query subject)
  ⇒  derive (S, 会, X)
```

**禁止**：
- **child → parent**：`企鹅不会飞` 绝不推出 `鸟不会飞`（§7 测试 16）。
- **sibling → sibling**：`企鹅不会飞` 绝不推出 `麻雀不会飞`（§7 测试 17）。
- 由 capability 边反向推导任何 is-a。

当前实现天然满足，因为不存在任何 capability 传播；B.4 必须**保持**这一点并有测试钉住。

---

## 6. Bounds / Complexity Budget

**计划前假设被推翻 #2**：现有 `isaTransitivity` **没有任何深度上界**（实测 12 跳全部返回）。B.4 不得沿用"无上界 BFS"，必须自带预算。

具名常量，集中在 `capabilityPropagation.ts`：

| 常量 | 值 | 论证 |
|---|---|---|
| `MAX_PROPAGATION_DEPTH` | **4** | 覆盖"企鹅→海鸟→鸟"这类真实分类深度并留余量；与 B.8 的 `maxFactsPerTurn=4` 同量级，便于推理成本估算 |
| `MAX_DERIVED_FACTS_PER_QUERY` | **16** | = depth 上界内的可达祖先数上限（4）× 每祖先最多可取的能力事实数（4），给多能力场景留余量，同时把单查询派生量钉死在常数 |
| `MAX_VISITED_ENTITIES` | **32** | 防止宽扇形 is-a 图（一个类下大量并列父类）把 BFS 撑开；8×depth |
| `MAX_EDGES_EXAMINED` | **128** | 防止**边数**远大于节点数时（多父、重复边）成本失控；4×visited |
| cycle detection | 每查询 `visited: Set<entityLookupKey>` | 复用现有做法，但 key 改用 lookup identity（见 §7、§12） |
| duplicate suppression | 见 §7 | 按 `(conclusion key)` 去重，保留**最短路径**，同长则按确定性 tie-break |

**复杂度上界（修订 2，已更正）**：令 V = 访问实体数（≤32），E = 检查的边数（≤128），F = 产出派生事实数（≤16），d = 深度（≤4），N = store 中该用户的 fact 总数。

- **搜索空间**由上述四个预算约束，因此 `V`、`E`、`F`、`d` 都是**与 N 无关的常数上界**。
- **但总查询成本仍含 N 因子**。`KnowledgeStore.match()` 的实现是"取最小索引集合求交 + 对候选逐个精确比对"（`knowledge/store.ts`），候选集合的大小随该 subject/relation 下的记录数增长；`match({ subject: T, relation: R })` 在 `T` 无 `relation` 索引覆盖时可能退化，最坏情形下成本随 N 线性增长。
- 因此正确的表述是：**每查询 `O(E × C)`，其中 `C` 是单次 `match` 的成本（最坏 `O(N)`）**；即 `O(E × N)` 最坏，而 `E ≤ 128` 只是常数因子。**不得宣称整体复杂度与 store 大小无关。**
- 空间仍是 `O(V + F)`，与 N 无关。
- **本批不因此进入 B.2 / 索引 / 缓存重构**（明确非目标）。该 N 依赖是**既有**性质：当前 `isaTransitivity` 的每一次 BFS 展开已调用 `match`，B.4 只是把展开次数钉在常数预算内，并没有引入新的 N 依赖类型。

**确定性停止**：任一预算耗尽即**立即停止扩展**（不再入队新节点），已产出的结果照常返回。停止条件是纯计数器判断，不依赖时间、随机或 Map 迭代顺序。加测试：预算耗尽时结果**稳定且可重复**，且不抛异常。

**明确禁止**：无界 BFS/DFS、递归到 fixed point 无硬上限、materialized closure、`isaTransitivityRule.apply()` 那类"对全库求闭包"的做法。

---

## 7. Cycle & Dedup Strategy

**Cycle**：从 S 出发的 BFS 维护 `visited: Set<string>`（值为 `entityLookupKey`）。入队前检查，命中即跳过。实测现有 `A→B→C→A` 已不死循环，B.4 沿用同一策略并加预算。

**Dedup**：
1. **同一祖先的同一 capability 事实**只产出一条。
2. **多条 is-a 路径到达同一祖先**（菱形）：按 `path.length` **升序**取最短；长度相同则按 **path 字符串升序**（`localeCompare("und")`）确定唯一一条。
   - 实测现状是"先到达者胜"（插入序依赖），B.4 **不沿用**这种做法，因为它使结果依赖 store 顺序，违反 §10 的 shuffle-invariant 要求。
3. **与 direct 事实重复**：`answerExact` 已有的 `knownObjects` 过滤负责去掉"直接已知"的 capability 结论；B.4 另在规则内部按 `(S, R, X, n)` 去重，避免 isa 与 capability 两条路径产出同一 triple。

**isa 与 capability 的重复生成**：`isaTransitivity` 只产出 `relation === 属于` 的结论，capability 只产出 `relation ∈ whitelist` 的结论，**两者值域不相交**，结构上不可能重复。测试加一条交叉断言。

---

## 8. Negation Semantics

**对称**：`negated` 不改变传播权，只随结论一起传递。

```
鸟 会 飞        + 企鹅 属于 鸟  →  derived (企鹅, 会, 飞, neg=false)
鸟 不会 飞      + 企鹅 属于 鸟  →  derived (企鹅, 会, 飞, neg=true)
鸟 有 翅膀      + 企鹅 属于 鸟  →  derived (企鹅, 有, 翅膀, neg=false)
鸟 没有 翅膀    + 企鹅 属于 鸟  →  derived (企鹅, 有, 翅膀, neg=true)
```

实现要点：ability 规则读取祖先的**两种极性**（`negated` 不作为查询条件），只在 `known.match({ subject: T, relation: R })` 时不加 `negated` 过滤，然后**原样**把 `negated` 放进结论与 step。

**direct 与 inherited 冲突**：完全交给现有 B.5，**不新增第二套规则**（§11）。

```
鸟 会 飞 + 企鹅 属于 鸟 + 企鹅 不会 飞
  → direct (企鹅, 会, 飞, neg=true)  vs  derived (企鹅, 会, 飞, neg=false)
  → B.5: direct > derived ⇒ direct 胜，strategy = "direct-over-derived"
```

反方向同样：

```
鸟 不会 飞 + 企鹅 属于 鸟 + 企鹅 会 飞
  → direct positive 胜，strategy 仍是 "direct-over-derived"
```

**实测确认当前 B.5 尚未走到这一步**：`[P-CONF]` 显示 direct negative 单独返回、`conflicts: []` —— 因为 derived positive 根本不存在。B.4 落地后该 pair 才会真正出现，故 §13 的测试 9/10 是 B.4 的**新增覆盖**而非回归。

---

## 9. Confidence / Source / createdAt / ID Semantics

### 9.1 Confidence —— 复用现有数学，不另造

实测现有 `isaTransitivity` 用 **乘积**。B.4 **复用同一函数语义**：

```
derivedConfidence = Π(isa 链上每条边的 confidence) × (祖先 capability 事实的 confidence)
```

即整条支撑链的所有事实置信度之积 —— 与既有 `buildInference` 的 `records.reduce(product)` 完全同构，只是链尾多一条 capability 事实。

任务书指定示例：

```
企鹅 属于 鸟 (0.7) ; 鸟 会 飞 (0.9)  →  derived conf = 0.7 × 0.9 = 0.63
```

（实测对照：`A属B(0.8) × B属C(0.5) = 0.4`，与乘积语义一致。）

**保守性**：乘积**永不高于**链上任一因子，因此不会"凭空提升到 1"。加测试断言 `derivedConfidence <= min(所有支撑事实 confidence)`。

**与 B.5 的衔接**：B.5 的第 2 级用 `confidence DESC`。因为 direct 优先于 derived 是第 1 级，confidence 只在**同 directness** 之间比较，所以低置信度 derived 不会压制 direct。B.4 不需要也不允许改动该顺序。

### 9.2 Source / createdAt / ID

derived fact **没有** record，因此**实测**其 `Inference` 只有 `conclusion`/`confidence`/`steps`/`path` 四个键（无 `id`/`source`/`createdAt`）。

B.4 **保持这一现状**，并明确规则：

| 字段 | 规则 | 理由 |
|---|---|---|
| `id` | **不存在**（不合成、不随机） | 任务书明确禁止随机 UUID；derived fact 不是记录，给它一个 id 会暗示它可被引用/持久化 |
| `source` | **不存在** | derived 不是 `KnowledgeSource`；B.5 已对 `record === null` 给 `-1` 权威分 |
| `createdAt` | **不存在** | 无原始写入时间；合成时间戳会破坏可重复性 |
| `path` | 确定性字符串数组 | 见 §10 |
| `steps[].ruleId` | 常量 `"capability-propagation"` | 稳定、可审计 |

**B.5 的 winner ordering 因此天然确定**：同 directness 时 derived 之间比 confidence；若 confidence 也相同，`createdAt` 两侧都是 `""`、`id` 两侧都是 `""`，比较返回 0 —— 此时由 §7 的内部去重保证不会出现两条相同 triple，故不会产生不确定顺序。

**确定性测试**（§13 测试 20）：同一 store、同一 query，连续 N 次执行，`answers`/`conflicts`/`explanation` **逐字节一致**。

---

## 10. Provenance / Explanation

derived capability fact 必须能解释来源链。**复用现有 `ReasoningStep` 与 `path` 类型，不新增类型、不改 SDK API。**

```
企鹅 属于 海鸟 ; 海鸟 属于 鸟 ; 鸟 会 飞
→ derived: 企鹅 会 飞
   path  = ["企鹅", "海鸟", "鸟", "飞"]
   steps = [
     { ruleId: "isa-transitivity",
       description: "企鹅 属于 海鸟，海鸟 属于 鸟 ⇒ 企鹅 属于 鸟",
       premises: [企鹅属于海鸟, 海鸟属于鸟],
       conclusion: 企鹅属于鸟 },
     { ruleId: "capability-propagation",
       description: "企鹅 属于 鸟，鸟 会 飞 ⇒ 企鹅 会 飞",
       premises: [企鹅属于鸟, 鸟会飞],
       conclusion: 企鹅会飞 },
   ]
   conclusion = { subject: 企鹅, relation: 会, object: 飞, negated: false }
```

要点：

- `path` 编码：`[querySubject, ...is-a 链上的每个祖先, capabilityObject]`。单层时 `["企鹅", "鸟", "飞"]`，与现有 isa 的 `["猫","动物","生物"]` 形状一致。
- `steps` 复用 isa 的迭代 `ReasoningStep[]` 构造（`buildSteps` 已产出 is-a 链步骤），再**追加**一条 capability 步骤。
- **绝不返回无来源的 synthesized triple**：`steps.length` 必 > 0，且最后一步的 `premises` 必含被使用的那条祖先 capability 事实。
- `describeAnswer`（`graphReasoner.ts`）已对带 steps 的答案输出"（推理路径：…）"，因此 `/为什么` 查询天然可获得完整链；planner 的 `plan.explanation` 自动继承。

---

## 11. ConflictResolver Integration

**禁止在 capability propagation 内实现任何 conflict resolution**，也不新增第二套优先级。

实际插入位置（基于真实代码结构，非按示意图重构）：

```
answerExact(query, known)
  ├─ direct = directAnswers(...)                       [不变]
  ├─ if (query.object !== undefined && direct.length > 0) return ...   [不变]
  ├─ derivedIsA = derivedIsAAnswers(query, known)      [不变，仅 属于]
  ├─ derivedCapability = derivedCapabilityAnswers(query, known)        [新增]
  │     └─ 仅当 query.relation ∈ CAPABILITY_PROPAGATION_RELATIONS
  ├─ 合并去重：按 (subject, relation, object, negated) 折叠
  └─ reasoningResult(query, [...direct, ...derivedIsA, ...derivedCapability], known)
        ├─ sortAnswers(...)        B.6
        ├─ resolveConflicts(...)    B.5
        └─ explanation
```

顺序说明（逐条回答任务书第十一节）：

| 问题 | 答案 |
|---|---|
| propagation 在 GraphReasoner 哪个阶段 | `answerExact` 内，`directAnswers` 之后、`reasoningResult` 之前 |
| 与 isaTransitivity 的先后 | **并列**。isa 负责 `属于` 结论，capability 负责白名单 relation 结论，值域不相交，无先后依赖 |
| 与 B.6 sorting 的先后 | propagation **先**（产出候选），sorting **后**（排序全部候选）。不修改 sorting |
| 与 B.5 resolver 的先后 | propagation **先**，resolver **后**。resolver 是唯一裁决者 |
| 如何避免 isa 与 capability 重复生成同一 derived fact | 值域不相交（§7）+ 合并时按四元组去重（双向保险） |

**不改动**：`sortAnswers`、`resolveConflicts`、`sourceAuthority.ts`、B.5 的 winner precedence、B.6 的 tuple、A.7 的 teaching outcome。

---

## 12. Entity Identity

任务书要求：若系统把 `Furry Club` 与 `FurryClub` 视为同一 entity，propagation 也必须一致；且只允许复用现有 whitespace identity。

**实测结论（§1.3 缺陷 A）**：当前**不一致**。

- direct 首跳：`matchByEntity` → whitespace-insensitive ✅
- BFS 后续跳与 `visited`：**精确字符串** ❌

因此 B.4 必须**先把 is-a 遍历的相邻节点解析统一到 `entityLookupKey`**，否则：

```
Alice Chen 属于 Furry Club ; FurryClub 会 X
```
在 `FurryClub` 这一跳就会断链。

**拟议修正（最小、复用现有 identity）**：

- `traverseIsAForQuery` 与新的 capability 遍历，扩展节点时改用 `matchByEntity(known, { subject: node, relation: 属于, negated: false })`（即 A.6c 的精确优先 + lookup-key 回退），而不是裸 `match`。
- `visited` 的 key 改用 `entityLookupKey(node)`。
- **禁止**新增 case folding、全半角 merge、繁简 merge、拼音、fuzzy matching、embedding/entity resolution。仍然只用 `entityLookupKey`（仅删 Unicode 空白）。

**风险**：该修正同时影响**既有 is-a 传递**（不只是 B.4）。这是行为变更，需在 §14 明确标注，并加回归测试确认现有 `属于` 行为不被破坏。

**由谁承担**：这是 B.4 的**前置修正**，因为 B.4 的正确性依赖它。若要严格缩小 B.4 改动面，可将其拆为 B.4a（identity 对齐，独立可验证）与 B.4b（capability 规则），但**必须在同一批合并**，否则 B.4b 单独上线会在空白实体场景下静默失效。

---

## 13. Files To Modify

| 文件 | 变更 | 备注 |
|---|---|---|
| `reasoners/capabilityPropagation.ts`（**新**） | 白名单、预算常量、`derivedCapabilityAnswers(query, known)` | 不加入 `reasoners/index.ts` 的 `export *`？→ **必须确认**：`reasoners` 是否被 barrel 导出至 SDK。实测 `sdk.ts` 不导出 `reasoners`，但需在实现时用契约测试确认 70 exports 不变 |
| `reasoners/graphReasoner.ts` | `answerExact` 增加 derivedCapability 与合并去重 | 唯一调用点 |
| `rules/isaTransitivity.ts` | 相邻节点解析改用 `matchByEntity` + `entityLookupKey` visited | §12 前置修正 |
| `reasoners/entityLookup.ts` | 可能需导出一个"按 entity 解析单个 subject"的小助手 | 优先复用现有 `matchByEntity`，尽量不改 |
| 测试（新增） | `reasoners/capabilityPropagation.test.ts`、`engine/capabilityPropagation.test.ts` | 见 §14 |
| 测试（回归） | `rules/isaTransitivity.test.ts` 扩充 entity identity 用例 | §12 修正的回归 |

**不改**：`types/`（不新增类型）、`personality/*`（措辞无需变化）、`planner/*`、`knowledge/store.ts`、任何 schema/RPC/RLS/migration。

---

## 14. Test Matrix

任务书 24 项逐一对应（补充项标注 ➕）：

| # | 用例 | 期望 |
|---|---|---|
| 1 | 单层 positive can：`鸟会飞` + `企鹅属于鸟` | derived `企鹅 会 飞 (neg=false)`；path/steps 完整 |
| 2 | 单层 negative can：`鸟不会飞` + `企鹅属于鸟` | derived `企鹅 会 飞 (neg=true)` |
| 3 | 单层 positive has：`鸟有翅膀` + `企鹅属于鸟` | derived `企鹅 有 翅膀` |
| 4 | 单层 negative has：`鸟没有翅膀`（**不是** `不具有`，见 §1.1）+ 属于 | derived `neg=true` |
| 5 | 两层 is-a + capability：`企鹅属于海鸟`+`海鸟属于鸟`+`鸟会飞` | derived，path `企鹅>海鸟>鸟>飞`，2 个 steps |
| 6 | 超过 max depth：链长 > 4 | 只推导到深度 4 内的祖先，更远的**不**产出；且不死循环 |
| 7 | is-a cycle：`A→B→C→A` | 终止；不重复产出 A |
| 8 | duplicate paths：菱形 | 只产出一条，取**最短路径**；同长按 path 字符串定序 |
| 9 | direct positive vs derived negative | direct 胜，strategy `direct-over-derived` |
| 10 | direct negative vs derived positive | direct 胜，strategy `direct-over-derived` |
| 11 | derived vs derived 不同 confidence | 高 confidence 在前（B.6 排序），无冲突（同极性） |
| 12 | 同 relation 不同 object | **不冲突**，两条都在 answers |
| 13 | `喜欢` 不传播 | `[]` |
| 14 | `在` 不传播 | `[]` |
| 15 | `意思是` / 普通 `是` 不传播 | `[]` |
| 16 | child → parent 不传播 | `企鹅不会飞` 不产出 `鸟不会飞` |
| 17 | sibling 不传播 | `企鹅不会飞` 不产出 `麻雀不会飞` |
| 18 | whitespace identity：`Alice Chen 属于 Furry Club` + `FurryClub 会 X` | 能传播（依赖 §12 修正） |
| 19 | store mutation invariant | 查询前后 `store.all()` 深度相等 |
| 20 | deterministic repeated query | 连续 N 次，answers/conflicts/explanation 逐字节一致 |
| 21 | shuffled input invariant | 打乱 restore 顺序后结果一致（复用 B.6 shuffle 手法） |
| 22 | budget exhaustion | 构造超预算图，确定性停止、可重复、不抛异常 |
| 23 | 与 B.8 同轮教学兼容 | `鸟会飞，企鹅属于鸟` 后查询得到 derived |
| 24 | B.7 negation + B.5 explanation 联合 | conflicts 含正确 strategy，explanation 说明来源与被压制事实 |
| ➕ 25 | 白名单唯一性 | `CAPABILITY_PROPAGATION_RELATIONS` 冻结、内容精确、不含 `喜欢/在/意思是/是` |
| ➕ 26 | confidence 保守性 | `derived <= min(支撑事实 confidence)`；`0.7×0.9=0.63` 精确断言 |
| ➕ 27 | isa/capability 值域不相交 | capability 规则绝不产出 `relation === 属于` |
| ➕ 28 | 「计划前假设被推翻」回归 | `不具有` 不可教（记录既有 grammar 事实，防未来误改） |
| ➕ 29 | 既有 is-a 回归 | §12 修正后 `猫属于动物`+`动物属于生物` 仍正确；`A属于A` self-loop 行为与修正前一致 |

---

## 15. Compatibility Risks

| 风险 | 说明 | 缓解 |
|---|---|---|
| **§12 修正影响既有 is-a** | 把 BFS 相邻解析改为 whitespace-insensitive，会改变**空白实体**上的既有 `属于` 传递结果（多返回一跳） | 视为**修正**而非回归；加显式测试；中文无空白实体不受影响 |
| 答案数量增加 | 引入派生能力后，`猫会什么` 可能从 1 条变多条 | 这是 B.4 的目的；B.6 保证顺序确定 |
| hedge 阈值 | derived confidence 是乘积，链长时会低于 `UNCERTAINTY_THRESHOLD (0.75)`，触发 hedge 措辞 | 既有行为（isa 已如此）；B.4 不改 planner |
| 性能 | 每查询新增一次有界 BFS | 预算（V/E/F/d）为与 N 无关的常数上界，但每次 `match` 的成本最坏仍为 `O(N)`，故总成本 `O(E×N)`；不扫全库，也不在本批做索引/缓存重构 |
| `reasoners/index.ts` 导出 | 新增模块若被 barrel 导出可能改变 70 exports | 实现时先跑 `sdk.api-surface.contract.test.ts`；若泄漏则改用不导出路径（同 `multiFact.ts` 的处理方式） |
| 与 `materialize()` 一致性 | `graphReasoner.materialize` 目前只含 isa；B.4 是否要加入 capability | **计划：不加入**。`materialize` 是可视化/调试用途（实测生产不调用），加入会扩大改动面。列为 §16 非目标 |

---

## 16. Explicit Non-goals

- ❌ B.1 delta writes、B.2 DO caching/persistent engine、B.8 继续扩展。
- ❌ DB schema / RPC / RLS / migration / deferred 任何改动。
- ❌ materialized closure；不修改 `materialize()`。
- ❌ fuzzy entity merge（case / 全半角 / 繁简 / 拼音 / embedding）。
- ❌ LLM / vector / embedding。
- ❌ 修改 SDK 公共 API（70 exports）、source authority 规则、B.5 winner precedence、A.7 teaching outcome 语义。
- ❌ 通用规则引擎、多本体继承、开放任意 relation 传播。
- ❌ 把 derived capability 落盘或写回 `KnowledgeStore`。
- ❌ 修复 §1.3 缺陷 B（verify 1-hop 泄漏）—— 记录但不在本批。
- ❌ 为 `喜欢`/`在` 设计"部分继承"语义。

---

## 17. Implementation Order

1. **白名单 + 预算常量 + 遍历核心**（`capabilityPropagation.ts`），纯函数、纯单元测试，先不接线。覆盖 §14 的 1–8、13–17、22、25–27。
2. **§12 entity identity 前置修正**（`isaTransitivity.ts` 相邻解析 + visited key），跑既有 is-a 回归（29）。
3. **接线 `graphReasoner.answerExact`**（合并 + 去重），跑 5、18、23。
4. **与 B.5/B.6 集成验证**（9–12、20、21、24）。
5. **SDK 契约 + 根 `typecheck`/`test`/`build`**，确认 70 exports。
6. 全矩阵通过后停止。

---

## 18. Stop Conditions

出现下列任一情况即**停止并上报 blocker**，不得擅自扩大 scope：

1. **SDK 面**：新增模块导致 `sdk.api-surface.contract.test.ts` 失败，且无法通过"放到不导出路径"解决（需改 SDK 公共 API 才能实现 B.4）。
2. **§12 前置修正不可行**：若统一 entity identity 必须改动 `KnowledgeStore.match` 语义或持久化，则超出本批授权。
3. **B.5 集成需要新规则**：若 direct/derived 冲突无法由现有 `direct-over-derived` 正确裁决，需要第二套冲突规则 → 停。
4. **必须落盘 derived**：若实测发现"每次查询重新推导"在本架构下不可行（例如宿主依赖持久化的 derived facts）→ 停并报告，不得通过改 persistence/schema 绕过。
5. **预算无法收敛**：若确定性停止需要依赖时间/随机/迭代顺序才能实现 → 停。
6. **需要修改**：source authority、B.5 winner precedence、A.7 outcome、B.6 tuple、白名单之外的 relation → 停。

---

## 附：计划前假设 vs 实测对照

| 计划前假设 | 实测结果 | 影响 |
|---|---|---|
| `B 不具有 X` 是可用否定形式 | ❌ **不可教**（`具有` 未注册别名）；`没有`/`不拥有` 可用 | §14 测试 4 改用 `没有` |
| 现有 BFS 有深度上界 | ❌ **实测无上界**（12 跳全返回） | B.4 必须自带预算（§6） |
| 现有 entity identity 在传播中一致 | ❌ **不一致**：首跳 lookup-key、后续跳精确匹配 | 新增 §12 前置修正，否则 B.4 在空白实体上静默失效 |
| `会`/`有` 可能已有部分传播 | ❌ 完全不存在，全部 `[]` | B.4 是从零新增，无历史包袱 |
| derived 可能有 id/source | ❌ `Inference` 只有 4 个键，无 record | §9.2 明确规则；B.5 的 `record === null` 分支已就绪 |
| `属于` 传递已正确处理菱形 | ⚠️ 只取先到达路径（依赖插入序） | B.4 改为"最短路径 + 确定性 tie-break"（§7） |
