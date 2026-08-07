# 全技能目录（4.1）

状态：✅ 框架下可实施骨架清晰 · ❓ 有待裁定疑点 · ⚠️ 与 Excel/Q&A 冲突或笔误 · **✅/❓ 复合值** = 骨架已定但疑点栏里仍挂着未决问题  

「疑点」栏只装**未决问题**；已经拍板的结论走围栏块的 `notes`（02 §1），不要混在疑点里。分类（如狂欢★ 的「buff（非技能牌）」）走围栏块的 `category`，不写进状态栏。

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
- **摘要**：摸 1，扣置 1。他人打出相同牌时亮出弃置扣置；其回合结束：该玩家掷 2、你掷 4，**双方各按自己骰子的总和**查狂欢表获得 buff（各算各的，不相加，2026-07-30 更正）；对方技能不变；**你的灾难技能移除**（若你的 4 骰总和 ≥5 则获得时神技能）。

```yaml
id: star-disaster
upgrade_to: god-fade
```

### 狂欢★ — ✅

- **id**：`star-carnival`
- **摘要**：按 S9 **各自骰子的总和**（对方 2 骰 0–4，灾难方 4 骰 0–8）查表：0 五彩 / 1 恋战 / 2 所有摸牌+1 / 3 惩罚摸牌+1 / 4 被惩罚不摸+单体不能以你为目标 / ≥5 时神（仅灾难方可达）。**双方各按自己总和获得**（2026-07-30 更正）。  
- **注**：不占技能栏（时神除外，时神是技能替换）。

