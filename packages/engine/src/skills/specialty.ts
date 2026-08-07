/**
 * 专精♥9（04 ♥9 / 06-Q67 / 06-Q68）。
 *
 * 卡面四条，**四个落点全是已有的单一判定点**，这个文件只提供「他的色是什么」与
 * 「这条链他要摸几张」两个判据：
 *
 * | 卡面 | 落点 |
 * |---|---|
 * | 亮出时底牌定色 | 亮出钩子 → `Board.chosen`（与吟游的歌声共用那个槽） |
 * | 该色 +2 打得出但你不摸 | `punishBase`（喂给 L0 的那个数）→ `punish.ts::settle` |
 * | 当前色 = 你的色 → 可打任意数字 | `legal.ts::playableFor` |
 * | 变色只能选你的色 | `legal.ts::requiredColor` |
 * | 免疫五彩 | 数据里的 `immune` → `canGrantStatus` |
 *
 * 06-Q68 的两条推论都在 `punishBase` 里：**逐段**过滤（段里已含强袭倍率）、
 * **链上贡献一张不减**（下家照吃满）——过滤只发生在**受罚侧读它的那一刻**。
 */
import { suppressionOf } from "./primitives/suppression.ts";
import { SKILL_DATA } from "./draw-passives.ts";
import type { SkillData } from "./draw-passives.ts";
import type { SkillDef } from "./types.ts";
import type { Board, Color, PunishChain } from "../types.ts";

/** 已亮出、没被封印的定义（V3 / 01-P9）。三条钩子都从这里起步。 */
function liveDef(b: Board, seat: number, data: SkillData): SkillDef | undefined {
  const id = b.skills[seat];
  if (!id || !b.revealed[seat]) return undefined;
  const def = data.byId.get(id);
  if (!def || def.structured !== true) return undefined;
  if (def.sealable !== false && suppressionOf(b, seat).includes("sealed")) return undefined;
  return def;
}

/**
 * `seat` 的专精色（没有则 undefined）。**按定义找，不认技能 id**：
 * 有一条 `kind: on_reveal` + `modifies: [color_rule]` 的效果 = 这张牌亮出时要定色，
 * 定下来的那个色存在 `Board.chosen[技能 id]` 里（与吟游的歌声共用那个槽）。
 */
export function specialtyColor(b: Board, seat: number, data: SkillData = SKILL_DATA): Color | undefined {
  const def = liveDef(b, seat, data);
  if (!def || !(def.effects ?? []).some(definesColorAtReveal)) return undefined;
  return b.chosen?.[def.id]?.seat === seat ? (b.chosen[def.id].key as Color) : undefined;
}

/** 亮出时要定色的那条效果（同一形状在亮出钩子里也用一次）。 */
export const definesColorAtReveal = (e: { kind?: string | null; modifies?: string[] }) =>
  e.kind === "on_reveal" && !!e.modifies?.includes("color_rule");

/**
 * 亮出那一刻取哪个色：**摸牌堆最底下那张有色的牌**（无色牌往上顺延）。
 *
 * ⚠️ 04 原文只写「底牌定色」，「底牌」= 摸牌堆底是引擎的读法，见 spec 的收尾清单。
 * 整副牌一张有色的都没有（理论上不可能）→ 定不出色，那就没有专精色。
 */
export const colorFromBottom = (b: Board): Color | undefined => {
  for (let i = b.drawPile.length - 1; i >= 0; i--) {
    const c = b.drawPile[i].color;
    if (c) return c;
  }
  return undefined;
};

/**
 * 这条惩罚链**这个受罚者**要按几张摸（06-Q67/Q68）。
 *
 * `base` = Σ 不被他的专精色免掉的段贡献（段里已含强袭倍率）；
 * `skip` = 全免（过滤掉了东西且剩 0）→ **整个摸牌事件跳过**，不是「摸 0 张」——
 * 后者会被 L4/L5 抬回来（同狂欢和4 / 06-Q27 的口径）。
 *
 * **+4 不适用**：它是无色牌，没有「该色」可谈（Q67）。
 */
export function punishBase(
  b: Board,
  seat: number,
  chain: PunishChain,
  data: SkillData = SKILL_DATA,
): { base: number; skip: boolean } {
  const color = specialtyColor(b, seat, data);
  if (!color) return { base: chain.total, skip: false };
  const kept = chain.segments.filter((s) => !(s.face === "+2" && s.color === color));
  const base = kept.reduce((n, s) => n + s.draw, 0);
  return { base, skip: kept.length < chain.segments.length && base === 0 };
}
