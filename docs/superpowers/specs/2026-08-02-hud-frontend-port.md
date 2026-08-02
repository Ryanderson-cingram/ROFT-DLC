# 新 HUD 落地到 apps/web · Spec

**日期：** 2026-08-02
**状态：** 待用户审阅
**上游：** `docs/superpowers/specs/2026-08-01-hud-redesign.md`（设计稿 spec）+ `design/mockups/{game,game-respond,game-choose,game-status}.html`（四份已定稿设计稿）
**规则源：** `docs/knowledge-base/`（本 spec 不改任何规则）
**基线：** `apps/web` 41 个测试全绿（5 文件 / 2.96s）——改版全程不许低于这个数

---

## 1. 目标与非目标

**目标**：把四份设计稿落成真实客户端，同时清掉盘点出来的死代码与三个真 bug。

**非目标**：不动数据链路（`lib/game-channel.ts` 的铃铛→拉快照、双档轮询、幂等重试、409 处理已经是对的，一行不碰）；不实现神化机制（引擎里没有）；不改大厅/等候室/百科三页的结构（它们跟着新令牌自动换肤即可）。

---

## 2. 顺手修掉的三个真 bug

这三条都是**删代码即修**，不需要额外设计。

| # | Bug | 现状 | 为什么新设计自动修掉 |
|---|---|---|---|
| 1 | **倒计时进度条与真实 deadline 无关** | `game.css:19/21` 的 `animation: drain 12s` 覆盖了 `alert-bar.tsx:46` 按 `deadline` 算的内联 `width`（CSS 动画计算值 > 内联样式）。惩罚窗口永远演 12s、反应窗口永远演 8s；只有 `prefers-reduced-motion` 下才显示真实进度 | 读条改成坞顶那条由 `--w` 驱动的线，`@keyframes drain` 整个删掉 |
| 2 | **窗口一开，牌桌被挤进 300px 右栏** | `.layout` 是 `1fr / 300px` 两列（`game.css:251`），而 `<Hud>` 返回 fragment（`hud.tsx:131`）= `<AlertBar>` + `<main.table>` 两个平级子节点 → 3 个网格子项错位。**只在惩罚/响应窗口打开时发生**，正好是最要紧的时刻 | 顶部读条不存在了，记录改 offcanvas，两列网格整个消失 |
| 3 | **`.colors` 的颜色与文字可能对不上** | `game.css:216-219` 用 `nth-child(1..4)` 绑死背景色，文字来自 `cards.ts:17-22` 的 `COLORS` 数组。改数组顺序 → 写着「红」的按钮是蓝底。这是 a11y 事故不只是样式事故 | 色块改成 `data-color` 驱动（`.colors button[data-color="R"]`），顺序与样式解耦 |

---

## 3. 目标架构

### 3.1 组件树

```
app/game/[code]/page.tsx          路由 · 数据 · 一个 Pending union · 提交编排
└ components/game/
  ├ table.tsx        <GameTable>     纯展示壳，不持有任何业务态
  │ ├ turn-dial.tsx  <TurnDial>      轮转轨：座位 · 方向 · 指针 · 每个人的技能徽
  │ ├ ticker.tsx     <Ticker>        最近一条（读 room_events，与抽屉同源）
  │ ├ card-river.tsx <CardRiver>     三堆同构 + 场上物件（骰子 / 被指定的牌）
  │ │ └ pile.tsx     <Pile>          厚度 · 张数 · 顶牌 · 扇形展开（摸牌堆永不展开）
  │ ├ punish-chain.tsx <PunishChain> 惩罚叠链（每段带颜色）
  │ └ dock.tsx       <Dock>          命令坞
  │   ├ hand.tsx     <Hand>          恒定排序 · 高亮 · 点选 · 多选
  │   └ dock-slots.tsx <DockSlots>   三固定槽位（左技能 / 中主操作 / 右退让）
  ├ log-drawer.tsx   <LogDrawer>     offcanvas + backdrop（原 log-panel）
  ├ skill-modal.tsx  <SkillModal>    技能详情（四句总则作第二页签）
  ├ sheet.tsx        <Sheet>         不遮手牌的升起面板（宣言盘 / 洗牌三选一）
  └ modal.tsx        <Modal>         全屏（抽 3 选 1 / 牌堆全貌）—— 原生 <dialog>
```

