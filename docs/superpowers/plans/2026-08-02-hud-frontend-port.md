# 新 HUD 落地到 apps/web · Implementation Plan

**Spec:** `docs/superpowers/specs/2026-08-02-hud-frontend-port.md`
**设计稿:** `design/mockups/{tokens.css,game.html,game-respond.html,game-choose.html,game-status.html}`
**基线:** `apps/web` 41 测试全绿 · `packages/engine` **581** 测试全绿
（原先写的 267 是过时数字，2026-08-02 实测更正。P0 结束时：引擎 593 / web 123）

## 全局约束

- **每个阶段结束时，两个测试套件都必须全绿**，且 `pnpm --filter web typecheck` 通过。做不到就不进下一阶段。
- 类名与 `design/mockups/` 逐字一致——设计稿是可运行的对照物，两边不许漂移。
- 规则唯一来源仍是 `docs/knowledge-base/`。本计划**不改任何规则**；遇到规则问题停下来问，不要自己裁。
- 客户端零规则：能不能做一律看 `legalActions`，组件不自判合法性。
- 每阶段一次 git commit（用户要求时才提交）。

---

## P0 · 引擎投影补齐（约 50 行，零迁移）

**可并行度：** 单人做完最省事（全在同两个文件里）。

**Files:** `packages/engine/src/types.ts` · `packages/engine/src/index.ts` · `packages/engine/src/skills/primitives/marks.ts` · `packages/engine/src/actions/punish.ts` · `apps/web/fixtures/snapshot.ts` · `packages/engine/test/project-view.test.ts`

- [ ] **Step 1**：纯投影七项——`playedPile`、`soulHarvest{seat,declared,drawn}`、`swap{seat,target}`（**不含 `cardId`**）、`dice.target`（从 `resume` 里只挑 `target`，**不放开 `resume`**）、`activatedThisTurn`、`shufflePending{seat,choice}`（**不含 `drawnId`**）、`sealedBy`
- [ ] **Step 2**：`marksSpent` 记账——`spendMarks` 成功时累加到 `Board.marksSpent`（optional 字段，老局读作 `{}`），投影到 `SnapshotPlayer.marksSpent`
- [ ] **Step 3**：`marksCap` 投影——把「标记名 ↔ `values.max`」的绑定在引擎里做掉，客户端不猜
- [ ] **Step 4**：`PunishSegment.color`——`extendChain` 加一个入参，各调用点跟上（**不能从 `playedPile` 回推**：远星的「视为打出」不动牌河）
- [ ] **Step 5**：fixture 补字段（`satisfies ClientSnapshot` 会逐个报出来）+ `project-view.test.ts` 加断言（`playedPile` 顺序、洗回后截断、暗信息未泄露三条）
- [ ] **Step 6**：两个套件全绿

**验收：** 新增字段全部 optional 或有默认值，现有 267 个引擎测试一条不改。

---

## P1 · 纯函数层抽离（零视觉变化）

**可并行度：** 四个文件互不依赖，**适合 4 个代理并行**，每人一个文件 + 它的测试。

**Files:** 新建 `apps/web/lib/{hud-copy,hand-sort,dock-slots,legal}.ts` 与各自的 `.test.ts`

- [ ] **Step 1** `lib/legal.ts`：从 `hud.tsx:60-76` 搬出 `playActionsOf` / `costActionsOf` / `playableIds`
- [ ] **Step 2** `lib/hud-copy.ts`：从 `hud.tsx:97-128,301-318,444-478,32-43,22-24` 搬出 `sayFor` / `handHint` / `buttonLabel` / `CHOICE_LABEL` / `PHASE_STEP`。**文案逐字不变**（现有测试还在断言它们）
- [ ] **Step 3** `lib/hand-sort.ts`：按 spec §4 实现，色序直接复用 `cards.ts` 的 `COLORS`
- [ ] **Step 4** `lib/dock-slots.ts`：`dockSlots(snapshot) → { skill, main, yield }`，每槽 `{ action?, label, disabled?, reason? }`。**这是第 5 条 UI 反馈在代码里的落点**——没有的动作返回 disabled+reason，不返回 undefined
- [ ] **Step 5**：`hud.tsx` 改为从这四个模块 import（此时 UI 一像素不变，41 个测试应原样全绿）
- [ ] **Step 6**：补零 DOM 表驱动测试——`dock-slots` 穷举窗口 × legalActions 组合；`hand-sort` 四条规则各一例 + 稳定性；`hud-copy` 取代现在靠 `querySelector` 的间接断言

