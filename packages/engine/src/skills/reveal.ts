/**
 * 亮出时机（01-V1 / V2 / V2b）的执行面。
 *
 * V1 是默认：**只能在自己的回合亮出**。V2 说 Excel 写明的时机是**白名单例外**，
 * 白名单写在定义里（`reveal_window` + 条件 `reveal_when`），所以这里是一张
 * 「窗口名 → 此刻成不成立」的表，不是技能名的 if/else——加一张写着例外的牌 = 改数据。
 *
 * V2b（2026-08-03 裁定）两条口径，都在这个文件里落地：
 *
 * 1. 例外**只放宽「必须是自己的回合」这一条**。反应窗口挂着时**一律禁亮**（含「任意时刻」）——
 *    亮出会当场改变正在结算的局面，那一条留在 `revealSkill` 里，不进这张表
 * 2. 认不出的窗口名**保守当作 `own_turn`**：白名单里有、但执行面还没建的（契约的
 *    `when_skipped`、偏折的 `when_challenged_uno`）宁可少放行，也不静默给出一个谁都没实现的例外
 */
import { colorFromBottom, definesColorAtReveal } from "./specialty.ts";
import { SKILL_DATA } from "./draw-passives.ts";
import type { SkillData } from "./draw-passives.ts";
import type { SkillDef } from "./types.ts";
import type { Board } from "../types.ts";

/** 引擎**真的会执行**的亮出窗口。不在表里的一律回落到 V1（自己的回合）。 */
const OUT_OF_TURN: ReadonlySet<string> = new Set(["any_time"]);

/**
 * 条件表（02 §6 的 `reveal_when`）。键不认识 = 条件不成立，同样是保守的那一侧。
 * 目前只有一条：神授♥5「手牌多时可主动亮出」= `{ hand_at_least: 10 }`（2026-08-08 裁定：10 张即可）。
 */
const CONDITIONS: Record<string, (b: Board, seat: number, n: number) => boolean> = {
  hand_at_least: (b, seat, n) => b.hands[seat].length >= n,
};

/**
 * `reveal_when` 的条件此刻成不成立。2026-08-08 裁定（01-V2b）：这是主动亮出的**门槛**，
 * 不满足时**连己方回合也不可亮**——不只是关掉「任意时刻」例外。没写条件的技能恒成立。
 */
export function revealConditionsMet(b: Board, seat: number, def?: SkillDef): boolean {
  return Object.entries(def?.reveal_when ?? {}).every(([k, n]) => CONDITIONS[k]?.(b, seat, n) ?? false);
}

/**
 * `seat` 此刻能不能在**别人的回合**亮出这张技能（V2 的白名单例外）。
 * `false` = 只能等自己的回合（V1 默认）。反应窗口那一条不在这里，见文件顶注。
 */
export function revealAllowedOutOfTurn(b: Board, seat: number, def?: SkillDef): boolean {
  return !!def?.reveal_window && OUT_OF_TURN.has(def.reveal_window);
}

/**
 * 亮出那一刻要当场结算的东西（02 §2 的 `kind: on_reveal`）。
 * 目前只有一支：专精♥9「亮出时底牌定色」——定下来的色存进 `Board.chosen`
 * （与吟游的歌声共用那个槽：吟游是玩家选的，专精是亮出时定死的）。
 * 按**定义的形状**认，不认技能 id；没有这条效果的技能原样返回。
 */
export function settleOnReveal(b: Board, seat: number, data: SkillData = SKILL_DATA): Board {
  const id = b.skills[seat];
  const def = id ? data.byId.get(id) : undefined;
  if (!def || !(def.effects ?? []).some(definesColorAtReveal)) return b;
  const color = colorFromBottom(b);
  return color ? { ...b, chosen: { ...b.chosen, [def.id]: { key: color, seat } } } : b;
}
