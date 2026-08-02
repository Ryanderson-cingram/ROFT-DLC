import type { Board, Card, Color, Ctx, Face, GameState, RulePack } from "../src/types.ts";

/** 确定性伪随机源，只用于测试——引擎自身永远不产生随机数（spec §5.1）。 */
export const lcg = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

export const NOW = "2026-07-28T12:00:00.000Z";
export const ctx = (rng = lcg(1), now = NOW): Ctx => ({ rng, now });

/**
 * `NOW` 之后 `ms` 毫秒的 ctx。抓漏喊的测试要用它跨过 U7b 那 1 秒补喊宽限——
 * 所有动作默认都在同一个 `NOW`，不推时间的话交回合后立刻抓一律 `uno_grace`。
 */
export const ctxAfter = (ms: number, rng = lcg(1)): Ctx =>
  ctx(rng, new Date(Date.parse(NOW) + ms).toISOString());

/**
 * 掷出指定点数的 rng（01-R1 的三面骰：`Math.floor(rng() * 3)`）。
 * 用完循环，所以 `roll(2)` 是「每一颗都掷 2」。
 */
export const roll = (...values: number[]) => {
  let i = 0;
  return () => (values[i++ % values.length] + 0.5) / 3;
};

export const lobby = (n: number, rulePack: RulePack = "base"): GameState => ({
  version: 0,
  phase: "lobby",
  seats: Array.from({ length: n }, (_, i) => ({ userId: `u${i}` })),
  config: { rulePack, skillDraft: "draft3" },
});

let uid = 0;
export const card = (color: Color | null, face: Face): Card => ({ id: `${color ?? "W"}${face}#t${uid++}`, color, face });

/** 直接摆一个牌桌，跳过发牌——出牌规则的测试要控制手牌。 */
export function table(hands: Card[][], board: Partial<Board> = {}, state: Partial<GameState> = {}): GameState {
  const top = board.playedPile?.[0] ?? card("R", "7");
  return {
    version: 10,
    phase: "turnStart",
    seats: hands.map((_, i) => ({ userId: `u${i}` })),
    ...state,
    board: {
      rulePack: "base",
      drawPile: [card("G", "1"), card("G", "2"), card("G", "3")],
      playedPile: [top],
      discardPile: [],
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
