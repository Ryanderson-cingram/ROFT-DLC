import { shuffle } from "../deck.ts";
import { commit, MAX_RESHUFFLES, passTurn, playableFor, reject } from "../legal.ts";
import { drawModifiersFor } from "../skills/draw-passives.ts";
import { mustDrawWhenStuck } from "../skills/gift.ts";
import { resolveDrawCount } from "../skills/primitives/draw-modifier.ts";
import type { DrawModifier, DrawRequest, DrawResolution } from "../skills/primitives/draw-modifier.ts";
import type { ApplyResult, Board, Card, Ctx, EngineEvent, GameState } from "../types.ts";

/**
 * 唯一的摸牌出口：先把请求过一遍 02 §7 的层级 reducer 得出张数，再真的从牌堆取。
 * 层级在这里而不是在各调用点，是为了没有哪条摸牌路径能绕开它（spec §8 禁止 ad-hoc 排序）。
 *
 * 已亮出技能声明的修正也在这里采集，同样是为了绕不开：调用方只描述「谁因为什么摸几张」，
 * 场上有谁在改这个数不是它该知道的事。`mods` 参数留给调用方**当场算出来**的修正
 * （掷骰之类），它与采集到的合并后一起进 reducer。
 *
 * 摸空时把出牌堆（除牌顶）与弃牌堆一并洗回摸牌堆（06-Q55 三堆模型），**整局最多洗 2 次**
 * （01-U8）；洗满或洗回后仍不够就摸到几张算几张——所以 `drawn.length` 可能小于
 * `resolution.count`。洗满之后摸牌堆再见底即平局，那一步由 `index.ts::settleStalemate` 判。
 * 随机源只来自注入的 `rng`。
 */
export function drawCards(
  b: Board,
  req: DrawRequest,
  rng: () => number,
  mods: readonly DrawModifier[] = [],
): { board: Board; drawn: Card[]; reshuffledOrder: string[] | null; resolution: DrawResolution } {
  const resolution = resolveDrawCount(req, [...drawModifiersFor(b, req), ...mods]);
  let drawPile = b.drawPile.slice();
  let playedPile = b.playedPile;
  let discardPile = b.discardPile;
  let reshuffles = b.reshuffles ?? 0;
  const drawn: Card[] = [];
  let reshuffledOrder: string[] | null = null;
  for (let i = 0; i < resolution.count; i++) {
    if (drawPile.length === 0) {
      // U8：洗满 2 次就不再洗了，摸到几张算几张——平局的判定在 applyAction 的出口
      if (reshuffles >= MAX_RESHUFFLES) break;
      const back = [...playedPile.slice(1), ...discardPile];
      if (back.length === 0) break;
      drawPile = shuffle(back, rng);
      playedPile = playedPile.slice(0, 1);
      discardPile = [];
      reshuffles++;
      // 洗出来的牌序要留档（调研 §4）：重放读事件，不重新洗
      reshuffledOrder = drawPile.map((c) => c.id);
    }
    drawn.push(drawPile.shift()!);
  }
  return { board: { ...b, drawPile, playedPile, discardPile, reshuffles }, drawn, reshuffledOrder, resolution };
}

/**
 * 摸牌事件：公开只说谁摸了几张，具体牌面走 private 投影（spec §4）。
 *
 * `replacedBy` = `DrawResolution.replacedBy`，L1 命中时是谁改写了这次计算（伤逝）。
 * 走 public：技能亮着，牌桌上人人看得见他摸了几张，只是不知道为什么少——
 * 补上这个名字，前端才说得出「伤逝：掷出 1」而不是干巴巴一个数。
 */
export function drawEvents(
  seat: number,
  drawn: Card[],
  reshuffledOrder: string[] | null,
  replacedBy?: string,
): EngineEvent[] {
  return [
    // public 只说「洗过了」与洗回多少张；牌序进 audit，谁都不发
    ...(reshuffledOrder
      ? [{ type: "deckReshuffled", public: { count: reshuffledOrder.length }, audit: { order: reshuffledOrder } }]
      : []),
    {
      type: "cardsDrawn",
      public: { seat, count: drawn.length, ...(replacedBy && { replacedBy }) },
      private: { seat, payload: { cards: drawn } },
    },
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
  const { board, drawn, reshuffledOrder } = drawCards(b, { kind: "rule", base: 1, seat }, ctx.rng);
  const withCard: Board = { ...board, hands: giveTo(board, seat, drawn) };
  const events = drawEvents(seat, drawn, reshuffledOrder);

  const playable = drawn[0] && playableFor(withCard, seat, drawn[0]);
  if (playable) return { state: commit(state, { ...withCard, drawnPlayable: drawn[0] }, "play"), events };
  // 摸到的牌打不出去 → 回合直接结束，不必再点一次
  return {
    state: commit(state, { ...withCard, drawnPlayable: null, ...passTurn(withCard, ctx.now, seat) }, "turnStart"),
    events,
  };
}

/**
 * U1：摸到可打的牌但选择不打 → 结束回合。没摸过牌**默认**不能空过——
 * 唯一的例外是神授♥5（01-S17：无牌可出时可以不摸直接结束），判据走 `mustDrawWhenStuck`，
 * 与 `legalActions` 给不给这条动作是同一个出处。
 */
export function endTurn(state: GameState, seat: number, ctx: Ctx): ApplyResult {
  const b = state.board;
  if (!b) return reject(state, "not_started");
  if (state.pendingWindow) return reject(state, "pending_window");
  if (seat !== b.currentSeat) return reject(state, "not_your_turn");
  // P3：选了叠就得叠，不能改成空过（同 drawCard 那一条）
  if (b.punish) return reject(state, "must_stack");
  if (!b.drawnPlayable && mustDrawWhenStuck(b, seat)) return reject(state, "must_draw_first");
  return {
    state: commit(state, { ...b, drawnPlayable: null, ...passTurn(b, ctx.now, seat) }, "turnStart"),
    events: [{ type: "turnEnded", public: { seat } }],
  };
}
