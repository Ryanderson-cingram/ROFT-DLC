# 全技能目录（4.1）

状态：✅ 框架下可实施骨架清晰 · ❓ 有待裁定疑点 · ⚠️ 与 Excel/Q&A 冲突或笔误  

字段含义见 [02-methodology.md](./02-methodology.md)。原文以 Excel 为准；此处为结构化摘要。

**散文给人读，围栏块给机器读。** 每个花色表格后的「结构化标注」小节里，` ```yaml ` 围栏块按 `id` 与条目配对，携带 `effects[]` / `layer` / `reveal_window` 等机读字段；格式与「省略 vs 显式留空」的区别见 [02 §6](./02-methodology.md#6-结构化标注围栏块04-的机读格式-)。**围栏块不得改变散文的裁定**，冲突时以散文与 [01](./01-decided-rules.md) 为准。

---

## ★ 升级链（开局可抽：宏伟、灾难）

### 宏伟★ — ✅/❓

- **id**：`star-grandeur`
- **类型**：一次性 + 持续监控 + 升级检定  
- **摘要**：摸 1，扣置 1。他人打出相同（色+牌面）时：其摸 1，你亮出弃置扣置。之后**每个**你的回合开始掷 1 骰，直到为 2：翻开判定并替换为宝藏★。  
- **疑点**：惩罚回合开始是否仍掷（无主动技能但仍有回合开始？）；与「挑战/技能二选一」是否并行。

```yaml
id: star-grandeur
upgrade_to: star-treasure
```

### 宝藏★ — ✅

- **id**：`star-treasure`
- **摘要**：翻开判定锁定一支——变色/功能/数字均为**常驻**；毒→替换为古神。变色：跳过并视为 +4 进叠链（你定色）。功能：可反复弃不同色功能→摸等量并指定一人摸等量。数字：可持续双出同色同数，0 当任意数字。

```yaml
id: star-treasure
upgrade_to: god-ricin
```

### 灾难★ — ✅

- **id**：`star-disaster`
- **摘要**：摸 1，扣置 1。他人打出相同牌时亮出弃置扣置；其回合结束：该玩家掷 2、你掷 4；双方获狂欢 buff；对方技能不变；**你的灾难技能移除**（若你骰和≥5 则获得时神技能）。

```yaml
id: star-disaster
upgrade_to: god-fade
```

### 狂欢★ — ✅ buff（非技能牌）

- **id**：`star-carnival`
- **摘要**：按自己的骰和：0 五彩 / 1 恋战 / 2 所有摸牌+1 / 3 惩罚摸牌+1 / 4 被惩罚不摸+单体不能以你为目标 / ≥5 时神（**仅掷4骰方可**）。  
- **注**：不占技能栏（时神除外，时神是技能替换）。

部分标注：只把 [02 §7](./02-methodology.md#7-摸牌数结算层级决策层级-) 点名的三档摸牌修正落到条目上（和2 / 和3 在 L2 加减，和4 在 L4 覆盖）。和0 / 和1 / 和≥5 与和4 的「单体不能以你为目标」尚未标注，故 `structured` 保持 false。

```yaml
id: star-carnival
upgrade_to: god-fade
effects:
  - key: 和2
    kind: passive
    modifies: [draw_count]
    layer: [L2]
  - key: 和3
    kind: passive
    modifies: [draw_count]
    layer: [L2]
  - key: 和4
    kind: passive
    window: on_punish_resolve
    modifies: [draw_count]
    layer: [L4]
