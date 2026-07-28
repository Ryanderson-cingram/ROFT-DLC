# 技能引擎：数据驱动 + 原语注册表 Implementation Plan

> **前置：** `2026-07-28-skill-catalog-structuring.md` 必须先完成——本计划消费它产出的 `effects[]` 标注。
> **执行方式：** 逐 Task 一次 commit，全程 TDD（先加载 `tdd` 技能）。规则唯一来源 `docs/knowledge-base/`。

**Goal:** 让「新增/修改/移除一个技能」在绝大多数情况下只是改 JSON，而不是改引擎代码。用首批 10 个技能验证这个断言。

---

## 1. 设计分析：数据能表达什么，不能表达什么

数据驱动的目标常被说成「以后加技能零代码」。**那个版本做不到**，而且追求它会得到一个用 JSON 写成的、没有类型和调试器的解释型语言——比硬编码更难维护。

可达成、也真正有价值的版本是：

> **JSON 表达「维度」，代码表达「机制」。第 N 个技能如果只是重组已有机制，就只改 JSON。**

两类东西必须分清：

**A 类 · 维度（纯数据，改 JSON 即可）**
时机窗口、目标集合、代价、每回合次数、结算层级、可否被强制、可否被封印、持续期、数值与上限下限。02 §1 的字段模型已经把这类列全了。

**B 类 · 机制（第一次必须写代码）**
「攒一种计数标记并花掉它」「在别人出牌时插入一个响应窗口」「改写一张牌能不能被打出」「一次打出多张的合法组合」。这些是**原语**。

关键在于：原语是**有限的且高度复用**的。下面从 10 个技能反推，只需要 9 个原语；而这 9 个原语一旦存在，剩下 46 个技能里的大多数就落回 A 类。

### 从 10 个 MVP 技能反推的原语清单

| 原语 | 做什么 | 首批用到它的技能 | 未来复用 |
|---|---|---|---|
| `marks` | 通用计数标记的获得/上限/花费 | 影歌(魂≤6)、司夜(盗) | 异议(异)、万变(形)、邪神(颠)、黄昏(陨)——`颠可当作异/盗/魂/形`（03 §5）本身就要求它通用 |
| `statuses` | 状态的赋予/互斥/生命周期 | 血棘(封印) | 五彩/恋战/心盲/领域/同命（03 §4，负面三者互斥不叠层） |
| `suppression` | 谁在什么条件下关掉谁的什么 | 血棘封印、惩罚回合关主动 | 技能免疫、预兆「技能暂时失效」（02 §2 已定义为通用机制）——**你说的「沉默」就是这一层** |
| `drawModifier` | 按 02 §7 的 L0–L6 层级改摸牌数 | 恩惠(L2 −2，L5 至少 1) | 狂欢/吟游/伤逝/忍戒/八门/寄生——**这是最该先建的横切件** |
| `dice` | 掷 0/1/2、重掷、结果落事件 | 强袭、司夜 | 宏伟、灾难、预兆、邪神 |
| `playability` | 改写「这张牌现在能不能打」 | 精英(数字可当大 1 点) | 五彩/心盲的限制、专精定色、古神改写 |
| `multiPlay` | 一次打出多张的合法组合 | 并列(2同色同数/4同数/6同色) | 宝藏·数字分支、神化的「一轮多张」 |
| `reactionWindow` | 在别人的行动中插入待决窗口 | 劫营(打断)、远星(跟叠) | 合纵/连横、近卫、阳谋、迫近——`pendingWindow` 框架已在，这里是把它做成技能可声明的 |
| `punishContribution` | 改自己那一段惩罚的贡献 | 强袭(掷骰改倍率) | P6 已定「只作用于自己打出的那一张」 |

### 硬约束：数据引用不存在的机制必须炸

数据驱动最典型的失败是**静默失效**：JSON 写了 `kind: "replacement"`，引擎没实现，技能亮出后什么都不发生，没人发现。所以：

