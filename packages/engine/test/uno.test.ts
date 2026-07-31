// 喊 UNO 与抓漏喊。规则：01-U6/U7 + 「U6/U7 补充」（2026-08-01 改判：声明的作用域是你的这个回合）。
import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../src/index.ts";
import { card, ctx, table } from "./helpers.ts";
import type { Board, Card, GameState } from "../src/types.ts";

const R7 = card("R", "7");
const filler = (n: number) => Array.from({ length: n }, () => card("G", "9"));
const wid = (s: GameState) => `w${s.version}:${s.pendingWindow!.type}`;

/** 座位 0 手持两张红牌（打一张就剩 1），座位 1/2 各 1 张。 */
const twoCards = (over: Partial<Board> = {}) =>
  table([[card("R", "3"), card("R", "4")], [card("Y", "1")], [card("Y", "2")]], {
    playedPile: [R7],
    drawPile: filler(30),
    ...over,
  });
/** 座位 1 已经只剩 1 张且未喊——currentSeat 是 0，所以他不在宽限期里。 */
const exposed = (over: Partial<Board> = {}) =>
  table([[card("R", "3"), card("R", "4")], [card("Y", "1")], [card("Y", "2")]], {
    playedPile: [R7],
    drawPile: [card("G", "5"), card("G", "6"), card("G", "7")],
    ...over,
  });

const call = (s: GameState, seat: number) => applyAction(s, { type: "callUno", seat }, ctx());
const catchIt = (s: GameState, seat: number, target: number) =>
  applyAction(s, { type: "catchUno", seat, target }, ctx());

// ---------------------------------------------------------------- 按下那一刻判

