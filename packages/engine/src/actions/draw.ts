import { shuffle } from "../deck.ts";
import { commit, isPlayable, passTurn, reject } from "../legal.ts";
import { resolveDrawCount } from "../skills/primitives/draw-modifier.ts";
import type { DrawModifier, DrawRequest, DrawResolution } from "../skills/primitives/draw-modifier.ts";
import type { ApplyResult, Board, Card, Ctx, EngineEvent, GameState } from "../types.ts";

/**
 * 唯一的摸牌出口：先把请求过一遍 02 §7 的层级 reducer 得出张数，再真的从牌堆取。
 * 层级在这里而不是在各调用点，是为了没有哪条摸牌路径能绕开它（spec §8 禁止 ad-hoc 排序）。
 *
 * 摸空时把弃牌堆（除牌顶）洗回摸牌堆；洗回后仍不够就摸到几张算几张
 * ——所以 `drawn.length` 可能小于 `resolution.count`。随机源只来自注入的 `rng`。
 */
export function drawCards(
  b: Board,
  req: DrawRequest,
  rng: () => number,
  mods: readonly DrawModifier[] = [],
): { board: Board; drawn: Card[]; reshuffledOrder: string[] | null; resolution: DrawResolution } {
  const resolution = resolveDrawCount(req, mods);
  let drawPile = b.drawPile.slice();
  let discardPile = b.discardPile;
  const drawn: Card[] = [];
  let reshuffledOrder: string[] | null = null;
  for (let i = 0; i < resolution.count; i++) {
    if (drawPile.length === 0) {
      if (discardPile.length <= 1) break;
      drawPile = shuffle(discardPile.slice(1), rng);
      discardPile = [discardPile[0]];
      // 洗出来的牌序要留档（调研 §4）：重放读事件，不重新洗
      reshuffledOrder = drawPile.map((c) => c.id);
    }
    drawn.push(drawPile.shift()!);
  }
  return { board: { ...b, drawPile, discardPile }, drawn, reshuffledOrder, resolution };
}

/** 摸牌事件：公开只说谁摸了几张，具体牌面走 private 投影（spec §4）。 */
export function drawEvents(seat: number, drawn: Card[], reshuffledOrder: string[] | null): EngineEvent[] {
  return [
    // public 只说「洗过了」与洗回多少张；牌序进 audit，谁都不发
    ...(reshuffledOrder
      ? [{ type: "deckReshuffled", public: { count: reshuffledOrder.length }, audit: { order: reshuffledOrder } }]
      : []),
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
  // P3：选了叠就得叠，不能改成摸牌
  if (b.punish) return reject(state, "must_stack");
  if (b.drawnPlayable) return reject(state, "already_drawn");

  // U1 是规则摸牌，不是惩罚（01-P1）
  const { board, drawn, reshuffledOrder } = drawCards(b, { kind: "rule", base: 1 }, ctx.rng);
  const withCard: Board = { ...board, hands: giveTo(board, seat, drawn) };
  const events = drawEvents(seat, drawn, reshuffledOrder);

  const playable = drawn[0] && isPlayable(drawn[0], withCard.discardPile[0], withCard.activeColor);
  if (playable) return { state: commit(state, { ...withCard, drawnPlayable: drawn[0] }, "play"), events };
  // 摸到的牌打不出去 → 回合直接结束，不必再点一次
  return {
    state: commit(state, { ...withCard, drawnPlayable: null, ...passTurn(withCard, seat) }, "turnStart"),
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
    state: commit(state, { ...b, drawnPlayable: null, ...passTurn(b, seat) }, "turnStart"),
    events: [{ type: "turnEnded", public: { seat } }],
  };
}
