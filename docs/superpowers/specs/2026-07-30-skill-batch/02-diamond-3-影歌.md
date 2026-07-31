# 影歌 ♦3（diamond-3）——攒魂 / 花魂跳过

先读 `README.md`；需要基建 2b（DrawRequest.initiator）、2c（suppression_exempt）。规则出处：01-S15、04 diamond-3 条目（含 2026-07-30 补齐的①三选一流程）、06-Q10、06-Q39（②惩罚回合可用）、06-Q54（付不起代价不能发动）。

## 一句话

①（一次性）：其他玩家依次「亮牌或摸牌」三选一，你按本轮实际摸牌总数攒魂（上限 6）。②：花 2 魂跳过自己的回合，惩罚回合也能用。

## ① 攒魂——精确行为

阶段 1 主动发动（`activateSkill { effectKey: "1" }`），`once: once` = **整局一次**（次数账要新加：Board 需要记「一次性效果已用」，加 `usedOnce: Record<string, true>[]` 按座位存 effectKey 集合；activateSkill 脊梁在 effect.once === "once" 时查它并在成功后记账）。

发动时**必须指定一张比对牌（色 + 数）**：`activateSkill` 动作扩一个可选载荷 `declared?: { color: Color; face: Face }`（仅影歌①要求；缺 → reject `declaration_required`）。限**数字牌**（face ∈ "0"–"9"，color ∈ RGBY；其他 → reject `bad_declaration`）。**不要求发动者手里有这张牌**（2026-07-30 更正——例：A 手无蓝 2，仍可指定「蓝 2」）。指定内容进 public 事件（当众宣言）。

随后进入一个**依次响应**的窗口（新 pendingWindow type `"soulHarvest"`，语义 = skillDraft 的收集变体，但 **一次只有一个 actor**，按行动顺序轮转）。窗口上下文要携带 declared（放 Board 临时字段或窗口旁挂，结算后清）：

- 响应顺序：自发动者的下家起，按当前 `direction` 轮一圈（不含发动者）。
- 每个响应者以 **declared 指定牌** 为比对对象三选一（`respond(windowId, choice, cardIds?)`）：
  1. `"show-exact"` + cardIds[1]：亮出（**展示，不离手**）一张与指定牌同色**且**同数的牌 → 不摸。
  2. `"show-partial"` + cardIds[1]：亮出一张与指定牌同色**或**同数的牌 → 摸 1 张。
  3. `"draw3"`：摸 3 张。
- 服务端校验亮出的牌真的满足对应匹配，不满足 → reject `bad_choice`（局面不动，可重选）。**不强制**玩家选得最优：手里有完美匹配也可以选摸 3。
- 摸牌全部走 `drawCards({ kind: "skill", base, seat: 响应者, initiator: 发动者 })` → 响应者若亮着恩惠可减（−2 至少 1：摸 3 → 摸 1；摸 1 → 摸 1）。
- 一圈结束：发动者 `gainMarks(b, seat, "魂", 本轮实际摸到的总张数, 6)`——按**实际摸到**计（含恩惠减免后、含牌堆摸空摸不足，06-Q46 口径）。上限 6 由 `gainMarks` 的 cap 参数承担。
- 超时：窗口带 deadline（30s/人，每轮转 actor 重置 deadline——窗口对象在每次 respond 后重建，deadline 顺延），`defaultChoice: "draw3"`；claimTimeout 只结**当前** actor，然后轮到下一个。
- 事件：`soulHarvestStarted { public: { seat, declared } }`（宣言公开）；每个响应 `soulHarvestResponse`——亮出 = 展示给所有人，所以亮的那张进 **public**（`{ seat, choice, card }`）；摸的牌照常走 drawEvents（private 给摸牌者）。结束 `soulHarvestEnded { public: { seat, souls } }`。
- V7：①占主动额度（`stacks_with_turn_limit: true`，定义已写）。

### Worked example

