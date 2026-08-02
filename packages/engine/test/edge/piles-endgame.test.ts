/**
 * 牌河与终局（01-U8 洗回与平局、U5 末牌功能牌、U2 收官）。
 *
 * 已有的 U8 测试都是把 `reshuffles: 2` 直接摆上牌桌的**局面**测试。这里补的是**路径**：
 * 真的洗回两次、再见底，走到平局；以及 U8 补充那条「判定时点是回合交接，不在半路
 * 终止一条惩罚链」。
 */
import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../../src/index.ts";
import { windowIdOf } from "../../src/actions/punish.ts";
import { MAX_RESHUFFLES, stalemate } from "../../src/legal.ts";
import { card, ctx, table } from "../helpers.ts";
import type { EngineEvent, GameState } from "../../src/types.ts";

const R7 = card("R", "7");

// ---------------------------------------------------------------- 真的洗满两次

describe("U8：整局最多洗 2 次，洗满之后再见底就是平局", () => {
  /**
   * 牌桌是特意配的：回收进摸牌堆的每一张都**接不上**当时的跟牌目标（红牌 vs 定色 G +
   * 牌面「变色」），所以每一次摸牌都必然「摸到打不出去的牌 → 回合当场结束」，
   * 不掺进 `drawnPlayable` 那条分支，整条路径与洗出来的牌序无关、完全确定。
   */
  function run() {
    const w1 = card(null, "wild");
    const w2 = card(null, "wild");
    const s = table([[w1, w2, card("R", "9")], [card("B", "1")], [card("B", "2")]], {
      playedPile: [R7, card("R", "1"), card("R", "2")],
      drawPile: [],
      discardPile: [],
    });
    const events: EngineEvent[] = [];
    const step = (a: Parameters<typeof applyAction>[1]) => {
      const r = applyAction(state, a, ctx());
      expect(r.rejected, JSON.stringify(a)).toBeUndefined();
      events.push(...r.events);
      state = r.state;
      return r;
    };
    let state: GameState = s;

    // 座位 0 打出第一张变色牌（定色 G）：牌河变成 [W1, R7, R1, R2]，红牌全成了死牌
    step({ type: "playCards", seat: 0, cardIds: [w1.id], chosenColor: "G" });
    // 座位 1 摸牌 → 摸牌堆空 → 洗回 #1（R7/R1/R2 三张），摸 1 张红牌打不出去、回合结束
    step({ type: "drawCard", seat: 1 });
    expect(state.board!.reshuffles).toBe(1);
    expect(state.board!.playedPile).toHaveLength(1);
    // 座位 2 摸 1 张
    step({ type: "drawCard", seat: 2 });
    // 座位 0 打出第二张变色牌：牌河 [W2, W1]，为第二次洗回备下一张牌
    step({ type: "playCards", seat: 0, cardIds: [w2.id], chosenColor: "G" });
    // 座位 1 把摸牌堆最后一张摸走
    step({ type: "drawCard", seat: 1 });
    expect(state.board!.drawPile).toHaveLength(0);
    expect(state.board!.reshuffles).toBe(1);
    // 座位 2 摸牌 → 洗回 #2（只剩 W1 一张）→ 摸到变色牌，无色牌永远打得出去
    step({ type: "drawCard", seat: 2 });
    expect(state.board!.reshuffles).toBe(MAX_RESHUFFLES);
    expect(state.board!.drawnPlayable).not.toBeNull();
    expect(state.phase).toBe("play");
    // 还没交回合，所以还不判平局（U8：判定时点是回合交接）
    expect(state.phase).not.toBe("finished");
    expect(stalemate(state.board!)).toBe(true);
    const last = step({ type: "endTurn", seat: 2 });
    return { state, events, last };
  }

  it("洗回两次之后摸牌堆再度见底 → 终局、无赢家、发 gameDrawn", () => {
    const { state, events, last } = run();
    expect(state.phase).toBe("finished");
    expect(state.board!.winner).toBeUndefined();
    expect(state.board!.reshuffles).toBe(2);
    expect(events.filter((e) => e.type === "deckReshuffled")).toHaveLength(2);
    expect(last.events.at(-1)).toEqual({ type: "gameDrawn", public: { reason: "deck_exhausted" } });
  });

  it("平局之后谁都没有合法动作，快照按「无赢家」给", () => {
    const { state } = run();
    for (const seat of [0, 1, 2]) expect(legalActions(state, seat)).toEqual([]);
    const snap = projectView(state, 0);
    expect(snap.phase).toBe("finished");
    expect(snap.winner).toBeUndefined();
  });

  it("洗回的牌序只进 audit，public 里一张牌都没有", () => {
    const { events } = run();
    for (const e of events.filter((x) => x.type === "deckReshuffled")) {
      expect(Object.keys(e.public)).toEqual(["count"]);
      expect((e.audit!.order as string[]).length).toBe(e.public.count);
    }
  });
});

