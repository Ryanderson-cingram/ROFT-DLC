import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../src/index.ts";
import { windowIdOf } from "../src/actions/punish.ts";
import { spendMarks } from "../src/skills/primitives/marks.ts";
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
      marksSpent: {},
      statuses: [],
      activatedThisTurn: false,
      sealedBy: null,
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

describe("出牌堆的投影（02 §5 / 06-Q55：牌河分堆）", () => {
  const older = [card("R", "4"), card("B", "4"), card("B", "9")];

  it("`[0]` 是牌顶：刚打出的那张排在最前，与 discardPile 的旧→新方向相反", () => {
    const mine = card("R", "3");
    const s = table([[mine, card("G", "8")], [card("Y", "1")], [card("Y", "2")]], {
      playedPile: [R7, ...older],
      discardPile: [card("G", "2"), card("Y", "9")],
    });
    const after = applyAction(s, { type: "playCards", seat: 0, cardIds: [mine.id] }, ctx()).state;
    const snap = projectView(after, 0);
    expect(snap.playedPile).toEqual([mine, R7, ...older]);
    expect(snap.playedPile[0]).toEqual(snap.playedTop);
    // 弃牌堆方向相反：`[0]` 是最旧的一张。两个堆同向的假设会把 UI 画反
    expect(snap.discardPile[0]).toEqual({ ...snap.discardPile[0], face: "2" });
  });

  it("摸牌堆见底洗回之后被截到只剩牌顶那一张（所以它是「上次重洗以来」，不是整局历史）", () => {
    const s = table([[card("G", "8")], [card("Y", "1")], [card("Y", "2")]], {
      playedPile: [R7, ...older],
      drawPile: [],
    });
    expect(projectView(s, 0).playedPile).toHaveLength(4);
    const after = applyAction(s, { type: "drawCard", seat: 0 }, ctx()).state;
    expect(after.board!.reshuffles).toBe(1);
    expect(projectView(after, 0).playedPile).toEqual([R7]);
  });
});

// 这一条是本批投影的**回归闩**：三个中间态都同时含着暗信息与公开信息，
// 投影只许放公开的那一半出去。加字段的人删不掉这个测试就漏不了牌。
describe("暗信息不进快照（司夜的 cardId / 摸 N 弃 N 的 drawnIds / 掷骰的 resume）", () => {
  const stolen = card("B", "5");
  const drawn = card("G", "7");
  const s = table([[stolen, drawn, card("R", "3")], [card("Y", "1")], [card("Y", "2")]], {
    swap: { seat: 0, target: 1, cardId: stolen.id },
    drawDiscard: { seat: 0, picks: 1, drawnIds: [drawn.id], resume: { kind: "afterFace" } },
  }, {
    pendingDice: {
      seat: 0,
      reason: "bloodthorn",
      values: [2],
      resume: { kind: "bloodthorn", seat: 0, target: 2 },
    },
  });

  it("司夜②：只投「谁跟谁换」，盲抽那张的 id 不出现在旁观者的快照里", () => {
    for (const viewer of [0, 1, 2]) {
      const snap = projectView(s, viewer);
      expect(snap.swap).toEqual({ seat: 0, target: 1 });
      expect(Object.keys(snap.swap!)).toEqual(["seat", "target"]);
    }
    // 盲抽那张此刻在司夜者（座位 0）手里，他当然看得见；旁人一个字节都不该拿到
    expect(JSON.stringify(projectView(s, 2))).not.toContain(stolen.id);
    expect(JSON.stringify(projectView(s, 1))).not.toContain(stolen.id);
  });

  it("摸 N 弃 N：只投「谁在弃、弃几张」，刚摸那几张的 id 不投", () => {
    for (const viewer of [1, 2]) {
      const snap = projectView(s, viewer);
      expect(snap.drawDiscard).toEqual({ seat: 0, picks: 1 });
      expect(JSON.stringify(snap)).not.toContain("drawnIds");
      expect(JSON.stringify(snap)).not.toContain(drawn.id);
    }
    // 弃牌的人自己当然看得见那张（它就在他手上），但 drawnIds 这个字段一样不投给他
    expect(JSON.stringify(projectView(s, 0))).not.toContain("drawnIds");
  });

  it("掷骰：点数与受害者公开，续跑指令 resume 整个不进快照", () => {
    const snap = projectView(s, 1);
    expect(snap.dice).toEqual({ seat: 0, reason: "bloodthorn", values: [2], target: 2 });
    expect(JSON.stringify(snap)).not.toContain("resume");
    expect(JSON.stringify(snap)).not.toContain("bloodthorn\",\"seat");
  });

  it("影歌①：宣言与已摸张数公开，队列与 effectKey 是内部记账不投", () => {
    const h = table([[card("R", "3")], [card("Y", "1")], [card("Y", "2")]], {
      soulHarvest: { seat: 0, declared: { color: "R", face: "5" }, queue: [1, 2], drawn: 3, effectKey: "1" },
    });
    expect(projectView(h, 2).soulHarvest).toEqual({ seat: 0, declared: { color: "R", face: "5" }, drawn: 3 });
  });
});

describe("标记的已花计数（03 §5）", () => {
  const s = table([[card("R", "3")], [card("Y", "1")], [card("Y", "2")]], {
    marks: [{ 魂: 5 }, {}, {}],
  });

  it("spendMarks 之后 marksSpent 累加，余额同步减少", () => {
    const once = spendMarks(s.board!, 0, "魂", 2)!;
    const twice = spendMarks(once, 0, "魂", 1)!;
    const p = projectView({ ...s, board: twice }, 0).players[0];
    expect(p.marks).toEqual({ 魂: 2 });
    expect(p.marksSpent).toEqual({ 魂: 3 });
    // 没花过的座位仍是空表，不是 undefined
    expect(projectView({ ...s, board: twice }, 0).players[1].marksSpent).toEqual({});
  });

  it("用替代标记顶替时按**实际扣掉的那个标记名**记账", () => {
    const marks: Record<string, number>[] = [{ 魂: 1, 颠: 4 }, {}, {}];
    const b = { ...s.board!, marks };
    const paid = spendMarks(b, 0, "魂", 3, ["颠"])!;
    expect(projectView({ ...s, board: paid }, 0).players[0].marksSpent).toEqual({ 魂: 1, 颠: 2 });
  });
});

describe("标记上限 marksCap（绑定来自 04 围栏块的 mark_cap）", () => {
  it("影歌的魂上限 6 从定义读得出来", () => {
    const s = table([[card("R", "3")], [card("Y", "1")], [card("Y", "2")]], {
      skills: ["diamond-3", null, null],
      revealed: [true, false, false],
    });
    expect(projectView(s, 0).marksCap.魂).toBe(6);
  });

  it("没有上限的标记不出现在表里——盗攒着也不给 key，更不是 0", () => {
    const s = table([[card("R", "3")], [card("Y", "1")], [card("Y", "2")]], {
      skills: ["club-3", null, null],
      revealed: [true, false, false],
      marks: [{ 盗: 4 }, {}, {}],
    });
    const snap = projectView(s, 0);
    expect(snap.players[0].marks.盗).toBe(4);
    expect("盗" in snap.marksCap).toBe(false);
    // 缺席才是「无上限」的表达；0 会被 UI 读成「上限是 0」
    expect(snap.marksCap.盗).toBeUndefined();
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
