# 首批技能实施 spec 总纲（第 2–8 号：并列 / 影歌 / 强袭 / 司夜 / 远星 / 血棘 / 劫营）

**日期：** 2026-07-30
**读者：** 被派来实现单个技能的子代理。**先读完本 README，再读你负责的那份 spec。**
**规则唯一来源：** `docs/knowledge-base/`（下称 KB）。spec 里引用的规则是抄给你省事的；与 KB 冲突时 **KB 赢**，且要回报冲突而不是自行取舍。

---

## 0. 铁律（违反任何一条 = 返工）

1. **改规则先改文档**：发现 KB 没写死而实现必须写死的行为 → 停下来回报，不许自行裁定。spec 已把已知的裁定都标了出处（01-Xn / 06-Qn / 04 条目）。
2. **引擎纯函数**：`packages/engine` 无 IO、无 `Date.now()`、无自产随机。随机只来自 `ctx.rng`，随机的**结果**必须写进事件（audit 或 public），重放读事件不重掷。
3. **数值进定义数据**：handler 里不许出现规则常数。数值走 04 围栏块的 `values` → `pnpm gen:skills` 重新生成 → `paramsOf` 读取。改了 04 的 yaml 必须重新跑 `gen:skills`（产物三份同源：`skill-defs.json` / `.ts` / `supabase/migrations/0004_skill_defs_seed.sql`）。
4. **隐私三分**：事件 `public`（全员）、`private`（单座位）、`audit`（谁都不发，只为重放）。他人手牌、牌堆顺序绝不进 public。
5. **客户端零规则**：UI 的可点性一律来自 `legalActions` 与 `disabledReasons`，组件内不判合法性。
6. **测试随行**：每条 spec 末尾的测试清单是最低要求；行为全部要有 vitest 覆盖。跑法：`cd packages/engine && pnpm test`；全仓 `pnpm -r typecheck`。

## 1. 引擎地图（2026-07-30 现状）

```
packages/engine/src/
  index.ts            applyAction 分发 / legalActions / projectView
  types.ts            GameState / Board / Action / ClientSnapshot / PendingWindow
  legal.ts            commit（version++，清窗口，syncUno）/ reject / windowIdOf / passTurn / isPlayable
  deck.ts             buildDeck / shuffle
  actions/
    start-game.ts     开局：发牌 → openDraft
    draft.ts          skillDraft 窗口（收集全员语义）
    play-cards.ts     单张出牌 + 精英 useSkill + U5 末牌 + 胜负判定（唯一设 winner 处）
    draw.ts           drawCards（唯一摸牌出口，走 02 §7 层级 reducer + 洗回）/ drawCard / endTurn
    punish.ts         惩罚链 / punishStack 窗口 / respond & claimTimeout 分发
    uno.ts            callUno / catchUno（U6/U7）
    skill.ts          revealSkill / activateSkill 脊梁（V1–V8、T1、压制、V7 次数账）
  skills/
    registry.ts       loadSkills：进抽池门槛 = 标注完整 + 引用机制全部注册 + 主动有 handler
    handlers.ts       HANDLERS[id] = 纯函数（恒心是范本）
    params.ts         paramsOf / paramsOfEffect：从定义 values 读数
    draw-passives.ts  扫全场亮出技能 → 摸牌修正（恩惠零专属代码，范本）
    skill-defs.*      生成产物，勿手改；源头是 04 的 yaml 围栏块
    primitives/       index.ts 机制注册表；marks / statuses / suppression / playability / draw-modifier
```

关键 API（直接用，别重造）：

- `commit(state, board, phase?)` — version+1、**清 pendingWindow**、执行 `syncUno`。要保窗口的转换手动接回（见 `draft.ts::assign` 与 `uno.ts::bump` 两个范本）。
- `windowIdOf(state)` — 窗口 id 由 version 派生，结算即失效。
- `drawCards(board, req, rng, mods?)` — **唯一**摸牌出口；`req: { kind: "punish"|"skill"|"rule", base, seat }`。
- `gainMarks / spendMarks / markCount`、`grantStatus / removeStatus / hasStatus`、`suppressionOf / isSuppressed`。
- 测试助手 `test/helpers.ts`：`table(hands, boardOver, stateOver)`、`ctx(rng?, now?)`、`lcg(seed)`。
- 窗口两种既有语义范本：`punishStack`（先到先得，一人响应即关）与 `skillDraft`（收集全员，各结各的）。新窗口按 spec 指定的语义选一种照抄结构。

