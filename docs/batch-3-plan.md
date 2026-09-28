# 第三批（A.3 + A.6 + A.7 + B.6）实施计划

> 状态：**待审批，未改任何代码。** 本文件只描述拟议变更。
> 前置：第一批（A1/A2/A4/A5）已实现；A.1 迁移已 apply 并验证。
> 约束：不改 SDK 公开 API（70 exports 不变）；不改 DB schema / RPC / RLS / migration / deferred；不实现 B1/B2/B4/B5/B7/B8。

## 0. 现状实测（决定方案的关键证据）

在本机用临时探针实测当前行为（探针已删除）：

**关系别名（A.3）——写路径完全不知道语义层的别名表：**

| 输入 | 当前结果 | 问题 |
|---|---|---|
| `猫会飞` | `{猫, 会, 飞}` | ✅ 正确 |
| `猫能飞` / `猫能够飞` / `猫可以飞` | **unknown，无法教学** | ❌ 别名不可教 |
| `猫喜欢鱼` | `{猫, 喜欢, 鱼}` | ✅ |
| `猫喜爱鱼` | **unknown** | ❌ |
| `猫在屋顶` | `{猫, 在, 屋顶}` | ✅ |
| `猫位于屋顶` | **unknown** | ❌ |
| `猫有爪子` | `{猫, 有, 爪子}` | ✅ |
| `猫拥有爪子` | **`{猫拥, 有, 爪子}`** | ❌ **主语被污染** |
| `猫是一种哺乳动物` | `{猫, 属于, 哺乳动物}` | ✅（A2 已修） |
| `猫算是哺乳动物` | **`{猫算, 是, 哺乳动物}`** | ❌ **主语被污染** |
| `猫归类为哺乳动物` | **unknown** | ❌ |
| `猫指的是家猫` | `{猫, 意思是, 家猫}` | ✅ |
| `猫的指代是家猫` | `{猫的指代, 是, 家猫}` | ⚠️ 关系词污染（本次范围外，记录） |

根因：`parser/registry.ts` 只注册**规范关系词**（`属于/是/会/喜欢/在` + `意思是/指的是` + `有`）的 statement pattern。语义层 `semantic/lexicon.ts` 另有别名表（`能/能够/可以`→can、`喜爱`→likes、`位于`→located-in、`拥有/具备`→has），但写路径不读它。`拥有`、`算是` 里含有已注册关系词 `有`、`是` 作为子串，于是正则从子串处切开，把 `猫拥`、`猫算` 当成主语写进知识库——**这是静默的数据损坏，不是解析失败**。

**实体空白不对称（A.6）：**

```
教 "Alice Chen 属于 Furry Club"  -> 存 [Alice Chen]|属于|[Furry Club]
问 "Alice Chen属于什么"          -> "目前还没有已知的相关事实。"   ❌
问 "Alice Chen 属于什么"         -> "目前还没有已知的相关事实。"   ❌
教 "猫 属于 哺乳动物"            -> 存 [猫]|属于|[哺乳动物]
问 "猫属于什么" / "猫 属于 什么" -> "猫 属于 哺乳动物"             ✅
```

根因：两条路径的规范化规则不同。`parser/normalize.ts` 的 `normalizeInput` **删除全部空白**，query pattern 读的是它（得到 `AliceChen`）；而 statement pattern 读 `rawInput` 并用 `normalizeCapturedValue` 只**折叠**连续空白（得到 `Alice Chen`）。`store.match()` 是精确字符串比较，两者永不相等。中文因为本来无空格所以掩盖了这个 bug。

**答案顺序（B.6）：**

```
先教 哺乳动物，再教 宠物 -> "猫 属于 哺乳动物；猫 属于 宠物"
先教 宠物，再教 哺乳动物 -> "猫 属于 宠物；猫 属于 哺乳动物"
```

同两条事实，答案顺序随教学（= 入库）顺序翻转。`graphReasoner` 用 `[...direct, ...derived]` 拼接，而 `directAnswers` 的次序来自 `store.match()` 的返回序，最终来自 `loadSnapshot` 的 `order=created_at.asc,id.asc` 与 `addMany` 的插入序；`derivedIsAAnswers` 的次序来自 BFS 邻接表序（同样受插入序影响）。即 `ReasoningResult.answers` 注释里承诺的 "best first" 目前并不成立。

