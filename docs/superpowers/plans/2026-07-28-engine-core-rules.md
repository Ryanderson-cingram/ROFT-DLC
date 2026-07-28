# 引擎核心规则 Implementation Plan

> **执行方式：** 逐 Task 实施，每个 Task 一次 commit。先加载 `tdd` 技能——本计划全程红-绿-重构，测试先行不是建议。
> **规则唯一来源：** `docs/knowledge-base/`。每条测试的 `it()` 描述里带上规则 ID（U1/P3/G1…），做不到就说明你在实现一条没拍板的规则——去 `06-open-questions.md` 查，查不到就停下来问，**不要自己发明规则**。

**Goal:** 把引擎从 `ping` 骨架变成能跑完一局基础包 UNO 的权威规则机：牌组、发牌、出牌合法性、摸牌、惩罚叠链、反应窗口超时、视角投影。

**Architecture:** `packages/engine` 纯 TS、零 IO、零依赖、零随机源（`ctx.rng` 注入）。所有状态转换是纯函数：`applyAction(state, action, ctx) → { state, events, rejected? }`，输入 state 绝不可变。

## Global Constraints

- **只动 `packages/engine/`。** `apps/web`、`supabase/` 有另一个代理在并行工作，碰了就冲突。
- **`src/types.ts` 是冻结契约**（commit `9a8e895`）。前端正在按它写代码。需要改字段？先停下来在最终报告里提出，不要单方面改——改了前端就编译不过。唯一允许的自由改动：Task 6 删掉 `ping`。
- 内部相对导入必须带 `.ts` 扩展名（Deno/Node 双跑前提）。
- 不要引任何依赖。不要为「以后可能有技能」预留抽象层——技能是下一个计划的事，本轮 `skillId` 只是个存着不动的字段。
- 每个 Task 一次 commit，不 push。

---

## 本轮范围与不做的事

**做**：基础包（`rulePack: "base"`）= 172 张牌减去毒 5 张、洗牌 3 张 = **164 张**。这两种牌的效果牵扯毒池/同命/古神，属于诸神包，本轮不实现，也不进牌堆。
**不做**：任何技能行为（`skillId` 只存不用）、神化轮次逻辑（`roundsLeft` 恒为 1）、诸神黄昏、拼点、预兆。字段留在契约里是给下一个计划用的，本轮**不要**为它们写代码。

> ⚠️ 「基础包 = 164 张」是本计划的假设（规则库只给了满编 172 张的构成表，没定义分包边界）。写进 `deck.ts` 的注释里，最终报告中列为待用户确认项。

---

### Task 1: 牌组与洗牌

**Files:** Create `src/deck.ts`; Test `test/deck.test.ts`

**Interfaces:**
```ts
export function buildDeck(pack: RulePack): Card[];        // base=164, gods=172
export function shuffle<T>(items: T[], rng: () => number): T[];  // 纯函数，返回新数组
```

- [ ] **Step 1: 写失败测试** — 按 `05-gods-omens-deck.md §3` 逐行断言张数：0 牌每色 2 张、1–9 每色每数 3 张、+2 每色 3 张、停每色 4 张、转每色 2 张、变色 4、+4 8；`base` 不含 `poison`/`shuffle` 且总数 164，`gods` 含且总数 172。`shuffle` 用固定 rng（如 `() => 0.5`）断言确定性、长度不变、多重集合不变（洗完排序后 === 洗前排序）。
- [ ] **Step 2: 实现** — Fisher-Yates（用 `rng()`；不要用 `sort(() => rng() - .5)`，那个分布是偏的）。
- [ ] **Step 3: 绿 + typecheck**
- [ ] **Step 4: Commit** `feat(engine): deck composition and unbiased shuffle`

### Task 2: 开局发牌 `startGame`

**Files:** Create `src/actions/start-game.ts`; Test `test/start-game.test.ts`

规则：S1b 每人 7 张；牌顶翻开第一张作为起始弃牌。

- [ ] **Step 1: 写失败测试** — 3 人与 4 人各一局：每人手牌 7 张（S1b）；`drawPile.length === 164 - 7*n - 1`；`discardPile` 长度 1；`phase` 变 `turnStart`；`currentSeat === 0`；`activeColor` 等于起始牌颜色。**起始牌是无色牌（wild/+4）时必须重翻**，直到翻出四色牌为止（断言：构造一个 rng 让首张为 `+4`，结果 `discardTop` 仍是四色牌且 `activeColor` 非 null）。非 `lobby` 阶段发起 → `rejected.reason === "not_in_lobby"`；座位数不在 3–4 → `rejected.reason === "bad_seat_count"`。发牌结果落 `EngineEvent`：公开事件只带张数，每人的具体手牌走 `private.{seat,payload}`（spec §4 事件同样做公私投影）。
- [ ] **Step 2: 实现**
- [ ] **Step 3: 绿 + typecheck**
- [ ] **Step 4: Commit** `feat(engine): startGame deals 7 and flips a coloured starter`

### Task 3: 出牌合法性与 `playCards`

**Files:** Create `src/legal.ts`、`src/actions/play-cards.ts`; Test `test/play-cards.test.ts`

规则：U1、U3、S7（「相同的牌」= 颜色+牌面全等）。

**合法性判定**（单张）：牌顶同色 / 同牌面 / 无色牌（`wild`、`+4`）任意时候可打。跟色比的是 `activeColor` 而非弃牌堆顶那张牌的原色（打过变色牌后两者不同）。

