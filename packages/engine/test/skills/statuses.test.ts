// 状态（03 §4）。互斥与不叠层在原语里实施一次，各技能不再判断。
import { describe, expect, it } from "vitest";
import { canGrantStatus, grantStatus, hasStatus, removeStatus } from "../../src/skills/primitives/statuses.ts";
import type { Board } from "../../src/types.ts";
import { table } from "../helpers.ts";

const board = (statuses: string[][]): Board => table([[], []], { statuses }).board!;

describe("03 §4 状态原语", () => {
  describe("查询与赋予", () => {
    it("没有的状态是 false", () => {
      expect(hasStatus(board([[], []]), 0, "五彩")).toBe(false);
    });

    it("赋予后查得到，且只落在那个座位上", () => {
      const after = grantStatus(board([[], []]), 0, "五彩");
      expect(hasStatus(after, 0, "五彩")).toBe(true);
      expect(hasStatus(after, 1, "五彩")).toBe(false);
    });

    it("不改入参", () => {
      const before = board([[], []]);
      const after = grantStatus(before, 0, "封印");
      expect(before.statuses[0]).toEqual([]);
      expect(after.statuses[0]).not.toBe(before.statuses[0]);
    });
  });

  describe("不叠层（§4「所有状态不能叠加多层」）", () => {
    it("重复赋予同一状态不会出现两份", () => {
      const after = grantStatus(grantStatus(board([[], []]), 0, "神化"), 0, "神化");
      expect(after.statuses[0]).toEqual(["神化"]);
    });
  });

  describe("负面三者互斥（§4「有五彩/心盲/恋战之一时不能获得另外两种」）", () => {
    it.each([
      ["五彩", "心盲"],
      ["五彩", "恋战"],
      ["心盲", "五彩"],
      ["心盲", "恋战"],
      ["恋战", "五彩"],
      ["恋战", "心盲"],
    ])("已有 %s 时不能获得 %s", (held: string, blocked: string) => {
      const after = grantStatus(board([[held], []]), 0, blocked);
      expect(after.statuses[0]).toEqual([held]);
      expect(canGrantStatus(board([[held], []]), 0, blocked)).toBe(false);
    });

    it("互斥只管这三者，不挡别的状态", () => {
      const after = grantStatus(board([["五彩"], []]), 0, "同命");
      expect(after.statuses[0]).toEqual(["五彩", "同命"]);
    });

    it("三者之外的状态可以任意共存（封印 + 领域 + 同命）", () => {
      let b = board([[], []]);
      for (const s of ["封印", "领域", "同命"]) b = grantStatus(b, 0, s);
      expect(b.statuses[0]).toEqual(["封印", "领域", "同命"]);
    });
  });

  describe("领域免疫恋战（§4）", () => {
    it("有领域时不能获得恋战", () => {
      const after = grantStatus(board([["领域"], []]), 0, "恋战");
      expect(hasStatus(after, 0, "恋战")).toBe(false);
      expect(canGrantStatus(board([["领域"], []]), 0, "恋战")).toBe(false);
    });

    it("领域不挡五彩与心盲——§4 只写了免疫恋战", () => {
      expect(canGrantStatus(board([["领域"], []]), 0, "五彩")).toBe(true);
      expect(canGrantStatus(board([["领域"], []]), 0, "心盲")).toBe(true);
    });

    it("领域挡住恋战后，仍可改为获得心盲（恋战没进去就不占互斥名额）", () => {
      const after = grantStatus(grantStatus(board([["领域"], []]), 0, "恋战"), 0, "心盲");
      expect(after.statuses[0]).toEqual(["领域", "心盲"]);
    });

    // §4 只写「免疫恋战」，没写「获得领域时驱散已有的恋战」。免疫 ≠ 驱散，
    // 当前实现不驱散——**待裁定**，文档定了再改这条。
    it("【待裁定】当前行为：已有恋战再获得领域，恋战不被移除", () => {
      const after = grantStatus(board([["恋战"], []]), 0, "领域");
      expect(after.statuses[0]).toEqual(["恋战", "领域"]);
    });
  });

  describe("移除", () => {
    it("移除已有的状态", () => {
      expect(removeStatus(board([["封印", "同命"], []]), 0, "封印").statuses[0]).toEqual(["同命"]);
    });

    it("移除不存在的状态不报错，局面照旧", () => {
      expect(removeStatus(board([["封印"], []]), 0, "五彩").statuses[0]).toEqual(["封印"]);
    });

    it("移除后原本被互斥挡住的状态可以获得了", () => {
      const after = grantStatus(removeStatus(board([["五彩"], []]), 0, "五彩"), 0, "心盲");
      expect(after.statuses[0]).toEqual(["心盲"]);
    });

    it("不改入参", () => {
      const before = board([["封印"], []]);
      removeStatus(before, 0, "封印");
      expect(before.statuses[0]).toEqual(["封印"]);
    });
  });
});