**重复教学（A.7）：**

```
plain: "已记录：猫 属于 哺乳动物"   ← 第一次
plain: "已记录：猫 属于 哺乳动物"   ← 重复同一条，措辞完全相同
frost: "…已经记在你的知识库里：\n\n鸟 会 飞\n\n下次聊到相关内容时…"  ← 重复也照说"记下了"
记忆: "已记住：name = 小明" → "已记住：name = 小红"  ← 覆盖旧值但只说"已记住"
```

`InMemoryKnowledgeStore.add()` 对已存在三元组返回既有记录（`store.ts:145-167`），引擎无法区分"新增"与"已存在"，人格层因此一律宣称"已记下"。

---

## 1. A.3 — 显式、可审计、确定性的关系别名与实体规范化

### 1.1 设计原则

- **单一别名表，数据驱动**：别名只存在于一张显式表里，可被测试逐条遍历，禁止相似度/编辑距离合并。
- **最长匹配优先**：`拥有` 必须先于 `有`、`算是` 必须先于 `是` 被识别，否则就会重现子串切分。别名表按长度降序参与构造，顺序是数据的一部分而不是巧合。
- **只做确定性映射**：`能→会`、`喜爱→喜欢`、`位于→在`、`拥有/具备→有`、`归类为/算是→属于`。同义词判断由维护者写进表里，代码不猜。

### 1.2 拟新增/修改

| 文件 | 变更 |
|---|---|
| `packages/core/src/parser/relationAliases.ts`（新） | 唯一别名表：`{ canonical, aliases[] }`，对外暴露规范化构造产物（已排序、已 escape 的别名列表） |
| `packages/core/src/parser/registry.ts` | statement/object-of/verify/why/locate 五种 pattern 改为由别名表驱动，确保读写关系词集合一致 |
| `packages/core/src/parser/patterns/*.ts` | 各 pattern 工厂接受「规范关系 + 别名列表」，并在匹配成功时一律输出 `canonical` |
| `packages/core/src/parser/teachingCanonical.ts` | `canonicalStatementTriple` 增加关系别名归一（复用同一张表），使门控与存储继续共用同一个纯函数 |

### 1.3 数据流变化

```text
用户输入 "猫拥有爪子"
  -> normalizeInput（删空白）
  -> statement pattern（别名表驱动，最长优先）
       拥有 先于 有 命中 -> { subject: 猫, relation: 有(canonical), object: 爪子 }
  -> canonicalStatementTriple（同一张表再归一一次，幂等）
  -> 存储 { 猫, 有, 爪子 }
```

关键点：**同一张别名表同时驱动 pattern 与 canonical 化**，因此第 0 节那类别名不再可能一边被识别、一边被写坏。

### 1.4 兼容性风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 存量关系词不一致 | 库里可能已存有 `猫拥`/`猫算` 这类被污染的记录 | 本次**不做数据迁移**（禁改 DB）。只保证新写入正确；存量脏数据另行评估 |
| `是` 与 `属于` 的语义边界 | `苏格拉底是人` 必须仍是 `是`（instance-of），不能因 `算是→属于` 而连带提升 | 别名表逐条显式；`是` 只在 A2 已确立的 `一种` 包装或语义 is-a 线索下提升，本批不改这条规则 |
| 别名表被误当 fuzzy 入口 | 后续可能有人往里塞相似度 | 表结构只允许 `canonical → aliases[]` 静态映射；新增属性测试断言"未登记别名一律 unknown" |

---

## 2. A.6 — 读路径 normalization 前移与统一

本项拆成三个子项，**风险差异很大，建议分别提交**。

### 2.1 A.6a 词条别名预计算（低风险，纯收益）

**现状**：`semantic/extract.ts:164-167` 在**每一轮**对**每个词条**执行 `[...entry.aliases].sort(...)`，然后在 `for` 里对每个别名做 `trim().replace(/\s+/gu," ").toLocaleLowerCase("und")`。18 个词条 × 约 7 个别名 × 每次调用。

**变更**：在 `semantic/lexicon.ts` 模块加载期一次性产出 `normalizedAliases`（已排序、已归一、已冻结），`findLexiconOccurrences` 直接消费。

