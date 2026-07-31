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
      revealed: false,
      marks: {},
      statuses: [],
      ascensions: 0,
    });
    expect(snap.drawPileCount).toBe(164 - 28 - 1);
    expect(snap.playedTop).toEqual(dealt.board!.playedPile[0]);
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
  const s = table([mine, [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7] });

  // 这些 fixture 里座位 1/2 都恰剩 1 张且没喊 UNO，所以到处合法地长出 catchUno（U7）；
  // callUno 则是**常亮**的（U6 2026-08-01：手牌数不参与，虚喊罚 2 张由引擎在按下时判）
  it("U3: offers exactly the playable cards plus a draw on your turn", () => {
    expect(legalActions(s, 0)).toEqual([
      { type: "playCards", seat: 0, cardIds: [mine[0].id] },
      { type: "playCards", seat: 0, cardIds: [mine[1].id] },
      { type: "drawCard", seat: 0 },
      { type: "callUno", seat: 0 },
      { type: "catchUno", seat: 0, target: 1 },
      { type: "catchUno", seat: 0, target: 2 },
    ]);
  });

  it("never offers another player's cards", () => {
    const wire = JSON.stringify(legalActions(s, 0));
    expect(wire).not.toContain(s.board!.hands[1][0].id);
    expect(legalActions(s, 1)).toEqual([
      { type: "callUno", seat: 1 },
      { type: "catchUno", seat: 1, target: 2 },
    ]);
  });

  it("P1: inside a punish window the actor may only respond", () => {
    const p2 = card("R", "+2");
    const opened = applyAction(
      table([[p2, card("R", "1")], [card("Y", "+2"), card("Y", "3")], [card("Y", "2")]], { playedPile: [R7] }),
      { type: "playCards", seat: 0, cardIds: [p2.id] },
      ctx(),
    ).state;
    const w = windowIdOf(opened)!;
    // U7：座位 0 打出 +2 后只剩 1 张没喊，但**回合还是他的**（窗口挂着 currentSeat 不动）
    // → 宽限期内抓不得，被抓名单里只有座位 2。callUno 则是常亮的（U6 2026-08-01）
    expect(legalActions(opened, 1)).toEqual([
      { type: "respond", seat: 1, windowId: w, choice: "stack" },
      { type: "respond", seat: 1, windowId: w, choice: "accept" },
      { type: "callUno", seat: 1 },
      { type: "catchUno", seat: 1, target: 2 },
    ]);
    expect(legalActions(opened, 0)).toEqual([
      { type: "callUno", seat: 0 },
      { type: "catchUno", seat: 0, target: 2 },
    ]);
    expect(projectView(opened, 1).windowId).toBe(w);
  });

  it("P5: an actor who cannot legally stack is only offered accept", () => {
    const p4 = card(null, "+4");
    const opened = applyAction(
      table([[p4, card("R", "1")], [card("Y", "+2"), card("Y", "3")], [card("Y", "2")]], { playedPile: [R7] }),
      { type: "playCards", seat: 0, cardIds: [p4.id], chosenColor: "Y" },
      ctx(),
    ).state;
    expect(legalActions(opened, 1)).toEqual([
      { type: "respond", seat: 1, windowId: windowIdOf(opened)!, choice: "accept" },
      // 座位 0 同样在自己的回合里（U7 宽限期），只有座位 2 抓得着
      { type: "callUno", seat: 1 },
      { type: "catchUno", seat: 1, target: 2 },
    ]);
  });

  it("U1: after drawing a playable card the options are that card or ending the turn", () => {
    const drawn = card("R", "5");
    const after = applyAction(
      table([[card("B", "3")], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7], drawPile: [drawn] }),
      { type: "drawCard", seat: 0 },
      ctx(),
    ).state;
    expect(legalActions(after, 0)).toEqual([
      { type: "playCards", seat: 0, cardIds: [drawn.id] },
      { type: "endTurn", seat: 0 },
      // callUno 常亮：手牌数不参与（按下时不是 1 张就是虚喊，罚摸 2）
      { type: "callUno", seat: 0 },
      { type: "catchUno", seat: 0, target: 1 },
      { type: "catchUno", seat: 0, target: 2 },
    ]);
  });

  it("02 §5: the discard pile is fully public in the snapshot", () => {
    const dumped = card("B", "9");
    const s2 = table([[card("R", "3")], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7], discardPile: [dumped] });
    expect(projectView(s2, 0).discardPile).toEqual([dumped]);
    expect(projectView(s2, 1).discardPile).toEqual([dumped]);
  });

  it("offers nothing once the game is finished", () => {
    const last = card("R", "3");
    const done = applyAction(
      table([[last], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7] }),
      { type: "playCards", seat: 0, cardIds: [last.id] },
      ctx(),
    ).state;
    expect(done.phase).toBe("finished");
    expect(legalActions(done, 0)).toEqual([]);
    expect(projectView(done, 0).winner).toBe(0);
  });
});

describe("disabledReasons", () => {
  // 按钮由 legalActions 生成，不可用的动作根本不渲染，所以引擎这边一条置灰文案都不该发
  // （L2 的真实需求是「点了被拒时给人话」，那在 apps/web 的拒因表里）。
  it("never advertises an action the engine does not implement", () => {
    const s = table([[card("R", "3"), card("R", "4"), card("R", "5")], [card("Y", "1")], [card("Y", "2")]]);
    const reasons = projectView(s, 0).disabledReasons;
    expect(reasons.callUno).toBeUndefined();
    expect(Object.keys(reasons)).toEqual([]);
  });
});
