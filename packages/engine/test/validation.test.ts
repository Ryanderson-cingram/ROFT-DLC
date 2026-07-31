/**
 * 信任边界：客户端送上来的每个字段都可能是伪造的。
 * Edge 只覆盖 `seat`，其余（cardIds / target / chosenColor / declared / choice）原样进引擎，
 * 所以校验的家在引擎里。契约是「引擎永不抛异常」——非法输入一律走 `rejected.reason`。
 */
import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../src/index.ts";
import { card, ctx, table } from "./helpers.ts";
import type { Action } from "../src/types.ts";

const R7 = card("R", "7");
const hands = () => [[card("R", "3"), card("R", "4")], [card("Y", "1")], [card("Y", "2")]];
/** 伪造的请求体：故意绕开 Action 类型，模拟 HTTP 上来的畸形 JSON。 */
const forged = (a: unknown) => a as Action;

describe("信任边界：畸形输入不许抛异常", () => {
  it("catchUno 的 target 是小数 / NaN / null / 字符串 → bad_target", () => {
    const s = table(hands(), { playedPile: [R7] });
    for (const target of [1.5, NaN, null, undefined, "1", {}, -0.5, Infinity]) {
      const r = applyAction(s, forged({ type: "catchUno", seat: 0, target }), ctx());
      expect(r.rejected?.reason, `target=${String(target)}`).toBe("bad_target");
      expect(r.state).toBe(s);
    }
  });

  it("playCards 的 cardIds 缺席 / null / 非数组 → bad_card_ids", () => {
    const s = table(hands(), { playedPile: [R7] });
    for (const cardIds of [undefined, null, "abc", 3, {}]) {
      const r = applyAction(s, forged({ type: "playCards", seat: 0, cardIds }), ctx());
      expect(r.rejected?.reason, `cardIds=${JSON.stringify(cardIds)}`).toBe("bad_card_ids");
    }
  });

  it("seat 是小数 / NaN → invalid_seat（引擎自己也守，不靠 Edge 覆盖）", () => {
    const s = table(hands(), { playedPile: [R7] });
    for (const seat of [1.5, NaN, "0", null, undefined, Infinity]) {
      const r = applyAction(s, forged({ type: "drawCard", seat }), ctx());
      expect(r.rejected?.reason, `seat=${String(seat)}`).toBe("invalid_seat");
    }
  });

  it("activateSkill / respond 的 cardIds 非数组也不抛", () => {
    const s = table(hands(), {
      playedPile: [R7],
      skills: ["spade-1", null, null],
      revealed: [true, false, false],
    });
    for (const cardIds of [null, "abc", 7, {}]) {
      const r = applyAction(s, forged({ type: "activateSkill", seat: 0, effectKey: "1", cardIds }), ctx());
      expect(r.rejected?.reason, `cardIds=${JSON.stringify(cardIds)}`).toBe("bad_card_ids");
      const w = applyAction(s, forged({ type: "respond", seat: 0, windowId: "x", choice: "y", cardIds }), ctx());
      expect(w.rejected?.reason).toBe("bad_card_ids");
    }
  });
});

describe("信任边界：定色不许绕开规则", () => {
  it("有色牌带 chosenColor → 拒绝（定色是无色牌的特权）", () => {
    const s = table(hands(), { playedPile: [R7] });
    const red5 = s.board!.hands[0][0]; // 红 3，跟得上红 7
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [red5.id], chosenColor: "B" }, ctx());
    expect(r.rejected?.reason).toBe("color_not_allowed");
  });

  it("chosenColor 值域校验：不存在的颜色一律拒绝", () => {
    const wild = card(null, "wild");
    const s = table([[wild, card("R", "4")], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7] });
    for (const chosenColor of ["ZZ", "紫", "", "r", 1, null]) {
      const r = applyAction(s, forged({ type: "playCards", seat: 0, cardIds: [wild.id], chosenColor }), ctx());
      expect(r.rejected?.reason, `color=${String(chosenColor)}`).toMatch(/bad_color|color_required/);
    }
    const ok = applyAction(s, { type: "playCards", seat: 0, cardIds: [wild.id], chosenColor: "B" }, ctx());
    expect(ok.rejected).toBeUndefined();
    expect(ok.state.board!.activeColor).toBe("B");
  });

  it("并列♥4：2 张 / 6 张形状带 chosenColor 也拒绝（只有 4 张形状要定色）", () => {
    const pair = [card("B", "5"), card("B", "5")];
    const s = table([[...pair, card("R", "4")], [card("Y", "1")], [card("Y", "2")]], {
      playedPile: [card("B", "9")],
      skills: ["heart-4", null, null],
      revealed: [true, false, false],
    });
    const r = applyAction(
      s,
      { type: "playCards", seat: 0, cardIds: pair.map((c) => c.id), chosenColor: "R" },
      ctx(),
    );
    expect(r.rejected?.reason).toBe("color_not_allowed");
  });

  it("并列♥4：4 张形状的定色同样过值域（不存在的颜色进不去 activeColor）", () => {
    const quad = [card("B", "5"), card("R", "5"), card("G", "5"), card("Y", "5")];
    const s = table([[...quad], [card("Y", "1")], [card("Y", "2")]], {
      playedPile: [card("B", "9")],
      skills: ["heart-4", null, null],
      revealed: [true, false, false],
    });
    const ids = quad.map((c) => c.id);
    const r = applyAction(s, forged({ type: "playCards", seat: 0, cardIds: ids, chosenColor: "紫" }), ctx());
    expect(r.rejected?.reason).toBe("bad_color");
    const ok = applyAction(s, { type: "playCards", seat: 0, cardIds: ids, chosenColor: "G" }, ctx());
    expect(ok.rejected).toBeUndefined();
    expect(ok.state.board!.activeColor).toBe("G");
  });
});

