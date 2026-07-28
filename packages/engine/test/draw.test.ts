import { describe, expect, it } from "vitest";
import { applyAction } from "../src/index.ts";
import { card, ctx, table } from "./helpers.ts";

const R7 = card("R", "7");
const hands = () => [[card("B", "3")], [card("Y", "1")], [card("Y", "2")]];

describe("drawCard", () => {
  it("U1: draws one card from the pile into the hand", () => {
    const top = card("G", "9");
    const s = table(hands(), { discardPile: [R7], drawPile: [top, card("G", "8")] });
    const r = applyAction(s, { type: "drawCard", seat: 0 }, ctx());
    expect(r.rejected).toBeUndefined();
    const b = r.state.board!;
    expect(b.hands[0]).toHaveLength(2);
    expect(b.hands[0][1]).toEqual(top);
    expect(b.drawPile).toHaveLength(1);
  });

  it("U1: a playable draw stays on your turn as drawnPlayable", () => {
    const s = table(hands(), { discardPile: [R7], drawPile: [card("R", "5"), card("G", "8")] });
    const r = applyAction(s, { type: "drawCard", seat: 0 }, ctx());
    expect(r.state.board!.drawnPlayable?.face).toBe("5");
    expect(r.state.board!.currentSeat).toBe(0);
    expect(r.state.phase).toBe("play");
  });

  it("U1: the drawn card may be played immediately", () => {
    const drawn = card("R", "5");
    const s = table(hands(), { discardPile: [R7], drawPile: [drawn, card("G", "8")] });
    const after = applyAction(s, { type: "drawCard", seat: 0 }, ctx()).state;
    const r = applyAction(after, { type: "playCards", seat: 0, cardIds: [drawn.id] }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.discardPile[0]).toEqual(drawn);
    expect(r.state.board!.currentSeat).toBe(1);
  });

  it("U1: with a drawnPlayable pending, any other card is refused", () => {
    const s = table(hands(), { discardPile: [R7], drawPile: [card("R", "5"), card("G", "8")] });
    const after = applyAction(s, { type: "drawCard", seat: 0 }, ctx()).state;
    const other = after.board!.hands[0][0];
    expect(applyAction(after, { type: "playCards", seat: 0, cardIds: [other.id] }, ctx()).rejected?.reason)
      .toBe("must_play_drawn_or_end");
  });

  it("U1: an unplayable draw ends the turn right away", () => {
    const s = table(hands(), { discardPile: [R7], drawPile: [card("G", "8"), card("G", "9")] });
    const r = applyAction(s, { type: "drawCard", seat: 0 }, ctx());
    expect(r.state.board!.drawnPlayable).toBeNull();
    expect(r.state.board!.currentSeat).toBe(1);
    expect(r.state.phase).toBe("turnStart");
  });

  it("U1: endTurn passes without playing the drawn card", () => {
    const s = table(hands(), { discardPile: [R7], drawPile: [card("R", "5"), card("G", "8")] });
    const after = applyAction(s, { type: "drawCard", seat: 0 }, ctx()).state;
    const r = applyAction(after, { type: "endTurn", seat: 0 }, ctx());
    expect(r.state.board!.currentSeat).toBe(1);
    expect(r.state.board!.drawnPlayable).toBeNull();
  });

  it("U1: you cannot end a turn without playing or drawing", () => {
    const s = table(hands(), { discardPile: [R7] });
    expect(applyAction(s, { type: "endTurn", seat: 0 }, ctx()).rejected?.reason).toBe("must_draw_first");
  });

  it("U1: you cannot draw twice in one turn", () => {
    const s = table(hands(), { discardPile: [R7], drawPile: [card("R", "5"), card("G", "8")] });
    const after = applyAction(s, { type: "drawCard", seat: 0 }, ctx()).state;
    expect(applyAction(after, { type: "drawCard", seat: 0 }, ctx()).rejected?.reason).toBe("already_drawn");
  });

  it("rejects a draw out of turn", () => {
    const s = table(hands(), { discardPile: [R7] });
    expect(applyAction(s, { type: "drawCard", seat: 1 }, ctx()).rejected?.reason).toBe("not_your_turn");
  });

  it("reshuffles the discard pile (top excluded) back into an empty draw pile", () => {
    const buried = [card("G", "1"), card("G", "2"), card("G", "3")];
    const s = table(hands(), { discardPile: [R7, ...buried], drawPile: [] });
    const r = applyAction(s, { type: "drawCard", seat: 0 }, ctx());
    const b = r.state.board!;
    expect(b.discardPile).toEqual([R7]);
    expect(b.drawPile).toHaveLength(2);
    expect(b.hands[0]).toHaveLength(2);
    expect(r.events.some((e) => e.type === "deckReshuffled")).toBe(true);
    const recovered = [...b.drawPile, b.hands[0][1]].map((c) => c.id).sort();
    expect(recovered).toEqual(buried.map((c) => c.id).sort());
  });

  // 调研 §4：随机的结果必须入事件流，否则重放要重新掷骰，历史对不上。
  it("records the reshuffled pile order for replay, without leaking it", () => {
    const buried = [card("G", "1"), card("G", "2"), card("G", "3")];
    const s = table([[card("B", "5")], [card("Y", "1")], [card("Y", "2")]], {
      drawPile: [], discardPile: [R7, ...buried],
    });
    const r = applyAction(s, { type: "drawCard", seat: 0 }, ctx());
    const ev = r.events.find((e) => e.type === "deckReshuffled")!;

    // 审计里是洗完当下的完整牌序（顶在前），重放据此还原：这一张随即被摸走，其余留在堆里
    expect(ev.audit?.order).toEqual([r.state.board!.hands[0][1], ...r.state.board!.drawPile].map((c) => c.id));
    // 公开 payload 里一张牌都不能有——否则等于把牌堆顺序告诉所有人
    expect(JSON.stringify(ev.public)).not.toContain("G1");
    for (const c of buried) expect(JSON.stringify(ev.public)).not.toContain(c.id);
  });

  it("survives an exhausted deck: draws what is left instead of crashing", () => {
    const s = table(hands(), { discardPile: [R7], drawPile: [] });
    const r = applyAction(s, { type: "drawCard", seat: 0 }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(1);
    expect(r.state.board!.currentSeat).toBe(1);
  });

  it("spec §4: the public draw event carries a count, the cards go private", () => {
    const drawn = card("R", "5");
    const s = table(hands(), { discardPile: [R7], drawPile: [drawn, card("G", "8")] });
    const r = applyAction(s, { type: "drawCard", seat: 0 }, ctx());
    const e = r.events.find((x) => x.type === "cardsDrawn")!;
    expect(e.public).toEqual({ seat: 0, count: 1 });
    expect(JSON.stringify(e.public)).not.toContain(drawn.id);
    expect(e.private).toEqual({ seat: 0, payload: { cards: [drawn] } });
  });

  it("does not mutate the input state", () => {
    const s = table(hands(), { discardPile: [R7], drawPile: [card("R", "5")] });
    const snapshot = JSON.stringify(s);
    applyAction(s, { type: "drawCard", seat: 0 }, ctx());
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