**数据流**：无变化——只是把同一份计算结果从"每轮算"变成"加载时算一次"。**规范化语义完全不变**，因为归一步骤逐字符等价。

### 2.2 A.6b 合并重复的规范化实现（低风险）

四处私有实现完全相同（`trim` + 折叠空白 + `toLocaleLowerCase("und")`）：

- `semantic/candidates.ts:237`
- `semantic/engineAdapter.ts:100`
- `semantic/legacySideEffectGate.ts:92`
- `semantic/producers/contextProducer.ts:39`

**变更**：提取为单一内部实现（放 `semantic/normalize.ts` 或新的 `utils/textNormalize.ts`），四处改为调用。

**注意**：这些都在 `semantic/` 下，且 `semantic/index.ts` 是**具名导出**（不进 `sdk.ts`），因此不触碰 70 exports。需在计划评审时确认新函数**不被**加入 `semantic/index.ts` 的导出列表。

### 2.3 A.6c 实体查找统一（**高风险，本批最需要评审的一项**）

**现状**：读侧删空白、写侧折叠空白（第 0 节实测）。

**拟议变更**：新增一个**查找专用规范形**，读写两侧只在"用于比较"时使用它：

```text
entityLookupKey(raw) = raw.trim().replace(/\s+/gu, "").toLocaleLowerCase("und")
```

- **存储保持原样**（`Alice Chen` 仍原样存、原样展示），因此不破坏 `parser/patterns/statement.test.ts:52`「preserves meaningful spaces in raw statement entities」所保护的展示语义。
- **匹配改为按查找键比较**：在 `reasoners/` 内新增一个受限的实体匹配层，先走现有 `store.match({ subject, relation })` 缩小候选集（O(小索引) 不变），再对候选按 `entityLookupKey` 比较。不引入全表扫描，不做模糊匹配。
- 同时把 query 侧与 write 侧的 `normalizeCapturedValue` 收敛到同一函数，消除"折叠 vs 删除"的分歧。

**为什么不改 `parser/normalize.ts`**：`normalizeInput` 删除全部空白是**语法识别的前提**（pattern 假定无空白），改成折叠空白会波及全部 5 类 pattern，风险远大于收益。

**为什么不直接在存储时删空白**：会破坏上面那条已存在的展示契约（`Alice Chen` 会变成 `AliceChen`），且改变已入库数据的可读性。

**风险**：空白不敏感的匹配会把 `AliceChen` 与 `Alice Chen` 视为同一实体。对中文与单 token 实体无影响；对刻意用空格区分两个实体的用户是行为变化。**若维护者认为不可接受，A.6c 可整体推迟**，A.6a/6b 仍独立成立（A.6a/6b 不修复第 0 节的 bug，只消除重复计算与实现分叉）。

### 2.4 "canonicalization 在写入时、读取时还是两者？"——明确回答

| 层 | 何时做 | 做什么 | 是否落盘 |
|---|---|---|---|
| **关系规范形** | **写入时** | 别名→规范关系（`拥有→有`） | ✅ 落盘，只存规范形 |
| **实体规范形** | **写入时** | 折叠空白、去尾标点（现有 `normalizeCapturedValue`） | ✅ 落盘 |
| **教学前缀剥离** | **两处，但同一函数** | 引擎入口剥一次 + pattern 内再剥一次 | 只影响解析，不落盘 |
| **查找键** | **读取时（且只在比较时）** | `entityLookupKey`（删空白 + 大小写折叠） | ❌ **绝不落盘** |

### 2.5 如何避免 double-normalization

1. **所有规范形函数必须幂等**，并写属性测试钉住：对任意输入 `f(f(x)) === f(x)`。现有 `normalizeCapturedValue`、`canonicalStatementTriple`、`stripTeachingCuePrefix`、拟新增的 `entityLookupKey` 全部纳入。
2. **落盘与比较用两套名字**，从命名上禁止混用：`normalize*` = 落盘形；`*LookupKey` = 仅比较用，带注释"永不落盘"。
3. **只在边界规范化一次**：写入路径上，alias→canonical 只在 `statement pattern`/`canonicalStatementTriple` 这一处发生；读取路径上，查找键只在**比较点**即时计算，不缓存进任何持久结构。
4. **门控与存储继续共用同一个纯函数**（A2 已建立的约束），防止再次出现"判定用一种形、存储用另一种形"。
5. 加一条回归测试：`normalize(x)` 的结果再喂给 `normalize` 不改变任何已存记录。

