/**
 * 原语 `playability`：改写「这张牌现在能不能打」（02 §6 的 `modifies: card_value`）。
 *
 * 第一个用户是精英♥3：数字牌可以**当作大 1 点**打出，最高 9（04 ♥3）。
 * 关键在于它**只改合法性判定**——牌照常按**牌面**落到牌顶，下家跟的是牌面数字
 * （03 Q&A：牌顶红 4，手里蓝 3 可当蓝 4 打出，下家跟的仍是蓝 3）。
 * 所以这里返回的是「可以当作几点」，不返回一张改过的牌：一旦改牌，牌顶就跟着错了。
 */
import { isNumberCard } from "../../legal.ts";
import { paramsOfEffect } from "../params.ts";
import { suppressionOf } from "./suppression.ts";
import type { Board, Card } from "../../types.ts";
import type { SkillDef, SkillEffect } from "../types.ts";

export interface ValueOverride {
  /** 这张牌此刻可以当作几点打出 */
  value: number;
  /** 哪条子效果给的——占不占 V7 额度由它的 `stacks_with_turn_limit` 决定 */
  effect: SkillEffect;
}

/**
 * `seat` 此刻能不能把 `c` 当作别的点数打出。null = 没有这个能力，或这次用不上。
 *
 * 拦下的条件全部有出处：V3 亮出才生效；封印与惩罚回合走压制层（02 §2）；
 * 「仅剩 1 张手牌时失效」是精英自带的（04 ♥3）；上限从定义的 `values.max` 读。
 */
export function valueOverrideFor(b: Board, seat: number, c: Card, def?: SkillDef): ValueOverride | null {
  if (!def || !b.revealed[seat]) return null;
  if (suppressionOf(b, seat).length > 0) return null;
  if (b.hands[seat].length <= 1) return null;
  // 功能牌没有点数可加（03：精英只对数字牌有效，原 Q28）
  if (!isNumberCard(c)) return null;

  for (const e of def.effects ?? []) {
    if (!e.modifies?.includes("card_value")) continue;
    const { counts } = paramsOfEffect(e);
    const value = Number(c.face) + (counts.card_value ?? 0);
    // 上限之外不是「按上限打出」而是根本用不了：9 不能当 10（04 ♥3「最大 9」）
    if (counts.max !== undefined && value > counts.max) return null;
    return { value, effect: e };
  }
  return null;
}