```

---

## ♥ 红心

| 点 | 名 | 状态 | 摘要 | 疑点 |
|---|---|---|---|---|
| 1 | 恩惠 | ✅ | 被动：因惩罚或他人技能的摸牌数 -2（至少 1）；叠链时作用在贡献总和上 | — |
| 2 | 迫近 | ❓ | 可明置同色递增 0→9；每明置 9 可接管他人各一次 | 接管是否占被接管者回合；与明示洗牌 |
| 3 | 精英 | ✅ | 被动：数字可当 +1 打出（仅 1 张手牌时失效）；最大 9 | Q&A 已补 |
| 4 | 并列 | ✅ | 主动规则：2 同色同数 / 4 同数 / 6 同色；与神化按「轮」互动已定 | 与劫营响应「任意一张」的牌顶 |
| 5 | 神授 | ✅ | 仅列情形必摸；否则无牌可出可不摸结束；优先于恋战；>10可主动亮出 | — |
| 6 | 近卫 | ✅ | 受 ≥4 惩罚时，每张 +2/+4 可交 1 张手牌给**链首** | — |
| 7 | 极运 | ⚠️ | 拼点默认 +4；亮出牌可口述；掷骰可口述；他人≤3 摸N弃N 你可同时；**可任意时刻亮出** | 口述掷骰与强袭重掷互动 |
| 8 | 异议 | ✅/❓ | ① 上家 +2/+4 时反转并跳过（一次性）；② 打出转获异，受罚弃异少摸；不可强制使用 | ① 是否算响应窗口非阶段1 |
| 9 | 专精 | ✅/❓ | 亮出时底牌定色；该色 +2 无效；当前色为你的色可打任意数字；变色只能选你的色；免疫五彩 | 与古神「变色皆毒」 |
| 10 | 伤逝 | ✅ | 受罚时只按链上 +2/+4 张数掷骰摸牌；忽略贡献总和与吟游等改摸数 | — |
| J | 回溯 | ❓ | 他人变色牌结算完掷 2 骰：0 回收 / 2 你获得 / 4 交任意人 / 1或3 无事 | Q&A 已有限制；与毒/洗牌 |
| Q | 偏折 | ⚠️ | 即使未亮出也不用喊 UNO（质疑时可亮出）；亮出后不能被问手牌数等 | 与 V1 例外；「抽取你手牌」类技能列表 |
| K | 阳谋 | ❓ | 在任意玩家前横向扣置 +2/停/转，你摸 1；其回合开始翻开，可弃相同牌面否则结算 | 「任意玩家」是否非己方回合放置=响应 |

### 结构化标注（♥）

恩惠：`−2` 落 L2、自带的「至少 1」落 L5，两层都由 [02 §7](./02-methodology.md#7-摸牌数结算层级决策层级-) 点名；「叠链时作用在贡献总和上」是 01-P11，不是额外一层。

```yaml
id: heart-1
structured: true
effects:
  - key: passive
    kind: passive
    window: any
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [draw_count]
    duration: while_revealed
    layer: [L2, L5]
```

精英改的是**牌面点数**（03 Q&A：最大为 9，下家按牌面数字继续），不是摸牌数，因此没有 `layer`。

```yaml
id: heart-3
structured: true
effects:
  - key: passive
    kind: passive
    window: play_phase
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [card_value]
    duration: while_revealed
```

并列改的是「一次合法打出几张」（01-G2），发生在阶段 2；摘要写的是「主动规则」，**是否占用 01-V7 的每回合一条主动没有裁定过**，`stacks_with_turn_limit` 故意留空等裁定。

```yaml
id: heart-4
structured: true
effects:
  - key: 1
    kind: meta_rule
    window: play_phase
    targeting: self
    once: unlimited
    stacks_with_turn_limit:
    modifies: [play_legality]
    duration: while_revealed
```

以下是**部分标注**（只把已定条款落到条目上，其余子效果尚未标注，`structured` 保持 false）。

极运「可任意时刻亮出」是 01-V2 白名单例外：

```yaml
id: heart-7
reveal_window: any_time
```

异议②「弃异每张 −1」在 02 §7 的 L2；「不可强制使用」按 01-F3 = 仍可强制亮出、不能强制发动：

```yaml
id: heart-8
force_activate_ok: false
effects:
  - key: 2
    kind: passive
    window: on_punish_resolve
    targeting: self
    modifies: [draw_count]
    layer: [L2]
```

伤逝在 02 §7 的 L1 替换层：整体改写计算，命中即得最终值（01-P13：忽略贡献总和与吟游等一切改摸数）：

```yaml
id: heart-10
effects:
  - key: passive
    kind: replacement
    window: on_punish_resolve
    targeting: self
    modifies: [draw_count]
    layer: [L1]
