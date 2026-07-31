# UNO 声明改为回合作用域 + Web 端补齐与测试

**日期：** 2026-08-01
**规则锚点：** `01-decided-rules.md` U6/U7 及其「U6/U7 补充」（2026-08-01 改判，已写入）
**前置：** 首批十技能引擎侧已全绿（557 测试）；本 spec 只动 UNO 规则 + Web 端

---

## 1. 为什么

规则制定人 2026-08-01 原话：

> 喊出 UNO 按钮可以在还有 2 张时出现（或亮起（平时暗着））。一回合内多次手牌变为 1 的情况，
> 在回合结束前喊就好，不用每次都喊。回合结束后，其他玩家可以抓没喊 uno。

旧口径「手牌数一离开 1 张，已喊即作废」（`legal.ts::syncUno`）在自己回合内会被反复触发：并列逐张摆被
劫营截断后剩牌回手、恒心弃 1 摸 1、远星弃 1 摸 2、洗牌②摸 1 弃 1——每穿过一次 1 张就要重喊一次。
引擎为此长出了两条**只为把 `sayUno` 抬过中间态**的透传字段（`ParallelPending.declared.sayUno`、
`ShufflePending.sayUno`）。改判之后这两条透传的存在理由消失，可以整块删掉。

同时，前端审计出的三个高危缺陷里有两个跟 UNO 直接相关：`sayUno` 在 `apps/web` 里**零命中**（出牌到
下一帧之间人人可抓），以及反应窗口只有 actor 能 `claimTimeout`（AFK 一人锁死全桌）。一并在本 spec 收掉。

---

## 2. 规则最终态（已写入 KB，实现照抄，不要再解释）

> **2026-08-01 二次澄清（规则制定人）已并入本节**：原话「如果先喊，喊的时候还有两张手牌也需要罚，即喊 UNO
> 动作不影响出牌动作，可以出手牌后点击喊 UNO，并且如果回合结束手里剩一张牌忘了喊 UNO，在其他人回合
> 没有被抓的时候也可以点击喊」。**不存在预喊**：按钮常亮、按下即受理，手牌不是 1 张就罚摸 2。
> 下表已是最终态；§3.3/§3.5/§4.1 已按此改写。

| 场景 | 判定 |
|---|---|
| 喊的资格 | **不拦**。按钮常亮，任何时刻按得下去，引擎在按下那一刻判 |
| 按下时手牌恰 1 张 | 声明成立 |
| 按下时手牌 ≠1 张 | **虚喊，罚摸 2 张**（规则摸牌非惩罚，同 U7 的抓），声明不成立 |
| 喊与出牌 | 两个互不影响的动作，互不占用机会；正常打法是打完牌、手牌变 1 之后再点喊 |
| 忘喊 | 回合结束后在别人回合仍可补喊（此时恰 1 张，不罚），只要还没被抓；补喊与抓先到先得 |
| 自己回合内 | 已喊**不作废**，手牌数怎么波动都不管 |
| 交回合那一刻 | 手牌恰为 1 → 已喊存续；否则作废 |
| 回合之外 | 手牌一离开 1 张 → 已喊立刻作废（旧口径不变） |
| 抓漏喊 | 目标持 1 张 + 未喊 + **不是目标本人的回合**。自己回合内是宽限期，抓不得 |

---

## 3. 引擎改动（`packages/engine`）

### 3.1 `legal.ts::syncUno` — 只清回合外的座位

```ts
// U6（2026-08-01）：声明的作用域是「你的这个回合」。回合内不清，交回合时由 passTurn 结算。
export const syncUno = (board: Board): Board => ({
  ...board,
  saidUno: board.saidUno.map((v, i) => v && (i === board.currentSeat || board.hands[i].length === 1)),
});
```

注意 `v && len === 1` 依然对**回合外**座位成立：喊在恰 1 张时的声明，在任何人的回合里都跟着那 1 张存续。

### 3.2 `legal.ts::passTurn` — 交回合结算离场座位的声明

`passTurn` 目前返回 `Pick<Board, "currentSeat" | "activatedThisTurn">`，扩成也返回 `saidUno`：离场座位
（参数 `from`，默认 `b.currentSeat`）手牌 ≠ 1 → 清掉它的已喊；其他座位不动。

**实现前必须核对**：所有换手路径都走 `passTurn`（`legal.ts` 注释声称如此）——逐个 grep `currentSeat:`
的赋值点确认没有绕过的；有绕过的就是 bug，一并修。

### 3.3 `actions/uno.ts::callUno` — 不再拦，改为虚喊罚摸 2

