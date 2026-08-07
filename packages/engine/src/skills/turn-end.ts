/**
 * 回合结束触发的被动（02 §3 的 `window: turn_end`）。
 *
 * 第一个用户是八门♠8②「回合结束获五彩」，但这里**不认技能 id**：凡是已亮出的技能里
 * 有 `kind: status_grant` + `window: turn_end` + `grants` 的子效果，回合一交就按 `grants`
 * 赋状态。互斥、不叠层、领域免恋战三条由 03 §4 的原语兜底（`grantStatus`），这里不复述。
 *
 * 落点在 `applyAction` 的出口（同 `settleUnoCall` / `settleStalemate`）：
 * 交回合的路径有七八条（出牌、摸牌、吃惩罚、跳过、洗牌重分…），逐条挂钩必漏，
 * 而「`currentSeat` 变了」是它们共同的、可观察的终点。
 */
import { rotateFuncPlay } from "./alliance.ts";
import { grantStatus } from "./primitives/statuses.ts";
import { suppressionOf } from "./primitives/suppression.ts";
import { SKILL_DATA } from "./draw-passives.ts";
import type { SkillData } from "./draw-passives.ts";
import type { ApplyResult, Board, GameState } from "../types.ts";

/** `seat` 此刻的回合末赋状态清单。V3 没亮出不算数；被封印时整支关掉（01-P9）。 */
function grantsAtTurnEnd(b: Board, seat: number, data: SkillData): string[] {
  const id = b.skills[seat];
  if (!id || !b.revealed[seat]) return [];
  const def = data.byId.get(id);
  if (!def || def.structured !== true) return [];
  if (def.sealable !== false && suppressionOf(b, seat).includes("sealed")) return [];
  return (def.effects ?? []).flatMap((e) =>
    e.kind === "status_grant" && e.window === "turn_end" ? (e.grants ?? []) : [],
  );
}

/**
 * 交回合那一刻结算回合末的赋状态。判据与 `settleUnoCall` 同源：
 * **离场的那个座位** = 动作之前的 `currentSeat`，且这次动作确实把回合交了出去。
 */
export function settleTurnEnd(
  before: GameState,
  r: ApplyResult,
  data: SkillData = SKILL_DATA,
): ApplyResult {
  const b0 = before.board;
  const b1 = r.state.board;
  if (r.rejected || !b0 || !b1) return r;
  const seat = b0.currentSeat;
  if (b1.currentSeat === seat) return r;

  // 01-S14b：连击账在交回合那一刻轮转（这回合 → 上回合）。**无条件**，与技能无关
  let board = rotateFuncPlay(b1, seat);
  const events = [];
  for (const status of grantsAtTurnEnd(b1, seat, data)) {
    const after = grantStatus(board, seat, status);
    // 03 §4 挡下来时（已经有了 / 三者互斥）静默无效，不发事件——牌桌上什么都没发生
    if (after === board) continue;
    board = after;
    events.push({ type: "statusGranted", public: { seat, status, skillId: b1.skills[seat] } });
  }
  // 这里不走 `commit`：回合已经交完了，再涨一次版本号会把刚发出去的窗口 id 作废
  return { ...r, state: { ...r.state, board }, events: [...r.events, ...events] };
}