**验收：** 41 个原有测试**一行不改**仍然全绿（这一阶段是纯搬运）；新增测试 ≥25 条。

---

## P2 · 令牌换血 + 牌桌壳（视觉切换点）

**可并行度：** Step 2–4 三个组件可并行，但都依赖 Step 1 的令牌先落地。

**Files:** `apps/web/app/globals.css`（整体换成 `design/mockups/tokens.css`）· `app/game/[code]/game.css`（退化成布局胶水）· 新建 `components/game/{table,turn-dial,ticker,card-river,pile,punish-chain}.tsx`

- [ ] **Step 1**：`tokens.css` → `globals.css`，含旧变量别名段（大厅/等候室/百科三页自动换肤，不改它们的结构）；顺手删掉 spec §8 列的 8 条死规则与 `.btn--block` 三处重复
- [ ] **Step 2** `<TurnDial>`：座位轨（**含自己**，标「你」）· 方向雪佛龙（`direction` 翻转即整排反向）· 当前行动者指针 · 每个人的技能徽（可点 → P3 的弹窗）· 窄屏横滚且当前行动者自动回视口
- [ ] **Step 3** `<CardRiver>` + `<Pile>`：三堆同构（厚度封顶 6 层 + 张数徽 + 顶牌）；**摸牌堆永不给展开入口**（暗信息）；出牌堆与弃牌堆 hover/点击浮出最近 6 张扇形；场上物件（骰子 / 被指定的牌）放在这里而不是弹窗
- [ ] **Step 4** `<PunishChain>`：每段带颜色块（吃 P0 的 `PunishSegment.color`）
- [ ] **Step 5** `<Ticker>`：最近一条，与抽屉同源（都读 `room_events`）
- [ ] **Step 6** `<GameTable>` 组装以上，`hud.tsx` 只留手牌与按钮那一半

**验收：** 375px 与 1440px 两档目检无横向溢出；bug 2（两列网格错位）随 `.layout` 消失而消失。

---

## P3 · 命令坞与浮层（交互切换点）

**可并行度：** Step 1–2 与 Step 3–5 可分两个代理并行（坞 / 浮层）。

**Files:** 新建 `components/game/{dock,hand,dock-slots,log-drawer,skill-modal,sheet,modal}.tsx`；删 `alert-bar.tsx`、`color-sheet.tsx`；`pick-sheet.tsx` 只留宣言盘

- [ ] **Step 1** `<Dock>` + `useDockHeight()`：手牌 + 一句人话 + 三槽；把坞的真实高度写回 `--dock-h`（挂载 / 快照变化 / resize），读条与窄屏扇形都读它
- [ ] **Step 2** `<DockSlots>`：消费 P1 的 `dockSlots()`；倒计时 = 主按钮外圈进度环 + 坞顶那条 `--w` 线（**bug 1 在这里修掉**：删 `@keyframes drain`，宽度真正由 `deadline` 驱动）；定色时中槽换成四色块，**色块用 `data-color` 而非 `nth-child`**（**bug 3 在这里修掉**）
- [ ] **Step 3** `<LogDrawer>`：offcanvas + backdrop（点 backdrop 关）+ 右缘把手；两端同一套
- [ ] **Step 4** `<SkillModal>`：技能徽（自己的在坞左、别人的在轨上）全部可点 → 同一个弹窗；L0/L1/L2 + 状态 + 标记（当前 / 上限 / 已花）+ 四句总则页签。**页面中部不再有技能大卡，也不再有 `<details>`**
- [ ] **Step 5** `<Sheet>` / `<Modal>`：`Sheet` 用 `.scrim--table`（`bottom: var(--dock-h)`）只盖牌桌；`Modal` 用**原生 `<dialog> + showModal()`**（免费拿 focus trap / Esc / inert）
- [ ] **Step 6**：删 `hud.tsx`

**验收：** 定色 / 从手牌挑一张 / 并列多选三态下**页面上没有任何遮罩元素处于可见状态**；宣言盘与洗牌三选一下手牌完整可见。

---

## P4 · 页面状态归一 + 死代码清理

**可并行度：** 单人做（都在同几个文件里）。

**Files:** `app/game/[code]/page.tsx` · `lib/skills.ts` · `fixtures/snapshot.ts` → `test-support/` · 删 `app/design/game/page.tsx` 等

