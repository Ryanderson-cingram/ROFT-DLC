import type { Board, Card, Color, Ctx, Face, GameState } from "../src/types.ts";

/** 确定性伪随机源，只用于测试——引擎自身永远不产生随机数（spec §5.1）。 */
export const lcg = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

export const ctx = (rng = lcg(1), now = "2026-07-28T12:00:00.000Z"): Ctx => ({ rng, now });

export const lobby = (n: number): GameState => ({
  version: 0,
  phase: "lobby",
  seats: Array.from({ length: n }, (_, i) => ({ userId: `u${i}` })),
});

let uid = 0;
export const card = (color: Color | null, face: Face): Card => ({ id: `${color ?? "W"}${face}#t${uid++}`, color, face });

/** 直接摆一个牌桌，跳过发牌——出牌规则的测试要控制手牌。 */
export function table(hands: Card[][], board: Partial<Board> = {}, state: Partial<GameState> = {}): GameState {
  const top = board.discardPile?.[0] ?? card("R", "7");
  return {
    version: 10,
    phase: "turnStart",
    seats: hands.map((_, i) => ({ userId: `u${i}` })),
    ...state,
    board: {
      rulePack: "base",
      drawPile: [card("G", "1"), card("G", "2"), card("G", "3")],
      discardPile: [top],
      hands,
      activeColor: top.color,
      currentSeat: 0,
      direction: 1,
      saidUno: hands.map(() => false),
      skills: hands.map(() => null),
      revealed: hands.map(() => false),
      activatedThisTurn: hands.map(() => false),
      marks: hands.map(() => ({})),
      statuses: hands.map(() => []),
      drawnPlayable: null,
      ...board,
    },
  };
}
