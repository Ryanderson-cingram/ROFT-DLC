/**
 * 技能效果的**数值**参数。
 *
 * 为什么这张表不在 `skill-defs.json` 里：02 §1 的字段模型没有承载数值的槽位。
 * `cost` 是自然语言（「弃 1 张手牌」），`layer` 只说落在哪一层、不说这一层的值是多少。
 * 于是 04 散文里的 `−2` / 「至少 1」 / 「弃 1 摸 1」在机读定义里**没有落点**——
 * 这是标注的缺口，不是规则的缺口（04 写得很清楚）。见报告与 06-open-questions。
 *
 * 所以这里是那些数值的临时住处，形状**刻意长得像它将来在 JSON 里的样子**：
 * 键是 `${技能 id}#${子效果 key}`，值是纯数据。字段模型一旦补上数值槽，
 * 整张表原样搬进 `skill-defs.json`，读它的代码一行不改——前提是读取一律走
 * `paramsOf()` 并且**绝不在 handler 里内联字面量**。
 */
import type { DrawEventKind } from "./primitives/draw-modifier.ts";
import type { DrawLayer } from "./types.ts";

export interface EffectParams {
  /** 摸牌修正的数值，按层给。键与定义里 `effects[].layer` 声明的层一一对应。 */
  draw?: Partial<Record<DrawLayer, number>>;
  /**
   * 这条修正作用于哪些摸牌事件。恩惠的「因惩罚或他人技能」= `["punish", "skill"]`。
   * 缺席 = 一切摸牌。02 §3 的 `window` 表达不了这个区分（`any` 只是说时机不限）。
   */
  appliesTo?: DrawEventKind[];
  /** cost：要弃掉几张手牌。 */
  discard?: number;
  /** 效果自己造成的摸牌张数（02 §6：这不是「改摸牌数」，不带 layer）。 */
  draws?: number;
}

export type ParamSource = Readonly<Record<string, EffectParams>>;

export const SKILL_PARAMS: ParamSource = {
  // 恩惠♥1：因惩罚或他人技能的摸牌 −2（至少 1）——04 ♥ 表 + 02 §7 L2/L5
  "heart-1#passive": { draw: { L2: -2, L5: 1 }, appliesTo: ["punish", "skill"] },
  // 恒心♠1：弃 1 摸 1——04 ♠ 表
  "spade-1#1": { discard: 1, draws: 1 },
};

export const paramsOf = (id: string, effectKey: string, src: ParamSource = SKILL_PARAMS): EffectParams =>
  src[`${id}#${effectKey}`] ?? {};
