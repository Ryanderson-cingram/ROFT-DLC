import type { Board, Card, Color } from "./types.ts";

/** 无色牌：变色 / +4（诸神包的毒、洗牌同样无色）。 */
export const isWild = (c: Card) => c.color === null;

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
