/**
 * 把「谁的定义声明了改摸牌数」翻译成 `resolveDrawCount` 吃的修正列表。
 *
 * 这里**没有一行是恩惠专属的**：它扫全场已亮出的技能，凡是定义里 `modifies` 含
 * `draw_count` 的子效果，就按它自己声明的 `layer` 逐层产出修正，数值从参数表读。
 * 所以「再来一个改摸牌数的技能」= 改 JSON + 加一行数值，这个文件不动。
 *
 * 摆在 `skills/` 而不是 `actions/`，是因为它依赖定义与参数；`drawCards` 反过来调它，
 * 一个方向，没有环。规则：01-V3（亮出才生效）、01-P9/02 §2（封印）、02 §7。
 */
import { paramsOfEffect } from "./params.ts";
import { skills } from "./registry.ts";
import { suppressionOf } from "./primitives/suppression.ts";
import type { EffectParams } from "./params.ts";
import type { DrawLayer, SkillDef, SkillEffect } from "./types.ts";
import type { DrawModifier, DrawRequest } from "./primitives/draw-modifier.ts";
import type { Board } from "../types.ts";

/** 定义（数值就在定义里）。生产用的那一份是 `SKILL_DATA`；测试与「改数据看行为」注入自己的。 */
export interface SkillData {
  byId: ReadonlyMap<string, SkillDef>;
}

/**
 * `byId` 用 getter 惰性取，不在模块顶层读。
 * registry → handlers → actions/draw → draw-passives → registry 是一个环：顶层直接读
 * `skills.byId` 时，registry 可能还在初始化中，拿到的是 undefined。谁先被 import 决定
 * 会不会炸——本地全量跑侥幸没事，CI 单独跑 registry.test.ts 就炸了。
 * 惰性化之后模块初始化不再依赖环内顺序，环存在也无害。
 */
export const SKILL_DATA: SkillData = {
  get byId() {
    return skills.byId;
  },
};

/** 一层修正的形状。L2/L5 之外的层要 scope / procedure，`values` 还没有承载它们的槽位。 */
function toModifier(layer: DrawLayer, source: string, n: number | undefined): DrawModifier {
  // 计划 §1：数据点名了一层，引擎给不出它的值——静默失效比报错难查得多，宁可炸。
  if (n === undefined) throw new Error(`${source}: 定义声明了 ${layer}，但 values 里没有它的数值`);
  switch (layer) {
    case "L2":
      return { layer, source, delta: n };
    case "L5":
      return { layer, source, min: n };
    default:
      throw new Error(`${source}: ${layer} 的数值形状还没建（L4 要 scope、L6 要 procedure）`);
  }
}

/**
 * 这条子效果此刻是否作用于 `req` 这次摸牌。
 * `targeting: "self"` = 只改自己那次摸牌（恩惠救不了别人）。
 */
const applies = (e: SkillEffect, holder: number, req: DrawRequest, p: EffectParams) =>
  (e.targeting !== "self" || holder === req.seat) && (!p.appliesTo || p.appliesTo.includes(req.kind));

export function drawModifiersFor(b: Board, req: DrawRequest, data: SkillData = SKILL_DATA): DrawModifier[] {
  const mods: DrawModifier[] = [];
  b.skills.forEach((id, seat) => {
    // V3：没亮出的技能对局面毫无影响
    if (!id || !b.revealed[seat]) return;
    const def = data.byId.get(id);
    // 部分标注的条目（狂欢/伤逝/吟游…只搬了 §7 的 layer）声称不了自己机器可执行，
    // 跟着它们的 layer 走只会撞上没有数值的层。它们本来也进不了抽 3 选 1 的池。
    if (!def || def.structured !== true) return;
    // P9/02 §2：封印把这个技能整个关掉（`sealable` 缺席 = 默认可封，02 §1）。
    // 这里只看 `sealed` 一个源，不用 `isSuppressed`：`punishTurn` 那一源按 P1/T3 关的是
    // **主动**技能，而被动照常结算（V8）——拿它压被动会让恩惠在每一次惩罚里都失效。
    if (def.sealable !== false && suppressionOf(b, seat).includes("sealed")) return;
    for (const e of def.effects ?? []) {
      if (!e.modifies?.includes("draw_count") || !e.layer) continue;
      const p = paramsOfEffect(e);
      if (!applies(e, seat, req, p)) continue;
      for (const layer of e.layer) mods.push(toModifier(layer, def.name, p.draw[layer]));
    }
  });
  return mods;
}
