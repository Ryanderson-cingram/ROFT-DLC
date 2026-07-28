import type { ApplyResult, Board, Card, Color, Face, GameState } from "./types.ts";

export const reject = (state: GameState, reason: string): ApplyResult => ({ state, events: [], rejected: { reason } });

/**
 * 把牌桌换成新的，version + 1；输入 state 永不修改。
 * 任何状态转换默认关闭反应窗口——要开窗口的转换自己再挂上去。
 */
export const commit = (state: GameState, board: Board, phase: GameState["phase"] = state.phase): GameState => ({
  ...state,
  version: state.version + 1,
  phase,
  board,
  pendingWindow: undefined,
});

/** 无色牌：变色 / +4（诸神包的毒、洗牌同样无色）。 */
export const isWild = (c: Card) => c.color === null;

/** U5：功能牌不能作为最后一张牌结束游戏，只有数字牌能打完获胜。 */
const FUNCTION_FACES = new Set<Face>(["+2", "skip", "rev", "wild", "+4", "poison", "shuffle"]);
export const isNumberCard = (c: Card) => !FUNCTION_FACES.has(c.face);

/**
 * U1/U3 单张出牌合法性：同色 / 同牌面 / 无色牌任意时候可打。
 * 跟色比的是 `activeColor` 而不是 `top.color`——打过变色牌后两者不同。
 */
export function isPlayable(c: Card, top: Card, activeColor: Color | null): boolean {
  return isWild(c) || c.color === activeColor || c.face === top.face;
}

export const nextSeat = (b: Board, from = b.currentSeat, step = 1) => {
  const n = b.hands.length;
  return (((from + b.direction * step) % n) + n) % n;
};
