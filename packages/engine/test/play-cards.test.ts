import { describe, expect, it } from "vitest";
import { applyAction } from "../src/index.ts";
import { isPlayable } from "../src/legal.ts";
import { card, ctx, table } from "./helpers.ts";

const R7 = card("R", "7");

describe("isPlayable (U1/U3)", () => {
  const cases: [string, ReturnType<typeof card>, boolean][] = [
    ["same colour", card("R", "3"), true],
    ["same face", card("B", "7"), true],
    ["neither colour nor face", card("B", "3"), false],
    ["wild is always playable", card(null, "wild"), true],
    ["+4 is always playable", card(null, "+4"), true],
  ];
  for (const [label, c, ok] of cases)
    it(`U3: on R7 with active colour R, ${label} -> ${ok}`, () => {
      expect(isPlayable(c, R7, "R")).toBe(ok);
    });

  it("U3: follows activeColor, not the discard top's own colour", () => {
    const top = card(null, "wild");
    expect(isPlayable(card("G", "5"), top, "G")).toBe(true);
    expect(isPlayable(card("R", "5"), top, "G")).toBe(false);
  });
});

describe("playCards", () => {
  it("U1: playing a matching card moves it to the discard pile and passes the turn", () => {
    const mine = card("R", "3");
    const s = table([[mine, card("B", "3")], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7] });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [mine.id] }, ctx());
    expect(r.rejected).toBeUndefined();
    const b = r.state.board!;
    expect(b.playedPile[0]).toEqual(mine);
    expect(b.activeColor).toBe("R");
    expect(b.hands[0]).toHaveLength(1);
    expect(b.currentSeat).toBe(1);
    expect(r.state.version).toBe(11);
  });

  it("U3: a wild needs a chosen colour", () => {
    const w = card(null, "wild");
    const s = table([[w], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7] });
    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [w.id] }, ctx()).rejected?.reason)
      .toBe("color_required");
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [w.id], chosenColor: "G" }, ctx());
    expect(r.state.board!.activeColor).toBe("G");
  });

  it("rejects a card the player does not hold", () => {
    const s = table([[card("R", "3")], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7] });
    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: ["nope"] }, ctx()).rejected?.reason)
      .toBe("not_in_hand");
  });

  it("rejects an illegal card", () => {
    const bad = card("B", "3");
    const s = table([[bad], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7] });
    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [bad.id] }, ctx()).rejected?.reason)
      .toBe("illegal_card");
  });

  it("rejects a play out of turn", () => {
    const mine = card("R", "3");
    const s = table([[card("Y", "1")], [mine], [card("Y", "2")]], { playedPile: [R7] });
    expect(applyAction(s, { type: "playCards", seat: 1, cardIds: [mine.id] }, ctx()).rejected?.reason)
      .toBe("not_your_turn");
  });

  it("U3: skip jumps over the next player", () => {
    const c = card("R", "skip");
    const s = table([[c, card("R", "1")], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7] });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [c.id] }, ctx());
    expect(r.state.board!.currentSeat).toBe(2);
  });

  it("U3: reverse flips the direction of play", () => {
    const c = card("R", "rev");
    const s = table([[c, card("R", "1")], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7] });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [c.id] }, ctx());
    expect(r.state.board!.direction).toBe(-1);
    expect(r.state.board!.currentSeat).toBe(2);
  });

  it("U1: emptying your hand ends the game with you as the winner", () => {
    const last = card("R", "3");
    const s = table([[last], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7] });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [last.id] }, ctx());
    expect(r.state.phase).toBe("finished");
    expect(r.state.board!.winner).toBe(0);
  });

  // U5：功能牌不能作为最后一张牌结束游戏，打出后须再摸 1 张
  for (const [color, face] of [["R", "+2"], ["R", "skip"], ["R", "rev"], [null, "wild"], [null, "+4"]] as const) {
    it(`U5: a final ${face} does not win -- you draw 1 and play continues`, () => {
      const last = card(color, face);
      const s = table([[last], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7] });
      const r = applyAction(
        s,
        { type: "playCards", seat: 0, cardIds: [last.id], chosenColor: color ? undefined : "B" },
        ctx(),
      );
      expect(r.rejected).toBeUndefined();
      expect(r.state.phase).not.toBe("finished");
      expect(r.state.board!.winner).toBeUndefined();
      expect(r.state.board!.hands[0]).toHaveLength(1); // 摸了代价牌
    });
  }

  it("U5: the final card still resolves -- a last +2 still opens the punish chain", () => {
    const last = card("R", "+2");
    const s = table([[last], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7] });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [last.id] }, ctx());
    expect(r.state.board!.punish?.total).toBe(2);
    expect(r.state.pendingWindow?.actors).toEqual([1]);
  });

  it("U5: the cost card is not a punishment, so it is drawn even mid-chain", () => {
    // 座位 0 用最后一张 +4 接上家的 +2：既叠链，又因 U5 摸 1 张
    const last = card(null, "+4");
    const s = table([[last], [card("Y", "1")], [card("Y", "2")]], {
      playedPile: [card("B", "+2")],
      punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2 }], total: 2 },
    });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [last.id], chosenColor: "B" }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(1);
    expect(r.state.board!.punish?.total).toBe(6);
  });

  it("U5: a number card still wins even when the draw pile is empty", () => {
    const last = card("R", "3");
    const s = table([[last], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7], drawPile: [] });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [last.id] }, ctx());
    expect(r.state.board!.winner).toBe(0);
  });

  it("G2: without 并列 revealed, a multi-card play is rejected", () => {
    const a = card("R", "3");
    const b = card("R", "4");
    const s = table([[a, b], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7] });
    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [a.id, b.id] }, ctx()).rejected?.reason)
      .toBe("single_card_only");
  });

  it("does not mutate the input state", () => {
    const mine = card("R", "3");
    const s = table([[mine, card("B", "3")], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7] });
    const snapshot = JSON.stringify(s);
    applyAction(s, { type: "playCards", seat: 0, cardIds: [mine.id] }, ctx());
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
