/**
 * 神授♥5（04 ♥5 / 01-S17 / 06-Q12）——原语 `draw_obligation`。
 *
 * 它改的是 **U1「无牌可出必须摸牌」的强制性**，不是摸几张：02 §7 那台层级机器一层都不碰。
 * 所以这个文件只导出**一个判据**，牌桌上「此刻还必须摸吗」的唯一出处：
 *
 * - `legalActions` 用它决定给不给「结束回合」（无牌可出时）
 * - `endTurn` 用它决定「没摸过就想结束」拒不拒
 * - **恋战**（03 §4：因无牌打出而摸牌时要摸到能打出为止）将来建执行面时也问它——
 *   S17 的「神授优先于恋战」因此不必写成两条技能之间的互斥，问同一个判据就是了
 *
 * 「无牌可出」的口径与出牌路径同源（`playableFor`，含 03 §4 五彩那类状态限制）：
 * 少一处同源，就会出现「坞里给了结束回合、引擎却说必须先摸」这种对不上的局面。
 */
import { playableFor } from "../legal.ts";
import { SKILL_DATA } from "./draw-passives.ts";
import { suppressionOf } from "./primitives/suppression.ts";
import type { SkillData } from "./draw-passives.ts";
import type { DrawRequest } from "./primitives/draw-modifier.ts";
import type { Board } from "../types.ts";

/** 这个座位手上还有能打的牌吗（含状态限制）。 */
const hasPlayable = (b: Board, seat: number): boolean =>
  b.hands[seat].some((c) => playableFor(b, seat, c));

/**
 * `seat` 身上有没有「可以不摸」的那条被动。**按定义找，不认技能 id**：
 * `modifies` 含 `draw_obligation`。V3 没亮出不算数；被封印时整支关掉（01-P9）。
 */
const optionalDraw = (b: Board, seat: number, data: SkillData): boolean => {
  const id = b.skills[seat];
  if (!id || !b.revealed[seat]) return false;
  const def = data.byId.get(id);
  if (!def || def.structured !== true) return false;
  if (def.sealable !== false && suppressionOf(b, seat).includes("sealed")) return false;
  return (def.effects ?? []).some((e) => e.modifies?.includes("draw_obligation"));
};

/**
 * **01-S17b 的五种情形**：只有它们是「一定要摸」。这是那五条**唯一**的机读落点。
 *
 * ① 受到惩罚 = `kind: "punish"`（01-P1 的定义，engine 里本来就分得开）
 * ③ 受到其他玩家技能 = `kind: "skill"` 且发起者不是自己（与恩惠的「他人技能」同一口径，06-Q56）
 * ②④⑤ 都是 `kind: "rule"`，光看 kind 认不出，所以由调用方写 `reason`
 */
export function drawIsForced(req: DrawRequest): boolean {
  if (req.kind === "punish") return true;
  if (req.kind === "skill" && (req.initiator ?? req.seat) !== req.seat) return true;
  return req.reason !== undefined;
}

/**
 * 这一次摸牌，他能不能**不摸**（神授♥5 / 01-S17b）。
 * 五种情形之外一律可以不摸——包括自己打出/发动造成的（2026-08-03 裁定：每次都问）。
 */
export function mayDeclineDraw(
  b: Board,
  seat: number,
  req: DrawRequest,
  data: SkillData = SKILL_DATA,
): boolean {
  return !drawIsForced(req) && optionalDraw(b, seat, data);
}

/**
 * **U1 的「无牌可出必须摸」此刻还成不成立**——`legalActions` 给不给「结束回合」、
 * `endTurn` 拒不拒，问的都是它。
 *
 * 手上有得打就恒为 true：04 ♥5 说的是「**无牌可出**时可不摸直接结束」，不是随便空过。
 * 剩下那一半直接问 `mayDeclineDraw`，与其他摸牌路径同一个判据（**恋战**将来也问它，
 * S17 的「神授优先」因此不必写成技能间的互斥）。
 */
export function mustDrawWhenStuck(b: Board, seat: number, data: SkillData = SKILL_DATA): boolean {
  if (hasPlayable(b, seat)) return true;
  return !mayDeclineDraw(b, seat, { kind: "rule", base: 1, seat }, data);
}
