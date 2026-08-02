import type { Card, Color, Face } from "@roft/engine";
import { describe, expect, it } from "vitest";
import { sortHand } from "./hand-sort";

/** spec §4 的四条规则各至少一例 + 混合 + 稳定性 + 不改入参。零 DOM。 */

const c = (id: string, color: Color | null, face: Face): Card => ({ id, color, face });
const ids = (cards: Card[]) => cards.map((x) => x.id);

describe("sortHand（spec §4 手牌恒定排序）", () => {
  it("规则 1：颜色分组，红 → 蓝 → 黄 → 绿（复用 cards.ts 的 COLORS 顺序）", () => {
    const hand = [c("g", "G", "5"), c("y", "Y", "5"), c("b", "B", "5"), c("r", "R", "5")];
    expect(ids(sortHand(hand))).toEqual(["r", "b", "y", "g"]);
  });

  it("规则 2：组内数字牌 0 → 9 升序", () => {
    const hand = [c("r9", "R", "9"), c("r0", "R", "0"), c("r5", "R", "5"), c("r1", "R", "1")];
    expect(ids(sortHand(hand))).toEqual(["r0", "r1", "r5", "r9"]);
  });

  it("规则 3：该色功能牌垫在本色组末尾，停 → 转 → +2", () => {
    const hand = [c("p2", "R", "+2"), c("rev", "R", "rev"), c("skip", "R", "skip"), c("r5", "R", "5")];
    expect(ids(sortHand(hand))).toEqual(["r5", "skip", "rev", "p2"]);
  });

  it("规则 4：无色牌排最后，变色 → +4 → 洗牌 → 毒", () => {
    const hand = [
      c("poison", null, "poison"),
      c("shuffle", null, "shuffle"),
      c("w4", null, "+4"),
      c("wild", null, "wild"),
      c("g0", "G", "0"),
    ];
    expect(ids(sortHand(hand))).toEqual(["g0", "wild", "w4", "shuffle", "poison"]);
  });

  it("混合牌堆：四条规则一起生效", () => {
    const hand = [
      c("w4", null, "+4"),
      c("g3", "G", "3"),
      c("r-skip", "R", "skip"),
      c("b0", "B", "0"),
      c("r2", "R", "2"),
      c("wild", null, "wild"),
      c("y-p2", "Y", "+2"),
      c("b-rev", "B", "rev"),
      c("r0", "R", "0"),
    ];
    expect(ids(sortHand(hand))).toEqual([
      "r0", "r2", "r-skip",   // 红：数字升序，功能牌垫后
      "b0", "b-rev",          // 蓝
      "y-p2",                 // 黄（只有功能牌）
      "g3",                   // 绿
      "wild", "w4",           // 无色最后
    ]);
  });

  it("稳定排序：同色同面的两张保持原有相对次序", () => {
    const hand = [c("r7#b", "R", "7"), c("r7#a", "R", "7"), c("b1", "B", "1"), c("r7#c", "R", "7")];
    expect(ids(sortHand(hand))).toEqual(["r7#b", "r7#a", "r7#c", "b1"]);
  });

  it("不就地修改入参，返回新数组", () => {
    const hand = [c("g0", "G", "0"), c("r1", "R", "1")];
    const before = ids(hand);
    const out = sortHand(hand);
    expect(ids(hand)).toEqual(before);
    expect(out).not.toBe(hand);
  });
});