describe("U6 按钮常亮，判在按下那一刻", () => {
  it("恰 1 张：声明成立、一张都不摸", () => {
    const s = exposed({ currentSeat: 1 });
    const r = call(s, 1);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.saidUno[1]).toBe(true);
    expect(r.state.board!.hands[1]).toHaveLength(1);
    expect(r.events.map((e) => e.type)).toEqual(["unoCalled"]);
    expect(call(r.state, 1).rejected?.reason).toBe("already_said");
  });

  it("2 张虚喊：不被拒，罚摸 2 张，发 unoMiscalled，声明仍为假", () => {
    const s = twoCards();
    const r = call(s, 0);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(2 + 2);
    expect(r.state.board!.saidUno[0]).toBe(false);
    expect(r.events.map((e) => e.type)).toEqual(["unoMiscalled", "cardsDrawn"]);
    expect(r.events[0].public).toEqual({ seat: 0 });
    // 罚完还是没喊 → 按钮还在，再按还是罚（合法 ≠ 划算）
    expect(legalActions(r.state, 0)).toContainEqual({ type: "callUno", seat: 0 });
  });

  it("3 张虚喊：同样受理并罚摸 2（资格一概不拦）", () => {
    const three = twoCards({
      hands: [[card("R", "3"), card("R", "4"), card("R", "5")], [card("Y", "1")], [card("Y", "2")]],
    });
    const r = call(three, 0);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(3 + 2);
    expect(r.state.board!.saidUno[0]).toBe(false);
    expect(r.events.some((e) => e.type === "unoMiscalled")).toBe(true);
  });

  it("罚不到就不受理：牌堆枯竭时虚喊 deck_empty，version 不涨", () => {
    const s = twoCards({ drawPile: [], discardPile: [], playedPile: [R7], reshuffles: 2 });
    const r = call(s, 0);
    expect(r.rejected?.reason).toBe("deck_empty");
    expect(r.state.version).toBe(s.version);
  });

  it("legalActions：按钮常亮，手牌数不参与——只有已喊才收回", () => {
    const three = twoCards({
      hands: [[card("R", "3"), card("R", "4"), card("R", "5")], [card("Y", "1")], [card("Y", "2")]],
    });
    expect(legalActions(three, 0)).toContainEqual({ type: "callUno", seat: 0 });
    expect(legalActions(three, 1)).toContainEqual({ type: "callUno", seat: 1 });
    const said = twoCards({ saidUno: [true, false, false] });
    expect(legalActions(said, 0)).not.toContainEqual({ type: "callUno", seat: 0 });
  });

  it("正常打法：先出牌、手牌变 1 之后再点喊（喊与出牌是两个互不影响的动作）", () => {
    const s = twoCards();
    const played = applyAction(s, { type: "playCards", seat: 0, cardIds: [s.board!.hands[0][0].id] }, ctx()).state;
    // 出牌把回合也交出去了，所以这一声落在别人的回合里——手牌恰 1 张，不算虚喊
    expect(played.board!.hands[0]).toHaveLength(1);
    expect(played.board!.currentSeat).toBe(1);
    const r = call(played, 0);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.saidUno[0]).toBe(true);
    expect(r.state.board!.hands[0]).toHaveLength(1);
    expect(r.events.map((e) => e.type)).toEqual(["unoCalled"]);
  });

  it("打到剩 1 张却没点喊：saidUno 是 false，交回合后可被抓", () => {
    const s = twoCards();
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [s.board!.hands[0][0].id] }, ctx());
    expect(r.state.board!.saidUno[0]).toBe(false);
    expect(catchIt(r.state, 1, 0).rejected).toBeUndefined();
  });

  it("喊过的人再出一张牌，不会把自己的声明擦掉", () => {
    // 已喊 + 2 张手牌是回合内到得了的局面（司夜②把他从 1 张顶开、或恒心摸了一张）
    const said = twoCards({ saidUno: [true, false, false] });
    const r = applyAction(said, { type: "playCards", seat: 0, cardIds: [said.board!.hands[0][0].id] }, ctx());
    expect(r.state.board!.saidUno[0]).toBe(true);
  });

  it("忘喊可补：回合结束后在别人回合点，成立且不罚", () => {
    const s = exposed(); // currentSeat = 0，座位 1 手上 1 张没喊
    const r = call(s, 1);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.saidUno[1]).toBe(true);
    expect(r.state.board!.hands[1]).toHaveLength(1);
    expect(r.events.map((e) => e.type)).toEqual(["unoCalled"]);
    expect(r.state.version).toBe(s.version + 1);
  });

  it("补喊与抓先到先得：被抓在前，补喊就成了虚喊（那时他手上 3 张）", () => {
    const s = exposed();
    const caught = catchIt(s, 2, 1).state;
    expect(caught.board!.hands[1]).toHaveLength(3);
    const late = call(caught, 1);
    expect(late.rejected).toBeUndefined();
    expect(late.state.board!.saidUno[1]).toBe(false);
    expect(late.events.some((e) => e.type === "unoMiscalled")).toBe(true);
  });
});

// ---------------------------------------------------------------- 作用域 = 你的这个回合

