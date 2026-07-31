/**
 * 血棘♦2（04 ♦2 / 01-P8/P9/P14/P15 / 06-Q36/Q38/Q41 / 06-Q56）。
 *
 * 被动：你**链首发起**的惩罚被吃下时，吃下者被封印（技能连被动一起关，01-P9/P14）。
 *   触发点在 `punish.ts::settle` 的 accept 分支，且必须排在 `drawCards` **之前**——
 *   06-Q36 裁定「血棘者打 +2，受罚者亮着恩惠 → 摸 2」，恩惠这一次就已经被封掉了。
 * ① 主动：掷 1 骰，当前被你封印的那个人摸等量（0/1/2）。骰子走 `rollWithTakeover`
 *   （强袭②可接管），所以「摸牌」是一条可序列化的 `ResumeSpec`，不是闭包。
 *
 * 封印的**消费**全场已经就位（`suppression` 认识 `"封印"`：主动发不了、被动不生效、
 * 亮不出来）；这里只管赋予与解除，以及 `sealedBy` 这本「谁封的我」的账。
 */
import { rollWithTakeover, sealedOff } from "./dice.ts";
import { drawCards, drawEvents, giveTo } from "./draw.ts";
import { commit, reject } from "../legal.ts";
import { SKILL_DATA } from "../skills/draw-passives.ts";
import { grantStatus, removeStatus } from "../skills/primitives/statuses.ts";
import type { SkillData } from "../skills/draw-passives.ts";
import type { SkillEffect } from "../skills/types.ts";
import type { ApplyResult, Board, Ctx, EngineEvent, GameState } from "../types.ts";

/** 03 §4 的状态名。压制层认的就是这四个字，两边必须一致。 */
const SEALED = "封印";

/** 谁封的我。缺席 = 一个人都没被封。 */
const bookOf = (b: Board): (number | null)[] => b.sealedBy ?? b.hands.map(() => null);

/**
 * `seat` 此刻有没有「惩罚被吃下就封印对方」这条被动。按定义找，不认技能 id：
 * `kind: status_grant` + `window: on_punish_resolve`。
 * V3 没亮出不算数；自己被封印时这条被动也一并关掉（01-P9，同 `draw-passives` 的理由）。
 */
const sealEffect = (b: Board, seat: number, data: SkillData): SkillEffect | undefined => {
  const id = b.skills[seat];
  const def = id && b.revealed[seat] ? data.byId.get(id) : undefined;
  if (!def || sealedOff(b, seat, def)) return undefined;
  return def.effects?.find((e) => e.kind === "status_grant" && e.window === "on_punish_resolve");
};

/**
 * 惩罚被吃下：若**链首**（01-P8，中间叠牌者有血棘无效）亮着血棘，封印受罚者。
 * 01-P14 的解除条件之一在这里落地：同一血棘至多罩一人，旧目标当场解封。
 * 没有血棘则原样返回，调用方不必先问。
 */
export function applySeal(
  b: Board,
  initiator: number,
  victim: number,
  data: SkillData = SKILL_DATA,
): { board: Board; events: EngineEvent[] } {
  // 2026-07-31 裁定：04 原文「你发起的惩罚使**目标**封印技能」，目标指别人——
  // 3 人局叠两次链就退回链首本人，此时封印不成立（血棘不封自己）。
  if (initiator === victim) return { board: b, events: [] };
  if (!sealEffect(b, initiator, data)) return { board: b, events: [] };

  const events: EngineEvent[] = [];
  const sealedBy = bookOf(b).slice();
  let board = b;
  sealedBy.forEach((by, s) => {
    if (by !== initiator || s === victim) return;
    board = removeStatus(board, s, SEALED);
    sealedBy[s] = null;
    events.push({ type: "sealLifted", public: { seat: s, reason: "replaced" } });
  });
  sealedBy[victim] = initiator;
  return {
    board: { ...grantStatus(board, victim, SEALED), sealedBy },
    events: [...events, { type: "sealed", public: { seat: victim, by: initiator } }],
  };
}

/**
 * 01-P14 的另一条解除条件：被封者**链首**打出 +2/+4 → 打出即解除。
 * 「打出即」很要紧：解封要排在这次出牌的其余结算之前，那条链里他自己的技能已经恢复。
 * 叠链（非链首）不解除——链首与否由调用方按 `b.punish` 判断。没被封则原样返回。
 */
export function liftSeal(b: Board, seat: number): { board: Board; events: EngineEvent[] } | null {
  if (bookOf(b)[seat] === null) return null;
  return {
    board: { ...removeStatus(b, seat, SEALED), sealedBy: bookOf(b).map((by, s) => (s === seat ? null : by)) },
    events: [{ type: "sealLifted", public: { seat, reason: "initiated" } }],
  };
}

/** 此刻被 `seat` 封印着的那个人（04 ♦2①的目标）。没有 = undefined。 */
export const sealedTargetOf = (b: Board, seat: number): number | undefined => {
  const i = bookOf(b).indexOf(seat);
  return i < 0 ? undefined : i;
};

/**
 * ①：掷骰放血。目标是「当前被你封印的那个人」——没有就发动不了（04 ♦2 补齐：无目标不可发动）。
 * 骰子颗数从定义的 `values.dice` 读。
 */
export function drainRoll(
  state: GameState,
  b: Board,
  seat: number,
  dice: number,
  ctx: Ctx,
  data: SkillData,
): ApplyResult {
  const target = sealedTargetOf(b, seat);
  if (target === undefined) return reject(state, "no_target");
  return rollWithTakeover(state, b, seat, "bloodthorn-drain", dice, { kind: "bloodthorn", seat, target }, ctx, data);
}

/**
 * ①的续跑：骰子定了（可能已被强袭②接管重掷）才知道摸几张。掷 0 = 摸 0，
 * 发动与 V7 额度照常消耗（额度在脊梁里已经记过了）。
 * 这次摸牌的发起者是血棘者本人，所以对被封者而言是「他人技能造成的摸牌」（06-Q56）——
 * 但他的恩惠此刻正被封着（06-Q36），实践中减不掉。
 */
export function resumeBloodthorn(
  state: GameState,
  board: Board,
  spec: { seat: number; target: number },
  values: number[],
  ctx: Ctx,
): ApplyResult {
  // 点数之和：定义给的是 1 颗，写成求和是为了颗数改了这里也不用动
  const base = values.reduce((a, v) => a + v, 0);
  const { board: b, drawn, reshuffledOrder } = drawCards(
    board,
    { kind: "skill", base, seat: spec.target, initiator: spec.seat },
    ctx.rng,
  );
  return {
    state: commit(state, { ...b, hands: giveTo(b, spec.target, drawn) }),
    events: drawEvents(spec.target, drawn, reshuffledOrder),
  };
}