## 2. 本批共享基建（谁的 spec 先用到谁建；建之前先 grep 是否已被前序代理建好）

### 2a. 掷骰助手（强袭①②、司夜①、血棘① 用）

`actions/dice.ts`（新）：

```ts
/** R1：三面骰 0/1/2。结果必须入事件（调研 §4）；骰面公开。 */
export function rollDice(rng: () => number, n: number): number[]  // 每个元素 ∈ {0,1,2}
```

事件约定：由调用方发 `{ type: "diceRolled", public: { seat, reason, values } }`——骰子是当众掷的，`values` 进 public。`reason` 是短字符串（`"assault-multiplier"` / `"nightlord-steal"` / `"bloodthorn-drain"`…）。

### 2b. `DrawRequest.initiator`（06-Q56；影歌①、劫营、血棘① 用）

- `DrawRequest` 加 `initiator?: number`（造成这次摸牌的技能持有者座位）。
- `draw-passives.ts::applies()` 补一条：当 `req.kind === "skill"` 时，效果仅在 `req.initiator !== req.seat` 时生效（恩惠的「他人技能」= 发起者不是自己，06-Q56）。`initiator` 缺席视为自己（恒心等自摸路径不用改调用）。
- 测试：恩惠不减自己技能造成的摸牌；减他人技能造成的摸牌。

### 2c. `suppression_exempt` 消费（06-Q39；影歌② 用）

- 定义字段已存在（`SkillEffect.suppression_exempt?: string[]`，取值用 02 §1 词表如 `"punish_turn"`）。
- `skill.ts::activateSkill` 的压制检查改为：`suppressionOf(b, seat)` 里每一个来源都能在该效果的 exempt 里找到（映射表 `{ punish_turn: "punishTurn" }`，一处写死）才放行；**`sealed` 永不豁免**（01-P9，由 `sealable` 管）。
- 注意：现在的检查在读 effect 之前，要把顺序挪到取到 effect 之后。

### 2d. 机制注册表（`primitives/index.ts`）

你的技能定义引用的每个 `kind` / `modifies` 名字都必须在注册表里，否则技能进不了抽池（`registry.test.ts` 会告诉你缺什么）。本批会新增：`on_play`、`response`、`status_grant`、`play_legality`、`turn_flow`、`punish_amount`、`dice`。**只注册你真正实现了行为的名字**——注册表的存在意义就是防「数据声称可执行、引擎静默没反应」。

## 3. 实施顺序与依赖

```
1 并列(heart-4)   ─┐ 多张出牌是劫营的前置
2 影歌(diamond-3) ─┤ 需要 2b、2c；新窗口（收集全员变体：依次响应）
3 强袭(diamond-1) ─┤ 建 2a；②需要「掷骰接管」两段式窗口（本批最难的基建）
4 司夜(club-3)    ─┤ 需要 2a；换牌动作
5 远星(diamond-j) ─┤ 扩 punishStack 窗口的选项
6 血棘(diamond-2) ─┤ 封印赋予/解除 + sealedBy 记账
7 劫营(diamond-10)─┘ 依赖 1 与 2b；interrupt 窗口
```

并行派发时：1–6 彼此基本独立（2a/2b 先到先建），7 必须等 1 落地。

## 4. 每个技能的完成定义（DoD）

- [ ] 04 的 yaml/散文如需修改已改，`pnpm gen:skills` 已跑，三份产物一致
- [ ] `registry` 抽池包含该技能（`loadSkills().pool` 断言进测试）
- [ ] spec 的全部 worked example 有对应测试；`pnpm test` 全绿；`pnpm -r typecheck` 干净
- [ ] 事件的 public/private/audit 划分符合 spec；随机结果入事件
- [ ] `legalActions` 暴露新动作/选项；`projectView` 不泄露暗信息（写一条「快照里搜不到」式测试）
- [ ] web 若需新 UI（spec 会写明），可点性只来自 legalActions；`pnpm build`（apps/web）通过
- [ ] 不改本批范围外的行为：跑全量测试而不是只跑自己的文件