describe("U6 声明的作用域是你的这个回合", () => {
  /** 座位 0 持恒心（弃 1 摸 1）并已亮出，手上只剩 1 张——喊得成立。 */
  const steadfast = () =>
    twoCards({
      hands: [[card("R", "3")], [card("Y", "1"), card("Y", "5")], [card("Y", "2"), card("Y", "6")]],
      skills: ["spade-1", null, null],
      revealed: [true, false, false],
    });

  it("回合内穿越：喊过之后恒心弃 1 摸 1（1→0→1），声明不作废", () => {
    const said = call(steadfast(), 0);
    expect(said.rejected).toBeUndefined();
    const drop = said.state.board!.hands[0][0];
    const used = applyAction(
      said.state, { type: "activateSkill", seat: 0, effectKey: "1", cardIds: [drop.id] }, ctx(),
    );
    expect(used.rejected).toBeUndefined();
    // 中途手牌归 0 又回到 1——回合外的口径在归 0 那一刻就把已喊清掉了
    expect(used.state.board!.hands[0]).toHaveLength(1);
    expect(used.state.board!.saidUno[0]).toBe(true);
    expect(used.state.board!.currentSeat).toBe(0);
    expect(catchIt(used.state, 1, 0).rejected?.reason).toBe("not_catchable");
  });

  it("交回合结算：喊过但回合结束时手牌 2 张 → 声明作废，且**不追罚**", () => {
    const said = call(steadfast(), 0).state;
    const used = applyAction(
      said, { type: "activateSkill", seat: 0, effectKey: "1", cardIds: [said.board!.hands[0][0].id] }, ctx(),
    ).state;
    // 摸一张（跟不上牌顶 → 回合当场结束），交回合时是 2 张
    const r = applyAction(used, { type: "drawCard", seat: 0 }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.currentSeat).toBe(1);
    // 罚只在按下那一刻判：作废是作废，不再补罚 2 张（手上就是那 1 + 1 张）
    expect(r.state.board!.hands[0]).toHaveLength(2);
    expect(r.state.board!.saidUno[0]).toBe(false);
    expect(r.events.some((e) => e.type === "unoMiscalled")).toBe(false);
    // 下次到 1 张须重喊——按钮本来就常亮着
    expect(legalActions(r.state, 0)).toContainEqual({ type: "callUno", seat: 0 });
  });

  it("交回合时手牌恰 1 张：声明跟着那张牌存续，回合外也抓不得", () => {
    // 影歌②花 2 魂跳过：手牌一张没动就把回合交出去了
    const s = twoCards({
      hands: [[card("R", "3")], [card("Y", "1"), card("Y", "5")], [card("Y", "2"), card("Y", "6")]],
      skills: ["diamond-3", null, null],
      revealed: [true, false, false],
      marks: [{ 魂: 2 }, {}, {}],
    });
    const said = call(s, 0).state;
    const skipped = applyAction(said, { type: "activateSkill", seat: 0, effectKey: "2" }, ctx()).state;
    expect(skipped.board!.currentSeat).toBe(1);
    expect(skipped.board!.hands[0]).toHaveLength(1);
    expect(skipped.board!.saidUno[0]).toBe(true);
    expect(catchIt(skipped, 1, 0).rejected?.reason).toBe("not_catchable");
  });

  it("并列逐张摆：第 2 张落地后的窗口里手牌恰 1 张，喊得成立且跨中间态存活", () => {
    const pair = [card("R", "2"), card("R", "2")];
    const raider = card("R", "2");
    const s = table([[...pair, card("R", "9")], [raider, card("B", "5")], [card("Y", "3"), card("Y", "4")]], {
      playedPile: [R7],
      drawPile: filler(30),
      skills: ["heart-4", "diamond-10", null],
      revealed: [true, true, false],
    });
    // 并列 2 张同色同数：每张落地各开一次劫营窗口。第 1 张之后他手上还有 2 张——
    // 那时点喊就是虚喊，所以中途确实没有喊的机会
    const first = applyAction(s, { type: "playCards", seat: 0, cardIds: pair.map((c) => c.id) }, ctx()).state;
    expect(first.pendingWindow?.type).toBe("interrupt");
    expect(first.board!.hands[0]).toHaveLength(2);

    // 第 1 个窗口 pass → 第 2 张落地 → 又开一个窗口，此刻他手上恰 1 张、回合还是他的
    const second = applyAction(
      first, { type: "respond", seat: 1, windowId: wid(first), choice: "pass" }, ctx(),
    ).state;
    expect(second.pendingWindow?.type).toBe("interrupt");
    expect(second.board!.hands[0]).toHaveLength(1);
    expect(second.board!.currentSeat).toBe(0);
    expect(catchIt(second, 1, 0).rejected?.reason).toBe("not_catchable"); // 宽限期

    const windowId = wid(second); // 喊会涨 version，窗口 id 在那之前冻住（U7）
    const said = call(second, 0);
    expect(said.rejected).toBeUndefined();
    expect(said.state.board!.saidUno[0]).toBe(true);

    // 窗口 pass 收尾 → 交回合，声明跟着那 1 张存续
    const done = applyAction(
      said.state, { type: "respond", seat: 1, windowId, choice: "pass" }, ctx(),
    ).state;
    expect(done.board!.currentSeat).toBe(1);
    expect(done.board!.hands[0]).toHaveLength(1);
    expect(done.board!.saidUno[0]).toBe(true);
    expect(catchIt(done, 1, 0).rejected?.reason).toBe("not_catchable");
  });

  it("劫营真的截断：剩牌回手 + 摸 1 → 3 张，此刻抓不着、按下去是虚喊", () => {
    const pair = [card("R", "2"), card("R", "2")];
    const raider = card("R", "2");
    const s = table([[...pair, card("R", "9")], [raider, card("B", "5")], [card("Y", "3"), card("Y", "4")]], {
      playedPile: [R7],
      drawPile: filler(30),
      skills: ["heart-4", "diamond-10", null],
      revealed: [true, true, false],
    });
    const opened = applyAction(s, { type: "playCards", seat: 0, cardIds: pair.map((c) => c.id) }, ctx()).state;
    const cut = applyAction(
      opened,
      { type: "respond", seat: 1, windowId: wid(opened), choice: "raid", cardIds: [raider.id] },
      ctx(),
    ).state;
    // 没摆的那张留在手上 + G5 的摸 1 = 3 张
    expect(cut.board!.hands[0]).toHaveLength(3);
    expect(cut.board!.saidUno[0]).toBe(false);
    expect(catchIt(cut, 1, 0).rejected?.reason).toBe("not_catchable");
    expect(call(cut, 0).events.some((e) => e.type === "unoMiscalled")).toBe(true);
  });

  it("洗牌②摸 1 弃 1：喊过之后声明跨中间态存活（不再靠 ShufflePending.sayUno 透传）", () => {
    const sh = card(null, "shuffle");
    const s = table([[sh], [card("B", "3"), card("B", "4")], [card("Y", "3"), card("Y", "4")]], {
      playedPile: [R7],
      drawPile: filler(30),
    });
    // 手上恰 1 张（就是那张洗牌）→ 先喊成立，然后把它打出去
    const said = call(s, 0);
    expect(said.rejected).toBeUndefined();
    const opened = applyAction(
      said.state,
      { type: "playCards", seat: 0, cardIds: [sh.id], chosenColor: "B", shuffleChoice: "drawDiscard" },
      ctx(),
    ).state;
    // 打出去那一刻手牌为 0（洗牌是功能牌，U5 不判胜），摸 1 之后是 1 张，窗口挂着
    expect(opened.pendingWindow?.type).toBe("shuffleDiscard");
    expect(opened.board!.saidUno[0]).toBe(true);

    const done = applyAction(
      opened,
      { type: "respond", seat: 0, windowId: wid(opened), choice: opened.board!.hands[0][0].id },
      ctx(),
    ).state;
    // 弃完手牌又归 0 → U5 补摸 1 → 交回合时恰 1 张，声明一路活到这里
    expect(done.board!.hands[0]).toHaveLength(1);
    expect(done.board!.saidUno[0]).toBe(true);
    expect(catchIt(done, 1, 0).rejected?.reason).toBe("not_catchable");
  });

  it("回合之外沿用旧口径：喊过之后手牌一离开 1 张就作废", () => {
    const said = call(exposed({ currentSeat: 1 }), 1).state;
    const r = applyAction(said, { type: "drawCard", seat: 1 }, ctx());
    expect(r.rejected).toBeUndefined();
    // 摸完回合就交出去了（摸到的绿 5 跟不上红 7）→ 2 张 → 作废
    expect(r.state.board!.saidUno[1]).toBe(false);
  });
});