手牌恰 1 张 → 照旧置位 + `unoCalled` 事件。手牌 ≠1 张 → **不 reject**：走 `drawCards({ kind: "rule", base: 2 })`
罚摸 2 张（与 `catchUno` 同一条口径：规则摸牌非惩罚，恩惠/同命不响应），发 `unoMiscalled` 公开事件，
声明**不置位**。`already_said` 保留（已喊再按没有代价，UI 那时显示的是徽记不是按钮）。
拒因 `not_one_card` / `not_callable` **一并删掉**，`apps/web/lib/api.ts` 的人话表同步删。

摸不到牌（牌堆枯竭）时按 `catchUno` 的既有口径处理：罚不到就不受理，不要涨 version。

### 3.4 `actions/uno.ts::catchable` — 加回合门闩

```ts
export const catchable = (b: Board, target: number) =>
  b.hands[target].length === 1 && !b.saidUno[target] &&
  target !== b.currentSeat &&        // U7：本人回合内是宽限期
  b.swap?.target !== target;         // 司夜②盲抽中的假象 1 张，理由见原注释
```

### 3.5 `index.ts::legalActions` — `callUno` 常亮

条件只剩 `!saidUno[seat]`（按钮常亮，手牌数不参与）。合法 ≠ 划算：虚喊要罚 2 张，代价由 UI 说清楚
（§4.1），引擎不替玩家做主。`catchUno` 那条不用改（走 `catchable`）。

### 3.6 删掉现在死掉的透传（ponytail：改判把它们变成了纯负担）

- `types.ts` `ParallelPending.declared.sayUno` 与 `ShufflePending.sayUno` 两个字段及其长注释
- `actions/play-cards.ts` / `raid.ts` / `shuffle-card.ts` 里搬运它们的代码
- `shuffle-card.ts:135` 的 `saidUno: b.saidUno.map(() => false)`（重分时全场清零）：**删掉**。回合外座位由
  `syncUno` 自动清；洗牌者本人在自己回合内不该被清（U6 改判）。删之前先跑一遍现有 shuffle 测试确认差异
  只有这一条语义

`playCards.sayUno` 这个动作字段**删掉**（2026-08-01 二次澄清后追加）：规则制定人原话「喊 UNO 动作**不影响
出牌动作**，可以出手牌后点击喊 UNO」——喊与出牌是两个独立动作，不存在「与出牌同时喊」这一档。留着它就是
唯一一个免罚预喊的口子（拿 3 张打 1 张、带 `sayUno`，声明白拿，绕过虚喊罚则）。前端本来就不用它（§4.1），
测试改用出牌后 `callUno`。连带删掉 `types.ts` 的字段与文档、`play-cards.ts` 的 `declare()` 分支。

### 3.7 顺带修（前端审计发现，引擎侧一行的那个）

`index.ts::legalActions` 的 activations 过滤只查压制与 `once`，不查代价：血棘①无封印目标时、影歌②0 魂时
仍然给出动作，玩家点了才拿到 `no_target` / `cost_unpayable`。加上代价预检（照 `nightlord.ts` 的 `swapActions`
已经在做的样子）。**只做这两个技能**，不做通用代价框架。

### 3.8 引擎测试（新增/改写，`test/uno.test.ts` 为主）

必须有真断言的条款：

1. 恰 1 张喊 → 声明成立不摸牌；2 张 / 3 张喊 → **不被拒**、罚摸 2 张、`unoMiscalled` 事件、声明仍为假；
   已喊再喊 `already_said`；牌堆枯竭时虚喊不受理（version 不涨）
2. **回合内穿越**：恰 1 张时喊 → 恒心弃 1 摸 1（1→0→1）→ 交回合时手牌 1 → 仍已喊、抓不得
3. **回合内多次归 1**：并列逐张摆被劫营截断（剩牌回手）→ 手牌回到 2 → 再打到 1，全程只喊一次仍有效
4. 洗牌②摸 1 弃 1 作末牌路径：声明跨中间态存活（原先靠 `ShufflePending.sayUno` 的那条测试改成断言新机制）
5. **交回合结算**：回合内喊过（当时恰 1 张）但回合结束时手牌 2 张 → 声明作废、**不追罚**（罚只在按下那一刻判）；
   下回合到 1 张须重喊