部分标注：只把 [02 §7](./02-methodology.md#7-摸牌数结算层级决策层级-) 点名的三档摸牌修正落到条目上（和2 / 和3 在 L2 加减，和4 在 L4 覆盖）。和0 / 和1 / 和≥5 与和4 的「单体不能以你为目标」尚未标注，故 `structured` 保持 false。

```yaml
id: star-carnival
category: buff（非技能牌）
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
| 3 | 精英 | ✅ | **主动**：出牌时可选择把一张数字牌当作大 1 点打出（仅 1 张手牌时失效）；最大 9；下家按牌面数字继续；占 V7 的每回合一条主动 | — |
| 4 | 并列 | ✅ | 主动规则：2 同色同数 / 4 同数 / 6 同色；与神化按「轮」互动已定 | 与劫营响应「任意一张」的牌顶 |
| 5 | 神授 | ✅ | 仅列情形必摸；否则无牌可出可不摸结束；优先于恋战；>10可主动亮出 | — |
| 6 | 近卫 | ✅ | 受 ≥4 惩罚时，每张 +2/+4 可交 1 张手牌给**链首** | — |
| 7 | 极运 | ⚠️ | 拼点默认 +4；亮出牌可口述；掷骰可口述；他人≤3 摸N弃N 你可同时；**可任意时刻亮出** | — |
| 8 | 异议 | ✅ | ① 上家 +2/+4 时反转并跳过（整局一次，链**反弹给上家**）；② 打出转获异，受罚**可选**弃异每枚少摸 1；不可强制使用 | — |
| 9 | 专精 | ✅/❓ | 亮出时底牌定色；该色 +2 **打得出但你不摸**（2026-08-02，原 06-Q67；混色链的边界见 Q68）；当前色为你的色可打任意数字；变色只能选你的色；免疫五彩 | 与古神「变色皆毒」 |
| 10 | 伤逝 | ✅ | 受罚时只按链上 +2/+4 张数掷骰摸牌；忽略贡献总和与吟游等改摸数 | — |
| J | 回溯 | ❓ | 他人变色牌结算完掷 2 骰：0 回收 / 2 你获得 / 4 交任意人 / 1或3 无事 | Q&A 已有限制；与毒/洗牌 |
| Q | 偏折 | ⚠️ | 即使未亮出也不用喊 UNO（质疑时可亮出）；亮出后不能被问手牌数等 | 与 V1 例外；「抽取你手牌」类技能列表 |
| K | 阳谋 | ❓ | 在任意玩家前横向扣置 +2/停/转，你摸 1；其回合开始翻开，可弃相同牌面否则结算 | 「任意玩家」是否非己方回合放置=响应 |

### 结构化标注（♥）

恩惠：`−2` 落 L2、自带的「至少 1」落 L5，两层都由 [02 §7](./02-methodology.md#7-摸牌数结算层级决策层级-) 点名；「叠链时作用在贡献总和上」是 01-P11，不是额外一层。「他人技能」已裁定 = **发起者不是自己**的技能（06-Q56），所以 `applies_to` 写的是 `skill_others` 而不是 `skill`——那条限定是**恩惠自己的卡面文字**，不是所有摸牌修正的通则（活泼板的「所有摸牌 +1」就不分你我）。

```yaml
id: heart-1
structured: true
effects:
  - key: passive
    kind: passive
    window: on_draw
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    values: { L2: -2, L5: 1 }
    applies_to: [punish, skill_others]
    modifies: [draw_count]
    duration: while_revealed
    layer: [L2, L5]
```

精英改的是**牌面点数**（03 Q&A：最大为 9，下家按牌面数字继续），不是摸牌数，因此没有 `layer`。

**2026-07-29 裁定（原 Q45 / Q28）**：精英是**主动**——用不用由玩家在出牌时自己选，不是自动生效。
例：牌顶红 4，手里只有蓝 3，可以把蓝 3 当作蓝 4 打出；**牌顶按牌面记作蓝 3**，下家跟蓝 3。
只对**数字牌**有效，惩罚牌不是数字牌，不给惩罚加点数（02 §7 的「精英+1」是笔误，已删）。
**占** 01-V7 的每回合一条主动：S2 一人一技能，持有者除了「用或不用精英」没有第二条主动可选，
占不占在牌桌上几乎看不出差别，**但逻辑上就是占**，照实标。
唯一看得出差别的场合：持有者同时有**神化**（一回合出多张）时，一回合只能给其中一张加点数。

```yaml
id: heart-3
notes: Q&A 已补
structured: true
effects:
  - key: 1
    kind: meta_rule
    window: play_phase
    targeting: self
    once: unlimited
    stacks_with_turn_limit: true
    values: { card_value: 1, max: 9 }
    modifies: [card_value]
    duration: while_revealed
```

并列改的是「一次合法打出几张」（01-G2），发生在阶段 2。

**2026-07-29 裁定（原 Q35）**：并列是**改出牌规则**，不是阶段 1 声明的主动技能——阶段 1 什么都不做，
直接在出牌阶段一次打出 2 张同色同数即合法，**不占 01-V7 的每回合一条主动**。04 摘要里的「主动规则」
指的是玩家自己选择这么打，不是 T1 意义上的「阶段 1 发动」。

**2026-07-30 补齐（三种形状的完整语义，规则制定人确认）**：三种合法多打，首张都必须按常规接得上牌顶：

1. **2 张，彼此同色同数**（如两张黄 2）——可凭「同数」接上任意色的 2；打完后跟**这两张的颜色**继续（例：牌顶蓝 2 → 打两张黄 2 → 下家跟黄 2）
2. **4 张同数、颜色任意**（如四色的 2 各一张）——打完后**打出者选一个颜色**继续（同变色的 chosenColor 机制）
3. **6 张同色、数字任意**（如六张蓝色数字牌）——打完后按**其中最大的数字**继续（颜色即该同色）

数字牌语境（功能牌不参与并列多打，G3 的「只有最后一张能是功能牌」是神化连出的规则，与并列的一次多打是两回事）。

```yaml
id: heart-4
structured: true
effects:
  - key: 1
    kind: meta_rule
    window: play_phase
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [play_legality]
    duration: while_revealed
```

以下是**部分标注**（只把已定条款落到条目上，其余子效果尚未标注，`structured` 保持 false）。

极运「可任意时刻亮出」是 01-V2 白名单例外：

**2026-07-31 裁定（极运 × 强袭，原疑点关闭）**：两者**可以同时触发，强袭覆盖极运**。
极运的「口述掷骰」= **视为掷出**了那个点数（不是「不掷骰」），因此它照样是一次掷骰事件，
会照常开强袭②的接管窗口；强袭者重掷后**采用强袭的结果**，口述的点数被覆盖。
引擎实现：极运的口述走与 `rollDice` 同一个出口（`rollWithTakeover`），只是初始 `values` 由玩家指定而非随机。

```yaml
id: heart-7
reveal_window: any_time
```

专精♥9 的四条都挂在**已有的单一判定点**上，一条新判定都没建（06-Q67/Q68 已裁定）：

| 卡面 | 落点 | 说明 |
|---|---|---|
| 亮出时**底牌定色** | 亮出钩子 + `Board.chosen` | 与吟游的歌声共用那个槽：吟游是玩家选的，专精是亮出时**定死**的 |
| 该色 +2 **打得出但你不摸** | `punish_amount`：喂给 L0 的那个数 | Q68 **逐段**过滤：`base = Σ 不被你的色免掉的段贡献`；全免则**整个摸牌事件跳过**（同 06-Q27），链上贡献一张不减、下家照吃满 |
| 当前色 = 你的色 → 可打**任意数字** | `play_legality`：`legal.ts::playableFor` | 出牌/并列首张/`legalActions`/U1 摸到即可打四条路本来就都问它 |
| 变色牌**只能选你的色** | `color_rule`：`legal.ts::requiredColor` | 与五彩、行进曲共用一处——那两条要的是「维持跟色」，专精要的是「定成你的色」 |
| **免疫五彩** | `immune` 字段 → `canGrantStatus` | 谁来赋都挡得住（八门②、寄生、狂欢…），赋状态的每条路径自动生效 |

⚠️ **底牌的取法**是这里唯一的读法选择：引擎取**摸牌堆最底下那张有色的牌**（无色牌往上顺延）。
04 原文只写「底牌定色」，若指的是开局翻开的第一张，改一处即可。

```yaml
id: heart-9
structured: true
effects:
  - key: on_reveal
    kind: on_reveal
    targeting: self
    once: once
    stacks_with_turn_limit: false
    modifies: [color_rule]
    duration: while_revealed
  - key: 1
    kind: passive
    window: on_punish_resolve
    applies_to: [punish]
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [punish_amount]
    duration: while_revealed
  - key: 2
    kind: meta_rule
    window: play_phase
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [play_legality]
    duration: while_revealed
  - key: 3
    kind: meta_rule
    window: play_phase
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [color_rule]
    duration: while_revealed
  - key: 4
    kind: passive
    window: any
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    immune: [五彩]
    duration: while_revealed
```

神授改的是 **「哪些摸牌是强制的」**，不是摸几张——所以 `modifies` 用 `draw_obligation`，
**不带 `layer`**（02 §7 那台机器一层都不碰）。

**「一定要摸」的五种情形**（2026-08-03 规则制定人给全，已写进 01-S17b）：
① 受到**惩罚** ② 打出**毒** ③ 受到**其他玩家技能** ④ 打出的最后一张牌为**非数字牌**（U5 补摸）
⑤ 只剩最后一张牌**未喊 UNO**（含 U6 的虚喊罚摸）。**其余摸牌一律可以不摸**——
无牌可出的那一张直接给「结束回合」，其他非强制的摸牌引擎会先问一句（S17b）。
恋战在场时神授优先（S17），由同一个判据 `mustDraw` 兜住，不写成技能间的互斥。

「手牌 >10 可主动亮出」是 01-V2 的**条件式亮出窗口**：`reveal_window: any_time` + `reveal_when`。
按 V2b，例外只放宽「必须是自己的回合」，**反应窗口挂着时照样禁亮**。

```yaml
id: heart-5
reveal_window: any_time
reveal_when: { hand_at_least: 11 }
structured: true
effects:
  - key: passive
    kind: passive
    window: play_phase
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [draw_obligation]
    duration: while_revealed
```

近卫在 02 §7 的 **L6 后置程序**（那一行原文就写着「近卫：逐张交牌」）：不改摸牌数，只在惩罚结算之后多跑一段。
两个数都在 `values` 里——`L6: 4` 是门槛（**链上贡献总和** ≥ 4，P11 的那个数），`give: 1` 是**每张 +2/+4** 交 1 张。
交的是**自己手牌**、交给**链首发起者**（01-P12），链首是自己时不成立（同 P8「不封自己」的口径）。
「可交」= 每次都可以不交（同 S14 的口径），所以引擎开一个窗口让他挑 0 ‥ N 张，超时按不交。

```yaml
id: heart-6
notes: 门槛按链上贡献总和（P11 的那个数）；交给链首（P12）；链首是自己时不触发
structured: true
effects:
  - key: passive
    kind: passive
    window: on_punish_resolve
    values: { L6: 4, give: 1 }
    applies_to: [punish]
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [draw_procedure]
    procedure: hand_over
    duration: while_revealed
    layer: [L6]
```

异议②「弃异每张 −1」在 02 §7 的 L2；「不可强制使用」按 01-F3 = 仍可强制亮出、不能强制发动。

**2026-08-02 补齐（规则制定人裁定，原 04 的「① 是否算响应窗口非阶段1」疑点）**：

- **①的链去向 = 反弹给上家**。方向反转 + 跳过自己 → 反转后我的下家正是原来的上家，
  链**原样**传过去（段与贡献总和一张不动），他自己选叠还是吃。我一张不摸。
  例：A 打绿 +2 → B 发动异议① → 方向反转、跳过 B → A 自己面对那 2 张，可叠可吃
- **①是纯响应窗口，不占 01-V7 的主动条**。它在**别人的回合**触发（上家刚打出 +2/+4），
  那一刻我根本没有「我的回合」可占；同强袭②的接管窗口。`once: once` 已经是它的限流
- **②弃几个由玩家选**（0 ‥ 持有数）。弃 0 = 不弃，异留着下次用；超时默认弃 0。
  每弃一枚 L2 **−1**，所以 `values.L2` 是**单枚**的值，不是总额——实际 delta = −1 × 实弃数
- **②机读层拆成两条**：`2a` 打出转获异（触发在 `after_play`），`2b` 受罚弃异少摸
  （触发在 `on_punish_resolve`）。一条 `window` 装不下两个时机，硬塞会让其中一个静默没标。
  「异」这个标记名走 `cost`（同司夜的 `cost: 盗`），不进 `modifies`——02 §1 的 `modifies`
  取值表里没有 `marks`，标记从来是靠 `values.marks` + `cost` 表达的

```yaml
id: heart-8
force_activate_ok: false
structured: true
effects:
  - key: 1
    kind: response
    window: on_punish_resolve
    targeting: self
    once: once
    stacks_with_turn_limit: false
    modifies: [turn_flow]
    duration: instant
  - key: 2a
    kind: on_play
    window: after_play
    cost: 异
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    values: { marks: 1 }
    duration: while_revealed
  - key: 2b
    kind: passive
    window: on_punish_resolve
    cost: 异
    values: { L2: -1, marks: 1 }
    applies_to: [punish]
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [draw_count]
    duration: while_revealed
    layer: [L2]
```

⚠️ `2b` 的 `values.L2` 是**每枚异**的值。声明了 `values.marks`（按标记计价）的改摸数效果
**不由 `drawModifiersFor` 自动产出**——它是纯函数，不知道玩家这次实付了几枚；
与伤逝的 L1 同一条理由，由调用方算好走 `drawCards` 的 `mods` 传进来。

伤逝在 02 §7 的 L1 替换层：整体改写计算，命中即得最终值（01-P13：忽略贡献总和与吟游等一切改摸数）。

**数的是「张数」不是「贡献总和」**：链上有几张 +2/+4 就掷几颗三面骰（01-R1，每颗 0/1/2），
点数求和即为最终摸牌数——**可以掷出 0，那就一张都不摸**（同强袭①的 0 倍）。
`values.L1` 缺席是有意的：替换值由掷骰产生，标的是「每张掷 1 颗」那个 1（02 §6 的 L1 例外）。

```yaml
id: heart-10
structured: true
effects:
  - key: passive
    kind: replacement
    window: on_punish_resolve
    values: { dice: 1 }
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    applies_to: [punish]
    modifies: [draw_count, dice]
    duration: while_revealed
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
| 1 | 强袭 | ✅/❓ | 打出 +2/+4 后可掷骰改该张倍率；**任意玩家**（不限回合）掷骰后可重掷同数量一次并采用你的结果，只替掉掷骰这一步、回合照常流转；①②均不占主动额度 | 与邪神联动 |
| 2 | 血棘 | ✅ | 你**发起**的惩罚使目标封印技能（**含被动**，至你另封新目标或其链首发起惩罚，01-P14）；回合开始可掷骰令被血棘者摸等量；优先；未亮出也被封则不能亮出；合纵连横双封 | — |
| 3 | 影歌 | ✅ | ① 一次性阶段1攒魂（**上限 6**）；② 花2魂跳过（可惩罚回合），占主动条 | — |
| 4 | 攻心 | ❓ | 每名玩家限一次展示比牌摸 1/2/3；累计摸满人数获神化 | 「首次累计」计数跨谁 |
| 5 | 毒池 | ❓ | 他人打毒额外摸你已明置毒数；你打毒不摸且他人各摸 3；实体毒明置 | 与古神、同命序 |
| 6 | 夜魇 | ❓ | ① 一次性明置数字（非最后一张）；② 每回合开始翻牌与明置判定；不可强制使用 | 判定 ⑶ 摸牌上下限 |
| 7 | 天堂 | ❓ | 无恋战时与人拼点：胜则对方摸牌+1并恋战直到打出 +4；负则你恋战直到打出 +2/+4 | 状态互斥时拼点结果 |
| 8 | 日月 | ❓ | 限制人数次：交手牌给他人，其分成两叠你取一叠 | 空手/1 张边界 |
| 9 | 寄生 | ⚠️ | 人数次：他人喊 UNO 时令其五彩或心盲+摸牌+1；你回合开始掷 2 骰和 0/1 则清除；**可任意时刻亮出** | 与状态互斥 |
| 10 | 劫营 | ✅ | 同色同数同时打出；对方摸 1；你下家继续；可打断**任何人打出的任何一张牌**（并列按**整组**算一次、神化仍是每一张，2026-08-02）；剩余神化轮作废 | — |
| J | 远星 | ✅ | 上家 +2 时弃同色停/转、上家 +4 时弃 +2，各摸 2 视为叠链 +2/+4；**视为的 +4 用所弃 +2 的颜色**（非任选定色） | — |
| Q | 不意 | ❓ | 一次性与所有人拼点，弃置所有手牌再重发；负方掷骰摸牌；额外摸≥人数则你再获一次使用 | 「再获一次」存哪里 |
| K | 觐见 | ❓ | 明示一张不合法牌，选无明示者令其明示一半（下取整最多 4） | 与偏折「不能明示」冲突时 |

### 结构化标注（♦）

强袭①改的是自己那张惩罚牌的倍率，按 01-P6 在**进链时**结算，02 §7 明确这类修正已计入 L0 贡献、不再走层级，故无 `layer`。**2026-07-30 补齐**：掷 **1 颗三面骰（0/1/2，R1）**，自己那张的贡献 = 面值 × 点数（+2 → 0/2/4；+4 → 0/4/8）——掷出 0 就是 0，赌的就是这个。「可掷骰」= 打出时可选，不掷则按面值。

**2026-07-29 裁定（原 Q34 的强袭部分）**：①②**都不占** 01-V7 的每回合一条主动。

- ①② 不可能同时要用：①在打出 +2/+4 时触发，此后到惩罚链结算完为止没有别人掷骰，②没有可接管的对象
- ②的触发条件是「**场上有人掷骰**」，**不限回合**——不是他的回合也能接管
- ②只**替掉掷骰这一步**，回合照常流转：接管不夺取行动权、不打断当前回合、不改变谁在行动
- 「每次掷骰都能接管」故 `once: unlimited`；同一次掷骰事件里按 04 摘要仍是「重掷同数量一次」

**2026-07-31 裁定（惩罚回合里的强袭）**：持有者**自己正被 +2/+4 指向**时，①②**照样可用**——
T3/P1 的「惩罚回合关闭主动技能」管不到它们（Q34 已定性①②不占主动额度，它们不是那种主动）。
只有血棘封印能关掉（01-P9）。

> 牌桌例（顺序 A→B→C→D）：**B 亮着强袭**。A 打出 +2 指向下家 B，B 进入惩罚回合。
> B 决定叠一张 +4，此时**可以用①掷骰**定这张的倍率（掷 2 → 这段贡献 8；掷 0 → 贡献 0，链照样成立）；
> 掷完不满意，还**可以用②重掷**一次并采用新结果。两条都不占 B 的主动额度。

```yaml
id: diamond-1
structured: true
effects:
  - key: 1
    kind: on_play
    window: on_stack_contribute
    values: { dice: 1 }
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [punish_amount, dice]
    duration: instant
  - key: 2
    kind: response
    window: on_dice_roll
    targeting: global
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [dice]
    duration: instant
```

血棘：封印按 01-P8 只在有血棘者是**链首发起**的 +2/+4 时成立，落点是被惩罚者，故 `targeting: single`（但按 01-P15 是被动触发、无指定动作，不算 §4 的单体，狂欢「单体不能以你为目标」挡不住）。封印含被动、先于本次摸牌数计算生效；`duration: until_event`，事件 = 血棘者另封新目标或被封者链首发起惩罚（01-P14）。「优先」（02 §1 `priority`）挂在封印上。

**2026-07-30 补齐**：①「回合开始可掷骰令被血棘者摸等量」= 掷 **1 颗三面骰（0/1/2）**，当前被你封印的那名玩家摸等量（0/1/2 张）；场上无人被你封印时此条无目标、不可发动。这次摸牌是「他人技能造成的摸牌」——但被封者的恩惠**已被你封印**（含被动，01-P14），所以实践中不会被减免。

**2026-07-31 裁定（血棘不封印自己）**：原文是「你发起的惩罚使**目标**封印技能」，**目标指的是其他玩家**。
链绕一圈退回链首发起者本人时（3 人局：A 打 +2 → B 叠 → C 叠 → 轮回 A 吃下），**封印不成立**——
A 照常摸下链上的总数，但不会封住自己。落档见 01-P8。

```yaml
id: diamond-2
notes: 链首已定
structured: true
effects:
  - key: passive
    kind: status_grant
    window: on_punish_resolve
    targeting: single
    once: unlimited
    stacks_with_turn_limit: false
    priority: true
    duration: until_event
  - key: 1
    kind: active
    window: turn_start
    values: { dice: 1 }
    targeting: all_others
    once: unlimited
    stacks_with_turn_limit: true
    modifies: [dice]
    duration: instant
```

影歌照 01-S15：①一次性攒魂（上限 6）、②花 2 魂跳过且**占主动条**。两条都是阶段 1 主动 → 01-V7 每回合只能选发动一条。②「可在惩罚回合发动」是 02 §2 压制的例外，由 `suppression_exempt: [punish_turn]` 承载（原 Q39）。

**2026-07-30 补齐（①的完整流程，Excel 原文带回；比对对象同日更正）**：发动时，**你指定一个「色 + 数」**
（如「蓝 2」）——**不要求你手里有这张牌**。然后其他玩家自你的下家起**依次**、以你指定的牌为比对对象三选一：

1. 亮出（展示，不离手）一张与指定牌同色**且**同数的牌——不摸牌
2. 亮出一张与指定牌同色**或**同数的牌——并**摸 1 张**
3. （亮不出或不愿亮）**摸 3 张**

一轮结束后，你获得 **本轮实际摸到的总张数** 个魂（上限 6）。这些摸牌是「他人技能造成的摸牌」
（发起者 = 影歌持有者，Q56）——被展示方若亮着恩惠可以减免；魂按**实际摸到**的张数计（与 Q46 口径一致）。
指定限**数字牌**（**1–9** × 四色，按例「说蓝色 2」；功能牌无「数」可同）。
①的 `targeting` 是 `all_others`（2026-07-31 裁定）：受影响的是其他所有人，不是发动者自己。

**2026-07-31 裁定（②在惩罚回合跳过后，链的去向）**：链**顺延给跳过者的下家**，链上的段与总数一张不动。
链一路顺延回到链首发起者本人是完全可能的（3 人局叠两次即可），那时他照常吃下——
血棘的封印在这一步不成立（见 ♦2 条目的 2026-07-31 裁定）。魂足够时同一个人在链转回来后**可以再跳一次**，
这是预期行为（魂是有限资源，跳一次扣 2）。

**2026-08-02（机读层补洞，不改裁定）**：把既有的「魂上限 6」补进围栏块的 `mark_cap`。

**2026-08-02 裁定（宣言不含 0）**：①能指定的牌面收窄为 **1–9**，**0 不可宣言**。
这是一条**裁定改动**，不是补洞——原文写的是 0–9。理由：0 在这副牌里每色 **2** 张，1–9 每色 **3** 张
（05 §3 的构成表，见 `engine/src/deck.ts::PER_COLOR`），宣言 0 时别人亮得出同数的概率只有其余牌面的
三分之二，同色同数那一档更稀。宣言 0 因此是**严格占优**的一手，攒魂期望比别的牌面都高，
选项等于形同虚设。收窄之后四色 × 九面 = 36 个宣言选项，每个的期望齐平。
⚠️ 这条**只管宣言**：0 照旧是数字牌，U5 的「只有数字牌能打完获胜」不受影响，
所以引擎里它不是改 `isNumberCard`，而是宣言校验自己多一条（见 `actions/soul-harvest.ts`）。
在此之前这条上限只存在于散文与 `values.max` 里，而 `max` 认不出它管的是**哪个标记**
（精英♥3 的 `values.max: 9` 管的是牌面点数，不是标记），标记名只好写死在 handler 常量里——
「哪个标记的上限是多少」于是有两份真相。`mark_cap: { 标记名: 上限 }` 把绑定挪进定义数据，
引擎从此不写死标记名。**没有上限的标记不写这个字段**（如司夜的「盗」）——缺席即无上限，不是 0。
同时删掉本条原有的 `values.max: 6`：那是同一个 6 的第二份拷贝，留着就会各改各的。删完之后
`max` 这个键在整份定义里只剩「数值上限」一种含义（精英♥3 的牌面点数 9），**不再过载**——
而 `max` 过载正是这次补洞的起因。字段登记见 [02 §6](./02-methodology.md#6-结构化标注围栏块04-的机读格式-)。

```yaml
id: diamond-3
structured: true
effects:
  - key: 1
    kind: active
    window: turn_start
    values: { draws: 3, draws_partial: 1 }
    mark_cap: { 魂: 6 }
    targeting: all_others
    once: once
    stacks_with_turn_limit: true
    duration: instant
  - key: 2
    kind: active
    window: turn_start
    cost: 2 魂
    values: { marks: 2 }
    targeting: self
    once: unlimited
    stacks_with_turn_limit: true
    suppression_exempt: [punish_turn]
    modifies: [turn_flow]
    duration: instant
```

劫营按 01-G5 打断当前轮、作废剩余神化轮。「对方摸 1」是本效果**造成**的摸牌，不是改摸牌数，无 `layer`——
那个 1 落在 `values.draws`（02 §6 的数值槽，原 Q53），引擎读它而不是写死常数。

**2026-07-29 裁定（原 Q34）**：劫营是**主动使用**的——响应与否由持有者自己决定，所以**占**主动次数。
额度是**持有者自己**的那一条，不是被打断者的：按 01-G5 打断者不进回合，等于把自己这一轮的出牌与
主动一并用在了打断上。牌桌顺序：A 出牌 → B 劫营（打出同色同数）→ 轮到 B 的下家 C，**C 的主动额度不受影响**。

**2026-08-02 改判（劫营 × 并列：整组原子落地，落地后只截一次）**——取代下方 2026-07-31 的逐张裁定。

原话：「并列的牌可以一次性出完，如果出的牌中有的牌可以劫营，在出完全部并列牌时再实施劫营」。

- **并列整组一次落地**，中途不给任何窗口。摆的过程不再是可观察的中间态
- 整组落地**之后**开**一次**劫营窗口。触发面是**组内任意一张**：劫营者手上有牌与
  这一组里**任何一张**同色同数即可截（不再只盯"刚摆的那张"）
- 因此**一回合最多截一次并列**，「放过第一张还能截第二张」那条口径随逐张模型一起作废
- 被截的后果照 01-G5 不变：打断牌压牌顶成为跟牌目标、被打断者摸 1、打断者不进回合、
  从打断者的下家继续。**整组已经全在牌河**，没有"没摆的留在手上"这回事了
- **收官不可截**（2026-08-02 拍板）：一次打空手牌 → 照 U5c「收官判在末牌离手那一刻」
  当场获胜，劫营窗口**根本不开**。代价是并列成为不可拦截的收官手段——这是明知的取舍

⚠️ **神化连出不走这条**：神化标记带来的「一回合出多张」仍是**逐张**出牌，
每张落地都给劫营一次机会、可被中途打断（01-G5 的「剩余神化轮作废」正是为它写的）。
两者机制不同，别合并——并列是**一次合法打出多张**（01-G2），神化是**多轮出牌**。
（神化本批未实现；实现时按逐张模型走，即本文下方那条 2026-07-31 裁定的原样。）

<details><summary>2026-07-31 裁定（已被上一条取代，留档）</summary>

并列是**先声明整组、逐张摆出**的，每摆一张给劫营一次截的机会。因此**想靠并列收官的人，
在摆空手牌之前照样会被截**——想用 6 张收官，摆到第 3 张时被劫营截住，**他手上还剩 3 张，不算赢**；
已摆出的 3 张留在牌河，没摆的留在手里，跟牌目标变成劫营那张。

**「一回合只能打断一次」的口径**：限制的是**真的打断**——打断即终止这次并列，不会再有下一张。
放弃某一张不消耗后续机会：6 张并列里若劫营者手上有两张对得上，他会依次拿到两个窗口，
放过第一个仍可截第二个。

</details>

**2026-07-31 裁定（触发面 = 任何人打出任何一张牌）**：劫营**不再限于打断并列/神化的多打**——
只要有人打出一张牌，而你手里有与**那一张**同色同数的牌，就可以截。单张出牌被截的后果与打断多打完全一致：
打断牌压牌顶成为跟牌目标、被打断者摸 1（本效果造成的摸牌，`values.draws`）、打断者**不进回合**、
从**打断者的下家**继续、占**打断者自己**的主动额度、打断牌是其最后一张则算赢。

- 「同色同数」只有**数字牌**谈得上（功能牌与无色牌没有「数」）：所以打出 +2/停/转/变色/+4 都不会被截，
  惩罚链结算中打出的叠链牌（必为 +2/+4）同样不在触发面内。这与「劫营要同色同数，本来就只可能是数字牌」一致。
- **打空手牌的那一张不给机会**：那一刻要么已经终局，要么走 01-U5 的代价摸牌，都没有「打断当前轮」可言。

**2026-07-31 裁定（打断者用最后一张手牌打断 = 获胜）**：打断牌确实打进了牌河，
按 01-U5「只有数字牌能打完获胜」判定——劫营要同色同数，本来就只可能是数字牌，故必然成立。
**胜利优先**：被打断者不再摸那 1 张，回合也不再流转，与「打出末牌获胜」的收场一致。

```yaml
id: diamond-10
notes: 已定
structured: true
effects:
  - key: 1
    kind: response
    window: interrupt
    values: { draws: 1 }
    targeting: single
    once: unlimited
    stacks_with_turn_limit: true
    modifies: [turn_flow]
    duration: instant
```

远星按 01-P7 是**合法叠链接法**，摸的 2 张是代价、不计惩罚，所以既不是改摸牌数也无 `layer`；「视为的 +4 用所弃 +2 的颜色」是改颜色规则。

**2026-07-29 裁定（原 Q34）**：远星只在**惩罚轮**用，而惩罚轮按 01-T3/P1 本来就关闭主动技能——
占不占额度**改变不了任何事实**（持有者此刻也没有别的主动可发）。故记 `false`，不给它编一条用不上的账。

**2026-07-31 裁定（代价不拆两步）**：「弃 1」与「摸 2」是同一个代价的两半，**一口气结算完**，
中间不存在可观察的中间态。所以不会因为「弃掉倒数第二张、手牌瞬间剩 1」而产生一个抓 UNO 的窗口。

```yaml
id: diamond-j
notes: 已定
structured: true
effects:
  - key: 1
    kind: response
    window: interrupt
    cost: 弃 1 张 + 摸 2
    values: { discard: 1, draws: 2 }
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
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
| 4 | 契约 | ⚠️ | 被停时可摸 3 弃 3；可在被跳过时亮出 | — |
| 5 | 合纵 | ✅ | 亮出时连横须立刻响应；相应则换牌+之后回合开始可换；无响应则**每张**功能牌后摸2弃2 | — |
| 6 | 连横 | ✅ | 对称；无响应则每张功能后摸1弃1，若上回合也打出功能则该次摸3弃3 | — |
| 7 | 窃贼 | ❓ | 拼点：胜则取对方半数手牌（上取整最多 5）再还同数；负摸 1 | — |
| 8 | 八门 | ✅ | 一次性摸 8 弃 8（不受其他技能）；回合结束获五彩且所有摸牌+1 | — |
| 9 | 黑白 | ❓ | ① 摸 3 扣 3；② 用扣置换判定/拼点；③ 与所有人拼点，负方亮手牌并掷骰解除 | — |
| 10 | 毒师 | ❓ | 打毒选两人同命；打毒不摸；可摸 2 弃当前色功能视为毒；最多两名同命 | 与毒池/古神 |
| J | 忍戒 | ✅ | 受罚时多摸一倍再弃多摸数（最多多摸 6）；结算层级属 L6 后置程序（02 §7） | — |
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
    values: { discard: 1, draws: 1 }
    targeting: self
    once: unlimited
    stacks_with_turn_limit: true
    duration: instant
```

以下是**部分标注**。契约「可在被跳过时亮出」是 01-V2 白名单例外：

```yaml
id: spade-4
notes: 例外亮出已收白名单
reveal_window: when_skipped
```

合纵♠5 / 连横♠6 是一对：**①亮出时的相应**（S13/S13b）与**②无相应时的摸弃**（S14）互斥，二选一。
两边靠 `pairs_with` 认亲，任一方**先亮出**的那一刻问另一方一次，答完一锤定音（06-Q70）。

- **①a 相应**：响应即亮出，两人**整副手牌互换**；此后②对双方都关掉
- **①b 换牌**：结盟后**双方各自的回合开始**都可以再换一次，不需对方同意，**占 V7 的主动条**（06-Q70）
- **②**：走 03 §2 的「摸 N 弃 N 是一个窗口」，且 S14 明写**每次触发都是可选**（Excel 原文「可以」），
  所以引擎先开一个「要不要」的窗口，答应了才摸；超时 = 不要。「功能牌」按 03 §1 = **+2 / 转 / 停**
  （+4 是变色牌，不触发）。连横的连击档按 **01-S14b** = 上一个**自己的**回合也打出过功能牌

```yaml
id: spade-5
pairs_with: spade-6
structured: true
effects:
  - key: 1a
    kind: on_reveal
    window: any
    targeting: single
    once: once
    stacks_with_turn_limit: false
    duration: while_revealed
  - key: 1b
    kind: active
    window: turn_start
    targeting: single
    once: unlimited
    stacks_with_turn_limit: true
    duration: instant
  - key: 2
    kind: passive
    window: after_play
    values: { draws: 2 }
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    duration: while_revealed
```

```yaml
id: spade-6
pairs_with: spade-5
notes: ②的连击档见 01-S14b（上一个自己的回合也打出过功能牌）
structured: true
effects:
  - key: 1a
    kind: on_reveal
    window: any
    targeting: single
    once: once
    stacks_with_turn_limit: false
    duration: while_revealed
  - key: 1b
    kind: active
    window: turn_start
    targeting: single
    once: unlimited
    stacks_with_turn_limit: true
    duration: instant
  - key: 2
    kind: passive
    window: after_play
    values: { draws: 1, draws_combo: 3 }
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    duration: while_revealed
```

八门①「一次性摸 8 弃 8」走 03 §2 的「摸 N 弃 N 是一个窗口」；「不受其他技能影响」按 02 §7 的
**L1 替换**落地（`values.L1` 就是那个定值 8，命中 L1 即跳过 L2/L3/L4，连自己的②也不加）。
范围已裁定：**摸 8、弃 8 两个数都是定值**（2026-08-07，见 06-Q69）。
②拆成两条：2a 是回合结束获五彩（`grants`，三者互斥由 03 §4 兜底），2b 是所有摸牌 L2 +1：

```yaml
id: spade-8
structured: true
effects:
  - key: 1
    kind: active
    window: turn_start
    values: { L1: 8 }
    targeting: self
    once: once
    stacks_with_turn_limit: true
    modifies: [draw_count]
    duration: instant
    layer: [L1]
  - key: 2a
    kind: status_grant
    window: turn_end
    grants: [五彩]
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    duration: while_revealed
  - key: 2b
    kind: passive
    window: on_draw
    values: { L2: 1 }
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [draw_count]
    duration: while_revealed
    layer: [L2]
```

忍戒在 02 §7 的 L6 后置程序——**不改数字，只改执行方式**（按最终值 N 多摸 min(N,6) 再弃等量），所以 `modifies` 用 `draw_procedure` 而不是 `draw_count`。那支程序叫 `draw_then_discard`，`values.L6` 是它的参数「多摸上限 6」（02 §6）；多摸完弃等量走 03 §2 的「摸 N 弃 N 是一个窗口」：

```yaml
id: spade-j
notes: ✅ 与伤逝无冲突：S2 一人一技能，二者不可能同在一名受罚者身上
structured: true
effects:
  - key: passive
    kind: passive
    window: on_punish_resolve
    values: { L6: 6 }
    applies_to: [punish]
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [draw_procedure]
    procedure: draw_then_discard
    duration: while_revealed
    layer: [L6]
```

---

## ♣ 梅花

| 点 | 名 | 状态 | 摘要 | 疑点 |
|---|---|---|---|---|
| 1 | 统御 | ❓ | 打出变色牌扣置；可弃一张扣置视为当前色转或停 | 窗口=阶段1还是 after_play |
| 2 | 明暗 | ❓ | ① 摸手牌倍数量并扣置人数张（至少留 1）；② 回合开始可用扣置换手牌（仅 1 张手牌不能） | — |
| 3 | 司夜 | ✅ | 打出变色后**掷骰一次获点数个盗（0/1/2）**；阶段1花盗换牌；3/5盗放宽末牌为功能/变色，仍须合法打出；**②③被动触发不占主动**（06-Q57） | — |
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

司夜三条：①获盗按 01-T2 在**阶段 3**；②花盗换牌要等到下次**阶段 1**（同 T2）；③3/5 盗放宽末牌是 01-U5 的例外（01-S16），发生在出牌时。②③均为**被动触发**（06-Q57）：不是「发动」、不占 V7 额度，同回合皆可发生——②换不换、换哪张仍由玩家选择（付代价的选择），③持够盗时出末牌自动放宽并扣盗。

**2026-07-30 补齐（②的汇率与流程，规则制定人确认）**：**1 盗 = 与一名玩家换 1 张**：指定一名玩家，
从其手牌**盲抽** 1 张，然后从自己手牌（**含刚抽到的那张**）选 1 张还给对方。可在同一阶段 1 花多枚盗、
逐次结算。隐私：抽到什么只有你与对方知道（对方失去哪张自己看得见）；公开信息只有「谁与谁换了 1 张」。

**2026-07-31 裁定（②的三个边角）**：

- **换牌会让对方「已喊 UNO」作废**：②把对方手牌 1 → 0 → 1，对方不在自己回合，按 01-U6 回合外口径已喊立刻清零，**他必须重喊**，否则可被抓。「被别人的技能改了手牌数」不例外。
  **司夜自己不同理**（2026-08-01 U6 改判后）：换牌发生在司夜自己的回合内，他这回合喊过一次就一直有效，交回合时手牌若仍为 1 则继续存续。
- **惩罚轮不能花盗换牌**：按 01-T2「花盗要等到下次阶段 1」，②只在**自己回合的阶段 1** 可用。（①获盗不受此限，惩罚轮打出 +4 照样掷骰。）
- **③收官时不再掷①的骰**：5 盗打出末张 +4 直接终局，胜利优先，不掷获盗的骰（赢了以后拿盗没有意义）。

**2026-07-29 裁定（原 Q34）**：分界线是**拿标记还是花标记**。

- **①获盗 = 被动，不占**。打出变色牌就掷骰，不是一个可选的发动；**惩罚轮里打出 +4 照样获盗**——惩罚轮关的是主动，拿标记不受影响
- ~~**②③花盗 = 主动，占**~~ / ~~**由此 ②③ 同回合只能选一条**~~ —— 这两条已于 **2026-07-30 由 06-Q57 裁定作废**（②③改判为被动触发、不占主动、同回合皆可），以本小节开头那段为准

```yaml
id: club-3
structured: true
effects:
  - key: 1
    kind: on_play
    window: after_play
    values: { dice: 1 }
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [dice]
    duration: instant
  - key: 2
    kind: meta_rule
    window: turn_start
    cost: 盗
    values: { marks: 1 }
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    duration: instant
  - key: 3
    kind: meta_rule
    window: play_phase
    cost: 3 或 5 盗
    values: { marks: 3, marks_wild: 5 }
    targeting: self
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [play_legality]
    duration: instant
```

**2026-08-02 补齐（歌声全表，规则制定人给出原文）**：

> 回合开始时若你的上家打出的不是「+2」或「+4」，则你可以选择一种歌声。
> **战争序**：所有「惩罚」摸牌数 ×2。
> **樱时雨**：所有「惩罚」摸牌数恒定为 1。
> **活泼板**：所有摸牌数 +1。
> **行进曲**：变色牌不能改变颜色。
> （技能亮出时为无歌声）

| 歌声 | 效果 | 落点 |
|---|---|---|
| 战争序 | 所有「惩罚」摸牌数 ×2 | 02 §7 **L3** 倍率，`applies_to: [punish]` |
| 樱时雨 | 所有「惩罚」摸牌数恒定为 1 | 02 §7 **L4** 覆盖，`applies_to: [punish]` |
| 活泼板 | 所有摸牌数 +1 | 02 §7 **L2** 加减，不限事件类型 |
| 行进曲 | 变色牌不能改变颜色 | **不改摸牌数**，走 `color_rule`（故不在 02 §7 的表里） |

- **无歌声是初始态**：亮出时没有歌声，要到某个回合开始才选得上；选与切换各占一次主动条（01-S20）
- **开唱条件**是「上家这一轮打出的不是 +2/+4」——所以惩罚轮里换不了歌
- ⚠️ 三条待裁定（作用域 / 与 05 古神的口径差 / 行进曲的确切语义）见
  [06-open-questions.md](./06-open-questions.md) 的 Q62–Q64

**三条待裁定已于 2026-08-02 全部裁完**（Q62 全场生效 / Q63 樱时雨只管惩罚且 0 也抬回 1 /
Q64 行进曲能打有效只是不改色 / Q65 封印只压制不清空 / Q66 全场一个槽、后唱覆盖先唱），
所以这里是**完整标注**：

- 四支歌声都是①的**选项**（`option_of: 1`）：选中哪支哪支才生效，选的动作就是「发动①并报那一支的 key」，
  因此 V7 的额度记在①头上（01-S20：选/切换各占一次主动条）
- 四支一律 `targeting: global`——**全场生效**（Q62），对手也吃；采集口径因此不是「收自己的」
- 行进曲不改摸牌数，走 `color_rule`，与五彩「使用变色牌时不能改变颜色」是**同一条判定**
  （引擎里 `legal.ts::colorLocked` 一处，两个来源共用）

```yaml
id: club-5
structured: true
effects:
  - key: 1
    kind: active
    window: turn_start
    targeting: global
    once: unlimited
    stacks_with_turn_limit: true
    duration: instant
  - key: 活泼板
    kind: passive
    option_of: 1
    window: on_draw
    values: { L2: 1 }
    targeting: global
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [draw_count]
    duration: while_revealed
    layer: [L2]
  - key: 战争序
    kind: passive
    option_of: 1
    window: on_draw
    values: { L3: 2 }
    applies_to: [punish]
    targeting: global
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [draw_count]
    duration: while_revealed
    layer: [L3]
  - key: 樱时雨
    kind: passive
    option_of: 1
    window: on_draw
    values: { L4: 1 }
    applies_to: [punish]
    targeting: global
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [draw_count]
    duration: while_revealed
    layer: [L4]
  - key: 行进曲
    kind: passive
    option_of: 1
    window: play_phase
    targeting: global
    once: unlimited
    stacks_with_turn_limit: false
    modifies: [color_rule]
    duration: while_revealed
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
