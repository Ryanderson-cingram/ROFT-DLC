# 强袭 ♦1（diamond-1）——惩罚牌掷骰倍率 / 掷骰接管

先读 `README.md`；建/用基建 2a（rollDice）。规则出处：04 diamond-1 条目（含 2026-07-30 补齐的倍率算法）、06-Q34 强袭部分（①②都不占主动）、01-P6（贡献进链时结算）、01-R1（三面骰 0/1/2）、06-Q40（`on_dice_roll` 窗口）。

## 一句话

①：自己打出 +2/+4 时可掷 1 骰，该张贡献 = 面值 × 点数。②：场上任何人掷骰后，你可以重掷同数量一次并强制采用你的结果。

## ① 倍率——精确行为

- 触发：**自己**打出 +2/+4（链首或叠链皆可）且已亮出强袭。可选：`playCards` 动作加可选旗标 `useAssault?: boolean`（与精英 `useSkill` 同风格——提交时声明，不做服务端窗口）。不带旗标 = 按面值进链。
- 结算：掷 1 骰（`rollDice(rng,1)`，0/1/2），该张的段贡献 = 面值 × 点数（+2 → 0/2/4；+4 → 0/4/8）。**掷 0 贡献就是 0**，链仍然成立（面子上打了 +2/+4，P4/P5 的接法判断不变，只是 `segments[].draw` = 0）。
- 时点：P6 进链时结算——修改 `extendChain` 的调用点，把段 draw 从常数换成算好的值；02 §7 明确这类修正计入 L0 贡献、**不再走层级**。
- 不占 V7（06-Q34）；`once: unlimited`——每张 +2/+4 都可以选择掷。
- 事件：`diceRolled { public: { seat, reason: "assault-multiplier", values } }` 紧跟在 `cardPlayed` 后；段贡献可从 punish 链公开状态读出。

### Worked example

牌顶红 5，A 亮着强袭打出红 +2 带 `useAssault`，掷出 2 → 链 total 4。B 叠 +4（无强袭）→ total 8。C 吃下摸 8。若 A 掷出 0 → 链 total 0，B 仍可叠（接法只看牌面），C 吃下摸 4（0+4）。

## ② 掷骰接管——精确行为（本批最重的基建）

- 触发：**任何一次掷骰事件之后**（不限回合、不限是谁掷的，含强袭者自己的掷骰、他人技能的掷骰——本批内的来源：强袭①、司夜①、血棘①），若场上存在**已亮出强袭**的其他持有者（或掷骰者本人持强袭——「任意玩家掷骰后」不排除自己重掷自己）。
- 语义：接管者重掷**同数量**的骰子一次，**采用接管者的结果**替换原结果，然后原动作按新结果继续结算。只替掉掷骰这一步，回合与行动权照常（06-Q34）。同一次掷骰事件只能被接管一次（04：「重掷同数量一次」）。
- 不占 V7。

### 两段式实现（必须按这个模型做，别试图在原动作里同步完成）

掷骰的动作不能在一个 apply 里直接消费骰子结果——中间要开窗口。引入 **挂起掷骰** 状态：

```ts
// GameState 增：
pendingDice?: {
  seat: number;            // 原掷骰者
  reason: string;          // 同 diceRolled.reason
  values: number[];        // 当前（可能已被接管替换的）结果
  resume: ResumeSpec;      // 窗口结算后如何继续（见下）
}
```

流程：动作走到「要掷骰」→ `rollDice` 得初始结果 → 若存在可接管者：commit 出一个 `pendingWindow { type: "diceTakeover", actors: [全部已亮出强袭的座位], deadline: 30s, defaultChoice: "pass" }` + `pendingDice`，事件 `diceRolled`（原结果）+ `diceTakeoverOpened`；若无可接管者：直接按结果继续（不建挂起态）。

- respond `"takeover"`：重掷同数量 → `values` 替换，事件 `diceRolled { reason: reason + "-takeover", seat: 接管者 }`；窗口关闭（先到先得，punishStack 语义），**立即执行 resume**。
- respond `"pass"` 全员 / 超时：按原 values 执行 resume。
- `ResumeSpec` 是可序列化的数据（不是闭包！状态存库）：`{ kind: "assault-contribution", cardId, ... } | { kind: "nightlord-steal" } | { kind: "bloodthorn-drain", target } | …`——每个用到掷骰的技能注册一个 resume 执行函数，输入 `(state, values, ctx)`。
- 本批范围：强袭①自身的掷骰也要过这个流程（自己掷完别人可接管吗？——只有强袭持有者能接管，S2 一人一技能，场上至多一名强袭持有者，所以「别人接管我的强袭骰」在本批不可能发生；但**自己重掷自己**合法：actors 含掷骰者自己时照常）。若场上唯一强袭者就是掷骰者且他不想重掷，UI 直接 pass。
- **简化豁免**：若实现时发现某处掷骰（如血棘①）与接管窗口的组合把状态机搞得过深，允许先让该处「无可接管者时跳过窗口」的快速路径覆盖 90% 对局；但窗口机制本身必须落地并被强袭①的用例覆盖。

## 引擎接入

- 04 yaml 不动（已标注齐）。机制注册：`on_play`、`response`、`punish_amount`、`dice`。
- 无传统 handler：①走 playCards 旗标路径（类比精英在 `useValueOverride` 的接法），②走窗口分发。registry 的「主动需要 handler」检查只针对 `kind: "active"`，强袭两条是 on_play/response，不需要 HANDLERS 条目——但**必须**写进抽池断言测试，防止悄悄漏配。
- `legalActions`：punish 语境下打 +2/+4 的 play 动作，若持有已亮出强袭 → 同时给出带 `useAssault: true` 的变体（与精英 skillPlays 同款「另一条动作」模式）。diceTakeover 窗口给 actors `respond takeover/pass`。
- web：出惩罚牌时若有带 `useAssault` 的合法动作，出牌按钮分两个（「按面值打」/「掷骰打」）；接管窗口复用 AlertBar + respond 按钮，全部由 legalActions 驱动。

## 测试清单（最低）

1. ①掷 2 → 贡献 4；掷 0 → 贡献 0 且链仍可叠、吃下按 total。
2. ①不带 `useAssault` → 按面值；未亮出带旗标 → reject。
3. ②接管：司夜①（或用测试注入的任意 pendingDice）被强袭者接管，采用新结果；`pass`/超时 → 原结果。
4. 同一次掷骰第二次 takeover → 窗口已关，stale_window。
5. 无强袭在场：掷骰不开窗口，动作一气呵成（版本只 +1）。
6. 随机可重放：`diceRolled` 事件里的 values 与最终结算一致；两次事件（原掷+重掷）都留档。
7. V7 不动账：①②都不置 `activatedThisTurn`。