- [ ] **Step 1**：五个 `useState` → 一个 `Pending` 可辨识联合（spec §3.3）；`discardOpen` 与 `picked` 从 HUD 收上来
- [ ] **Step 2**：`lib/skills.ts` 双源收敛——`Skill.id` 改成引擎 id，`name`/`sigil` 读 `loadedSkills.byId`，`SKILLS` 退化成 `id → { l0, l1, effects }` 纯文案表；`skills.ts:101-108` 的换名桥接删掉
- [ ] **Step 3**：删 spec §8 清单里的全部死代码；`fixtures/snapshot.ts` 搬进 `test-support/`
- [ ] **Step 4**：补 `humanize()` 的覆盖率测试（40 个 case，用 `engine-vocab.ts` 从引擎源码 grep 事件类型驱动）

### P4 承接 P3b 留下的五条（2026-08-02 记）

- [ ] **Step 5**：把设计稿里 `.tabs` / `.tabpanel` / `.sk__*` / `.creed` / `.sk__bar` 那一段 CSS 补进 `globals.css`。**放 globals 不放 game.css**——设计稿里它们在每页 `<style>` 只是因为四份稿各自复制了一遍；真实产品里技能弹窗是**一个共享组件**，它的样式属于组件层。不补的话技能弹窗与牌堆弹窗是裸的（页签没有下划线、`.sk__meta` 没有网格）
- [ ] **Step 6**：`globals.css` 补 `dialog.modal { border:0; background:transparent; padding:0 }` 与 `.modal::backdrop`，然后**删掉 `modal.tsx` 里那个 `ponytail:` 标记的内联 RESET**（原生 `<dialog>` 默认带 UA 的白底与边框）。`::backdrop` 到位后，那个只为压暗而留的兄弟 `.scrim` div 也可以一起去掉
- [ ] **Step 7**：`useRoomLog` / `humanize` 从 `log-panel.tsx` 搬进 **`lib/room-log.ts`**（它们是数据与文案，不是视图），`log-drawer.tsx` 与 `ticker.tsx` 改从那里 import，`log-panel.tsx` 随之删除
- [ ] **Step 8**：技能弹窗的 `主动 ×2` / `被动 ×3` 计数徽——数据在**引擎的** `loadedSkills.byId(id).effects[].kind`（不是 `lib/skills.ts` 里那张按钮文案表）。Step 2 的双源收敛做完之后按 kind 分组数一下即可
- [ ] **Step 9**：`globals.css` 动效段里的 `.seat--lin` / `.seat--man` / `.seat--chai` 是设计稿的人物固定类，生产里是死规则，删掉

**不改的一条**：`<Modal>`/`<SkillModal>` 是挂载驱动、`<LogDrawer>` 用 `open` prop——**不要统一**。挂载驱动正好白拿 spec §6 的动画重播，而抽屉需要常驻 DOM 才能做滑入过渡，两者的差异是有理由的。

**验收：** `git grep` 确认删掉的符号零残留；测试数只增不减。

---

## P5 · 动效 · 可访问性 · 移动端

**可并行度：** 三个 Step 可三个代理并行（互不重叠）。

- [ ] **Step 1 动效**：沿用 `tokens.css` 已定稿的那套；React 里靠**组件挂载**重播，只换文本的地方用 `key={文本}` 强制重挂；`prefers-reduced-motion` 下全关且三档回合状态仍靠颜色分得出
- [ ] **Step 2 a11y**（spec §7 七条）：原生 `<dialog>` · `useId()` · live region · `aria-current="step"` · `aria-expanded`/`aria-controls` · 牌面 `role="img"` · 抽技能单选框的焦点指示 · 出牌方向的文本替代
- [ ] **Step 3 移动端**：375/390px 实机目检——底坞 sticky 且 `100dvh`、手牌横滚、堆的扇形不被裁、命令坞三槽位在所有状态下位置不变

**验收：** 键盘可以只用 Tab/Enter/Esc 走完一整局的主要路径；关掉动画偏好后三档回合状态仍分得清。

---

## Verification（全部完成后）

1. `pnpm --filter web test` + `packages/engine` 测试**双绿**，且 web 测试数 > 41
2. `pnpm --filter web typecheck` 通过
3. 四份设计稿与真实页面逐状态对照：轮转轨 / 三堆 / 命令坞三槽 / 抽屉 / 技能弹窗 / 遮罩分级 / 手牌排序
4. spec §2 的三个 bug 逐条验证已修
5. 375px 与 1440px 两档无横向溢出
6. `git grep` 确认 spec §8 的删除清单零残留
