# 劫营 ♦10（diamond-10）——打断出牌

> **2026-07-31 裁定（推翻本 spec 的「只打断多打」前提）**：触发面是**任何人打出的任何一张牌**——
> 单张出牌落地同样开窗口，后果与打断多打逐字相同。KB 以 04 ♦10 / 01-G5 / 03 glossary 为准。
> 实现上单张出牌的中间态是 `Board.playPending`（并列那侧仍是 `parallelPending`），
> 窗口 pass 之后由 `play-cards.ts::settlePlay` 把这次出牌余下的结算跑完。
> 「同色同数」只有数字牌成立，所以功能牌/无色牌（含惩罚链上的叠链牌）不在触发面内。

先读 `README.md`；**依赖 01-heart-4-并列 已落地**、基建 2b（initiator）。规则出处：01-G5（打断当前轮、剩余神化轮作废、被打断者摸 1、打断者不进回合、从打断者下家继续）、03 glossary（可响应并列**任意一张**）、04 diamond-10 条目、06-Q34（占**自己**的主动、一回合只能打断一次、只能截多张中的一张）、06-Q56（被打断者摸的 1 张是他人技能摸牌）。

## 一句话

别人一次打出多张（并列；将来含神化连出）时，你可以打出一张与其中**任意一张**同色同数的牌打断：那张压上牌顶、被打断者摸 1、轮到你的下家。

## 精确行为

- 触发（**2026-07-30 裁定更新**）：并列是「先声明、逐张摆」的（见 01 号 spec 的裁定小节）。**每摆出一张**之后就给一次打断机会，不是等整组摆完。神化连出 G1–G3 本批未实现，接口留好即可。
- 窗口：刚摆的那张落地后，若存在**已亮出劫营**的其他玩家且其手中有与**刚摆这张**同色**且**同数的牌 → 开 `pendingWindow { type: "interrupt", actors: [满足条件的劫营持有者], deadline: 30s, defaultChoice: "pass", resume: "turnStart" }`。**先到先得**（punishStack 语义）。没有满足条件者 → 不开窗口，接着摆下一张。
  - 「可响应并列**任意一张**」（03 glossary）在逐张模型下的含义：劫营者可以选择在任意一张落地时出手——每张都会给他一次机会，他挑哪张就是挑哪张。窗口只针对**刚摆的那张**，所以 `raid` 牌必须与它同色同数。
  - **注意**：窗口挂着时回合尚未移交，并列的 `parallelPending` 也还挂着——pass/超时 → 接着摆 `remaining` 的下一张；打断 → 见下。
- respond `"raid"` + `cardIds: [一张手牌]`：校验该牌与**刚摆那张**（`playedPile[0]`）同色且同数。
  - 结算：打断牌压 playedPile 顶（**跟牌目标变成这张**：`activeColor` = 其色、`activeFace` 清 null——用户原话「从劫营的人的下家按黄 2 继续」）；**并列的剩余牌回手**（清 `parallelPending`，`remaining` 本来就没离手，所以只是清字段）；已摆出的留在牌河；被打断者 `drawCards({ kind: "skill", base: 1, seat: 被打断者, initiator: 打断者 })`——**恩惠可减**（Q56 的原型场景；−2 至少 1 → 仍摸 1）；剩余神化轮作废（本批无神化，落一行注释 + 事件字段留位）；`passTurn` 从**打断者**起算 → 打断者的下家。
  - 打断者 `activatedThisTurn[打断者] = true`（占**自己**的主动，Q34）：passTurn 会把全表清零（那是给新回合的），所以实现上在 passTurn **之后**单独把打断者标回 true。当前没有可观察后果（打断者本轮不再有回合），但 V7 账本要诚实。
  - 「一回合只能打断一次」天然成立：打断即结束这次并列，不会再有下一张。
- respond `"pass"` / 全员放弃 / 超时：正常流转（passTurn 到出牌者下家）。
- 打断者付出的牌就是普通的一张牌（不是技能代价、不摸补偿）。
- 被打断者的多打**不回滚**：已打出的牌留在牌河（G5 打断的是「剩余轮次」与行动权，不是没收已打的牌）。
- 与胜利的交互：多打收官（手牌 0、已 finished）**不可打断**——游戏已结束，不开窗口。多打后恰剩 1 张 → 窗口照开；期间 U6/U7 喊抓照常（uno 动作不被窗口挡）。

### Worked example

4 人 A→B→C→D。牌顶蓝 2。A（亮并列）打出两张黄 2。C 亮着劫营、手有黄 2 → 窗口开（actors=[C]）。C raid 黄 2：黄 2 压顶（跟黄 2），A 摸 1（A 亮着恩惠 → 仍摸 1，min 1），轮到 **D**（C 的下家）——B 这一轮被跳过，这是 G5 的固有后果。C pass → 轮到 B，无事发生。

## 引擎接入

- `play-cards.ts` 多打 resolve 尾部：探测可打断者（其他座位、revealed diamond-10、手牌存在与多打任一张同色同数的牌）→ 开窗口 + 存 `interrupted`。
- respond 分发：punish.ts 现有 dispatch 加 `interrupt` 分支（或抽到独立 interrupt.ts，与 draft.ts 同级——按现有分发风格选后者）。
- `legalActions`：interrupt 窗口 actor → 对每张合法打断牌一条 `respond { choice: "raid", cardIds: [id] }` + 一条 `respond { choice: "pass" }`；非 actor 照常（uno 动作仍拼上）。
- 机制注册：`response`、`turn_flow`（若前序未注册）。无 handler（不走 activateSkill）。
- 事件：`raided { public: { by, target, card, voided: 0 } }`（voided = 作废的神化轮数，本批恒 0）+ drawEvents。
- web：interrupt 窗口 = AlertBar（react 色）+ 手牌高亮可打断的那几张（legalActions cardIds 驱动）+「放弃」按钮；被打断提示进 log（humanize 加 `raided` 分支）。
- 04 yaml 已标注齐，无需改。

## 测试清单（最低）

1. Worked example 全断言：牌顶、A 摸 1、轮到 D、C 的 activatedThisTurn 标记。
2. 恩惠交互：被打断者亮恩惠 → 摸 max(1−2,1)=1（且断言 initiator 路径生效——把恩惠的 −2 临时调大到 −0 之类的数据驱动写法验证走过了 skill+initiator 分支，参照 effects.test.ts 数据驱动组）。
3. 匹配「任意一张」：raid 牌匹配多打的第二张（非顶）也合法；异色同数 / 同色异数 → bad_choice。
4. 单张出牌不开窗口；无劫营在场/未亮出/无匹配手牌不开窗口（版本恰 +1）。
5. pass 与超时：轮到出牌者下家；窗口清、`interrupted` 清。
6. 收官多打不开窗口（finished 直达）。
7. 窗口期间 callUno/catchUno 仍可用（uno.ts 不受窗口挡的既有行为回归）。
8. 打断后 raid 牌成为跟牌目标：下家按其色/数接。