describe("信任边界：影歌①的宣言值域", () => {
  const shadow = (declared: unknown) => {
    const s = table(hands(), {
      playedPile: [R7],
      skills: ["diamond-3", null, null],
      revealed: [true, false, false],
    });
    return applyAction(s, forged({ type: "activateSkill", seat: 0, effectKey: "1", declared }), ctx());
  };

  it("declared.face 必须真的是数字牌面，'42' / 'abc' 不算", () => {
    for (const face of ["42", "abc", "", "10", "-1", 3, null]) {
      const r = shadow({ color: "R", face });
      expect(r.rejected?.reason, `face=${String(face)}`).toBe("bad_declaration");
    }
  });

  it("合法宣言照常开窗口", () => {
    const r = shadow({ color: "R", face: "5" });
    expect(r.rejected).toBeUndefined();
    expect(r.state.pendingWindow?.type).toBe("soulHarvest");
  });
});

describe("信任边界：抓漏喊不许变成活锁", () => {
  it("牌堆与出牌堆都空时抓不动 → 拒绝，version 不变（否则可无限刷）", () => {
    const s = table(hands(), { playedPile: [R7], drawPile: [], discardPile: [] });
    const r = applyAction(s, { type: "catchUno", seat: 0, target: 1 }, ctx());
    expect(r.rejected?.reason).toBe("deck_empty");
    expect(r.state.version).toBe(s.version);
  });

  it("U7：窗口挂着时抓人，窗口 id 仍然有效（响应者不该被打成 stale_window）", () => {
    const s = table(hands(), {
      playedPile: [R7],
      drawPile: [card("G", "5"), card("G", "6")],
      punish: { initiator: 0, segments: [{ seat: 0, face: "+2", draw: 2 }], total: 2 },
    });
    const withWindow = {
      ...s,
      phase: "afterPlay" as const,
      pendingWindow: {
        type: "punishStack", actors: [2], deadline: "2026-07-28T12:00:30.000Z",
        defaultChoice: "accept", resume: "play" as const,
      },
    };
    const windowId = projectView(withWindow, 2).windowId!;
    // 座位 0 抓漏喊（U7：窗口期间也可抓），座位 2 手上那条响应不该因此作废
    const caught = applyAction(withWindow, { type: "catchUno", seat: 0, target: 1 }, ctx());
    expect(caught.rejected).toBeUndefined();
    expect(caught.state.version).toBe(withWindow.version + 1);
    expect(projectView(caught.state, 2).windowId).toBe(windowId);
    const r = applyAction(caught.state, { type: "respond", seat: 2, windowId, choice: "accept" }, ctx());
    expect(r.rejected).toBeUndefined();
  });

  it("U7：补喊同样保住窗口 id", () => {
    const s = table(hands(), {
      playedPile: [R7],
      punish: { initiator: 0, segments: [{ seat: 0, face: "+2", draw: 2 }], total: 2 },
    });
    const withWindow = {
      ...s,
      phase: "afterPlay" as const,
      pendingWindow: {
        type: "punishStack", actors: [2], deadline: "2026-07-28T12:00:30.000Z",
        defaultChoice: "accept", resume: "play" as const,
      },
    };
    const windowId = projectView(withWindow, 2).windowId!;
    const said = applyAction(withWindow, { type: "callUno", seat: 1 }, ctx());
    expect(said.rejected).toBeUndefined();
    expect(projectView(said.state, 2).windowId).toBe(windowId);
    // legalActions 给出的 windowId 也要跟着是新鲜的
    const respond = legalActions(said.state, 2).find((a) => a.type === "respond");
    expect(respond && "windowId" in respond && respond.windowId).toBe(windowId);
  });
});