```

偏折「质疑时可亮出」是 01-V2 白名单例外（喊 UNO 的时机本身未定，见 06-Q26）：

```yaml
id: heart-q
reveal_window: when_challenged_uno
```

---

## ♦ 方片

| 点 | 名 | 状态 | 摘要 | 疑点 |
|---|---|---|---|---|
| 1 | 强袭 | ✅/❓ | 打出 +2/+4 后可掷骰改该张倍率；任意玩家掷骰后可重掷同数量一次并采用你的结果 | 重掷是否每骰事件一次；与邪神联动 |
| 2 | 血棘 | ✅ | 你**发起**的惩罚使目标封印技能直至条件；回合开始可掷骰令被血棘者摸等量；优先；未亮出也被封则不能亮出；合纵连横双封 | 链首已定 |
| 3 | 影歌 | ✅ | ① 一次性阶段1攒魂（**上限 6**）；② 花2魂跳过（可惩罚回合），占主动条 | — |
| 4 | 攻心 | ❓ | 每名玩家限一次展示比牌摸 1/2/3；累计摸满人数获神化 | 「首次累计」计数跨谁 |
| 5 | 毒池 | ❓ | 他人打毒额外摸你已明置毒数；你打毒不摸且他人各摸 3；实体毒明置 | 与古神、同命序 |
| 6 | 夜魇 | ❓ | ① 一次性明置数字（非最后一张）；② 每回合开始翻牌与明置判定；不可强制使用 | 判定 ⑶ 摸牌上下限 |
| 7 | 天堂 | ❓ | 无恋战时与人拼点：胜则对方摸牌+1并恋战直到打出 +4；负则你恋战直到打出 +2/+4 | 状态互斥时拼点结果 |
| 8 | 日月 | ❓ | 限制人数次：交手牌给他人，其分成两叠你取一叠 | 空手/1 张边界 |
| 9 | 寄生 | ⚠️ | 人数次：他人喊 UNO 时令其五彩或心盲+摸牌+1；你回合开始掷 2 骰和 0/1 则清除；**可任意时刻亮出** | 与状态互斥 |
| 10 | 劫营 | ✅ | 同色同数同时打出；对方摸 1；你下家继续；可打断并列/神化；剩余神化轮作废 | 已定 |
| J | 远星 | ✅ | 上家 +2 时弃同色停/转、上家 +4 时弃 +2，各摸 2 视为叠链 +2/+4；**视为的 +4 用所弃 +2 的颜色**（非任选定色） | 已定 |
| Q | 不意 | ❓ | 一次性与所有人拼点，弃置所有手牌再重发；负方掷骰摸牌；额外摸≥人数则你再获一次使用 | 「再获一次」存哪里 |
| K | 觐见 | ❓ | 明示一张不合法牌，选无明示者令其明示一半（下取整最多 4） | 与偏折「不能明示」冲突时 |

### 结构化标注（♦）

强袭①改的是自己那张惩罚牌的倍率，按 01-P6 在**进链时**结算，02 §7 明确这类修正已计入 L0 贡献、不再走层级，故无 `layer`。②「重掷一次」的计次范围正是本条疑点（每骰事件一次？每回合一次？），`once` 留空；02 §3 也没有掷骰窗口，暂记 `any`。

```yaml
id: diamond-1
structured: true
effects:
  - key: 1
    kind: on_play
    window: on_stack_contribute
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [punish_amount, dice]
    duration: instant
  - key: 2
    kind: response
    window: any
    targeting: global
    once:
    stacks_with_turn_limit:
    modifies: [dice]
    duration: instant
```

血棘：封印按 01-P8 只在有血棘者是**链首发起**的 +2/+4 时成立，落点是被惩罚者，故 `targeting: single`（不是玩家指定，§4 的「单体」判定另说，见 02 §6）。摘要写「直至条件」但没写是什么条件，`duration` 留空等裁定。「优先」（02 §1 `priority`）挂在封印上。

```yaml
id: diamond-2
structured: true
effects:
  - key: passive
    kind: status_grant
    window: on_punish_resolve
    targeting: single
    once: unlimited
    stacks_with_turn_limit: false
    priority: true
    duration:
  - key: 1
    kind: active
    window: turn_start
    targeting: all_others
    once: unlimited
    stacks_with_turn_limit: true
    duration: instant
