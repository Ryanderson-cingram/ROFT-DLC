import type { Card, Face } from "@roft/engine";
import { COLORS } from "./cards";

/**
 * 手牌恒定排序（spec §4）。**只在客户端渲染前发生，引擎给的 `yourHand` 顺序不变**——
 * 这不是规则，是「手指别追着牌跑」的显示约定。
 *
 * 1. 颜色分组，顺序红 → 蓝 → 黄 → 绿（直接用 `cards.ts` 的 `COLORS`，不定义第二套色序）
 * 2. 组内数字牌 0→9 升序
 * 3. 该色功能牌垫在本色组末尾：停 → 转 → +2
 * 4. 无色牌排最后：变色 → +4 → 洗牌 → 毒
 */

/** 规则 3：本色组末尾的功能牌次序。 */
const COLORED_TAIL: Face[] = ["skip", "rev", "+2"];
/** 规则 4：无色牌之间的次序。 */
const WILD_ORDER: Face[] = ["wild", "+4", "shuffle", "poison"];

/** 表里没有的牌面一律垫到该组最后，不参与比较——多了新牌面也不会乱插进数字里。 */
const at = (order: Face[], f: Face) => (order.indexOf(f) < 0 ? order.length : order.indexOf(f));

const rank = (c: Card): number => {
  if (c.color === null) return 1000 + at(WILD_ORDER, c.face);
  const group = COLORS.findIndex((x) => x.value === c.color);
  // 数字 0–9 占 0–9，功能牌接在 10 起：一个色组永远占不满 100，所以组间不会串位
  const face = /^[0-9]$/.test(c.face) ? Number(c.face) : 10 + at(COLORED_TAIL, c.face);
  return group * 100 + face;
};

/**
 * 排好序的**新数组**，入参不动。
 * `Array.prototype.sort` 自 ES2019 起规范保证稳定，所以同键的牌保持原有相对次序
 * （同一张牌在手里有两份时，摸到的先后不会被打乱）。
 */
export const sortHand = (cards: Card[]): Card[] => [...cards].sort((a, b) => rank(a) - rank(b));
