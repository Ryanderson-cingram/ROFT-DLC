import { buildDeck, shuffle } from "../deck.ts";
import type { ApplyResult, Card, Ctx, EngineEvent, GameState } from "../types.ts";

const HAND_SIZE = 7; // S1b

/**
 * 开局：每人 7 张（S1b），再翻开牌顶第一张作为起始弃牌。
 * 起始牌翻到无色牌（变色 / +4）时压回牌堆底重翻，直到翻出四色牌为止——
 * 否则 `activeColor` 无从确定。
 */
export function startGame(state: GameState, ctx: Ctx): ApplyResult {
  if (state.phase !== "lobby") return { state, events: [], rejected: { reason: "not_in_lobby" } };
  const n = state.seats.length;
  if (n < 3 || n > 4) return { state, events: [], rejected: { reason: "bad_seat_count" } };

  const rulePack = state.config?.rulePack ?? "base";
  const pile = shuffle(buildDeck(rulePack), ctx.rng);
  // 洗牌结果留档，重放读它而不是重新洗（调研 §4）。绝不能进 public。
  const shuffledOrder = pile.map((c) => c.id);
  const hands: Card[][] = [];
  for (let seat = 0; seat < n; seat++) hands.push(pile.splice(0, HAND_SIZE));
  while (pile[0].color === null) pile.push(pile.shift()!);
  const starter = pile.shift()!;

  const events: EngineEvent[] = [
    {
      type: "gameStarted",
      public: { seats: n, handSize: HAND_SIZE, starter, drawPile: pile.length },
      audit: { rulePack, shuffledOrder },
    },
    ...hands.map((cards, seat): EngineEvent => ({
      type: "handDealt",
      public: { seat, count: cards.length },
      private: { seat, payload: { cards } },
    })),
  ];
  return {
    state: {
      ...state,
      version: state.version + 1,
      phase: "turnStart",
      board: {
        rulePack,
        drawPile: pile,
        discardPile: [starter],
        hands,
        activeColor: starter.color,
        currentSeat: 0,
        direction: 1,
        saidUno: hands.map(() => false),
        skills: hands.map(() => null),
        drawnPlayable: null,
      },
    },
    events,
  };
}