- 引擎启动/加载定义时校验每条 `effects[].kind` 与引用的原语都已注册；**未注册 = 抛错**，不是跳过
- 未实现的技能显式标 `unimplemented: true`，**不进抽 3 选 1 的池**（spec §5.5 已有此要求）
- CI 断言：`skill-defs.json` 里出现的原语名集合 ⊆ 引擎注册表的键集合

---

## 2. 与既有计划的关系

- **不冲突、是承接**：`skill-catalog-structuring` 产出标注（A 类维度），本计划建消费它的引擎（B 类机制）
- 取代我先前口头提的「计划 A 框架 / 计划 B 十技能」二分——按**原语依赖**分波更省事，见下
- 本计划**不碰**诸神包（毒/洗牌/四神/预兆/黄昏）与神化轮次；`06-open-questions.md` 的未裁定项（含 Q26 喊 UNO）一律不自行裁定

---

### Task 1: 定义加载器与原语注册表（无任何技能行为）

**Files:** Create `packages/engine/src/skills/registry.ts`、`packages/engine/src/skills/primitives/index.ts`; Test `test/skills/registry.test.ts`

- [ ] **Step 1: 写失败测试** — 注册表能按 id 取到定义；定义引用未注册原语时**抛错**且错误信息点名是哪个技能哪个字段；`unimplemented` 的技能不出现在可抽池里
- [ ] **Step 2: 实现**（此时原语集合为空，所有技能都 `unimplemented`）
- [ ] **Step 3: Commit** `feat(engine): skill definition loader with a primitive registry`

### Task 2: 摸牌结算层级 reducer（原语 `drawModifier`）

**Files:** Create `src/skills/primitives/draw-modifier.ts`; Test

02 §7 的 L0–L6。**这是最先做的原语**：每一次摸牌都要过它，晚做就会有第二个技能开始 ad-hoc 排序，spec §8 明令禁止。

- [ ] **Step 1: 写失败测试** — 逐层：L1 替换命中即跳到 L5；L2 同层全部累加；L3 倍率；L4 覆盖（受罚者自身覆盖 > 全局覆盖）；L5 钳制（下限，且全局 ≥ 0）；L6 只改执行方式不改数字。用假的修正源，不牵扯具体技能
- [ ] **Step 2: 实现**；把现有 `drawCards` 的所有调用点接进来（P11：先加总各段贡献再套用）
- [ ] **Step 3: Commit** `feat(engine): layered draw-count reducer (02 §7)`

### Task 3: 恒心 + 恩惠——打通「JSON → 行为」全链路

**Files:** Modify registry; Test

选这两个是因为它们只需要 `cost`/`draw` 与 `drawModifier`，能在最少机制上验证整条链路。

- [ ] **Step 1:** 恒心♠1（弃一张摸一张，active 占回合 1 次 V7）
- [ ] **Step 2:** 恩惠♥1（passive，L2 −2、L5 至少 1，作用于惩罚与技能摸牌；P11 先加总再套用）
- [ ] **Step 3: 验收断言** — 这两条的行为**完全由 JSON 驱动**：改 JSON 里的 `-2` 为 `-3`，测试随之变化而引擎代码一行不动（写一个测试直接证明这点）
- [ ] **Step 4: Commit** `feat(engine): 恒心 and 恩惠 driven entirely by definition data`

### Task 4: 标记与状态与压制（原语 `marks` / `statuses` / `suppression`）

**Files:** Create `primitives/marks.ts`、`statuses.ts`、`suppression.ts`

- [ ] **Step 1: `marks`** — 获得/上限/花费；上限来自 JSON（影歌 6，S15）
- [ ] **Step 2: `statuses`** — 赋予/互斥/生命周期；03 §4 的「负面三者互斥、不叠层」在这里实现一次
- [ ] **Step 3: `suppression`** — 02 §2 的通用压制层：源（惩罚回合 / 血棘封印 / 技能免疫 / 预兆）× 关掉什么 × 例外白名单（影歌②可在惩罚回合发动，S15）。**P9：封印是「效果全关但仍持有，解除后原样恢复，一次性进度不重置」**
- [ ] **Step 4: 技能** — 影歌♦3（魂≤6，2 魂跳过回合，占主动条）、司夜♣3（打出变色后掷骰获盗；花盗换手牌；S16 末牌放宽照 U5 的例外处理）、血棘♦2（P8 仅链首发起时生效）
- [ ] **Step 5: Commit** `feat(engine): marks, statuses, suppression; 影歌 司夜 血棘`