---

## 3. A.7 — 如实表达"已存在/已更新"

### 3.1 现状

`store.add()` 返回既有记录，引擎在 `sunlandEngine.ts:770-775` 无法区分新增与重复；`learned` 只有 `{ record }` 一个字段，因此人格层一律说"已记下"。

### 3.2 设计（不新增 store 方法）

利用**已冻结接口里就有的** `KnowledgeStore.has()`，零接口变更：

```text
写入前：
  existedExact = store.has(triple)                       // O(1)
如果 existedExact：
  outcome = "already-known"        （完全相同的三元组）
否则：
  priorSameSubjectRelation = store.match({ subject, relation })  // O(小索引)
  outcome = priorSameSubjectRelation.length > 0 ? "corrected" : "added"
  store.add(triple, { source: "user" })
  correctedFrom = outcome === "corrected" ? priorSameSubjectRelation : []
```

三种结果的语义：

| outcome | 触发 | 示例 |
|---|---|---|
| `added` | 全新事实 | `鸟会飞`（首次） |
| `already-known` | 三元组完全相同（含 A.3 别名归一后相同） | 再教 `猫是一种哺乳动物`，已存 `{猫,属于,哺乳动物}` |
| `corrected` | 同主语+同关系、不同宾语 | 先 `猫属于哺乳动物`，后 `猫属于爬行动物` |

判定完全确定性，不依赖时间、不依赖顺序。

### 3.3 拟修改文件

| 文件 | 变更 |
|---|---|
| `packages/core/src/types/personality.ts` | `learned` 变体增加 `outcome` 与可选 `replaced: readonly KnowledgeRecord[]` |
| `packages/core/src/engine/sunlandEngine.ts` | `respondToParseResult` 的 statement 分支计算 outcome；仅 `added`/`corrected` 才 `persist()`；原样扩展 `respond({kind:"learned", ...})`（`correctedFrom` 用条件展开，兼容 `exactOptionalPropertyTypes`） |
| `packages/core/src/personality/frost.ts` + `frostPhrases.ts` | `renderLearned` 按 outcome 选措辞；`already-known` 不再宣称"新增" |
| `packages/core/src/personality/plain.ts` | 同上（`已记录` / `已知，未重复记录` / `已更新`） |

### 3.4 兼容性与风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| **既有测试断言** | `sunlandEngine.test.ts:133` 断言 `"已记录：猫 属于 哺乳动物"`；`plain.test.ts:23`、`frost.test.ts:124-135`、`boundary.test.ts:69-70` 直接构造 `{kind:"learned", record}` | 这些断言的是**首次教学**路径，措辞保持不变即可让它们全绿；`{kind:"learned", record}` 不带 outcome 时按 `added` 处理（向后兼容） |
| 措辞表膨胀 | Frost 新增 2 组 openers/closers | 复用现有 `pickBySeed`，seed 加入 outcome 以免同一事实不同 outcome 得到相同句式 |
| 记忆覆盖未区分 | `remember` 覆盖旧值同样只输出"已记住" | **本批只做知识**；记忆侧要区分"新记住/已更新"需改 `MemoryManager.remember` 返回值（公共类型），建议单列一项，不在本批 |
| 不改变事实内容 | 人格层只改措辞 | 断言 `already-known` 时不产生第二条记录、不修改既有 `confidence`/`source` |

---

## 4. B.6 — 确定性答案排序

### 4.1 排序位置

**在 `reasoners/graphReasoner.ts` 内排序**，不放进 planner。理由：
- `types/reasoning.ts:48` 已声明 `answers` 是 "best first"，排序属于 reasoner 的契约职责；
- planner 保持"按给定顺序渲染"的纯渲染器，`planner/responsePlanner.test.ts:94`（`猫 属于 动物；猫 属于 哺乳动物`）无需改动。

### 4.2 完整排序键（按优先级）

先做**去重**：按 `(subject, relation, object, negated)` 折叠完全相同的结论，保留排序最优的那条（去重必须在排序**之后**或与排序同时确定，否则结果依赖输入序）。

