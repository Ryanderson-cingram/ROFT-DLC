import { isPlayable, isWild, nextSeat } from "../legal.ts";
import type { ApplyResult, Board, Card, Color, Ctx, GameState } from "../types.ts";

const reject = (state: GameState, reason: string): ApplyResult => ({ state, events: [], rejected: { reason } });

/** 把牌桌换成新的，version + 1；输入 state 永不修改。 */
export const commit = (state: GameState, board: Board, phase: GameState["phase"] = state.phase): GameState => ({
  ...state,
  version: state.version + 1,
  phase,
  board,
});

export function playCards(
  state: GameState,
  action: { seat: number; cardIds: string[]; chosenColor?: Color },
  _ctx: Ctx,
): ApplyResult {
  const b = state.board;
  if (!b) return reject(state, "not_started");
  if (state.pendingWindow) return reject(state, "pending_window");
  if (state.phase !== "turnStart" && state.phase !== "play") return reject(state, "wrong_phase");
  if (action.seat !== b.currentSeat) return reject(state, "not_your_turn");
  // ponytail: 并列 / 神化的多张打出是下一个计划（G1/G2）的事
  if (action.cardIds.length !== 1) return reject(state, "single_card_only");

  const card = b.hands[action.seat].find((c) => c.id === action.cardIds[0]);
  if (!card) return reject(state, "not_in_hand");
  // U1：摸到可打的牌后，本回合只能打那一张，或者结束回合
  if (b.drawnPlayable && b.drawnPlayable.id !== card.id) return reject(state, "must_play_drawn_or_end");
  if (!isPlayable(card, b.discardPile[0], b.activeColor)) return reject(state, "illegal_card");
  if (isWild(card) && !action.chosenColor) return reject(state, "color_required");

  return resolvePlay(state, b, action.seat, card, action.chosenColor);
}

function resolvePlay(
  state: GameState,
  b: Board,
  seat: number,
  card: Card,
  chosenColor?: Color,
): ApplyResult {
  const hands = b.hands.map((h, i) => (i === seat ? h.filter((c) => c.id !== card.id) : h));
  const played: Board = {
    ...b,
    hands,
    discardPile: [card, ...b.discardPile],
    activeColor: chosenColor ?? card.color,
    direction: card.face === "rev" ? ((b.direction * -1) as 1 | -1) : b.direction,
    drawnPlayable: null,
  };
  const events = [
    { type: "cardPlayed", public: { seat, card, chosenColor: chosenColor ?? null } },
  ];

  if (hands[seat].length === 0)
    return { state: { ...commit(state, { ...played, winner: seat }, "finished") }, events };

  // 「停」跳过下家的回合开始窗口（U3 + 传统 UNO）
  const step = card.face === "skip" ? 2 : 1;
  return {
    state: commit(state, { ...played, currentSeat: nextSeat(played, seat, step) }, "turnStart"),
    events,
  };
}