5b. **忘喊可补**：回合结束时剩 1 张未喊 → 别人回合里 `callUno` 成立且不罚；与 `catchUno` 先到先得
6. **宽限期**：自己回合内持 1 张未喊 → 任何人 `catchUno` 得 `not_catchable`；`passTurn` 之后立刻可抓
7. **回合外不宽限**：劫营打断把打断者打到 1 张且未喊 → 当场可抓；司夜②换牌把目标顶离 1 张 → 目标已喊作废、须重喊（04 ♣3 2026-07-31 裁定，改判后仍成立）
8. 司夜②换牌**不作废司夜自己**的已喊（04 ♣3 该条已按改判修订）
9. `catchUno` 摸的 2 张仍是规则摸牌（恩惠不减，已有测试，确认没被改坏）
10. `fuzz.test.ts` 的 U6 不变式要改：现在的「`saidUno` 与手牌数一致」在回合内不再成立，改成
    「`saidUno[i]` 为真 ⇒ `i === currentSeat || hands[i].length === 1`」

顺带（审计列出的零断言项，本轮一并补，按重要性取前 5）：司夜②换牌作废已喊（= 上面第 7 条）、
血棘①的骰子走强袭②接管、影歌②链转回来可再跳、影歌②跳过后链绕回链首本人不封印、司夜②惩罚轮不可用。

### 3.9 fuzz 加固（最便宜的一条）

`test/fuzz.test.ts` 的覆盖报告目前只断言 `finished > 0`，窗口/事件计数全靠 `console.log`。给关键几项各加
一条下限断言：`interrupt`、`diceTakeover`、`soulHarvest`、`swapReturn`、`farstarUsed`、`sealed`、`unoCalled`、
`unoCaught` 各 `> 0`。阈值就写 `> 0`，不写实测值（避免随机数波动导致假红）。

---

## 4. Web 改动（`apps/web`）

### 4.1 UNO 按钮（本次的正题）

- **常驻常亮**：只要未喊过（`legalActions` 里有 `callUno`）就可点，手牌几张都可点——引擎不拦，代价在按下之后
- **手牌 ≠1 张时按钮要写明代价**：标签或紧邻提示写「现在喊要罚摸 2 张」，别让人误按。这是本条唯一的
  防呆手段（引擎已明确不做资格拦截），务必显眼
- 已喊过：显示为「已喊 UNO」的**静态徽记**（不是可点按钮），自己手牌区可见
- 点击发 `{ type: "callUno" }`。`playCards.sayUno` 前端**不用**：喊与出牌互不影响，自己回合内有宽限期
  （U7），打完牌再点喊不会被抢在中间抓掉
- 抓人按钮（`catchUno`）沿用现有 `legalActions` 驱动，不动

### 4.2 `claimTimeout` 对全员开放

`AlertBar` 现在只在 `window && youAreActor` 时渲染，倒计时与自动催促都挂在它上面（`hud.tsx:121`），
非 actor 既看不到倒计时也发不出 `claimTimeout` → 一个 AFK 玩家锁死全桌（spec §7 明写「任意成员」）。
改成：窗口存在即渲染 AlertBar，非 actor 用旁观文案（「等 X 响应」）+ 同一个倒计时 + 同一个 `onExpire`。
引擎的 `claimTimeout` 本来就不校验 actor 身份，无需引擎改动。

### 4.3 按钮标签按 `effectKey` 区分

`buttonLabel` 的 `activateSkill` 分支忽略 `a.effectKey`，影歌①②渲染成两个字面完全相同的按钮，且
React key 都是 `"activateSkill"`（重复 key）。修：

- 标签取 **per-effect 文案**，来源放 `lib/skills.ts`（每个技能 `effects: { [key]: { label } }`），十个技能里
  有多条主动的只有影歌（①攒魂 / ②花 2 魂跳过）与血棘（①掷骰放血），先把这三条写全，其余回落到 `l0`
- 按钮 key 拼上 `effectKey`

### 4.4 拒因人话与 L2

- `lib/api.ts` 的 `SAYINGS` 补全这十个技能能产生的拒因：`cost_unpayable`、`no_target`、`suppressed`、
  `already_activated`、`not_revealed`、`not_callable`、`already_said`、`not_catchable`、`not_in_hand`、
  `bad_choice`、`deck_empty`、`wrong_phase`、`must_stack`、`color_not_allowed`、`stale_window`
  （以引擎里实际 `reject(...)` 的字符串为准，grep 一遍全取到，别照抄本清单）
- **不做**引擎侧 `disabledReasons`：按钮由 `legalActions` 生成，不可用的动作根本不渲染，L2 的真实需求
  就是「点了被拒时给人话」。已有的两条硬编码 L2（封印置灰、惩罚回合）保留

### 4.5 零碎修正

