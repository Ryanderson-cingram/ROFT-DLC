/**
 * 伤逝♥10（04 ♥10 / 01-P13 / 02 §7 L1）。
 *
 * 「受罚时**只按链上 +2/+4 的张数**掷骰摸牌；忽略贡献总和与吟游等一切改摸数。」
 *
 * 两个要点，都容易写错：
 *
 * 1. **张数 ≠ 贡献总和**。`PunishChain.segments.length` 才是「链上几张」，`total` 是
 *    加总后的贡献（强袭×点数、远星视为的那张都已经计进 total）。01-P13 明写伤逝
 *    忽略 total，所以这里数的是 `segments`。
 * 2. **随机在组装修正之前做完**。`drawModifiersFor` 是纯函数、拿不到 rng
 *    （`draw-modifier.ts` 顶注：「掷骰之类的随机在组装修正之前由调用方用注入的 rng 做完，
 *    落到 L1 的 `value` 上」）。所以伤逝不走那条数据驱动的路，而是由**吃下**那一步
 *    先掷好、再作为 `mods` 传进 `drawCards`。
 *
 * L1 一命中就直接得最终值并跳到 L5（见 `resolveDrawCount`），所以恩惠的 −2、吟游的
 * 活泼板/战争序全都不作数——这正是 P13 要的「忽略一切改摸数」。
 */
import { rollDice, sealedOff } from "../actions/dice.ts";
import { SKILL_DATA } from "./draw-passives.ts";
import type { SkillData } from "./draw-passives.ts";
import type { DrawModifier } from "./primitives/draw-modifier.ts";
import type { SkillEffect } from "./types.ts";
import type { Board, PunishChain } from "../types.ts";

/** 按定义找，不认技能 id：`kind: replacement` + 改 `draw_count` + 落 L1 的那一条。 */
const isReplacement = (e: SkillEffect) =>
  e.kind === "replacement" && !!e.modifies?.includes("draw_count") && !!e.layer?.includes("L1");

/**
 * 吃下惩罚的人身上有没有伤逝；有就掷好骰、给出那条 L1 修正。
 * 返回空数组 = 没有（绝大多数情况），调用方原样把它摊进 `mods`。
 *
 * 掷 `segments.length` 颗三面骰（01-R1，每颗 0/1/2）并求和——**可以掷出 0**，
 * 那就是一张都不摸，赌的就是这个（同强袭①的 0 倍）。
 */
export function damnationModifier(
  b: Board,
  seat: number,
  chain: PunishChain,
  rng: () => number,
  data: SkillData = SKILL_DATA,
): DrawModifier[] {
  const id = b.skills[seat];
  // V3：没亮出的技能对局面毫无影响
  const def = id && b.revealed[seat] ? data.byId.get(id) : undefined;
  if (!def || def.structured !== true || sealedOff(b, seat, def)) return [];
  const effect = (def.effects ?? []).find(isReplacement);
  if (!effect) return [];
  const values = rollDice(rng, chain.segments.length);
  return [{ layer: "L1", source: def.name, value: values.reduce((a, n) => a + n, 0) }];
}