- [ ] **Step 1: 写失败测试** — 表驱动：`activeColor=R` + 顶 `R7` 时 `R3` ✅、`B7` ✅、`B3` ❌、`wild` ✅、`+4` ✅；打出 `wild`/`+4` 必须带 `chosenColor`，缺了 → `rejected.reason === "color_required"`；打非自己手上的牌 → `not_in_hand`；不是自己回合 → `not_your_turn`。**牌面效果**：`skip` 跳过下家（G-无关，传统 UNO + T4）、`rev` 翻转 `direction`（2 人局语义未定，本轮只测 3–4 人）、打完手牌为空 → `phase="finished"` 且 `winner` 为该座位。每条 `it()` 带规则 ID。
- [ ] **Step 2: 实现** — 合法性判定抽成 `isPlayable(card, top, activeColor)` 供 Task 6 的 `legalActions` 复用，**不要写两遍**。
- [ ] **Step 3: 绿 + typecheck**
- [ ] **Step 4: Commit** `feat(engine): play legality, skip/reverse, win detection`

### Task 4: 摸牌与牌堆重洗

**Files:** Create `src/actions/draw.ts`; Test `test/draw.test.ts`

规则：U1（摸到可打可立即打出）。

- [ ] **Step 1: 写失败测试** — `drawCard` 摸 1 张进手牌；摸到的牌合法 → `drawnPlayable` 置为该牌，玩家可以接着 `playCards` 打它，或 `endTurn` 不打；摸到的牌不合法 → `drawnPlayable` 为 null 且回合直接结束（不要求玩家再点一次）；`drawnPlayable` 非 null 时 `playCards` **只允许打那一张**，打别的 → `must_play_drawn_or_end`。**牌堆摸空**：`drawPile` 空时把 `discardPile` 除牌顶外洗回摸牌堆（用 `ctx.rng`）并落 `deckReshuffled` 事件；洗回后仍不够摸 → 摸到几张算几张，不崩。摸到的具体牌走 `private` 投影，公开事件只说「谁摸了 N 张」。
- [ ] **Step 2: 实现**
- [ ] **Step 3: 绿 + typecheck**
- [ ] **Step 4: Commit** `feat(engine): draw, play-drawn window, discard reshuffle`

### Task 5: 惩罚叠链与反应窗口

**Files:** Create `src/actions/punish.ts`; Test `test/punish.test.ts`

规则：**P1–P11 是本 Task 的验收清单，逐条写测试。** 尤其：

- P3 可叠加传递：轮到被惩罚者时打出合法惩罚牌把累计传给下家
- P4 顶为 +2 → 可接 +2 或 +4（+4 需定色）；P5 顶为 +4 → **只能接 +4**
- P6 贡献在打出进链时结算，只作用于自己那一张（本轮无技能，所以 `draw` 恒为 2 或 4；结构必须支持每段独立，别写成 `total = 2*count`）
- P10 吃下累计后：摸完即回合结束，**不能再出牌**
- P1 惩罚回合不能用主动技能（本轮无技能，但 `respond` 的 choice 白名单要只含 `stack`/`accept`）

窗口：打出 +2/+4 → 开 `pendingWindow{ type:"punishStack", actors:[下家], deadline: ctx.now+30s, defaultChoice:"accept", resume:"play" }`，`id` 用 `w${version}:punishStack`。

- [ ] **Step 1: 写失败测试**（一条规则 ID 一条 `it()`）— 含多段链的累计：`+2(seat0) → +4(seat1) → 累计 6`，`punish.total === 6`、`segments.length === 2`、`initiator === 0`。非 `actors` 内的座位发 `respond` → `not_your_window`；`windowId` 对不上 → `stale_window`。
- [ ] **Step 2: 实现**
- [ ] **Step 3: `claimTimeout`** — 任意成员可发起；`ctx.now <= deadline` → `rejected.reason === "not_yet_expired"`；过期 → 按 `defaultChoice` 结算（等价于全员 accept）。这是防 AFK 卡死全桌的唯一机制（spec §7），必须有测试。
- [ ] **Step 4: 绿 + typecheck**
- [ ] **Step 5: Commit** `feat(engine): punish stacking, pending window, timeout claim`

### Task 6: `projectView` / `legalActions`，删除 `ping`

**Files:** Modify `src/index.ts`; Test `test/project-view.test.ts`

- [ ] **Step 1: 写失败测试** — **隐私是硬验收**：把整个 `ClientSnapshot` JSON 序列化，断言里面不含任何他人手牌的牌面（不是只检查 `players[].hand` 不存在——要 `JSON.stringify(snapshot)` 后确认别人的牌一张都搜不到）。`legalActions` 在「我的回合、手上有 R3/B7、顶 R7」时恰好包含打 R3、打 B7、摸牌，不含打别人的牌。`disabledReasons.callUno` 在手牌 >2 时为「剩 2 张牌时才需要喊」。惩罚窗口中 `legalActions` 只有 `respond`。
- [ ] **Step 2: 实现** `projectView(state, seat) → ClientSnapshot`（含内联 `legalActions`）
- [ ] **Step 3: 删除 `ping` 动作与其测试**，跑全量 `pnpm --filter @roft/engine test` + `typecheck`
- [ ] **Step 4: Commit** `feat(engine): client projection with legal actions; drop ping skeleton`

---

## Verification（整计划完成后）

1. `pnpm --filter @roft/engine test` 全绿，**测试数 ≥20**（spec §1 的 MVP 成功标准）
2. `pnpm --filter @roft/engine typecheck` 干净
3. 隐私测试确实是对整个序列化快照做的搜索，不是只查字段名
4. `git log --oneline` 6 个 feat(engine) 提交，未 push
5. 最终报告中列出：所有假设（如 164 张分包边界）、所有你觉得规则库没讲清而自行裁定的地方
