/**
 * 技能效果的**数值**，从定义里读。
 *
 * 这里曾经是一张手写的参数表，因为 02 §1 的字段模型没有承载数值的槽位——那是第二个真相源：
 * 04 改了数，表不会跟着变，CI 也查不出来。2026-07-29 裁定（原 Q53）给 §1 补了 `values`，
 * 04 散文里的每个数字现在都在机读定义里有落点，那张表随之删除。
 *
 * 所以本文件只剩形状转换：层名键（L0–L6）归 `draw`，其余归 `counts`，`applies_to` 归 `appliesTo`。
 * **handler 里不该出现任何一个规则常数**——出现了就说明有个数还没进 04 的 `values`。
 */
import type { DrawEventKind } from "./primitives/draw-modifier.ts";
import type { DrawLayer, SkillDef, SkillEffect } from "./types.ts";

const LAYERS: readonly string[] = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"];

export interface EffectParams {
  /** 摸牌修正的数值，按层给。键与定义里 `effects[].layer` 声明的层一一对应。 */
  draw: Partial<Record<DrawLayer, number>>;
  /**
   * 这条修正作用于哪些摸牌事件。恩惠的「因惩罚或他人技能」= `["punish", "skill"]`。
   * 缺席 = 一切摸牌。02 §3 的 `window` 表达不了这个区分（`any` 只是说时机不限）。
   */
  appliesTo?: DrawEventKind[];
  /** 非层名的数值：`discard` / `draws` / `marks` / `dice` / `card_value` / `max`（02 §6 白名单）。 */
  counts: Readonly<Record<string, number>>;
  /**
   * 这条效果攒的标记**叫什么、上限多少**，直接来自定义的 `mark_cap`（04 围栏块）。
   * 这是「标记名 ↔ 上限」唯一的绑定处——`counts.max` 只有一个数，答不出它管哪个标记。
   * 空表 = 这条效果不攒有上限的标记（无上限的标记压根不写 `mark_cap`，见 SkillEffect）。
   */
  markCap: Readonly<Record<string, number>>;
}

export function paramsOfEffect(e: SkillEffect): EffectParams {
  const draw: Partial<Record<DrawLayer, number>> = {};
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(e.values ?? {})) {
    if (LAYERS.includes(k)) draw[k as DrawLayer] = v;
    else counts[k] = v;
  }
  return { draw, counts, appliesTo: e.applies_to, markCap: e.mark_cap ?? {} };
}

/** 按 `id` + 子效果 `key` 取数值。定义里没有这条子效果 = 一个数都没有，不是 0。 */
export function paramsOf(id: string, effectKey: string, byId: ReadonlyMap<string, SkillDef>): EffectParams {
  const e = byId.get(id)?.effects?.find((x) => x.key === effectKey);
  return e ? paramsOfEffect(e) : { draw: {}, counts: {}, markCap: {} };
}