然后按以下键升序/降序排列，**每一级都必须可测**：

| 级别 | 键 | 方向 | 依据 |
|---|---|---|---|
| 1 | `isDerived`（`steps.length > 0`） | 直接事实优先（false < true） | 已知事实比推理结论更可靠，且先答用户已教的内容 |
| 2 | `negated` | 肯定优先（false < true） | 让正面事实先于否定事实出现 |
| 3 | `confidence` | **降序** | 高置信度优先；与既有 hedge 阈值（`responsePlanner.ts:41` 的 0.75）语义一致 |
| 4 | `path.length` | **升序** | 推导链越短越直接（`哺乳动物` 先于 `动物` 先于 `生物`） |
| 5 | `object` | 升序 | 确定性、可读；`localeCompare("und")` 而非默认 locale |
| 6 | `relation` | 升序 | 同宾语不同关系时的稳定序 |
| 7 | `subject` | 升序 | 同上 |
| 8 | `negated`（已在第 2 级） | — | — |
| 9 | **tie-breaker**：`createdAt` 降序（新事实优先）→ `id` 升序 | — | 仅在上述全部相同时才用到；`id` 保证**全序**，使排序结果与输入顺序完全无关 |

**第 9 级的必要性**：前 8 级仍可能并列（两条记录 subject/relation/object/negated 全同但 id 不同——`addMany` 现已按三元组去重，理论上不出现，但库中存量数据可能有）。有了 `id` 这一级，`sort` 的输入顺序不再影响输出，可写"打乱输入顺序后结果不变"的测试。

**关于 `updated_at`**：A.1 已加该列，但**当前 RPC 的 `p_knowledge` 不含它**，`KnowledgeRecord` 类型也没有该字段，因此本批**不能**用它做 tie-breaker（那需要改 RPC/schema，本批禁止）。记录为后续项。

### 4.3 排序键为什么这样定（可审计）

- 不用 `Map`/数组的偶然顺序：所有比较键都取自记录的**显式字段**（`confidence`/`createdAt`/`id`/三元组文本）或推理结果的结构属性（`steps.length`/`path.length`）。
- 不引入任何隐式权重：没有"重要性打分"之类的魔法常数，除了 confidence 的方向之外全部是字典序/长度。
- 排序函数是纯函数、可单测：`sortAnswers(answers)` 输入输出都是普通数组，测试直接用打乱顺序的输入断言输出恒等。

### 4.4 兼容性风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 答案顺序变化 | 用户可见输出顺序改变 | 这正是本次目的；用 `reply` 级测试钉住新顺序 |
| `planner/responsePlanner.test.ts:94` | 该测试直接构造 `answers` 传入 planner | **不受影响**，因为排序在 reasoner 内、planner 不排序 |
| hedge 判定 | `representativeConfidence` 取 `min`，与顺序无关 | 无需改动；排序不改变 min |
| 与 B.5 冲突检测的关系 | `conflicts` 仍恒为 `[]`（B5 不在本批） | 排序把否定事实排后，但不合并、不裁决；B5 落地时复用同一排序键 |

---

## 5. 测试矩阵

### A.3（`parser/relationAliases.test.ts` 新增 + `patterns/*.test.ts` 扩充）

| 用例 | 期望 |
|---|---|
| 每个规范关系的每个别名各一条 statement | 输出 `relation === canonical` |
| `猫拥有爪子` / `猫具备爪子` | `{猫, 有, 爪子}`（不再出现 `猫拥`） |
| `猫算是哺乳动物` / `猫归类为哺乳动物` | `{猫, 属于, 哺乳动物}` |
| `猫能飞` / `猫能够飞` / `猫可以飞` | `{猫, 会, 飞}` |
| `猫喜爱鱼` / `猫位于屋顶` | `{猫, 喜欢, 鱼}` / `{猫, 在, 屋顶}` |
| 最长匹配优先：`拥有` 不得被切成 `拥`+`有` | 主语不含 `拥` |
| 未登记别名（如 `猫酷爱鱼`） | `unknown`，**不得**猜测 |
| 幂等 | `canonical(canonical(x)) === canonical(x)` |
| 回归：`苏格拉底是人` | 仍是 `{苏格拉底, 是, 人}` |

### A.6

