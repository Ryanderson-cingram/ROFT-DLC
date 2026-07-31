# 远星 ♦J（diamond-j）——弃牌视为叠链

先读 `README.md`。规则出处：01-P7（视为打出 = 合法叠链接法；摸 2 是代价不计惩罚）、04 diamond-j 条目（+4 用所弃 +2 的颜色）、06-Q34（不占主动——惩罚轮本来就关主动）、06-Q54（付不起代价不能发动）、06-Q55（弃的牌进弃牌堆）。

## 一句话

被惩罚指向时的第三个选项：上家打的是 +2 → 弃一张**同色**停/转；是 +4 → 弃一张 +2（任意色）；然后摸 2 张，视为你也叠了一张 +2/+4，链传给你的下家。

## 精确行为

- 时机：你是 punishStack 窗口的 actor（被惩罚指向）且已亮出远星。这**不是**主动技能发动（不走 activateSkill、不占 V7、不受「惩罚回合关主动」影响——它就是惩罚窗口内的一种响应）。
- 看**链尾那段**（`chain.segments` 最后一项，即上家打进链的那张）：
  - 尾段是 **+2** → 代价：弃一张与该 +2 **同色**的「停」或「转」；视为你打出一张**同色 +2** 进链（段贡献 2）。
  - 尾段是 **+4** → 代价：弃一张 **+2（颜色任意）**；视为你打出一张 **+4** 进链（段贡献 4），**该 +4 的定色 = 你弃的那张 +2 的颜色**（不能另选，04 明文）。
- 代价牌走**弃牌堆**（06-Q55 三堆：`discardPile`，不动出牌堆顶——「视为打出」的牌是虚拟的，**不进 playedPile**；跟牌目标由链的接法规则决定，P4/P5 只看段的 face）。`activeColor`：+4 段按弃牌颜色更新 activeColor（下家若吃完，之后跟色以此为准——与真实打 +4 定色一致）；+2 段 activeColor 更新为该同色。
- 然后**摸 2 张**：`drawCards({ kind: "skill", base: 2, seat: 自己, initiator: 自己 })`——是代价、不是惩罚（P7）：不触发同命，恩惠不减（initiator = 自己，README 2b）。
- 链照常延续：`extendChain(chain, seat, face)`，`openPunishWindow` 指向**你的下家**。
- 付不起（没有合法代价牌）→ 该选项根本不出现在 legalActions；硬发 → reject `cost_unpayable`（06-Q54）。
- `once: unlimited`：链再转回来（多人远星不可能——S2，一人一技能；但同一局同一人可多次用）。

### Worked example

A 打红 +2 指向 B（亮着远星）。B 弃红「停」→ 视为叠红 +2，B 摸 2（代价），链 total 4，窗口指向 C。C 只能按 P4 接 +2/+4 或吃 4。
A 打 +4（定色黄）指向 B。B 弃蓝 +2 → 视为叠 +4 且定色**蓝**，B 摸 2，链 total 8，activeColor 蓝，窗口指向 C；C 按 P5 只能接 +4 或吃 8。

## 引擎接入

- `punish.ts`：punishStack 窗口新增 respond choice `"farstar"`，动作要带 `cardIds: [代价牌]`（respond action 补可选 `cardIds?: string[]`，types.ts 改一处——影歌①的亮牌也用它）。settle 分支：校验亮出远星 + 代价牌合法（颜色/牌面对得上尾段规则）→ 弃入 discardPile → 摸 2 → extendChain → openPunishWindow(下家)。
- `legalActions`：punishStack 窗口 actor 的 choices 里，对每张合法代价牌各给一条 `respond { choice: "farstar", cardIds: [id] }`（多张候选就多条动作——UI 直接渲染成可点的牌）。
- 事件：`farstarUsed { public: { seat, discarded: 代价牌, as: "+2"|"+4", color } }`（弃牌堆全公开）+ drawEvents（摸的 2 张 private）。
- 机制注册：`response`（若强袭还没注册）。无 handler（不走 activateSkill）。
- 04 yaml：已标注（values discard 1 / draws 2）；数值从 params 读。
- web：惩罚窗口的 AlertBar 下，合法代价牌高亮可点（legalActions 驱动，与手牌高亮同机制——cardIds 在 respond 动作里）。

## 测试清单（最低）

1. +2 尾段：弃同色停 → 链 total、下家指向、activeColor、代价牌落 discardPile、playedPile 未动。
2. +4 尾段：弃蓝 +2 → 视为 +4 定蓝；下家只能 +4/吃（P5）。
3. 非法代价：异色停（+2 尾段）/ 弃普通数字牌 → reject；没有合法代价牌时 legalActions 不含 farstar。
4. 摸 2 是代价：受罚者亮着同命（若已实现则测；未实现则测恩惠——**不减**，initiator = 自己）。
5. 链上多段后仍按尾段判断（A +2、B 叠 +4、C 远星 → 按 +4 规则弃 +2）。
6. 未亮出远星 → 窗口 choices 无 farstar。
7. U5 边角：远星弃掉倒数第二张、手牌剩 1 → 照常 U6 可喊/可被抓；弃到 0 张不判胜（01 U5 补充「胜利只判定在出牌」，弃牌不是出牌）——再摸 2 回到 2 张。