`hud.tsx`（487 行 / 19 项职责）拆完即删。`alert-bar.tsx`、`color-sheet.tsx` 删（功能并入 `<DockSlots>`）。`pick-sheet.tsx` 只保留宣言盘那一种用法。

### 3.2 纯函数层（`lib/`，零 DOM，表驱动测试）

从 `hud.tsx` 抽出来的六块「快照 → 字符串/结构」逻辑，现在只能靠 `querySelector` 间接测：

| 文件 | 导出 | 取代 |
|---|---|---|
| `lib/hud-copy.ts` | `sayFor()` · `handHint()` · `buttonLabel()` · `CHOICE_LABEL` · `PHASE_STEP` | `hud.tsx:97-128, 301-318, 444-478, 32-43, 22-24` |
| `lib/hand-sort.ts` | `sortHand(cards)` | 新增（见 §4） |
| `lib/dock-slots.ts` | `dockSlots(snapshot) → { skill, main, yield }` | `hud.tsx:80-92` 那 5 条 `&&` 过滤 |
| `lib/legal.ts` | `playActionsOf()` · `costActionsOf()` · `playableIds()` | `hud.tsx:60-76` |

**`dockSlots()` 是这次架构的核心。** 第 5 条 UI 反馈（按钮别乱跑）在代码里的落点就是它：一个纯函数把 `legalActions` 映射到三个固定槽位，没有的动作返回 `{ disabled: true, reason }` 而不是消失。它零 DOM、可穷举测试，且是「客户端零规则」的守门员——组件永远不自己判合法性。

### 3.3 页面状态：五个 `useState` 归一

现状五个本地态（`page.tsx:53-61`）语义完全一致——*「一个待补完的提交：弹个客户端面板收最后一个输入，收完 `send()` 一次，然后归零」*。类型上 2^5=32 种组合合法，其中 31 种非法；互斥只是调用路径的巧合。

```ts
type Pending =
  | { kind: "color";         cards: Card[]; extra?: PlayFlags }        // 变色/+4/并列4张定色
  | { kind: "shuffleChoice"; cards: Card[]; extra?: PlayFlags }        // 洗牌三选一
  | { kind: "cancelColor";   action: RespondAction }                   // 洗牌③取消牌定色
  | { kind: "discardCost";   effectKey: string }                       // 恒心弃 1
  | { kind: "declare";       effectKey: string }                       // 影歌①宣言
  | { kind: "pickFromHand";  window: "swapReturn" | "shuffleDiscard" } // 司夜还牌 / 洗牌弃牌
  | { kind: "multiPlay";     picked: string[] }                        // 并列多选
```

5 个 `useState` → 1 个；「至多一个面板」从口头约定变成类型事实；5 段 `{x && …}` → 一个 `switch`。`discardOpen`（`hud.tsx:47`）与 `picked`（`hud.tsx:50`）也从 HUD 收上来——`picked` 决定 `onPlayMany` 的 payload，那是提交语义不是显示语义。

### 3.4 遮罩分级（第 4 条反馈在代码里的落点）

| 场景 | 实现 | 手牌 |
|---|---|---|
| 定色 | 中槽换成 `<ColorSlots>`，**无任何遮罩** | 全程可见 |
| 从手牌挑一张（司夜还牌 / 洗牌弃牌 / 恒心代价） | 手牌区进入 `pickFromHand` 态，**无任何遮罩** | 就是操作对象 |
| 并列多选 | 手牌区进入 `multiPlay` 态，**无任何遮罩** | 就是操作对象 |
| 宣言盘 / 洗牌三选一 | `<Sheet>`：`.scrim--table`（`bottom: var(--dock-h)`）+ 面板从坞上方升起 | 完整露出 |
| 抽 3 选 1 / 牌堆全貌 / 技能详情 | `<Modal>` 全屏 | 此刻不需要手牌 |