// ---------------------------------------------------------------- 判定时点 = 回合交接

describe("U8 补充：平局判在回合交接，不在半路终止一条惩罚链", () => {
  /** 摸牌堆已空、已洗满 2 次，座位 0 手上还有一张 +2。 */
  const dry = () => {
    const p2 = card("R", "+2");
    const s = table([[p2, card("R", "1")], [card("Y", "1")], [card("Y", "2")]], {
      playedPile: [R7],
      drawPile: [],
      discardPile: [],
      reshuffles: 2,
    });
    return { s, p2 };
  };

  it("打出 +2 之后惩罚窗口照常挂着，不当场收场", () => {
    const { s, p2 } = dry();
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [p2.id] }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(stalemate(r.state.board!)).toBe(true);
    expect(r.state.phase).toBe("afterPlay");
    expect(r.state.pendingWindow!.type).toBe("punishStack");
    expect(r.state.board!.punish!.total).toBe(2);
  });

  it("链结完、轮到下一个人的那一刻才判平局（受罚者一张都摸不到）", () => {
    const { s, p2 } = dry();
    const opened = applyAction(s, { type: "playCards", seat: 0, cardIds: [p2.id] }, ctx()).state;
    const r = applyAction(opened, { type: "respond", seat: 1, windowId: windowIdOf(opened)!, choice: "accept" }, ctx());
    expect(r.rejected).toBeUndefined();
    // 摸牌堆空、洗满 2 次 → 该摸 2 张实际摸到 0 张（06-Q46）
    expect(r.state.board!.hands[1]).toHaveLength(1);
    expect(r.state.phase).toBe("finished");
    expect(r.state.board!.winner).toBeUndefined();
    expect(r.events.some((e) => e.type === "gameDrawn")).toBe(true);
  });

  it("超时结算走同一条出口：claimTimeout 之后照样判平局", () => {
    const { s, p2 } = dry();
    const opened = applyAction(s, { type: "playCards", seat: 0, cardIds: [p2.id] }, ctx()).state;
    const r = applyAction(
      opened,
      { type: "claimTimeout", seat: 2, windowId: windowIdOf(opened)! },
      ctx(undefined, "2026-07-28T12:00:31.000Z"),
    );
    expect(r.rejected).toBeUndefined();
    expect(r.state.phase).toBe("finished");
    expect(r.state.board!.winner).toBeUndefined();
  });
});

// ---------------------------------------------------------------- U5 与 U2 的分界

describe("U5：只有数字牌能打完获胜（末牌矩阵）", () => {
  const play = (c: ReturnType<typeof card>, chosenColor?: "B") =>
    applyAction(
      table([[c], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7], drawPile: [card("G", "4"), card("G", "5")] }),
      { type: "playCards", seat: 0, cardIds: [c.id], chosenColor },
      ctx(),
    );

  it.each([
    { face: "3", color: "R" as const, win: true },
    { face: "0", color: "R" as const, win: true },
    { face: "+2", color: "R" as const, win: false },
    { face: "skip", color: "R" as const, win: false },
    { face: "rev", color: "R" as const, win: false },
    { face: "wild", color: null, win: false },
    { face: "+4", color: null, win: false },
  ] as const)("末牌 $face → 判胜 $win", ({ face, color, win }) => {
    const r = play(card(color, face), color === null ? "B" : undefined);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.winner).toBe(win ? 0 : undefined);
    expect(r.state.phase).toBe(win ? "finished" : r.state.phase);
    // 收不了官的人在「结算完、准备交回合」那一刻补摸 1 张
    expect(r.state.board!.hands[0]).toHaveLength(win ? 0 : 1);
  });

  it("U5 的补摸 1 张不是惩罚：摸不到牌也不抛，手牌留在 0 张继续跑", () => {
    const skip = card("R", "skip");
    const s = table([[skip], [card("Y", "1")], [card("Y", "2")]], {
      playedPile: [R7],
      drawPile: [],
      discardPile: [],
      reshuffles: 2,
    });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [skip.id] }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(0);
    expect(r.state.board!.winner).toBeUndefined();
    // 交回合那一刻牌堆已枯竭 → U8 平局收场
    expect(r.state.phase).toBe("finished");
  });
});
