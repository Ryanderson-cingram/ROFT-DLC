// 通用计数标记（03 §5：魂/盗/异/形/颠/陨）。
// 标记名与上限全由调用方传入——本文件刻意不 import 任何技能定义，
// 出现的「魂/颠」只是 03 §5 表里的标记名，不是技能分支。
import { describe, expect, it } from "vitest";
import { gainMarks, markCount, spendMarks } from "../../src/skills/primitives/marks.ts";
import type { Board } from "../../src/types.ts";
import { table } from "../helpers.ts";

/** 两个座位的空桌，只关心 marks。 */
const board = (marks: Record<string, number>[]): Board => table([[], []], { marks }).board!;

describe("03 §5 标记原语", () => {
  describe("查询", () => {
    it("没有的标记是 0，不是 undefined", () => {
      expect(markCount(board([{}, {}]), 0, "魂")).toBe(0);
    });

    it("按座位分别记", () => {
      const b = board([{ 魂: 3 }, { 魂: 1 }]);
      expect(markCount(b, 0, "魂")).toBe(3);
      expect(markCount(b, 1, "魂")).toBe(1);
    });
  });

  describe("获得", () => {
    it("累加到已有的数上", () => {
      expect(markCount(gainMarks(board([{ 魂: 2 }, {}]), 0, "魂", 3), 0, "魂")).toBe(5);
    });

    it("上限由调用方传入，超出部分截断（S15 影歌魂上限 6：已有 6 再获得 2 仍是 6）", () => {
      expect(markCount(gainMarks(board([{ 魂: 6 }, {}]), 0, "魂", 2, 6), 0, "魂")).toBe(6);
    });

    it("跨过上限的那一次只补到上限", () => {
      expect(markCount(gainMarks(board([{ 魂: 5 }, {}]), 0, "魂", 4, 6), 0, "魂")).toBe(6);
    });

    it("不传上限 = 没有上限（03 §5 大多数标记没写上限）", () => {
      expect(markCount(gainMarks(board([{ 盗: 9 }, {}]), 0, "盗", 5), 0, "盗")).toBe(14);
    });

    it("上限 0 = 一个都拿不到（0 是真的 0，不当作「没传上限」）", () => {
      expect(markCount(gainMarks(board([{}, {}]), 0, "颠", 3, 0), 0, "颠")).toBe(0);
    });

    it("已经超过上限时不倒扣，维持现状", () => {
      expect(markCount(gainMarks(board([{ 魂: 8 }, {}]), 0, "魂", 1, 6), 0, "魂")).toBe(8);
    });

    it("不改入参：返回新 Board，原 Board 与原 marks 对象都不动", () => {
      const before = board([{ 魂: 1 }, {}]);
      const after = gainMarks(before, 0, "魂", 1);
      expect(before.marks[0]).toEqual({ 魂: 1 });
      expect(after).not.toBe(before);
      expect(after.marks[0]).not.toBe(before.marks[0]);
    });

    it("不碰别的座位和别的标记", () => {
      const after = gainMarks(board([{ 魂: 1, 盗: 2 }, { 魂: 5 }]), 0, "魂", 1);
      expect(after.marks[0]).toEqual({ 魂: 2, 盗: 2 });
      expect(after.marks[1]).toEqual({ 魂: 5 });
    });
  });

  describe("花费", () => {
    it("够就扣掉", () => {
      expect(markCount(spendMarks(board([{ 魂: 3 }, {}]), 0, "魂", 2)!, 0, "魂")).toBe(1);
    });

    it("花费超过持有量 → null，一个都不扣", () => {
      const before = board([{ 魂: 1 }, {}]);
      expect(spendMarks(before, 0, "魂", 2)).toBeNull();
      expect(before.marks[0]).toEqual({ 魂: 1 });
    });

    it("花 0 张永远成功", () => {
      expect(spendMarks(board([{}, {}]), 0, "魂", 0)).not.toBeNull();
    });

    it("不改入参", () => {
      const before = board([{ 魂: 3 }, {}]);
      const after = spendMarks(before, 0, "魂", 2)!;
      expect(before.marks[0]).toEqual({ 魂: 3 });
      expect(after.marks[0]).not.toBe(before.marks[0]);
    });
  });

  describe("替代标记补足（03 §5「颠可当作异/盗/魂/形」）", () => {
    it("本币不够时用替代标记补上差额", () => {
      const after = spendMarks(board([{ 魂: 1, 颠: 2 }, {}]), 0, "魂", 3, ["颠"])!;
      expect(after.marks[0]).toEqual({ 魂: 0, 颠: 0 });
    });

    it("本币一张都没有时可以全用替代标记付", () => {
      const after = spendMarks(board([{ 颠: 4 }, {}]), 0, "形", 2, ["颠"])!;
      expect(markCount(after, 0, "颠")).toBe(2);
    });

    it("替代标记也不够以补足 → null，本币和替代标记都不扣", () => {
      const before = board([{ 魂: 1, 颠: 1 }, {}]);
      expect(spendMarks(before, 0, "魂", 4, ["颠"])).toBeNull();
      expect(before.marks[0]).toEqual({ 魂: 1, 颠: 1 });
    });

    it("本币够时不动替代标记", () => {
      const after = spendMarks(board([{ 魂: 5, 颠: 3 }, {}]), 0, "魂", 2, ["颠"])!;
      expect(after.marks[0]).toEqual({ 魂: 3, 颠: 3 });
    });

    it("不给替代标记时，本币不够就是不够（默认不会自作主张拿别的标记抵）", () => {
      expect(spendMarks(board([{ 魂: 1, 颠: 9 }, {}]), 0, "魂", 2)).toBeNull();
    });

    it("多个替代标记按传入顺序依次消耗", () => {
      const after = spendMarks(board([{ 魂: 0, 颠: 2, 形: 2 }, {}]), 0, "魂", 3, ["颠", "形"])!;
      expect(after.marks[0]).toEqual({ 魂: 0, 颠: 0, 形: 1 });
    });

    // 「先花本币还是先花颠」规则库没写（06 未列此题）。当前实现是本币优先，
    // 结果确定但**不是裁定**——文档定了再改这条测试。
    it("【待裁定】当前行为：本币优先花光，再动替代标记", () => {
      const after = spendMarks(board([{ 魂: 2, 颠: 2 }, {}]), 0, "魂", 3, ["颠"])!;
      expect(after.marks[0]).toEqual({ 魂: 0, 颠: 1 });
    });
  });
});