`--dock-h` 由 `useDockHeight()` 在挂载 / 快照变化 / resize 时写回真实像素（设计稿里的 `syncDockH()`）。读条与窄屏扇形也读它。

---

## 4. 手牌恒定排序

逐字沿用设计稿 spec §3.3。**排序只在客户端渲染前发生，引擎给的 `yourHand` 顺序不变。**

1. 颜色分组，顺序 **红 → 蓝 → 黄 → 绿**（直接复用 `lib/cards.ts:17-22` 的 `COLORS` 顺序，不定义第二套色序）
2. 组内数字牌 0→9 升序
3. 该色功能牌垫在本色组末尾：停 → 转 → +2
4. 无色牌排最后：变色 → +4 → 洗牌 → 毒

摸到的新牌按同一规则插入，不追加到末尾。**多选（并列）时不重排**——手指不跟着牌跑。

---

## 5. 引擎侧要补的投影（约 50 行，零数据库迁移）

全部集中在 `packages/engine/src/types.ts` + `index.ts::projectView`。数据本来就在 `room_state_private.state`（jsonb），只是没投影出来。`apps/web/fixtures/snapshot.ts` 的 `satisfies ClientSnapshot` 会当场把漏补的地方报出来。

| # | 字段 | 用在哪 | 泄露风险 |
|---|---|---|---|
| 1 | `playedPile: Card[]` | 出牌堆的厚度 / 张数 / 扇形展开 / 全貌弹窗 | 无：每一张都被所有人亲眼见过（逐个入口核过，见下） |
| 2 | `players[].marksSpent` | 「魂 3/6 · **已花 2**」 | 无：标记的获得与花费都有公开事件 |
| 3 | `marksCap` | 「魂 3**/6**」 | 无：来自技能定义 |
| 4 | `soulHarvest: { seat, declared, drawn }` | 影歌窗口念得出「老白指定 **红5**」 | 无：`types.ts:110` 自己写着「宣言当众、队列与已摸张数都是公开的」 |
| 5 | `swap: { seat, target }` | 「把绿0 还给**阿柴**」 | 无。**`cardId` 绝不投影**（那是暗信息） |
| 6 | `dice.target` | 「老白掷出 2 · **小满**摸 2 张」 | 无。从 `resume` 里只挑 `target`，**不放开整个 `resume`** |
| 7 | `players[].activatedThisTurn` | 技能弹窗的「本回合主动 0/1」 | 无 |
| 8 | `shufflePending.choice` | 「老白打出了洗牌**①**（全体手牌打乱重分）」 | 无。**`drawnId` 不投影** |
| 9 | `PunishSegment.color` | 叠链每段前面的色块 | 无 |
| 10 | `players[].sealedBy` | 「你被**老白**的血棘封印了 · 解封条件：老白改封别人」 | 无：`sealed` 事件的 public payload 早就带 `by`，行动记录一直在渲染「被老白封印了技能」 |

**#1 的一个产品约定**：摸牌堆见底洗回时 `playedPile` 被砍到只剩顶张（`actions/draw.ts:38-41`），所以「完整历史」实际是「**上次重洗以来**」。设计稿的说明行已经写了这件事。要整局历史只能从 `room_events` 拼——**不为此再造一条历史链**。

**#9 为什么不能从 `playedPile` 回推**：远星的「视为打出」不动牌河（`actions/punish.ts:168`），链里会有一段在牌河上找不到对应牌。必须记在段上。