// ---------------------------------------------------------------- 宽限期（U7 的硬门闩）

describe("U7 宽限期 = 你自己的回合", () => {
  /** 座位 0 只剩 1 张、没喊，而且正轮到他；持影歌②以便原样把回合交出去。 */
  const inTurn = () =>
    table([[card("R", "3")], [card("Y", "1"), card("Y", "5")], [card("Y", "2"), card("Y", "6")]], {
      playedPile: [R7],
      drawPile: filler(30),
      skills: ["diamond-3", null, null],
      revealed: [true, false, false],
      marks: [{ 魂: 2 }, {}, {}],
    });

  it("自己回合内持 1 张未喊：谁都抓不得，legalActions 里也没有这条", () => {
    const s = inTurn();
    expect(s.board!.saidUno[0]).toBe(false);
    expect(catchIt(s, 1, 0).rejected?.reason).toBe("not_catchable");
    expect(catchIt(s, 2, 0).rejected?.reason).toBe("not_catchable");
    expect(legalActions(s, 1)).not.toContainEqual({ type: "catchUno", seat: 1, target: 0 });
    // 他自己看得到补喊
    expect(legalActions(s, 0)).toContainEqual({ type: "callUno", seat: 0 });
  });

  it("回合一交出去立刻可抓", () => {
    const passed = applyAction(inTurn(), { type: "activateSkill", seat: 0, effectKey: "2" }, ctx()).state;
    expect(passed.board!.currentSeat).toBe(1);
    expect(legalActions(passed, 1)).toContainEqual({ type: "catchUno", seat: 1, target: 0 });
    const caught = catchIt(passed, 1, 0);
    expect(caught.rejected).toBeUndefined();
    expect(caught.state.board!.hands[0]).toHaveLength(3);
  });

  it("在别人回合里被顶到 1 张没有宽限期：劫营打断者当场可抓", () => {
    const r2 = card("R", "2");
    const raider = card("R", "2");
    const s = table([[r2, card("R", "9")], [raider, card("B", "5")], [card("Y", "3"), card("Y", "4")]], {
      playedPile: [R7],
      drawPile: filler(30),
      skills: [null, "diamond-10", null],
      revealed: [false, true, false],
    });
    const opened = applyAction(s, { type: "playCards", seat: 0, cardIds: [r2.id] }, ctx()).state;
    const cut = applyAction(
      opened,
      { type: "respond", seat: 1, windowId: wid(opened), choice: "raid", cardIds: [raider.id] },
      ctx(),
    ).state;
    // 打断者手上只剩 1 张且没喊，而回合已经交给他的下家（G5）
    expect(cut.board!.hands[1]).toHaveLength(1);
    expect(cut.board!.currentSeat).toBe(2);
    expect(catchIt(cut, 0, 1).rejected).toBeUndefined();
  });
});

