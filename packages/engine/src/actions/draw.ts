import { shuffle } from "../deck.ts";
import { isPlayable, nextSeat } from "../legal.ts";
import { commit, reject } from "./play-cards.ts";
import type { ApplyResult, Board, Card, Ctx, EngineEvent, GameState } from "../types.ts";

/**
 * 从摸牌堆取 n 张。摸空时把弃牌堆（除牌顶）洗回摸牌堆；洗回后仍不够就摸到几张算几张。
 * 随机源只来自注入的 `rng`。
 */
export function drawCards(b: Board, n: number, rng: () => number): { board: Board; drawn: Card[]; reshuffled: boolean } {
  let drawPile = b.drawPile.slice();
  let discardPile = b.discardPile;
  const drawn: Card[] = [];
  let reshuffled = false;
  for (let i = 0; i < n; i++) {
    if (drawPile.length === 0) {
      if (discardPile.length <= 1) break;
      drawPile = shuffle(discardPile.slice(1), rng);
      discardPile = [discardPile[0]];
      reshuffled = true;
    }
    drawn.push(drawPile.shift()!);
  }
  return { board: { ...b, drawPile, discardPile }, drawn, reshuffled };
}

/** 摸牌事件：公开只说谁摸了几张，具体牌面走 private 投影（spec §4）。 */
export function drawEvents(seat: number, drawn: Card[], reshuffled: boolean): EngineEvent[] {
  return [
    ...(reshuffled ? [{ type: "deckReshuffled", public: {} }] : []),
    { type: "cardsDrawn", public: { seat, count: drawn.length }, private: { seat, payload: { cards: drawn } } },
  ];
}

export const giveTo = (b: Board, seat: number, cards: Card[]): Board["hands"] =>
  b.hands.map((h, i) => (i === seat ? [...h, ...cards] : h));

/** U1：无牌可出（或选择不打）→ 摸牌；摸到符合规则可立即打出。 */
export function drawCard(state: GameState, seat: number, ctx: Ctx): ApplyResult {
  const b = state.board;
  if (!b) return reject(state, "not_started");
  if (state.pendingWindow) return reject(state, "pending_window");
  if (state.phase !== "turnStart" && state.phase !== "play") return reject(state, "wrong_phase");
  if (seat !== b.currentSeat) return reject(state, "not_your_turn");
  if (b.drawnPlayable) return reject(state, "already_drawn");

  const { board, drawn, reshuffled } = drawCards(b, 1, ctx.rng);
  const withCard: Board = { ...board, hands: giveTo(board, seat, drawn) };
  const events = drawEvents(seat, drawn, reshuffled);

  const playable = drawn[0] && isPlayable(drawn[0], withCard.discardPile[0], withCard.activeColor);
  if (playable) return { state: commit(state, { ...withCard, drawnPlayable: drawn[0] }, "play"), events };
  // 摸到的牌打不出去 → 回合直接结束，不必再点一次
  return {
    state: commit(state, { ...withCard, drawnPlayable: null, currentSeat: nextSeat(withCard, seat) }, "turnStart"),
    events,
  };
}

/** U1：摸到可打的牌但选择不打 → 结束回合。没摸过牌不能空过。 */
export function endTurn(state: GameState, seat: number): ApplyResult {
  const b = state.board;
  if (!b) return reject(state, "not_started");
  if (state.pendingWindow) return reject(state, "pending_window");
  if (seat !== b.currentSeat) return reject(state, "not_your_turn");
  if (!b.drawnPlayable) return reject(state, "must_draw_first");
  return {
    state: commit(state, { ...b, drawnPlayable: null, currentSeat: nextSeat(b, seat) }, "turnStart"),
    events: [{ type: "turnEnded", public: { seat } }],
  };
}
