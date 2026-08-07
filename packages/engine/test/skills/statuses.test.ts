// 状态（03 §4）。互斥与不叠层在原语里实施一次，各技能不再判断。
import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../../src/index.ts";
import { canGrantStatus, grantStatus, hasStatus, removeStatus } from "../../src/skills/primitives/statuses.ts";
import type { Board, Card, Color, GameState } from "../../src/types.ts";
import { card, ctx, table } from "../helpers.ts";

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

/**
 * 五彩的**执行面**（03 §4 那两句：「不能打出只是颜色相同的牌；使用变色牌时不能改变颜色」）。
 * 赋予它的是八门♠8②（见 `eight-gates.test.ts`），但限制本身是状态的、不是技能的——
 * 寄生♣9、古神那几支将来赋同一个状态，走的是这里同一段判定。
 */
describe("五彩的执行面（03 §4）", () => {
  const R7 = card("R", "7");
  /** 座位 0 带五彩、轮到他；牌顶红 7（跟色 R、跟面 7）。 */
  const rainbow = (hand: Card[], over: Partial<Board> = {}): GameState =>
    table([hand, [card("Y", "1")], [card("Y", "2")]], {
      playedPile: [R7],
      drawPile: [card("G", "1"), card("G", "2"), card("G", "3")],
      statuses: [["五彩"], [], []],
      ...over,
    });
  const play = (s: GameState, c: Card, chosenColor?: Color) =>
    applyAction(s, { type: "playCards", seat: 0, cardIds: [c.id], ...(chosenColor && { chosenColor }) }, ctx());

  it("只靠颜色相同的牌打不出去（红 3 接红 7）", () => {
    const c = card("R", "3");
    const s = rainbow([c, card("B", "8")]);
    expect(play(s, c).rejected?.reason).toBe("illegal_card");
    // legalActions 也不给它——UI 的可点高亮与引擎判定同一个源
    expect(legalActions(s, 0).filter((a) => a.type === "playCards")).toEqual([]);
  });

  it("同牌面照打（蓝 7 接红 7）", () => {
    const c = card("B", "7");
    const s = rainbow([c, card("R", "3")]);
    expect(play(s, c).rejected).toBeUndefined();
    expect(legalActions(s, 0).filter((a) => a.type === "playCards").map((a) => a.cardIds)).toEqual([[c.id]]);
  });

  it("无色牌照打（它本来就不是靠颜色接上的）", () => {
    const c = card(null, "wild");
    const s = rainbow([c, card("R", "3")]);
    expect(play(s, c, "R").rejected).toBeUndefined();
  });

  it("变色牌只能定成当前跟色，改色要拒（「使用变色牌时不能改变颜色」）", () => {
    const c = card(null, "wild");
    const s = rainbow([c, card("R", "3")]);
    expect(play(s, c, "B").rejected?.reason).toBe("color_locked");
    expect(play(s, c, "R").state.board!.activeColor).toBe("R");
  });

  it("没有五彩的人不受这两条限制（对照组）", () => {
    const c = card("R", "3");
    const w = card(null, "wild");
    const s = rainbow([c, w], { statuses: [[], [], []] });
    expect(play(s, c).rejected).toBeUndefined();
    expect(play(s, w, "B").rejected).toBeUndefined();
  });

  it("摸到只靠颜色相同的牌 → 不算「摸到能打的」，回合直接结束（U1）", () => {
    const s = rainbow([card("B", "8")], { drawPile: [card("R", "1"), card("G", "5")] });
    const r = applyAction(s, { type: "drawCard", seat: 0 }, ctx());
    expect(r.state.board!.drawnPlayable).toBeNull();
    expect(r.state.board!.currentSeat).toBe(1);
  });

  it("并列♥4 的首张同样要过这一关（首张只靠颜色 → 整组拒）", () => {
    const pair = [card("R", "2"), card("R", "2")];
    const s = rainbow([...pair, card("B", "9")], { skills: ["heart-4", null, null], revealed: [true, false, false] });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: pair.map((c) => c.id) }, ctx());
    expect(r.rejected?.reason).toBe("illegal_card");
  });
});