// ---------------------------------------------------------------- 司夜②与已喊状态（04 ♣3）

describe("司夜②换牌与已喊（04 ♣3 2026-07-31 裁定，改判后仍成立）", () => {
  const nightlord = (over: Partial<Board> = {}) =>
    table([[card("R", "3")], [card("Y", "1")], [card("Y", "2"), card("Y", "6")]], {
      playedPile: [R7],
      drawPile: filler(30),
      skills: ["club-3", null, null],
      revealed: [true, false, false],
      marks: [{ 盗: 1 }, {}, {}],
      ...over,
    });

  it("把目标顶离 1 张 → 目标的已喊作废，还完牌须重喊、当场可抓", () => {
    const s = nightlord({ saidUno: [false, true, false] });
    const drawn = applyAction(s, { type: "stealSwap", seat: 0, target: 1 }, ctx()).state;
    expect(drawn.board!.hands[1]).toHaveLength(0);
    expect(drawn.board!.saidUno[1]).toBe(false);

    const back = applyAction(
      drawn,
      { type: "respond", seat: 0, windowId: wid(drawn), choice: "stolen" },
      ctx(),
    ).state;
    expect(back.board!.hands[1]).toHaveLength(1);
    expect(back.board!.saidUno[1]).toBe(false);
    expect(catchIt(back, 2, 1).rejected).toBeUndefined();
  });

  it("不作废**司夜自己**的已喊：他在自己的回合里，手牌 1→2→1 都不管", () => {
    const s = nightlord({ saidUno: [true, false, false] });
    const drawn = applyAction(s, { type: "stealSwap", seat: 0, target: 2 }, ctx()).state;
    expect(drawn.board!.hands[0]).toHaveLength(2);
    expect(drawn.board!.saidUno[0]).toBe(true);

    const back = applyAction(
      drawn,
      { type: "respond", seat: 0, windowId: wid(drawn), choice: "stolen" },
      ctx(),
    ).state;
    expect(back.board!.hands[0]).toHaveLength(1);
    expect(back.board!.saidUno[0]).toBe(true);
  });

  it("换牌窗口挂着时目标手上的 1 张是假象，抓不得", () => {
    const s = nightlord({ hands: [[card("R", "3")], [card("Y", "1"), card("Y", "5")], [card("Y", "2")]] as Card[][] });
    const drawn = applyAction(s, { type: "stealSwap", seat: 0, target: 1 }, ctx()).state;
    expect(drawn.board!.hands[1]).toHaveLength(1);
    expect(catchIt(drawn, 2, 1).rejected?.reason).toBe("not_catchable");
  });
});