```

影歌照 01-S15：①一次性攒魂（上限 6）、②花 2 魂跳过且**占主动条**。两条都是阶段 1 主动 → 01-V7 每回合只能选发动一条。②「可在惩罚回合发动」是 02 §2 压制的例外，字段模型里没有承载它的栏位，只在散文里。

```yaml
id: diamond-3
structured: true
effects:
  - key: 1
    kind: active
    window: turn_start
    targeting: self
    once: once
    stacks_with_turn_limit: true
    duration: instant
  - key: 2
    kind: active
    window: turn_start
    cost: 2 魂
    targeting: self
    once: unlimited
    stacks_with_turn_limit: true
    modifies: [turn_flow]
    duration: instant
```

劫营按 01-G5 打断当前轮、作废剩余神化轮。「对方摸 1」是本效果**造成**的摸牌，不是改摸牌数，无 `layer`。02 §2 说 `response` 的次数「按技能」，而 04/01 都没写劫营响应算不算占主动条，`stacks_with_turn_limit` 留空。

```yaml
id: diamond-10
structured: true
effects:
  - key: 1
    kind: response
    window: interrupt
    targeting: single
    once: unlimited
    stacks_with_turn_limit:
    modifies: [turn_flow]
    duration: instant
```

远星按 01-P7 是**合法叠链接法**，摸的 2 张是代价、不计惩罚，所以既不是改摸牌数也无 `layer`；「视为的 +4 用所弃 +2 的颜色」是改颜色规则。`stacks_with_turn_limit` 同劫营留空。

```yaml
id: diamond-j
structured: true
effects:
  - key: 1
    kind: response
    window: interrupt
    cost: 弃 1 张 + 摸 2
    targeting: self
    once: unlimited
    stacks_with_turn_limit:
    modifies: [play_legality, color_rule]
    duration: instant
```

以下是**部分标注**。夜魇「不可强制使用」同异议，按 01-F3：

```yaml
id: diamond-6
force_activate_ok: false
```

寄生「可任意时刻亮出」是 01-V2 白名单例外；令目标「摸牌+1」在 02 §7 的 L2：

```yaml
id: diamond-9
reveal_window: any_time
effects:
  - key: 1
    kind: status_grant
    targeting: single
    once: per_player_count
    modifies: [draw_count]
    layer: [L2]
```

---

## ♠ 黑桃

| 点 | 名 | 状态 | 摘要 | 疑点 |
|---|---|---|---|---|
| 1 | 恒心 | ✅ | 主动：弃 1 摸 1 | — |
| 2 | 先哲 | ✅/❓ | ① 摸 2 弃 2 并强制他人亮出+可用则强制发动；② 洗牌时指定一人不参与 | 强制规则已定；① 是否 on_reveal |
| 3 | 福赐 | ❓ | 每名玩家限一次：摸 3 交 2，其定色数；一次性：对所有人都发动过且手牌>人数则每人交 1 但本回合不能出牌 | 「不能出牌」与阶段 |
| 4 | 契约 | ⚠️ | 被停时可摸 3 弃 3；可在被跳过时亮出 | 例外亮出已收白名单 |
| 5 | 合纵 | ✅ | 亮出时连横须立刻响应；相应则换牌+之后回合开始可换；无响应则**每张**功能牌后摸2弃2 | — |
| 6 | 连横 | ✅ | 对称；无响应则每张功能后摸1弃1，若上回合也打出功能则该次摸3弃3 | — |
| 7 | 窃贼 | ❓ | 拼点：胜则取对方半数手牌（上取整最多 5）再还同数；负摸 1 | — |
| 8 | 八门 | ✅/❓ | 一次性摸 8 弃 8（不受其他技能）；回合结束获五彩且所有摸牌+1 | 「不受其他」范围 |
| 9 | 黑白 | ❓ | ① 摸 3 扣 3；② 用扣置换判定/拼点；③ 与所有人拼点，负方亮手牌并掷骰解除 | — |
| 10 | 毒师 | ❓ | 打毒选两人同命；打毒不摸；可摸 2 弃当前色功能视为毒；最多两名同命 | 与毒池/古神 |
| J | 忍戒 | ✅ | 受罚时多摸一倍再弃多摸数（最多多摸 6）；结算层级属 L6 后置程序（02 §7） | ✅ 与伤逝无冲突：S2 一人一技能，二者不可能同在一名受罚者身上 |
| Q | 心火 | ❓ | 回合开始三选一：明示全部 / 弃明示最多人数张并摸等量 / 强制亮出并强制使用某人技能后移除心火 | 强制规则已定 |
| K | 染手 | ❓ | 无牌摸时多摸 2 弃 2；受罚可从弃牌堆选但惩罚+1；一次性打乱弃牌堆正面放旁边优先抽 | Q&A 牌河洗牌 |

### 结构化标注（♠）

恒心自己摸的那 1 张是效果本身、不是「改摸牌数」，所以不带 `layer`（02 §6）。

```yaml
id: spade-1
structured: true
effects:
  - key: 1
    kind: active
    window: turn_start
    cost: 弃 1 张手牌
    targeting: self
    once: unlimited
    stacks_with_turn_limit: true
    duration: instant
