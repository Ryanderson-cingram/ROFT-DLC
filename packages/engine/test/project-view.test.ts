import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../src/index.ts";
import { windowIdOf } from "../src/actions/punish.ts";
import { card, ctx, lobby, table } from "./helpers.ts";

const R7 = card("R", "7");

describe("projectView privacy (spec §1: client never sees other hands)", () => {
  const dealt = applyAction(lobby(4), { type: "startGame", seat: 0 }, ctx()).state;

  it("no other player's card appears anywhere in the serialised snapshot", () => {
    for (let seat = 0; seat < 4; seat++) {
      const wire = JSON.stringify(projectView(dealt, seat));
      const others = dealt.board!.hands.flatMap((h, i) => (i === seat ? [] : h));
      expect(others).toHaveLength(21);
      for (const c of others) expect(wire).not.toContain(c.id);
    }
  });

  it("the same string search does find your own seven cards (the search works)", () => {
    const wire = JSON.stringify(projectView(dealt, 2));
    for (const c of dealt.board!.hands[2]) expect(wire).toContain(c.id);
  });

  it("other players are reduced to public counters", () => {
    const snap = projectView(dealt, 0);
    expect(snap.youSeat).toBe(0);
    expect(snap.yourHand).toEqual(dealt.board!.hands[0]);
    expect(snap.players).toHaveLength(4);
    expect(snap.players[1]).toEqual({
      seat: 1,
      userId: "u1",
      handCount: 7,
      saidUno: false,
      skillId: null,
      ascensions: 0,
    });
    expect(snap.drawPileCount).toBe(164 - 28 - 1);
    expect(snap.discardTop).toEqual(dealt.board!.discardPile[0]);
  });

  it("projects a lobby with no board", () => {
    const snap = projectView(lobby(3), 1);
    expect(snap.phase).toBe("lobby");
    expect(snap.yourHand).toEqual([]);
    expect(snap.currentSeat).toBeNull();
    expect(snap.legalActions).toEqual([]);
  });
});

describe("legalActions", () => {
  const mine = [card("R", "3"), card("B", "7"), card("G", "2")];
  const s = table([mine, [card("Y", "1")], [card("Y", "2")]], { discardPile: [R7] });

  it("U3: offers exactly the playable cards plus a draw on your turn", () => {
    expect(legalActions(s, 0)).toEqual([
      { type: "playCards", seat: 0, cardIds: [mine[0].id] },
      { type: "playCards", seat: 0, cardIds: [mine[1].id] },
      { type: "drawCard", seat: 0 },
    ]);
  });

  it("never offers another player's cards", () => {
    const wire = JSON.stringify(legalActions(s, 0));
    expect(wire).not.toContain(s.board!.hands[1][0].id);
    expect(legalActions(s, 1)).toEqual([]);
  });

  it("P1: inside a punish window the actor may only respond", () => {
    const p2 = card("R", "+2");
    const opened = applyAction(
      table([[p2, card("R", "1")], [card("Y", "+2"), card("Y", "3")], [card("Y", "2")]], { discardPile: [R7] }),
      { type: "playCards", seat: 0, cardIds: [p2.id] },
      ctx(),
    ).state;
    const w = windowIdOf(opened)!;
    expect(legalActions(opened, 1)).toEqual([
      { type: "respond", seat: 1, windowId: w, choice: "stack" },
      { type: "respond", seat: 1, windowId: w, choice: "accept" },
    ]);
    expect(legalActions(opened, 0)).toEqual([]);
    expect(projectView(opened, 1).windowId).toBe(w);
  });

  it("P5: an actor who cannot legally stack is only offered accept", () => {
    const p4 = card(null, "+4");
    const opened = applyAction(
      table([[p4, card("R", "1")], [card("Y", "+2"), card("Y", "3")], [card("Y", "2")]], { discardPile: [R7] }),
      { type: "playCards", seat: 0, cardIds: [p4.id], chosenColor: "Y" },
      ctx(),
    ).state;
    expect(legalActions(opened, 1)).toEqual([
      { type: "respond", seat: 1, windowId: windowIdOf(opened)!, choice: "accept" },
    ]);
  });

  it("U1: after drawing a playable card the options are that card or ending the turn", () => {
    const drawn = card("R", "5");
    const after = applyAction(
      table([[card("B", "3")], [card("Y", "1")], [card("Y", "2")]], { discardPile: [R7], drawPile: [drawn] }),
      { type: "drawCard", seat: 0 },
      ctx(),
    ).state;
    expect(legalActions(after, 0)).toEqual([
      { type: "playCards", seat: 0, cardIds: [drawn.id] },
      { type: "endTurn", seat: 0 },
    ]);
  });

  it("offers nothing once the game is finished", () => {
    const last = card("R", "3");
    const done = applyAction(
      table([[last], [card("Y", "1")], [card("Y", "2")]], { discardPile: [R7] }),
      { type: "playCards", seat: 0, cardIds: [last.id] },
      ctx(),
    ).state;
    expect(done.phase).toBe("finished");
    expect(legalActions(done, 0)).toEqual([]);
    expect(projectView(done, 0).winner).toBe(0);
  });
});

describe("disabledReasons", () => {
  it("explains that UNO is only called at two cards", () => {
    const s = table([[card("R", "3"), card("R", "4"), card("R", "5")], [card("Y", "1")], [card("Y", "2")]]);
    expect(projectView(s, 0).disabledReasons.callUno).toBe("剩 2 张牌时才需要喊");
    const two = table([[card("R", "3"), card("R", "4")], [card("Y", "1")], [card("Y", "2")]]);
    expect(projectView(two, 0).disabledReasons.callUno).toBeUndefined();
  });
});