### Task 5: 出牌规则改写（原语 `playability` / `multiPlay`）

- [ ] **Step 1: `playability`** — 精英♥3（数字可当大 1 点；Q&A：发动时最大为 9，下家按牌面数字继续；只剩 1 张手牌时失效）
- [ ] **Step 2: `multiPlay`** — 并列♥4（2 同色同数 / 4 同数 / 6 同色）。当前 `playCards` 直接拒绝多张（`single_card_only`），在这里放开
- [ ] **Step 3: Commit** `feat(engine): playability and multi-card patterns; 精英 并列`

### Task 6: 反应窗口与惩罚贡献（原语 `reactionWindow` / `punishContribution`）

- [ ] **Step 1: `reactionWindow`** — 技能可声明「在什么事件上开窗口、谁是 actors、默认解法」；复用既有 `pendingWindow` 与 `claimTimeout`
- [ ] **Step 2:** 劫营♦10（G5 打断当前轮、被打断者摸 1、打断者不进回合、从其下家继续；Q&A：可响应并列任意一张）。**已知缺口：G5 的「剩余神化轮次作废」无法实现——基础包没有任何东西授予神化，`roundsLeft` 恒为 1。本轮只做单轮打断，在代码里留 `ponytail:` 注释并在报告中说明**
- [ ] **Step 3:** 远星♦J（P7 弃代价牌并摸 2，视为合法叠链接法；代价摸牌不计惩罚）
- [ ] **Step 4: `punishContribution`** + 强袭♦1（掷骰改倍率，P6 只作用于自己那张；可替任何人重掷）
- [ ] **Step 5: Commit** `feat(engine): reaction windows and punish contribution; 劫营 远星 强袭`

### Task 7: 抽 3 选 1 与亮出/发动

**Files:** Modify `src/index.ts`、`types.ts`（契约扩展，前端同步）

- [ ] **Step 1:** `dealing` 阶段 + 每人 3 个候选（S1；只从已实现的技能里抽）+ `chooseSkill` 动作 + 快照表示
- [ ] **Step 2:** `revealSkill` / `activateSkill`；V1 只在己方回合亮出、V2 白名单例外、V4 亮出当回合即可发动、V6 亮出不占次数、V7 发动占 1 次且多条主动每回合只能选一条、V8 被动不占
- [ ] **Step 3:** S2/S3 一人一技能（替换语义）
- [ ] **Step 4: Commit** `feat(engine): skill draft, reveal and activate`

### Task 8: CI 守住「数据引用的机制都存在」

- [ ] **Step 1:** 断言 `skill-defs.json` 里所有 `kind`/原语名 ⊆ 注册表键集合
- [ ] **Step 2:** 断言 10 个 MVP 技能均**非** `unimplemented`，且都在可抽池里
- [ ] **Step 3: Commit** `test(skills): no definition may reference an unregistered primitive`

---

## Verification（整计划完成后）

1. `pnpm test` 全绿；技能相关测试每条挂规则 ID
2. **数据驱动的实证**：改 `skill-defs.json` 里恩惠的 `-2` → 测试期望值随之改变，引擎代码零改动
3. **静默失效的实证**：往 JSON 里塞一个引用不存在原语的技能 → 加载即抛错，CI 红
4. 10 个 MVP 技能可抽、可亮出、可发动；其余 46 个标 `unimplemented` 且不进池

## Out of scope

诸神包（毒/洗牌/四神/预兆/诸神黄昏/拼点）、神化轮次 G1–G4、`06-open-questions.md` 未裁定项（含 Q26 喊 UNO）、其余 46 个技能的行为。
