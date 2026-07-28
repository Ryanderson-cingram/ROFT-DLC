import type { Card, Color, Face, RulePack } from "./types.ts";

const COLORS: Color[] = ["R", "G", "B", "Y"];
const DIGITS: Face[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** 每色牌面构成，见 `docs/knowledge-base/05-gods-omens-deck.md` §3。 */
const PER_COLOR: [Face, number][] = [
  ["0", 2],
  ...DIGITS.map((f) => [f, 3] as [Face, number]),
  ["+2", 3],
  ["skip", 4],
  ["rev", 2],
];

/**
 * 05 §3 的 172 张满编牌组。
 *
 * ⚠️ 假设（待用户确认）：规则库只给了满编 172 张的构成表，没定义分包边界。
 * 本轮把「基础包」定义为 172 张减去毒 5 张、洗牌 3 张 = 164 张——这两种牌的效果
 * 牵扯毒池 / 同命 / 古神，属于诸神包。
 */
export function buildDeck(pack: RulePack): Card[] {
  const deck: Card[] = [];
  const push = (color: Color | null, face: Face, n: number) => {
    for (let i = 0; i < n; i++) deck.push({ id: `${color ?? "W"}${face}#${i}`, color, face });
  };
  for (const color of COLORS) for (const [face, n] of PER_COLOR) push(color, face, n);
  push(null, "wild", 4);
  push(null, "+4", 8);
  if (pack === "gods") {
    push(null, "shuffle", 3);
    push(null, "poison", 5);
  }
  return deck;
}

/** Fisher-Yates。纯函数，返回新数组；随机源只来自注入的 `rng`。 */
export function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