```

以下是**部分标注**。契约「可在被跳过时亮出」是 01-V2 白名单例外：

```yaml
id: spade-4
reveal_window: when_skipped
```

八门②「回合结束获五彩且所有摸牌+1」在 02 §7 的 L2；①的「不受其他技能」范围仍是本条疑点，未标注：

```yaml
id: spade-8
effects:
  - key: 2
    kind: passive
    modifies: [draw_count]
    layer: [L2]
```

忍戒在 02 §7 的 L6 后置程序——**不改数字，只改执行方式**（按最终值 N 多摸 min(N,6) 再弃等量），所以 `modifies` 用 `draw_procedure` 而不是 `draw_count`：

```yaml
id: spade-j
effects:
  - key: passive
    kind: passive
    window: on_punish_resolve
    targeting: self
    modifies: [draw_procedure]
    layer: [L6]
```

---

## ♣ 梅花

| 点 | 名 | 状态 | 摘要 | 疑点 |
|---|---|---|---|---|
| 1 | 统御 | ❓ | 打出变色牌扣置；可弃一张扣置视为当前色转或停 | 窗口=阶段1还是 after_play |
| 2 | 明暗 | ❓ | ① 摸手牌倍数量并扣置人数张（至少留 1）；② 回合开始可用扣置换手牌（仅 1 张手牌不能） | — |
| 3 | 司夜 | ✅ | 打出变色后**掷骰一次获点数个盗（0/1/2）**；阶段1花盗换牌；3/5盗放宽末牌为功能/变色，仍须合法打出 | — |
| 4 | 辉耀 | ❓ | 限制人数次：亮出人数张顶牌，他人按序各取 1；已亮出则洗牌时你可不参与 | — |
| 5 | 吟游 | ✅ | 上家非+2/+4时可选歌声；选/切换占主动条；亮出时无歌声 | — |
| 6 | 伪神 | ✅ | 摸 1 明置；重复色弃置按张数奖励；算神（黄昏/互挑）；陨满不算神但效果保留 | — |
| 7 | 通牌 | ❓ | 所有人扣置 1，你选择交给各自上家或下家 | — |
| 8 | 万变 | ✅ | 掷2骰获形=占主动；达10强制换技能并归零；排除宏伟/灾难/宝藏/狂欢/预兆/飞升及四神；♣8 | — |
| 9 | 预兆 | ❓ | 开局亮出掷 2 定预兆；之后匹配两次：开预兆 / 化身邪神 | 与开局发技能顺序 |
| 10 | 终结 | ❓ | 获领域；仅 1 张手牌时失去领域，下次摸牌获扣置牌+明示+神化；无明示手牌则失去该神化 | 领域与摸牌定义 |
| J | 无念 | ❓ | 回合开始掷 2 记总和（0 清空）；一次性摸总和，每 5 张一神化 | — |
| Q | 降临 | ❓ | 摸 2 展示，同色则视为洗牌且人人神化；每次成功后需额外多摸 1 | 与真洗牌牌、神化上限 |
| K | 飞升 | ✅ | 每回合开始获神化；出完续玩→主神；神官优先级+下家方向最近；神官胜主神同胜 | — |

### 结构化标注（♣）

司夜三条：①获盗按 01-T2 在**阶段 3**；②花盗换牌要等到下次**阶段 1**（同 T2），占主动条；③3/5 盗放宽末牌是 01-U5 的例外（01-S16），发生在出牌时。02 §2 没给 `meta_rule` 的占位默认，③ 的 `stacks_with_turn_limit` 留空。

```yaml
id: club-3
structured: true
effects:
  - key: 1
    kind: on_play
    window: after_play
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [dice]
    duration: instant
  - key: 2
    kind: active
    window: turn_start
    cost: 盗
    targeting: self
    once: unlimited
    stacks_with_turn_limit: true
    duration: instant
  - key: 3
    kind: meta_rule
    window: play_phase
    cost: 3 或 5 盗
    targeting: self
    once: unlimited
    stacks_with_turn_limit:
    modifies: [play_legality]
    duration: instant
