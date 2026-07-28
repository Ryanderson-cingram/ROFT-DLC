import { drawCard, endTurn } from "./actions/draw.ts";
import { playCards } from "./actions/play-cards.ts";
import { canStack, claimTimeout, respond, windowIdOf } from "./actions/punish.ts";
import { startGame } from "./actions/start-game.ts";
import { isPlayable } from "./legal.ts";
import type { Action, ApplyResult, ClientSnapshot, Ctx, GameState } from "./types.ts";
export * from "./types.ts";
export { buildDeck, shuffle } from "./deck.ts";
export { isPlayable } from "./legal.ts";

export function applyAction(state: GameState, action: Action, ctx: Ctx): ApplyResult {
  if (action.seat < 0 || action.seat >= state.seats.length)
    return { state, events: [], rejected: { reason: "invalid_seat" } };
  switch (action.type) {
    case "startGame":
      return startGame(state, ctx);
    case "playCards":
      return playCards(state, action, ctx);
    case "drawCard":
      return drawCard(state, action.seat, ctx);
    case "endTurn":
      return endTurn(state, action.seat);
    case "respond":
      return respond(state, action, ctx);
    case "claimTimeout":
      return claimTimeout(state, action, ctx);
    default:
      return { state, events: [], rejected: { reason: "unknown_action" } };
  }
}

/**
 * 这个座位此刻能做的事。客户端的「可打高亮」一律来自这里，不许自己判合法性。
 * 无色牌不带 `chosenColor`——定色是提交前的客户端模态，不是服务端窗口。
 */
export function legalActions(state: GameState, seat: number): Action[] {
  const b = state.board;
  if (!b || state.phase === "finished") return [];

  const w = state.pendingWindow;
  if (w) {
    // P1：惩罚窗口里只有叠或吃，主动技能不可用
    if (!w.actors.includes(seat)) return [];
    const windowId = windowIdOf(state)!;
    const choices = ["stack", "accept"].filter(
      (c) => c !== "stack" || (b.punish != null && b.hands[seat].some((card) => canStack(card, b.punish!))),
    );
    return choices.map((choice) => ({ type: "respond", seat, windowId, choice }));
  }

  if (seat !== b.currentSeat) return [];
  const top = b.discardPile[0];
  // U1：摸到可打的牌之后，只剩「打那一张」和「结束回合」
  if (b.drawnPlayable)
    return [
      { type: "playCards", seat, cardIds: [b.drawnPlayable.id] },
      { type: "endTurn", seat },
    ];
  const plays = b.hands[seat]
    .filter((c) => (b.punish ? canStack(c, b.punish) : isPlayable(c, top, b.activeColor)))
    .map((c): Action => ({ type: "playCards", seat, cardIds: [c.id] }));
  return b.punish ? plays : [...plays, { type: "drawCard", seat }];
}

/** 视角投影：只有 `seat` 自己的手牌进快照，其余玩家降级为公开计数。 */
export function projectView(state: GameState, seat: number): ClientSnapshot {
  const b = state.board;
  return {
    version: state.version,
    phase: state.phase,
    youSeat: seat,
    yourHand: b?.hands[seat] ?? [],
    players: state.seats.map((s, i) => ({
      seat: i,
      userId: s.userId,
      handCount: b?.hands[i].length ?? 0,
      saidUno: b?.saidUno[i] ?? false,
      skillId: b?.skills[i] ?? null,
      // ponytail: 神化是下一个计划（G1）的事，本轮恒为 0
      ascensions: 0,
    })),
    currentSeat: b?.currentSeat ?? null,
    direction: b?.direction ?? 1,
    activeColor: b?.activeColor ?? null,
    discardTop: b?.discardPile[0] ?? null,
    drawPileCount: b?.drawPile.length ?? 0,
    drawnPlayable: b?.drawnPlayable ?? null,
    punish: b?.punish,
    pendingWindow: state.pendingWindow,
    windowId: windowIdOf(state),
    winner: b?.winner,
    legalActions: legalActions(state, seat),
    disabledReasons: disabledReasons(state, seat),
  };
}

function disabledReasons(state: GameState, seat: number): Record<string, string> {
  const hand = state.board?.hands[seat];
  // ponytail: 只放 UI 现在真的会显示的那条；其余等 UI 提出需求再加
  return hand && hand.length > 2 ? { callUno: "剩 2 张牌时才需要喊" } : {};
}
