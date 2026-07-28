# 技能目录结构化 Implementation Plan

> **执行方式：** 逐 Task 实施，每个 Task 一次 commit。
> **这是改文档的计划，不是改规则的计划。** 任何一处「文档没写清楚所以我按理解补一个语义」都必须停下来问，不要自行裁定——你在动的是全项目唯一规则源。

**Goal:** 让 `docs/knowledge-base/04-skills-catalog.md` 的技能条目携带**逐条结构化标注**，使 `scripts/gen-skill-defs.ts` 能生成 `effects[]` 及其属性，把首批 10 个 MVP 技能的 `structured` 翻成 `true`。

**Why now:** spec §4 要求技能 handler「仅按 id 注册行为，属性一律从定义数据读取」。当前 56 条定义只有 `id/name/suit_rank/status/summary/caveats/notes`，`effects[]` 全空、全部 `structured: false`。这个缺口不补，技能实现只能把窗口/次数/层级/目标写回 handler 里，spec 的单一生成源就白做了。**这是技能实现的前置，不是它的一部分。**

**背景**：生成器与 CI 漂移校验已就位（`packages/engine/src/skills/`、`.github/workflows/ci.yml`、`skill-defs.test.ts`）。改了文档就必须重跑 `pnpm --filter @roft/engine gen:skills` 并提交产物，否则 CI 红。

## Global Constraints

- 只动 `docs/knowledge-base/`、`scripts/gen-skill-defs.ts`、`packages/engine/src/skills/`（生成产物 + 类型）、`supabase/migrations/0004_skill_defs_seed.sql`（重新生成的 seed）
- **不改任何既有规则文字的语义**。重排版、补标注、拆栏位可以；改一个字的裁定不行
- 每个 Task 结束跑 `pnpm --filter @roft/engine gen:skills` + `test` + `git diff --exit-code -- packages/engine/src/skills`
- 不 push

---

### Task 1: 定标注格式，先标 2 个技能打通管道

**Files:** Modify `docs/knowledge-base/04-skills-catalog.md`、`docs/knowledge-base/02-methodology.md`（补格式说明）、`scripts/gen-skill-defs.ts`、`packages/engine/src/skills/types.ts`

