# 并列 ♥4（heart-4）——同回合一次合法多打

先读同目录 `README.md`。规则出处：01-G2、04 heart-4 条目（含 2026-07-30 补齐的三形状语义）、06-Q35（不占主动）、01-U2（多张收官免喊 UNO）。

## 一句话

亮出并列后，出牌阶段可以把「一次出 1 张」换成三种多打形状之一；不占 V7 主动额度，不需要发动声明。

## 精确行为

三种形状。**首张必须按常规规则接得上牌顶**（同色 / 同数 / `activeColor`，`legal.ts::isPlayable`），全部限**数字牌**：

| 形状 | 约束 | 打完后的跟牌目标 |
|---|---|---|
| 2 张 | 两张彼此**同色且同数** | 该色 + 该数（例：牌顶蓝 2 → 两张黄 2 → 下家跟黄 2） |
| 4 张 | 四张**同数**，颜色任意 | 数为该数；**颜色由打出者选**（复用 `chosenColor`，提交时必带，缺 → reject `color_required`） |
| 6 张 | 六张**同色**，数字任意 | 色为该色；**数为六张中最大**（面值数值比较，"9" > "2"） |

- 首张的「接得上」判定：2 张形状凭同数或同色接；4 张形状凭同数接（牌顶异数时需 activeColor 命中首张的颜色）；6 张形状凭同色或首张同数接。实现上：**校验 `cardIds[0]` 的 `isPlayable`**——4 张/6 张形状组内并不一致（颜色/数字各异），「任意一张接得上即整组可打」是错的；而逐张摆之后哪张先落地是可观察事实，所以判的必须是首张。组内顺序是提交者的自由，UI 让他把接得上的那张排在前面即可。
- 出牌堆顺序：整组按提交顺序压入 `playedPile`，**最后一张在堆顶**。跟牌目标不是简单的堆顶牌面（4 张看 chosenColor、6 张看最大数）——实现时把「跟牌目标」显式落在 `activeColor` 与一个新概念上：**引入 `activeFace?: Face | null`**（Board 字段，缺席 = 沿用堆顶牌面）。`isPlayable` 改为比对 `activeFace ?? top.face`。单张路径照旧不设 `activeFace`（置 null）。这是本 spec 唯一的结构改动，动它之前先看 `index.ts` / `play-cards.ts` / `draw.ts` 所有 `playedPile[0]` 的比对点。

## ⚠️ 2026-07-30 裁定：并列是「先声明、逐张摆、可被劫营中途截断」

规则制定人确认，**推翻本 spec 初版的原子模型**（原：6 张一次提交一次结算）。实现要点：

1. **先声明整组**：提交仍是一次 `playCards { cardIds: [...] }`，引擎**当场校验形状**（上面的三形状表不变）；校验失败整组拒，一张都不摆。
2. **逐张落地**：校验通过后按提交顺序一张一张进 `playedPile`。**未摆的牌不离手**——Board 增 `parallelPending?: { seat: number; remaining: string[]; follow: {color, face} }` 记录「已声明但还没摆」的部分。
3. **每摆一张给劫营一次机会**：刚摆的那张落地后，若存在**其他座位**已亮出劫营且手中有与**刚摆这张**同色同数的牌 → 开 `interrupt` 窗口（详见 07 号 spec），`parallelPending` 挂着等窗口结算；没有可截者就直接摆下一张。
4. **被截断**：已摆出的牌**留在牌河**（不回手、不重算），`remaining` 里的牌**留在手上**，`parallelPending` 清空，并列者的回合结束（G5：从劫营者的下家继续）。跟牌目标 = 劫营打出的那张牌（07 号 spec 负责设置）。
5. **完整摆完**：按形状设 `activeColor` / `activeFace`（三形状表），清 `parallelPending`，照常结算 U5/UNO/胜负与回合流转。
6. **场上无劫营时**：整个循环在**一次 apply 内**跑完，不开任何窗口、version 只 +1——与原子模型行为完全一致。这是绝大多数对局的路径，别让它变慢或变复杂。

牌桌例（用户原话）：出黄色 6 张并列，摆到某张黄 2 时被劫营者用自己的黄 2 截住 → 从劫营者的下家按**黄 2** 继续；并列剩下没摆的牌回到并列者手里。
- **多张收官**：一次多打把手牌打空 → 获胜，且按 01-U2 **无需喊 UNO**；U5「末牌必须数字牌」天然满足（并列全数字）。打到恰剩 1 张 → 照常 U6（没喊可被抓，可随本次出牌带 `sayUno`）。
- 不占 V7（`stacks_with_turn_limit: false`），不走 activateSkill——直接是 `playCards` 带多张 `cardIds`。
- 惩罚链挂着时（`b.punish`）不可多打（惩罚轮只认 P3-P5 的叠链单张）。`drawnPlayable` 挂着时同样只能打那一张。
- 未亮出并列 → 多张一律 reject（V3）。亮出即常驻（`duration: while_revealed`）。

## 引擎接入

- `play-cards.ts`：拆掉 `cardIds.length !== 1` 的闸门（那行注释就是留给本任务的）。新增形状校验函数（纯函数，输入 cards + 持有者是否亮出并列），非法组合 reject `bad_shape`。resolvePlay 泛化为多张：手牌移除整组、`playedPile` 压整组、按形状定 `activeColor` / `activeFace`。
- `legalActions`：多打组合爆炸，不逐一枚举——只在「持有已亮出并列且存在至少一个合法形状」时追加一条**能力提示动作**是过度设计；**什么都不加**，UI 侧靠多选交互直接提交，服务端校验。`disabledReasons` 不动。
- 机制注册：`play_legality`（README 2d）。无 handler（meta_rule 无发动）。
- 事件：沿用 `cardPlayed`，`public.card` 改为 `public.cards`（数组）+ `chosenColor`。**注意**：web 的 log-panel `humanize` 读 `p.card`，同步改成兼容两者。
- web（最小可玩）：手牌支持多选（点选高亮，出现「打出 N 张」按钮）→ `playCards { cardIds: [...] }`；4 张形状弹既有 ColorSheet。可点性判断不做——非法组合等服务端 reject 后显示 `humanReason`。

## 测试清单（最低）

1. 三种形状各一条 happy path：手牌/牌顶按上表例子摆，打出后堆顶、`activeColor`、`activeFace`、下家跟牌判定全部断言。
2. 6 张后下家跟「最大数」：牌顶蓝，六张蓝 {1,3,9,2,4,5} → 下家黄 9 可打、黄 5 不可。
3. 非法组合各一条：2 张异色同数 / 4 张三同一异 / 6 张五同色一异色 / 混入功能牌 → `bad_shape`；未亮出 → reject；4 张缺 `chosenColor` → `color_required`。
4. 多张收官获胜，`winner` 设置、无需喊 UNO（不会被抓：手牌 0 不满足 U7）。
5. 打到剩 1 张不带 `sayUno` → 可被 `catchUno`。
6. 惩罚链挂着时多张被拒。
7. 单张路径回归：全量既有测试不红。
