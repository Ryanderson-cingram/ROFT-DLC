"use client";

import type { Card } from "@roft/engine";
import { useEffect, useRef, useState } from "react";

/**
 * 手牌被**外力**改了一批（`2026-08-04-batch-2-ui-gaps` 的改动①，盖住缺口 A1 + A5）。
 *
 * 近卫♥6 的收牌方、结盟换牌的双方、洗牌重分的全体，手牌都会在自己没动手的情况下变一批。
 * 在此之前唯一的痕迹是轮转轨下沿跑马灯里的一行小字——离手牌 30cm 远，下一条事件就把它顶掉。
 *
 * **只看手牌 id 的集合，不认识任何技能**：近卫、结盟、洗牌，以及将来任何往别人手里塞牌的
 * 技能，一条都不用加。
 *
 * **只报「进」不报「出」**：只出不进的那几条路（出牌、交牌给链首、摸 N 弃 N 的弃）都是你
 * 自己点的，牌当着面离手，再解释一遍是噪音；而牌**进**手是这局里最需要一个数的地方——
 * 摸几张要过 02 §7 的 L0–L6（恩惠 −2 / 活泼板 +1 / 战争序 ×2 / 樱时雨 =1 …），
 * 「我以为摸 2 结果摸了 3」正是玩家会当场报 bug 的那种事。
 *
 * 两条约束照抄 `use-bump`：**首渲染不报**（那时没有「上一次」），**到点自己摘掉**
 * （定时器而不是 `animationend`：`prefers-reduced-motion` 下动画整个不跑，那个事件永远不来）。
 */

/** 浮报挂多久（globals.css 的 `toast-life 3s`）。 */
const TOAST_MS = 3_000;

export type HandDelta = {
  /** 这一次进了几张。恒 > 0——不进牌就不报。 */
  got: number;
  /**
   * 旧手牌**一张不剩**（结盟互换 / 洗牌重分）。不是「既进又出」——摸完再弃、盲抽再还
   * 都会既进又出，那些不是换手牌，而且它们各自分在两个快照里。
   */
  whole: boolean;
};

export function useHandDelta(hand: Card[]): HandDelta | null {
  const prev = useRef(hand);
  const [delta, setDelta] = useState<HandDelta | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = hand;
    // 首渲染时 before 就是 hand 本身 → got 恒为 0，一进牌桌不会满屏乱报
    const had = new Set(before.map((c) => c.id));
    const got = hand.reduce((n, c) => (had.has(c.id) ? n : n + 1), 0);
    if (got === 0) return;
    // 「进的就是全部」= 旧手牌一张不剩。空手时不算（本来就没得换）
    setDelta({ got, whole: before.length > 0 && got === hand.length });
  }, [hand]);

  // 摘掉的定时器单独一条：与上面合成一条的话，「手牌没变的下一个快照」会先跑掉上一条的
  // cleanup（清掉定时器）再提前 return（不重设），浮报就永远挂在那里不走了。
  useEffect(() => {
    if (!delta) return;
    const t = setTimeout(() => setDelta(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [delta]);

  return delta;
}