3 人局，A 持影歌发动并指定「蓝 2」（A 手里没有蓝 2，合法）。B 亮蓝 2（同色且同数）→ 不摸；C 亮蓝 7（同色）→ 摸 1；假如 C 亮的是黄 2（同数）也合法。C 摸 1 实际到手 1 → A 获 1 魂。若 B 选 draw3 且 B 亮着恩惠 → B 摸 max(3−2,1)=1，A 共获 2 魂。牌顶是什么与本流程完全无关。

## ② 花魂跳过——精确行为

- `activateSkill { effectKey: "2" }`，代价 `spendMarks(b, seat, "魂", 2)`——不足 2 魂 → reject `cost_unpayable`（06-Q54，机会不消耗）。数值 2 从定义 `values.marks` 读（已标注）。
- 效果：**跳过自己的本回合** → `passTurn` 到下家，phase `turnStart`。占 V7 额度（定义已写；跳过回合所以实际无冲突，01-S15）。
- **惩罚回合可用**（S15 / 06-Q39）：`suppression_exempt: [punish_turn]` 已在定义里；走 README 2c 的脊梁改造。语义：被 +2/+4 指向、punishStack 窗口挂着时，受罚者可以不叠不吃、花 2 魂跳过——**跳过 = 本回合结束**，但惩罚链**不消失**，顺延给下一家（=你的下家成为新的受罚者，窗口重开、actors 换人）。这是 06-Q10 裁定的「花魂跳过且占主动条」在惩罚语境的展开：链在场上继续滚。
  - 实现：punishStack 窗口的 `legalActions` 里，受罚者若亮着影歌且 ≥2 魂，多一个 `respond choice: "soul-skip"`；结算 = 扣 2 魂 + 链不动 + `openPunishWindow` 指向下家。
- 普通回合（无惩罚）用②：阶段 1 直接发动，跳过出牌。

## 引擎接入

- handler：`HANDLERS["diamond-3"]`，按 effectKey 分派。①开窗口；②普通回合路径。惩罚回合的②走 punish.ts 的 respond 分支（如上）。
- 新窗口类型 `soulHarvest` 进 respond/claimTimeout 的分发（punish.ts 现有 dispatch 处）。
- `usedOnce` 次数账：脊梁层实现（对所有 `once: "once"` 效果通用，别写成影歌专属）。
- 机制注册：`turn_flow`。
- web：发动①先弹「指定一张牌」面板（四色 × 0–9，ColorSheet 的扩展版），声明随 activateSkill 提交；响应窗口给三个选项按钮，亮牌选项点手牌提交 cardIds（legalActions 驱动可亮的牌——engine 在 legalActions 里对匹配手牌逐张给 show-exact/show-partial 的 respond 动作）。

## 测试清单（最低）

1. ①三选一各一条 + 校验失败（亮的牌与**指定牌**不匹配 → bad_choice、局面不动）；比对与牌顶无关（摆一个牌顶 ≠ 指定牌的局面验证）。
1b. 声明校验：缺 declared → declaration_required；声明功能牌/无色 → bad_declaration；**发动者手中无该牌也合法**。
2. 恩惠交互：draw3 遇恩惠 → 摸 1，魂按 1 计（基建 2b 的 initiator 生效）。
3. 魂上限：两人各 draw3 共 6+，gainMarks cap → 恰 6。
4. `once: once`：第二次发动① → reject；跨回合仍拒。
5. ②：2 魂跳过，回合到下家；1 魂 → cost_unpayable 且额度未消耗。
6. ②惩罚回合：链 total 保持、窗口转移到下家、影歌者没摸牌、魂 −2。
7. 无魂概念泄露：其他座位快照看得到 marks 数（03 §5 标记公开——确认 projectView 现状，若快照还没带 marks，补 `players[].marks` 公开字段并测试）。
8. 超时：当前 actor 被 claimTimeout 按 draw3 结算，轮到下一个 actor 而不是整窗关闭。
