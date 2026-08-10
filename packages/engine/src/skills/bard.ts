/**
 * 吟游♣5 的歌声（04 ♣5 / 01-S20 / 06-Q62–Q66）。
 *
 * 卡面：「回合开始时若你的上家打出的不是 +2 或 +4，则你可以选择一种歌声。」
 * 四支歌声（战争序 ×2 惩罚 / 樱时雨 惩罚恒为 1 / 活泼板 所有摸牌 +1 / 行进曲 变色牌不改色）
 * 在数据里是**①的四个选项**（`option_of: 1`），所以这个文件里没有一支歌声的名字：
 *
 * - **选哪支**：发动①并报那支的 key，走 `activateSkill` 那条脊梁（V7 的额度由它记，01-S20）
 * - **生效**：`drawModifiersFor` 只收「当前选中的那一支」（通用的选项闸门，不认技能 id）；
 *   行进曲不改摸牌数，由 `legal.ts::colorLocked` 与五彩共用一条判定
 * - **全场生效**（06-Q62）：四支都标 `targeting: global`，采集口径因此不是「收自己的」
 * - **封印**（06-Q65）：只压制、不清值——采集器本来就跳过被封印者的定义，
 *   `Board.chosen` 那个值原样留着，解封即回到原来那一支
 * - **后唱覆盖先唱**（06-Q66）：`Board.chosen` 按**技能 id** 存一份，技能全场唯一 ⇒ 只有一支
 */
import { suppressionOf } from "./primitives/suppression.ts";
import type { SkillData } from "./draw-passives.ts";
import type { SkillDef, SkillEffect } from "./types.ts";
import type { Board } from "../types.ts";

/**
 * 03 §1 的惩罚牌面。这里只用来判「上家刚打出的是不是 +2/+4」——
 * 不 import `actions/punish.ts`：那会把 `legal.ts → skills → actions → legal.ts` 连成环，
 * 而这两个字面量本来就是牌面事实（03 §1），不是那边的实现细节。
 */
const PUNISH_FACES = new Set(["+2", "+4"]);

/** 这个技能当前选中的那个选项（`option_of` 的另一半）。缺席 = 还没选过。 */
const chosenOption = (b: Board, skillId: string): string | undefined => b.chosen?.[skillId]?.key;

/**
 * `seat` 此刻能不能选/换选项：卡面写着「回合开始时若你的**上家打出的不是 +2 或 +4**」。
 * 牌顶那张就是上家刚打出的（惩罚轮里牌顶必是 +2/+4），所以这一条也自动兑现了
 * 「惩罚轮里换不了歌」。
 */
export const canChooseOption = (b: Board): boolean => !PUNISH_FACES.has(b.playedPile[0]?.face ?? "");

/** 记下选中的那一支（后选覆盖先选）。 */
export const chooseOption = (b: Board, skillId: string, key: string, seat: number): Board => ({
  ...b,
  chosen: { ...b.chosen, [skillId]: { key, seat } },
});

/**
 * 一条**选项**此刻生不生效：被选中才算数。不是选项的效果（没有 `option_of`）恒为 true。
 * 通用闸门——`drawModifiersFor` 与 `colorLocked` 都问它，将来心火♥Q 的三选一照用。
 */
export const optionLive = (b: Board, def: SkillDef, e: SkillEffect): boolean =>
  !e.option_of || chosenOption(b, def.id) === e.key;

/**
 * 全场是否有一支**已生效**的歌声在改写「变色牌能不能改色」（行进曲）。
 * V3 没亮出不算数、被封印期间失效（06-Q65：值留着，只是读不到）。
 * 按定义找：`modifies` 含 `color_rule` 且 `targeting: global` 的那条选项。
 */
export function globalColorLock(b: Board, data: SkillData): boolean {
  for (const [seat, id] of b.skills.entries()) {
    if (!id || !b.revealed[seat]) continue;
    const def = data.byId.get(id);
    if (!def || def.structured !== true) continue;
    if (def.sealable !== false && suppressionOf(b, seat).includes("sealed")) continue;
    const hit = (def.effects ?? []).some(
      (e) => e.targeting === "global" && !!e.modifies?.includes("color_rule") && optionLive(b, def, e),
    );
    if (hit) return true;
  }
  return false;
}
