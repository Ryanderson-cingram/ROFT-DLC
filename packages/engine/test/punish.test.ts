import { describe, expect, it } from "vitest";
import { applyAction } from "../src/index.ts";
import { windowIdOf } from "../src/actions/punish.ts";
import { card, ctx, table } from "./helpers.ts";
import type { GameState } from "../src/types.ts";

const R7 = card("R", "7");
const NOW = "2026-07-28T12:00:00.000Z";
const LATER = "2026-07-28T12:00:31.000Z";

const play = (s: GameState, seat: number, id: string, chosenColor?: "R" | "G" | "B" | "Y") =>
  applyAction(s, { type: "playCards", seat, cardIds: [id], chosenColor }, ctx());

/** seat0 打出 +2，窗口开在 seat1。 */
function opened() {
  const p2 = card("R", "+2");
  const s = table(
    [[p2, card("R", "1")], [card("Y", "+2"), card(null, "+4"), card("Y", "3")], [card("Y", "2")]],
    { playedPile: [R7] },
  );
  return { start: s, after: play(s, 0, p2.id).state, p2 };
}

describe("punish stacking (01 §5)", () => {
  it("P3: playing +2 opens a punishStack window on the next seat", () => {
    const { after } = opened();
    const w = after.pendingWindow!;
    expect(w.type).toBe("punishStack");
    expect(w.actors).toEqual([1]);
    expect(w.defaultChoice).toBe("accept");
    expect(w.resume).toBe("play");
    expect(w.deadline).toBe("2026-07-28T12:00:30.000Z");
    expect(after.board!.punish).toEqual({
      initiator: 0,
      segments: [{ seat: 0, face: "+2", draw: 2 }],
      total: 2,
    });
  });

  it("P6: each played card contributes its own segment, the total is their sum", () => {
    const { after } = opened();
    const stacked = applyAction(
      after,
      { type: "respond", seat: 1, windowId: windowIdOf(after)!, choice: "stack" },
      ctx(),
    ).state;
    const plus4 = stacked.board!.hands[1][1];
    const r = play(stacked, 1, plus4.id, "G");
    expect(r.rejected).toBeUndefined();
    const p = r.state.board!.punish!;
    expect(p.initiator).toBe(0);
    expect(p.segments).toEqual([
      { seat: 0, face: "+2", draw: 2 },
      { seat: 1, face: "+4", draw: 4 },
    ]);
    expect(p.total).toBe(6);
    expect(r.state.pendingWindow!.actors).toEqual([2]);
  });

  it("P4: on a +2 chain a +4 is a legal stack but still needs a chosen colour", () => {
    const { after } = opened();
    const stacked = applyAction(
      after,
      { type: "respond", seat: 1, windowId: windowIdOf(after)!, choice: "stack" },
      ctx(),
    ).state;
    const plus4 = stacked.board!.hands[1][1];
    expect(play(stacked, 1, plus4.id).rejected?.reason).toBe("color_required");
  });

  it("P5: on a +4 chain only another +4 may be stacked", () => {
    const p4 = card(null, "+4");
    const s = table(
      [[p4, card("R", "1")], [card("Y", "+2"), card("Y", "3")], [card("Y", "2")]],
      { playedPile: [R7] },
    );
    const after = play(s, 0, p4.id, "Y").state;
    const stacked = applyAction(
      after,
      { type: "respond", seat: 1, windowId: windowIdOf(after)!, choice: "stack" },
      ctx(),
    );
    expect(stacked.rejected?.reason).toBe("cannot_stack");
  });

  it("P10: accepting draws the whole total, then the turn ends immediately", () => {
    const { after } = opened();
    const r = applyAction(after, { type: "respond", seat: 1, windowId: windowIdOf(after)!, choice: "accept" }, ctx());
    const b = r.state.board!;
    expect(b.hands[1]).toHaveLength(5); // 3 张原手牌 + 摸 2
    expect(b.punish).toBeUndefined();
    expect(r.state.pendingWindow).toBeUndefined();
    expect(b.currentSeat).toBe(2);
    const own = b.hands[1][0];
    expect(applyAction(r.state, { type: "playCards", seat: 1, cardIds: [own.id] }, ctx()).rejected?.reason)
      .toBe("not_your_turn");
  });

  it("P1: respond only accepts the stack/accept whitelist (no active skills in a punish turn)", () => {
    const { after } = opened();
    const r = applyAction(
      after,
      { type: "respond", seat: 1, windowId: windowIdOf(after)!, choice: "activateSkill" },
      ctx(),
    );
    expect(r.rejected?.reason).toBe("bad_choice");
  });

  it("P3: after choosing to stack you must actually stack, not draw", () => {
    const { after } = opened();
    const stacked = applyAction(
      after,
      { type: "respond", seat: 1, windowId: windowIdOf(after)!, choice: "stack" },
      ctx(),
    ).state;
    expect(applyAction(stacked, { type: "drawCard", seat: 1 }, ctx()).rejected?.reason).toBe("must_stack");
    const plain = stacked.board!.hands[1][2];
    expect(play(stacked, 1, plain.id).rejected?.reason).toBe("must_stack");
  });

  it("rejects a respond from a seat outside the window's actors", () => {
    const { after } = opened();
    const r = applyAction(after, { type: "respond", seat: 2, windowId: windowIdOf(after)!, choice: "accept" }, ctx());
    expect(r.rejected?.reason).toBe("not_your_window");
  });

  it("rejects a respond carrying a stale windowId", () => {
    const { after } = opened();
    const r = applyAction(after, { type: "respond", seat: 1, windowId: "w1:punishStack", choice: "accept" }, ctx());
    expect(r.rejected?.reason).toBe("stale_window");
  });

  it("blocks unrelated plays while a window is open", () => {
    const { after } = opened();
    const other = after.board!.hands[2][0];
    expect(applyAction(after, { type: "playCards", seat: 2, cardIds: [other.id] }, ctx()).rejected?.reason)
      .toBe("pending_window");
  });

  it("does not mutate the input state", () => {
    const { after } = opened();
    const snapshot = JSON.stringify(after);
    applyAction(after, { type: "respond", seat: 1, windowId: windowIdOf(after)!, choice: "accept" }, ctx());
    expect(JSON.stringify(after)).toBe(snapshot);
  });
});

describe("claimTimeout (spec §7)", () => {
  it("refuses to claim a window that has not expired yet", () => {
    const { after } = opened();
    const r = applyAction(
      after,
      { type: "claimTimeout", seat: 2, windowId: windowIdOf(after)! },
      ctx(undefined, NOW),
    );
    expect(r.rejected?.reason).toBe("not_yet_expired");
  });

  it("any member may claim an expired window; it settles on defaultChoice", () => {
    const { after } = opened();
    const r = applyAction(
      after,
      { type: "claimTimeout", seat: 2, windowId: windowIdOf(after)! },
      ctx(undefined, LATER),
    );
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[1]).toHaveLength(5);
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.currentSeat).toBe(2);
  });

  it("rejects a claim with a stale windowId", () => {
    const { after } = opened();
    const r = applyAction(after, { type: "claimTimeout", seat: 2, windowId: "w1:punishStack" }, ctx(undefined, LATER));
    expect(r.rejected?.reason).toBe("stale_window");
  });

  it("rejects a claim when no window is open", () => {
    const { start } = opened();
    const r = applyAction(start, { type: "claimTimeout", seat: 0, windowId: "w10:punishStack" }, ctx(undefined, LATER));
    expect(r.rejected?.reason).toBe("no_window");
  });
});