**不做**：`ascensions` 真实值（引擎里没有神化机制，`projectView` 恒返回 0，设计稿画成灰的即可）；昵称进快照（展示数据不进规则层，现有的客户端 join 是对的）。

**顺带一条设计稿修正**：`01-decided-rules.md` G4——「主神在场时神化最多 3；**无主神时无此上限**」。基础包无主神，所以神化点不该画成「2 实心 + 1 空心」的三格，应只画 N 颗实心。

---

## 6. 动效

设计稿靠「`display` 切换会让 CSS 动画重播」拿到零 JS 的动效。React 里换成**组件挂载**：内容一变就重新挂载，动画自然重播。对不换组件只换文本的地方（一句人话、跑马灯），用 `key={文本}` 强制重挂——这是同一个技巧的 React 版本。

动效清单逐字沿用 `tokens.css` 里已定稿的那套（`rise` / `pop` / `deal` / `sheet-up` / `fade` + 手牌逐张 30ms 错开）。`prefers-reduced-motion: reduce` 下全部关闭，且三档回合状态**仍靠颜色分得出来**。

---

## 7. 可访问性（现状是零，这次补齐底线）

盘点结论：全 app **没有任何焦点管理**（`grep onKeyDown|Escape|focus\(` 在非测试文件里零命中）。四个模态都写了 `role="dialog" aria-modal="true"` 却没有 focus trap——屏幕阅读器会隐藏背景，但**键盘 Tab 照样跑到背景的手牌按钮上**，AT 用户听不到却能操作。这比不写 `aria-modal` 更糟。

本次必须做到：

1. **模态一律用原生 `<dialog>` + `showModal()`** —— 浏览器免费给 focus trap、Esc 关闭、背景 inert。四处手写 `.overlay` 全部换掉
2. **`aria-labelledby` 一律用 `useId()`** —— 现在三处硬编码 id，`ColorSheet` 还被渲染两次（id 重复）
3. **live region**：一句人话（`aria-live="polite"`）、倒计时进入最后 10 秒时播报一次、行动记录新条目不播报（避免刷屏）
4. **`aria-current="step"`** 给阶段条当前步；**`aria-expanded` + `aria-controls`** 给抽屉把手与堆的扇形
5. **牌面的 `aria-label` 从裸 `<span>` 挪走**：非交互牌面用 `role="img"` + `aria-label`（多数 AT 忽略裸 span 上的 label）
6. **抽 3 选 1 的单选框**：`opacity:0` 的绝对定位 input 吃掉了焦点指示，键盘用户看不见选到哪个 → 改 `.draft-opt:has(input:focus-visible)` 显式画外框
7. 出牌方向不能只有 `title`（触屏与 AT 不可达）→ 补文本替代

---

## 8. 死代码清理（约 200 行 + 7 个文件）

全部有证据，无行为影响：

| 删什么 | 证据 |
|---|---|
| `app/design/game/page.tsx`（38 行） | 无任何入口；对齐目标 `game-log.html` 已删；它渲染的正是被新设计整体废弃的那些块；日志是硬编码假数据验证不了 `humanize()`；且它传的 `fixtureA` 没有 `pendingWindow`，恰好绕开了 §2 的 bug 2 —— 作为对照页给的是**假阳性** |
| `fixtures/snapshot.ts:83-159`（77 行） | `fixtureB`–`fixtureE` / `FIXTURES` / `FixtureKey` / `fixtureDWild` 零消费者；删完整个文件只剩测试消费者，搬进 `test-support/` |
| `apps/web/public/*.svg` ×5 + `README.md` | `create-next-app` 脚手架残留 |
| `globals.css` 死规则 8 条 | `.num` `.muted` `.row` `.sr-only` `.pip--empty` `.badge[data-tone=magic]` `.badge[data-tone=bad]` `.badge .count`，`className` 里零命中 |
| `game.css:90-95 .swatch`、`:10 top:48px`（被 `:248` 覆盖） | 同上 |
| `lobby.css:52-53 .opt--disabled` | 诸神包恢复可选后留下的钩子 |
| `game-channel.ts:113` 的 `refresh` / `clearError` | 无调用方 |
| `.btn--block` 三处重复 | `game.css:245` / `lobby.css:86` / `login.css:23` 逐字相同 → 上提到令牌 |