```

以下是**部分标注**。吟游：选/切换歌声占主动条（01-S20）；三支被 02 §7 点名的歌声各有层级（活泼板 +1 在 L2、战争序 ×2 在 L3、樱时雨恒为 1 在 L4）。歌声全表不在 04 里，故只标注这三支：

```yaml
id: club-5
effects:
  - key: 1
    kind: active
    window: turn_start
    targeting: self
    stacks_with_turn_limit: true
  - key: 活泼板
    kind: passive
    modifies: [draw_count]
    layer: [L2]
  - key: 战争序
    kind: passive
    modifies: [draw_count]
    layer: [L3]
  - key: 樱时雨
    kind: passive
    modifies: [draw_count]
    layer: [L4]
```

预兆与飞升的升级目标（02 §5 的升级链）：

```yaml
id: club-9
upgrade_to: god-omorph
```

```yaml
id: club-k
upgrade_to: god-tindra
```

---

## 神 四神

替换原技能后生效（01-S3）。条文照搬 [05-gods-omens-deck.md §1](./05-gods-omens-deck.md)，此处只补条目与 id。四神不进开局池、不进万变池（01-S5 / S18b）。

### ※古神 Ricin — ✅

- **id**：`god-ricin`
- **摘要**：1. 所有玩家的变色牌皆视为「毒」。2. 你打出「毒」时改为其他所有玩家分别打出此「毒」。3. 若有毒池♦5：你每次打出毒时将此毒明置在其明置区；毒池胜利时你同时胜利。  
- **疑点**：专精♥9 / 毒池♦5 / 毒师♠10 的疑点栏均挂着与古神的互动。

### ✣邪神 Omorph — ✅

- **id**：`god-omorph`
- **摘要**：1. 回合开始可掷骰一次，获点数枚「颠」（可当作异/盗/魂/形）。2. 获得任意标记时额外 +1（陨除外）。3. 若有强袭♦1：可控制其是否帮你改掷骰；强袭改为可重掷两次并任选结果；强袭胜利时你同时胜利。

### ❂时神 Fade — ❓

- **id**：`god-fade`
- **摘要**：成神时按掷骰点数解锁能力（≥5 / ≥6 / ≥7 / =8）；失去神技能时获得灾难★。  
- **疑点**：05 §1 只写了四档门槛，**四档各自解锁什么能力没有落进任何文档**；01-S6 只说失神后按 Excel 例。

### ⌘主神 Tindra — ✅

- **id**：`god-tindra`
- **摘要**：1. 所有玩家最多 3 枚神化（**仅主神在场时**，见 01-G4）。2. 你回合开始：神官将一张牌放牌堆顶；你观看玩家人数张顶牌，排序并交一张给神官。3. 可将观看的全部交给神官；每如此做两次，神官获一枚神化。4. 神官指定：降临 > 无念 > 终结 > 手牌最多，取**行动顺序下家方向最近**者；神官达成胜利条件时主神同时胜利。  
- **注**：Q&A 写「θ主神」，表内为「⌘主神」——文档统一用 ⌘主神（06-Q19）。

---

## 统计（粗算）

- 技能条目：4★ + 52 点位 + 4 神 = 60（含升级态则更多形态）  
- 框架已定、可写测试骨架：恒心、精英、并列、劫营、远星、血棘（核心）、强制使用相关  
- 高疑点集中：★链、合纵连横、神授、成神四神、预兆、毒体系  

下一问从 [06-open-questions.md](./06-open-questions.md) **Q1** 开始。