| 用例 | 期望 |
|---|---|
| 词条别名预计算 | 预计算产物与旧的每轮计算结果逐条相等（等价性测试） |
| 四处 `normalized` 合并 | 合并后旧测试全绿；等价性测试对同一输入集比对 |
| 空白不敏感查找 | 教 `Alice Chen 属于 Furry Club` 后，`Alice Chen属于什么` 能答 |
| 存储不变 | 存的仍是 `Alice Chen` / `Furry Club`（展示契约不破） |
| 中文回归 | `猫 属于 哺乳动物` + `猫属于什么` 仍能答 |
| 展示契约回归 | `statement.test.ts:52` 仍然通过 |
| 幂等 | 所有规范形函数 `f(f(x)) === f(x)` |

### A.7

| 用例 | 期望 |
|---|---|
| 首次教学 | `added`，措辞与现有断言一致（`已记录：猫 属于 哺乳动物`） |
| 完全重复 | `already-known`，不产生第二条记录，措辞不宣称新增 |
| 别名导致重复（`猫是一种哺乳动物` 后再教 `猫属于哺乳动物`） | `already-known`（A.3/A2 归一后同一事实） |
| 更正（`猫属于哺乳动物` → `猫属于爬行动物`） | `corrected`，两条记录都在，措辞说明已更新 |
| 不修改既有记录 | 重复教学后 `confidence`/`source`/`id` 不变 |
| Frost 与 Plain 两种人格 | 各自断言三种 outcome 的措辞 |
| 向后兼容 | 直接构造 `{kind:"learned", record}`（无 outcome）仍渲染为 `added` |

### B.6

| 用例 | 期望 |
|---|---|
| 输入顺序无关 | 打乱 `answers` 输入顺序，`sortAnswers` 输出恒等 |
| 直接优先于推导 | 直接事实排在推导结论之前 |
| 肯定优先于否定 | 正面事实在前 |
| confidence 降序 | 0.9 在 0.5 前 |
| 推导链短者优先 | `哺乳动物` → `动物` → `生物` |
| 全并列时用 id 兜底 | 两条同 subject/relation/object/negated 记录稳定有序 |
| 端到端顺序 | 先教 A 后教 B 与先教 B 后教 A，最终回答顺序相同 |
| planner 不受影响 | `responsePlanner.test.ts` 全部保持绿色 |

### 全局回归
`npm run typecheck && npm test && npm run build`，并确认 `sdk.api-surface.contract.test.ts`（70 exports）保持绿色。

---

## 6. 不变量与验收清单

- [ ] SDK 运行时导出仍恰好 70 个，`sdk.ts` 未新增导出；新内部模块不被 `semantic/index.ts` 具名导出
- [ ] 未改 DB schema / RPC / RLS / policy / grant / migration / deferred
- [ ] 未实现 B1、B2、B4、B5、B7、B8
- [ ] 未引入模糊匹配、相似度合并、LLM 或向量检索
- [ ] 人格层只改措辞，不改事实、置信度、推理结果或状态归属
- [ ] 所有新增规范形函数都有幂等属性测试
- [ ] 排序键全部来自显式字段，且有"输入顺序无关"测试
- [ ] 已存在的展示契约（实体保留空格）与解析契约（`苏格拉底是人` 保持 `是`）均未被破坏

## 7. 建议提交顺序

1. **A.6a + A.6b**（纯性能与去重，零行为变化，风险最低）
2. **A.3**（别名表驱动，修掉主语污染；行为变化集中在别名输入）
3. **A.7**（需要 A.3/A2 的归一稳定后才有意义）
4. **B.6**（独立，可与上面并行）
5. **A.6c**（实体查找统一，风险最高，单独提交并单独评审；若维护者不接受空白不敏感匹配则整体推迟）

## 8. 本批明确不做

- 不迁移存量脏数据（如已写入的 `猫拥`）；只保证新写入正确。
- 不区分记忆的"新记住/已更新"（需改 `MemoryManager` 公共类型，另立一项）。
- `updated_at` 不进排序键、不进 `KnowledgeRecord`、不改 RPC。
- 不做 `conflicts` 检测与裁决（B5），排序只为它预留稳定顺序。
- 不修 `猫的指代是家猫` 这类关系词污染（第 0 节记录，范围外）。