- `lib/skills.ts` 精英标的 `kind: "被动"` → **主动**（04 §♥3 2026-07-29 裁定 + 引擎 `stacks_with_turn_limit: true`）
- `CHOICE_LABEL.interrupt` 是死条目（真实 choice 是 `"raid"`）→ 改键名
- `fixtures/snapshot.ts` 修：fixture C 的 `choice: "interrupt"` → `"raid"`；`skillId` 用引擎 id 而非中文名

---

## 5. Web 测试（本次的另一个正题：`apps/web` 现在零测试）

### 5.1 工具链

`vitest` + `jsdom` + `@testing-library/react` + `@testing-library/user-event`，`apps/web/package.json` 加
`"test": "vitest run"`（根 `pnpm -r test` 自动带上）。**不引入** Playwright / E2E / MSW / 快照测试库——
组件是纯函数式的（`snapshot` 进，`send` 出），RTL 足够。

### 5.2 测试数据

一律从 `fixtures/snapshot.ts` 造，**类型必须是引擎导出的 `ClientSnapshot`**（这是唯一能挡住契约漂移的
东西——现有 fixture 就是因为没人跑而烂掉的）。加一个 `makeSnapshot(overrides)` 工厂，别再手抄整份快照。

### 5.3 必须覆盖的用例

**UNO（本次改判的验收面）**

1. 手牌 3 张 → UNO 按钮**可点**（常亮），且**显示「罚摸 2」的代价提示**
2. 手牌 1 张 → 按钮可点、无代价提示；点击 → `send` 收到 `{ type: "callUno", seat }`
3. 已喊（`players[you].saidUno === true`）→ 显示已喊徽记，按钮不可点
4. 某对手 `catchUno` 在 `legalActions` 里 → 出现「抓 X：没喊 UNO」按钮，点击 payload 带正确 `target`
5. 自己回合内持 1 张未喊 → **没有**任何人的抓按钮（引擎不给，前端不该自己造）

**十个技能各一条 UI 路径**（断言「入口存在 + 点击后 payload 正确」，不断言规则）

| 技能 | 断言 |
|---|---|
| 恩惠 | 技能卡显示 L0/L1；无操作入口 |
| 精英 | 同一张牌带 `useSkill` 的 `playCards` → 点牌发出的 payload 带 `useSkill: true` |
| 并列 | `canPlayMultiple` → 「多张一起打」入口；多选后 payload 的 `cardIds` 是选中的那几张 |
| 强袭 | ①「掷骰打」独立按钮（与点牌两条路径都在）；② `diceTakeover` 窗口的 takeover/pass 按钮 |
| 血棘 | 封印徽记渲染；被封印时手牌/技能置灰；①发动按钮标签说的是「掷骰放血」而不是被动描述 |
| 影歌 | ①②渲染成**两个不同标签**的按钮且 React 无重复 key 警告；宣言面板提交 payload 带 `declared` |
| 劫营 | `interrupt` 窗口下手牌高亮来自 `legalActions.cardIds`；点击发 `respond{choice:"raid",cardIds}` |
| 远星 | `punishStack` 窗口下代价牌高亮；点击发 `respond{choice:"farstar",cardIds}` |
| 恒心 | 发动后弹弃牌面板；选 1 张提交 payload 带 `cardIds` 长度 1 |
| 司夜 | ②每个目标一个按钮，payload `target` 正确；`swapReturn` 全屏面板点牌发 `respond` |

**窗口与超时**

11. 非 actor 也看得到倒计时，到点自动发 `claimTimeout`（4.2 的验收）
12. `skillDraft` 面板：选项来自 `draftOptions`，点击发 `respond{choice: skillId}`，已选后禁用
13. 每种窗口的一句人话不为空、且不是原始 choice 字符串（`CHOICE_LABEL` 覆盖率——用引擎里实际出现的
    choice 列表驱动这条测试，缺一个就红）

**拒因**

14. `api.ts` 对每个引擎拒因都给出人话（同上，用引擎实际拒因字符串列表驱动，缺一个就红）

### 5.4 不做

E2E、Supabase 集成、视觉回归、`lib/game-channel.ts` 的 Realtime 行为（要真连接才有意义，MVP 不值当）。

---

## 6. 顺序与验收

1. KB（已完成：01-U6/U7 + 补充、04 ♣3、06-Q26）
2. 引擎：§3 全部 + `pnpm --filter @roft/engine test` 全绿（现有 557 条不许因改判而红着不管——受影响的
   要按新规则改写并在 commit message 里说明，不是删掉）
3. Web：§4 全部 + `pnpm --filter web typecheck` + `next build` 通过
4. Web 测试：§5 全部 + `pnpm -r test` 全绿

未 git commit；需要入库时再说。
