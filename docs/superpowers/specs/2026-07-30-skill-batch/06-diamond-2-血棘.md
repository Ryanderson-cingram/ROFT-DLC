# 血棘 ♦2（diamond-2）——链首惩罚封印 / 掷骰放血

先读 `README.md`；用基建 2a（rollDice + 接管流程）。规则出处：01-P8（仅链首发起生效）、01-P9（封印 = 效果全关、解除后原样恢复）、01-P14（含被动、先于摸牌数计算；解除条件）、01-P15（被动触发，不算单体）、04 diamond-2 条目（含 2026-07-30 补齐的①骰数）、06-Q36/Q38/Q41、06-Q54。

## 一句话

被动：你**链首发起**的惩罚被吃下时，吃下者被封印（技能含被动全关），直到你另封新目标或他链首打出 +2/+4。①主动：掷 1 骰令当前被你封印者摸等量。

## 封印（被动）——精确行为

- 触发：惩罚链**结算**（受罚者 accept）时，若 `chain.initiator`（链首）亮着血棘 → 受罚者获得封印。**中间叠牌有血棘无效**（P8——只看链首）。链首是受罚者自己不可能（不会惩罚自己）。
- 时序（P14/Q36）：封印**先于该次摸牌数计算**落地——受罚者的恩惠这一次就已失效（worked example：血棘者打 +2，受罚者亮着恩惠 → 摸 2 不是 1）。实现：punish.ts settle 的 accept 分支里，`drawCards` 之前先 `grantStatus(受罚者, "封印")` + 记账。
- 记账：Board 增 `sealedBy?: (number | null)[]`（谁封的我；null = 没被封）。statuses 的 `"封印"` 仍是压制层读的真相（`suppressionOf` 已认识它），`sealedBy` 只为解除条件服务。两处同进同出。
- 封印含义（P9/P14，多数已由现有 suppression/draw-passives 实现）：主动不能发动（isSuppressed）、被动不生效（draw-passives 的 sealed 检查）、未亮出不能亮（revealSkill 加 isSuppressed 检查——**确认现状**，缺则补）、一次性进度不重置（usedOnce 不动）。
- **解除条件**（P14，先到先解）：
  1. 血棘者又封了新目标 → 旧目标解封（同一血棘至多罩一人）。实现：grant 前扫 `sealedBy`，把 `=== 血棘座位` 的旧目标 removeStatus + 清账。
  2. 被封者**链首打出 +2/+4**（`playCards` 里 face 存在且 `!b.punish`，即开新链）→ **打出即解除**（那条链里他自己的技能已恢复——若他也有 on_play 类技能可触发；本批内：他持强袭不可能，S2 一人一技能，被封者持的是别的技能——解封后他的被动即刻恢复）。实现：play-cards 的 face 分支开头查 `sealedBy[seat] !== null` → 解封。
- 狂欢「单体不能以你为目标」挡不住（P15）——本批狂欢未实现，不写代码，写在测试注释里即可。
- 合纵/连横双封（03 glossary）——这两个技能本批不实现，跳过。
- 事件：`sealed { public: { seat: 受罚者, by: 链首 } }`、`sealLifted { public: { seat, reason: "replaced" | "initiated" } }`。

## ① 掷骰放血——精确行为

- 阶段 1 主动（activateSkill effectKey "1"），占 V7（定义已写 `stacks_with_turn_limit: true`），`once: unlimited`（每回合都可，受 V7 限一条）。
- 前置：场上存在 `sealedBy[x] === 自己` 的玩家；没有 → reject `no_target`（04 补齐：无目标不可发动）。
- 效果：掷 1 骰（0/1/2，走接管流程；resume kind `"bloodthorn-drain"`）→ 被封者 `drawCards({ kind: "skill", base: 点数, seat: 被封者, initiator: 自己 })`。掷 0 = 摸 0（发动与 V7 额度照常消耗）。
- 恩惠交互：被封者的恩惠**已被封**（含被动，Q36）→ 不减。测试要覆盖这个「双重否定」：被封者亮着恩惠，摸的张数 = 骰点原值。
- 事件：`diceRolled { reason: "bloodthorn-drain" }` + drawEvents。

### Worked example

A 亮血棘，链首打 +2 指向 B（亮着恩惠）。B 吃下：先封印 → 恩惠失效 → 摸 2。此后 A 每回合阶段 1 可掷骰放血（B 恩惠仍封着，掷 2 → B 摸 2）。B 链首打出 +4 → 打出瞬间解封，恩惠恢复；这条链之后 A 若再链首惩罚 B，重新封印。期间若 A 惩罚了 C 并被吃下 → C 被封、B 解封。

## 引擎接入

- handler：`HANDLERS["diamond-2"]`（effectKey "1"）。封印赋予/解除不走 handler——它们分别长在 punish.ts settle 与 play-cards.ts 里（被动触发）。
- 机制注册：`status_grant`。
- projectView：封印是公开状态（statuses 数组——**确认快照现状**：SnapshotPlayer 目前不带 statuses，补 `statuses: string[]` 公开字段，UI 才能画「被封印」徽记；03 §4 状态公开）。
- web：玩家条显示「封印」badge（`data-tone="warn"`）；被封者自己的技能卡置灰 + L2 文案「被血棘封印」。

## 测试清单（最低）

1. 链首血棘 + 吃下 → 封印落地且**该次**摸牌恩惠已失效（摸 2 不是 1）（Q36 worked example 原样）。
2. 中间叠牌者有血棘、链首没有 → 不封（P8）。
3. 解除①：血棘者再封 C → B 解封（statuses 与 sealedBy 双清），事件 reason "replaced"。
4. 解除②：被封者链首打出 +2 → 打出即解封（同一 apply 里 statuses 已无封印），reason "initiated"；叠链（非链首）打 +4 → **不**解封。
5. 被封者：主动发动被拒（suppressed）、未亮出不能亮、被动（恩惠）不生效、放血摸牌不被恩惠减。
6. ①无被封目标 → no_target；掷 0 → 摸 0 但 V7 额度已消耗。
7. 快照：statuses 公开可见；封印状态在 projectView 各视角一致。
8. 解封后原样恢复（P9）：恩惠立即重新生效（再来一条无血棘的惩罚链 → 摸牌 −2）。