**格式选型**：四花色现在是 markdown 表格，给 `effects[]` 加列会把表撑爆且没法表达数组。**在每个技能条目后附一个 ` ```yaml ` 围栏块**，散文摘要保持不变（人读散文，机读围栏）。围栏块只放 02 §1 定义的字段，字段名逐字沿用。

先只标两个，把管道跑通：
- **恒心♠1**（最简单的 active：弃一张摸一张）
- **恩惠♥1**（passive + 带 `layer: L2` + 带 `L5` 钳制「至少 1」——它同时验证 `layer` 能不能表达）

- [ ] **Step 1: 写格式说明**到 `02-methodology.md`（新增一节：围栏块的位置、字段、必填/选填、未知时怎么留空）
- [ ] **Step 2: 标注这 2 个技能**
- [ ] **Step 3: 扩展生成器**解析围栏块 → 生成 `effects[]`；有围栏块的条目 `structured: true`，没有的保持 `false`
- [ ] **Step 4: 验证** 生成器连跑两次产物一致；这 2 条 `structured === true` 且 `effects` 非空；其余 54 条不受影响
- [ ] **Step 5: Commit** `docs(kb): structured annotation format, proven on 恒心 and 恩惠`

### Task 2: 标注其余 8 个 MVP 技能

**Files:** Modify `04-skills-catalog.md` + 重新生成产物

首批 10 个（spec §5.5）：恒心♠1、恩惠♥1、精英♥3、并列♥4、强袭♦1、血棘♦2、影歌♦3、劫营♦10、远星♦J、司夜♣3。

**逐个对照 `01-decided-rules.md` 的已定条款**（S15 影歌魂上限 6 与占主动条、S16 司夜末牌放宽、P6/P7/P8/P9 强袭/远星/血棘、G5 劫营打断）。**标注必须与这些条款一致**；发现散文与已定条款冲突，停下来报告，不要自己选一个。

- [ ] **Step 1: 标注 8 个技能**
- [ ] **Step 2: 验证** 10 个 MVP 技能全部 `structured: true`，`effects[].kind/window/once/targeting` 均有值
- [ ] **Step 3: Commit** `docs(kb): annotate the remaining MVP skills`

### Task 3: 补文档缺的东西（不是逐条标注，是整块缺失）

**Files:** Modify `04-skills-catalog.md`、`02-methodology.md`

- [ ] **Step 1: 四神补正式条目与 id** — 古神/邪神/时神/主神在 04 里**没有条目、没有 id**，只有 05 的散文与 02 的箭头图，导致 `upgrade_to` 完全无法生成。按 `05-gods-omens-deck.md §1` 的现有文字补条目（**照搬，不要改写**），给 id
- [ ] **Step 2: ★ 的 id 写进文档** — 现在 `star-grandeur/star-treasure/star-disaster/star-carnival` 是生成器 `STAR_IDS` 里手工锚定的，文档只举过 `star-grandeur` 一例。改名要同时改两处 = 早晚会漂
- [ ] **Step 3: `layer` 落到条目上** — 02 §7 用散文按技能名列举（恩惠 L2 / 伤逝 L1 / 忍戒 L6 / 吟游·战争序 L3 / 狂欢和2 和3 L2 / 樱时雨 L4…）。这些是**已定裁定**，只是没落到 04 的条目里。逐条搬进对应技能的围栏块，§7 的散文保留作总览
- [ ] **Step 4: `reveal_window` 白名单成列** — 现在散在散文里（♥7 极运/♦9 寄生「可任意时刻亮出」、♠4 契约「被跳过时亮出」），正则抓不可靠。凡 V2 白名单例外的技能，围栏块里显式写 `reveal_window`
- [ ] **Step 5: `force_activate_ok` 与 `sealable` 补全** — 02 §1 写「异议/夜魇**等** false」，那个「等」说明列表不全；`sealable` 只在♦2 血棘条目里描述规则，没有逐条标注谁不可封。**这两项如果文档确实没有依据，不要猜**——列进报告让用户裁定，围栏块里留空
- [ ] **Step 6: Commit** `docs(kb): gods entries, star ids, per-skill layer and reveal windows`

### Task 4: 数据质量修正

**Files:** Modify `04-skills-catalog.md`

生成器已经把这些脏数据原样带进了 JSON：

- [ ] **Step 1: 「疑点」栏里的已裁定结论挪走** — ♠J 忍戒（`✅ 与伤逝无冲突：S2…`）、♥3 精英（`Q&A 已补`）、♦10 劫营（`已定`）装的是状态注记不是疑点，导致 `caveats` 混入非疑点内容。挪到 `notes` 或删（**内容不要丢**）
- [ ] **Step 2: 复合 status `✅/❓`** — 文件头图例只定义了 ✅/❓/⚠️ 三种。要么在图例里承认复合值的含义，要么拆成 status + 备注
- [ ] **Step 3: `### 狂欢★ — ✅ buff（非技能牌）`** — 状态与分类塞在同一栏，生成器只能把「buff（非技能牌）」丢进 notes。给它一个正式的分类字段
- [ ] **Step 4: 重新生成 + Commit** `docs(kb): separate decided notes from open caveats`

### Task 5: CI 守住结构化进度

**Files:** Modify `packages/engine/src/skills/skill-defs.test.ts`

- [ ] **Step 1:** 加断言：首批 10 个 MVP 技能（按 id 列表写死）必须 `structured === true` 且 `effects.length > 0`。有人改文档改坏了标注 → CI 红
- [ ] **Step 2:** 断言 `layer` 只出现在 `modifies` 含摸牌数的效果上（02 §7 的约束）
- [ ] **Step 3: Commit** `test(skills): lock in MVP structuring coverage`

---

## Verification（整计划完成后）

1. `pnpm --filter @roft/engine gen:skills && git diff --exit-code -- packages/engine/src/skills` 干净
2. `pnpm test` 全绿；10 个 MVP 技能 `structured: true`
3. `supabase db reset` 后 `skill_defs` 条数不变（56）且 MVP 10 条含 `effects`
4. **人工复核**：随机抽 3 个标注过的技能，逐字对照 `01-decided-rules.md` 与 Excel 摘要，确认标注没有悄悄改变语义

## Out of scope

其余 46 个技能的标注（等 MVP 10 个跑通、schema 稳定后再批量做）、技能 handler 实现、`06-open-questions.md` 里未裁定项（含 Q26 喊 UNO）的裁定。