// ---------------------------------------------------------------- 抓漏喊

describe("U7 抓漏喊", () => {
  it("任何人不限回合可抓：被抓摸 2 张", () => {
    const s = exposed();
    const r = catchIt(s, 2, 1);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[1]).toHaveLength(3);
    expect(r.state.board!.saidUno[1]).toBe(false);
    expect(r.events.map((e) => e.type)).toEqual(["unoCaught", "cardsDrawn"]);
  });

  it("U7 的 2 张不是惩罚：目标亮着恩惠照样摸满 2 张", () => {
    const s = exposed({ skills: [null, "heart-1", null], revealed: [false, true, false] });
    expect(catchIt(s, 0, 1).state.board!.hands[1]).toHaveLength(3);
  });

  it("喊过的抓不到；自己不能抓自己；手牌不是 1 张抓不到", () => {
    const said = call(exposed(), 1).state;
    expect(catchIt(said, 0, 1).rejected?.reason).toBe("not_catchable");
    const s = exposed();
    expect(catchIt(s, 1, 1).rejected?.reason).toBe("bad_target");
    expect(catchIt(s, 1, 0).rejected?.reason).toBe("not_catchable");
  });

  it("legalActions：目标自己看到 callUno，其他人看到 catchUno——不轮到谁都一样", () => {
    const s = exposed(); // currentSeat = 0
    expect(legalActions(s, 1)).toContainEqual({ type: "callUno", seat: 1 });
    expect(legalActions(s, 2)).toContainEqual({ type: "catchUno", seat: 2, target: 1 });
    expect(legalActions(s, 0)).toContainEqual({ type: "catchUno", seat: 0, target: 1 });
  });

  it("反应窗口不挡补喊与抓（U7 明文含窗口期间）", () => {
    const s = exposed({ punish: { initiator: 0, segments: [{ seat: 0, face: "+2", draw: 2 }], total: 2 } });
    const withWindow = {
      ...s,
      phase: "afterPlay" as const,
      pendingWindow: {
        type: "punishStack", actors: [2], deadline: "2026-07-28T12:00:30.000Z",
        defaultChoice: "accept", resume: "play" as const,
      },
    };
    const r = catchIt(withWindow, 2, 1);
    expect(r.rejected).toBeUndefined();
    expect(r.state.pendingWindow).toBeDefined(); // 窗口原样保留
    expect(legalActions(withWindow, 0)).toContainEqual({ type: "catchUno", seat: 0, target: 1 });
  });
});