**`lib/skills.ts` 的双源收敛**：`name` / `sigil` 与引擎 `skill-defs.ts` 10/10 逐字重复，`suit` 可推导。更糟的是 `Skill.id` 用**中文名**当主键，导致每次查技能都要绕引擎一圈换名（`skills.ts:101-108`）。改成：`Skill.id` = 引擎 id，`name`/`sigil` 一律读 `loadedSkills.byId`，`SKILLS` 退化成 `id → { l0, l1, effects }` 的纯文案表。这段桥接与 4 个重复字段一起消失。

---

## 9. 测试策略

**基线 41 个必须始终绿。** 分三类处理：

| 类别 | 处理 | 数量 |
|---|---|---|
| **保留原样** | `api.test.ts` 全部；`CHOICE_LABEL` 覆盖率（零 DOM）；`draft-sheet.test.tsx` 全部 | ~13 |
| **只改选择器** | 根因是 `test-support/render-hud.tsx:29,33` 两行（`.hand .card--legal` 与 `.actions button`）。**顺手换成 role 查询**，下次改版不用再动 | ~13 处断言 |
| **必须重写** | `.alertbar` 那个 describe（读条改成进度环 + 坞顶线，但「`onExpire` 每窗口只触发一次」原样搬）；`.skillcard` 相关（技能卡→技能徽+弹窗）；`.hand-meta` 提示语 | ~8 |
| **删** | `pick-sheet.test.tsx` 的恒心弃牌与司夜还牌两个 describe —— 这两条流程改成手牌区直接点选，届时应测 HUD 手牌区而非 `PickSheet` | 2 |

**新增覆盖**（现在是零）：
- `lib/dock-slots.ts` —— 穷举每种窗口 × 每种 `legalActions` 组合，断言三槽位的归属与 disabled 理由
- `lib/hand-sort.ts` —— 排序规则四条各一例 + 稳定性
- `lib/hud-copy.ts` —— 表驱动，取代现在靠 `querySelector` 间接测文案
- `log-panel.tsx::humanize()` —— 40 个 case 零覆盖，而它是唯一把引擎事件翻成玩家语言的地方，性质与已有覆盖率测试的 `humanReason`、`CHOICE_LABEL` 完全相同。用 `engine-vocab.ts` 的手法从引擎源码 grep 事件类型来驱动

---

## 10. CSS 策略

`design/mockups/tokens.css` 直接成为 `app/globals.css`（新视觉语言 + 全部组件基类 + 旧变量别名段），`app/game/[code]/game.css` 退化成页面布局胶水（竖柱 / 栏宽 / 断点），与设计稿里各页 `<style>` 的内容一一对应。**类名与设计稿保持逐字一致**——这样设计稿永远是可运行的对照物，改版不会两边漂移。

---

## 11. 风险

| 风险 | 缓解 |
|---|---|
| 一次性替换 487 行的 `hud.tsx`，中途不可运行 | 分阶段：纯函数先抽（零视觉变化、测试同步绿），再换壳 |
| 41 个测试大面积变红导致失去回归保护 | 每阶段结束必须全绿；选择器耦合先集中到两个 helper 再改 |
| 引擎投影改动波及 267 个引擎测试 | 全是**新增可选字段**，不改现有行为；`satisfies` 会指出所有漏补处 |
| 设计稿与代码日后漂移 | 类名逐字一致 + 设计稿保留在仓库里当对照 |

---

## 12. 审阅门闩

确认本 spec 后按 `docs/superpowers/plans/2026-08-02-hud-frontend-port.md` 分阶段实施。未 git commit。
