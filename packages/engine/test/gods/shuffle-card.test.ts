/**
 * 洗牌牌（05 §2b「洗牌（3 张）」+ 2026-07-31 的四条裁定）。
 * spec：`docs/superpowers/specs/2026-08-01-gods-cards/02-洗牌.md`
 *
 * ⚠️ 这里测的是**卡面**的洗牌（打乱重分全体手牌），不是 01-U8 的「牌河洗回摸牌堆」。
 */
import { describe, expect, it } from "vitest";
import { applyAction, buildDeck, legalActions, projectView } from "../../src/index.ts";
import { card, ctx, lcg, table } from "../helpers.ts";
import type { Card, GameState } from "../../src/types.ts";

const R7 = card("R", "7");
const sh = () => card(null, "shuffle");
const pile = () => [card("G", "1"), card("G", "2"), card("G", "3"), card("G", "4")];

/** 牌不增不减的不变式：所有可见位置的牌 id 多重集合。 */
const allIds = (s: GameState) => {
  const b = s.board!;
  return [...b.drawPile, ...b.playedPile, ...b.discardPile, ...b.hands.flat()].map((c) => c.id).sort();
};

const hand = (n: number, color: "R" | "G" | "B" | "Y"): Card[] =>
  Array.from({ length: n }, () => card(color, "5"));

describe("洗牌·选项① 合并重分（03 §6）", () => {
  it("worked example A：14 张 4 人，从**打出者的下家**开始轮流发，靠前的多一张", () => {
    const c = sh();
    // 手牌 3/4/2/5；打出后池子 = 2+4+2+5 = 13 张
    const s = table([[c, ...hand(2, "R")], hand(4, "B"), hand(2, "Y"), hand(5, "G")], {
      playedPile: [R7],
      drawPile: pile(),
    });
    const before = allIds(s);
    const r = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "B", shuffleChoice: "shuffle" }, ctx(lcg(7)),
    );

    expect(r.rejected).toBeUndefined();
    const b = r.state.board!;
    // 13 张从座位 1 起轮流发：1/2/3/0 → 4/3/3/3
    expect(b.hands.map((h) => h.length)).toEqual([3, 4, 3, 3]);
    expect(b.playedPile[0]).toEqual(c);
    expect(b.activeColor).toBe("B");
    expect(b.currentSeat).toBe(1);
    // 场上没有别人持洗牌牌 → 不开取消窗口，一次 apply 跑完
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.version).toBe(11);
    // 牌不增不减：打出的那张进了牌河，其余原样重分
    expect(allIds(r.state)).toEqual(before);
  });

  it("发牌起点随 direction 反向", () => {
    const c = sh();
    // 池子必须**除不尽**才测得出起点：9 张 4 人，逆向从座位 3 起 → 3/2/1/0 拿 3/2/2/2。
    // 正向的话多出来那张会落在座位 1，所以这组断言真的能把方向钉住。
    const s = table([[c, ...hand(3, "R")], hand(2, "B"), hand(2, "Y"), hand(2, "G")], {
      playedPile: [R7],
      drawPile: pile(),
      direction: -1,
    });
    const r = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "B", shuffleChoice: "shuffle" }, ctx(lcg(3)),
    );
    expect(r.state.board!.hands.map((h) => h.length)).toEqual([2, 2, 2, 3]);
    expect(r.state.board!.currentSeat).toBe(3);
  });

  it("U6：重分作废**回合外**的已喊（分到 1 张的人须重喊），打出者本人在自己回合内不作废", () => {
    const c = sh();
    const s = table([[c, ...hand(1, "R")], hand(1, "B"), hand(1, "Y")], {
      playedPile: [R7],
      drawPile: pile(),
      // 座位 0 是本回合按的（所以享受回合内的豁免）；座位 1 那声是上一轮结转来的
      saidUno: [true, true, false],
      unoThisTurn: [true, false, false],
    });
    const r = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "B", shuffleChoice: "shuffle" }, ctx(lcg(5)),
    );

    const b = r.state.board!;
    // 合并那一刻人人手牌为 0：座位 1 在回合外 → 作废；座位 0 是打出者、正在自己的回合 → 存续
    expect(b.saidUno).toEqual([true, false, false]);
    expect(b.hands.map((h) => h.length)).toEqual([1, 1, 1]);
    expect(b.currentSeat).toBe(1);
    // 座位 1 须重喊（轮到他，所以宽限期内抓不着他）；座位 2 没喊又不在自己回合 → 当场可抓
    expect(legalActions(r.state, 1)).toContainEqual({ type: "callUno", seat: 1 });
    expect(legalActions(r.state, 0)).toContainEqual({ type: "catchUno", seat: 0, target: 2 });
    // 打出者交回合时手牌恰 1 张 → 这一回合喊过的那声仍然算数，抓不着
    expect(applyAction(r.state, { type: "catchUno", seat: 1, target: 0 }, ctx()).rejected?.reason)
      .toBe("not_catchable");
  });

  it("worked example D（U5b）：重分分到 0 张 → **不判胜**，补摸 1 后须喊 UNO", () => {
    const c = sh();
    // 4 人各剩 1 张，只有 A 那张是洗牌 → 池子 3 张，A 分到 0
    const s = table([[c], hand(1, "B"), hand(1, "Y"), hand(1, "G")], { playedPile: [R7], drawPile: pile() });
    const r = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "R", shuffleChoice: "shuffle" }, ctx(lcg(9)),
    );

    const b = r.state.board!;
    expect(b.winner).toBeUndefined();
    expect(r.state.phase).toBe("turnStart");
    // 分到 0 张 → U5 补摸 1
    expect(b.hands[0]).toHaveLength(1);
    expect(b.hands.slice(1).map((h) => h.length)).toEqual([1, 1, 1]);
    expect(legalActions(r.state, 0)).toContainEqual({ type: "callUno", seat: 0 });
    expect(b.currentSeat).toBe(1);
  });

  it("司夜③ 持 5 盗以洗牌收官：**打出即胜**，三选一不再结算（2026-08-01 裁定）", () => {
    const c = sh();
    const s = table([[c], hand(1, "B"), hand(1, "Y"), hand(1, "G")], {
      playedPile: [R7],
      drawPile: pile(),
      skills: ["club-3", null, null, null],
      revealed: [true, false, false, false],
      marks: [{ 盗: 5 }, {}, {}, {}],
    });
    const r = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "R", shuffleChoice: "shuffle" }, ctx(lcg(9)),
    );

    expect(r.state.phase).toBe("finished");
    expect(r.state.board!.winner).toBe(0);
    expect(r.state.board!.marks[0]["盗"]).toBe(0); // 变色牌门槛 5 盗，扣光
    // 「无论选择什么」——①的重分整个没跑，其余三人手牌一张没动
    expect(r.events.some((e) => e.type === "handsShuffled")).toBe(false);
    expect(r.state.board!.hands.slice(1).map((h) => h.length)).toEqual([1, 1, 1]);
  });

  it("盗不够 5 就收不了官：洗牌①重分分到 0 张 → 补摸 1、不判胜（U5b）", () => {
    const c = sh();
    const s = table([[c], hand(1, "B"), hand(1, "Y"), hand(1, "G")], {
      playedPile: [R7],
      drawPile: pile(),
      skills: ["club-3", null, null, null],
      revealed: [true, false, false, false],
      marks: [{ 盗: 4 }, {}, {}, {}], // 差一枚
    });
    const r = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "R", shuffleChoice: "shuffle" }, ctx(lcg(9)),
    );

    expect(r.state.board!.winner).toBeUndefined();
    expect(r.state.phase).toBe("turnStart");
    expect(r.state.board!.hands[0]).toHaveLength(1); // 分到 0 张 → U5 补摸 1
    expect(r.state.board!.marks[0]["盗"]).toBe(4); // 一枚没扣
  });

  it("隐私：牌序与谁拿到哪张只进 audit，public 里没有任何牌 id", () => {
    const c = sh();
    const s = table([[c, ...hand(2, "R")], hand(2, "B"), hand(2, "Y")], { playedPile: [R7], drawPile: pile() });
    const r = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "B", shuffleChoice: "shuffle" }, ctx(lcg(11)),
    );

    const ev = r.events.find((e) => e.type === "handsShuffled")!;
    // toEqual 是全量比对：public 里多出任何一个字段（尤其是牌 id）都会失败
    expect(ev.public).toEqual({ seat: 0, counts: [2, 2, 2] });
    expect(ev.audit?.order).toHaveLength(6);
    expect(ev.audit?.deal).toHaveLength(3);
  });

  it("隐私：别人的新手牌不进快照（DoD 的「快照里搜不到」）", () => {
    const c = sh();
    const mine = hand(2, "R");
    const s = table([[c, ...mine], hand(2, "B"), hand(2, "Y")], { playedPile: [R7], drawPile: pile() });
    const r = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "B", shuffleChoice: "shuffle" }, ctx(lcg(11)),
    );

    const seat0 = r.state.board!.hands[0];
    const view = projectView(r.state, 1);
    // 座位 1 的快照里只有自己的手牌；座位 0 重分后拿到的那几张一张也搜不到
    expect(view.yourHand.map((x) => x.id).sort()).toEqual(r.state.board!.hands[1].map((x) => x.id).sort());
    const dump = JSON.stringify(view);
    for (const card0 of seat0) expect(dump).not.toContain(card0.id);
    // 中间态也不投影（drawnId 是暗信息）
    expect(dump).not.toContain("shufflePending");
  });
});

describe("洗牌·选项② 摸一弃一（裁定 洗-1）", () => {
  it("摸 1 之后开单人窗口，弃掉自选的那张 → 进弃牌堆，牌顶与跟色不动", () => {
    const c = sh();
    const keep = card("R", "1");
    const s = table([[c, keep], hand(1, "B"), hand(1, "Y")], { playedPile: [R7], drawPile: pile() });
    const opened = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "B", shuffleChoice: "drawDiscard" }, ctx(),
    );

    expect(opened.state.pendingWindow?.type).toBe("drawDiscard");
    expect(opened.state.pendingWindow?.actors).toEqual([0]);
    // 摸到的牌 id 绝不进公开的窗口（哨兵）
    expect(opened.state.pendingWindow?.defaultChoice).toBe("drawn");
    expect(opened.state.board!.hands[0]).toHaveLength(2); // keep + 刚摸的

    const windowId = `w${opened.state.version}:drawDiscard`;
    const done = applyAction(opened.state, { type: "respond", seat: 0, windowId, choice: "discard", cardIds: [keep.id] }, ctx());

    expect(done.rejected).toBeUndefined();
    const b = done.state.board!;
    expect(b.hands[0]).toHaveLength(1);
    expect(b.discardPile.map((x) => x.id)).toEqual([keep.id]);
    // 06-Q55：弃牌不改牌顶也不改跟色
    expect(b.playedPile[0]).toEqual(c);
    expect(b.activeColor).toBe("B");
    expect(b.currentSeat).toBe(1);
    expect(done.state.pendingWindow).toBeUndefined();
  });

  it("超时按哨兵弃掉刚摸的那张", () => {
    const c = sh();
    const keep = card("R", "1");
    const s = table([[c, keep], hand(1, "B"), hand(1, "Y")], { playedPile: [R7], drawPile: pile() });
    const opened = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "B", shuffleChoice: "drawDiscard" }, ctx(),
    );
    const windowId = `w${opened.state.version}:drawDiscard`;
    const late = ctx(lcg(1), "2026-07-28T12:01:00.000Z");
    const done = applyAction(opened.state, { type: "claimTimeout", seat: 1, windowId }, late);

    const drawnId = opened.state.board!.hands[0].find((x) => x.id !== keep.id)!.id;
    const b = done.state.board!;
    // 超时弃的是**刚摸那张**，留在手上的是原来那张
    expect(b.hands[0].map((x) => x.id)).toEqual([keep.id]);
    expect(b.discardPile.map((x) => x.id)).toEqual([drawnId]);
    expect(done.state.pendingWindow).toBeUndefined();
  });

  it("弃一张不在手上的牌 → not_in_hand", () => {
    const c = sh();
    const s = table([[c, card("R", "1")], hand(1, "B"), hand(1, "Y")], { playedPile: [R7], drawPile: pile() });
    const opened = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "B", shuffleChoice: "drawDiscard" }, ctx(),
    );
    const windowId = `w${opened.state.version}:drawDiscard`;
    expect(applyAction(opened.state, { type: "respond", seat: 0, windowId, choice: "discard", cardIds: ["nope"] }, ctx()).rejected?.reason)
      .toBe("not_in_hand");
  });

  it("worked example C：选项②作末牌 → 弃完手牌又归零 → **U5 补摸 1**、不判胜、须喊 UNO", () => {
    const c = sh();
    const s = table([[c], hand(1, "B"), hand(1, "Y")], { playedPile: [R7], drawPile: pile() });
    const opened = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "B", shuffleChoice: "drawDiscard" }, ctx(),
    );
    const drawnId = opened.state.board!.hands[0][0].id;
    const windowId = `w${opened.state.version}:drawDiscard`;
    const done = applyAction(opened.state, { type: "respond", seat: 0, windowId, choice: "discard", cardIds: [drawnId] }, ctx());

    const b = done.state.board!;
    expect(b.winner).toBeUndefined();
    expect(b.hands[0]).toHaveLength(1); // 弃空之后 U5 补摸 1
    expect(legalActions(done.state, 0)).toContainEqual({ type: "callUno", seat: 0 });
    expect(b.currentSeat).toBe(1);
  });

  it("牌堆枯竭摸到 0 张 → 不开窗口、不弃牌（03 §2：摸到的不能少于弃的）", () => {
    const c = sh();
    const s = table([[c, card("R", "1")], hand(1, "B"), hand(1, "Y")], {
      playedPile: [R7],
      drawPile: [],
      discardPile: [],
      reshuffles: 2,
    });
    const r = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "B", shuffleChoice: "drawDiscard" }, ctx(),
    );

    expect(r.rejected).toBeUndefined();
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(1);
    expect(r.state.board!.discardPile).toHaveLength(0);
  });
});

describe("洗牌·选项③ 取消（裁定 洗-3，照抄劫营 01-G5）", () => {
  /** A(0) 打①，C(2) 手里有洗牌牌 → 取消窗口开给 C。 */
  const setup = () => {
    const a = sh();
    const c = sh();
    const s = table([[a, ...hand(2, "R")], hand(4, "B"), [c, ...hand(1, "Y")], hand(5, "G")], {
      playedPile: [R7],
      drawPile: pile(),
    });
    const opened = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [a.id], chosenColor: "B", shuffleChoice: "shuffle" }, ctx(),
    );
    return { a, c, s, opened, windowId: `w${opened.state.version}:shuffleCancel` };
  };

  it("窗口只开给手上有洗牌牌的其他玩家", () => {
    const { opened } = setup();
    expect(opened.state.pendingWindow?.type).toBe("shuffleCancel");
    expect(opened.state.pendingWindow?.actors).toEqual([2]);
    expect(opened.state.pendingWindow?.defaultChoice).toBe("pass");
    // 窗口挂着时还没重分
    expect(opened.state.board!.hands.map((h) => h.length)).toEqual([2, 4, 2, 5]);
  });

  it("worked example B：C 取消 → 不重分、牌顶与跟色归 C、轮到 D", () => {
    const { c, opened, windowId } = setup();
    const before = allIds(opened.state);
    const r = applyAction(
      opened.state,
      { type: "respond", seat: 2, windowId, choice: "cancel", cardIds: [c.id], chosenColor: "Y" },
      ctx(),
    );

    expect(r.rejected).toBeUndefined();
    const b = r.state.board!;
    // 全体手牌一张没动，只有 C 少了那张取消牌
    expect(b.hands.map((h) => h.length)).toEqual([2, 4, 1, 5]);
    expect(b.playedPile[0]).toEqual(c);
    expect(b.activeColor).toBe("Y");
    expect(b.activeFace ?? null).toBeNull();
    // 01-G5：取消者不进回合，从**取消者的下家**继续 → D
    expect(b.currentSeat).toBe(3);
    expect(b.shufflePending).toBeUndefined();
    expect(allIds(r.state)).toEqual(before);
    expect(r.events.some((e) => e.type === "shuffleCancelled")).toBe(true);
    expect(r.events.some((e) => e.type === "handsShuffled")).toBe(false);
  });

  it("裁定 洗-4：取消不可连锁——取消牌落地后没有第二个取消窗口", () => {
    const { c, opened, windowId } = setup();
    // D(3) 手里也塞一张洗牌牌，看看会不会给它开窗口
    const withThird = {
      ...opened.state,
      board: {
        ...opened.state.board!,
        hands: opened.state.board!.hands.map((h, i) => (i === 3 ? [sh(), ...h] : h)),
      },
    };
    const r = applyAction(
      withThird, { type: "respond", seat: 2, windowId, choice: "cancel", cardIds: [c.id], chosenColor: "Y" }, ctx(),
    );
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.currentSeat).toBe(3);
  });

  it("pass / 超时 → ①照常重分（分布、跟色、轮次都要对）", () => {
    const { a, opened, windowId } = setup();
    // 池子 13 张（2+4+2+5），从座位 1 起轮流发 → 4/3/3/3
    const expected = [3, 4, 3, 3];

    const passed = applyAction(opened.state, { type: "respond", seat: 2, windowId, choice: "pass" }, ctx(lcg(4)));
    expect(passed.rejected).toBeUndefined();
    expect(passed.state.board!.hands.map((h) => h.length)).toEqual(expected);
    expect(passed.state.board!.playedPile[0]).toEqual(a);
    expect(passed.state.board!.activeColor).toBe("B"); // 打出者定的色，没被取消者改
    expect(passed.state.board!.currentSeat).toBe(1);
    expect(passed.state.pendingWindow).toBeUndefined();
    expect(passed.state.board!.shufflePending).toBeUndefined();

    const late = ctx(lcg(4), "2026-07-28T12:01:00.000Z");
    const timedOut = applyAction(opened.state, { type: "claimTimeout", seat: 1, windowId }, late);
    expect(timedOut.state.board!.hands.map((h) => h.length)).toEqual(expected);
    expect(timedOut.state.board!.currentSeat).toBe(1);
    expect(timedOut.state.pendingWindow).toBeUndefined();
  });

  it("窗口挂着时 callUno / catchUno 仍可用（uno 动作不被窗口挡）", () => {
    const a = sh();
    const c = sh();
    // 座位 1 只剩 1 张且没喊 → 取消窗口开着时，他能补喊、别人能抓
    const s = table([[a, ...hand(2, "R")], hand(1, "B"), [c, ...hand(1, "Y")]], { playedPile: [R7], drawPile: pile() });
    const opened = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [a.id], chosenColor: "B", shuffleChoice: "shuffle" }, ctx(),
    );

    expect(opened.state.pendingWindow?.type).toBe("shuffleCancel");
    expect(legalActions(opened.state, 1)).toContainEqual({ type: "callUno", seat: 1 });
    // 座位 0 不是 actor，但抓漏喊不受窗口约束
    expect(legalActions(opened.state, 0)).toContainEqual({ type: "catchUno", seat: 0, target: 1 });
  });

  it("取消牌必须是洗牌牌、必须定色、必须是 actor", () => {
    const { c, opened, windowId } = setup();
    const other = opened.state.board!.hands[2][1];

    expect(
      applyAction(opened.state, { type: "respond", seat: 2, windowId, choice: "cancel", cardIds: [c.id] }, ctx())
        .rejected?.reason,
    ).toBe("color_required");
    expect(
      applyAction(
        opened.state,
        { type: "respond", seat: 2, windowId, choice: "cancel", cardIds: [other.id], chosenColor: "Y" },
        ctx(),
      ).rejected?.reason,
    ).toBe("bad_choice");
    expect(
      applyAction(
        opened.state,
        { type: "respond", seat: 1, windowId, choice: "cancel", cardIds: [c.id], chosenColor: "Y" },
        ctx(),
      ).rejected?.reason,
    ).toBe("not_your_window");
  });

  it("被取消者若把洗牌当末牌打出 → 手牌 0 → U5 补摸 1、不判胜", () => {
    const a = sh();
    const c = sh();
    const s = table([[a], hand(2, "B"), [c, ...hand(1, "Y")]], { playedPile: [R7], drawPile: pile() });
    const opened = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [a.id], chosenColor: "B", shuffleChoice: "shuffle" }, ctx(),
    );
    const windowId = `w${opened.state.version}:shuffleCancel`;
    const r = applyAction(
      opened.state, { type: "respond", seat: 2, windowId, choice: "cancel", cardIds: [c.id], chosenColor: "Y" }, ctx(),
    );

    expect(r.state.board!.winner).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(1);
    expect(r.state.board!.currentSeat).toBe(0); // 取消者是 2，下家是 0
  });

  it("取消牌是取消者最后一张 → 洗牌是功能牌，不判胜、补摸 1", () => {
    const a = sh();
    const c = sh();
    const s = table([[a, ...hand(1, "R")], hand(2, "B"), [c]], { playedPile: [R7], drawPile: pile() });
    const opened = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [a.id], chosenColor: "B", shuffleChoice: "shuffle" }, ctx(),
    );
    const windowId = `w${opened.state.version}:shuffleCancel`;
    const r = applyAction(
      opened.state, { type: "respond", seat: 2, windowId, choice: "cancel", cardIds: [c.id], chosenColor: "Y" }, ctx(),
    );

    expect(r.state.board!.winner).toBeUndefined();
    expect(r.state.board!.hands[2]).toHaveLength(1);
  });

  it("取消夺不走已经到手的胜利：司夜③ 收官时取消窗口根本不会开", () => {
    const a = sh();
    const c = sh();
    // 座位 0 持司夜、盗够本，手上只剩这张洗牌；座位 2 手里有洗牌牌本可取消。
    // 但胜负判在末牌离手那一刻（2026-08-01 裁定），所以游戏当场结束、窗口没有机会开。
    const s = table([[a], hand(1, "B"), [c, ...hand(1, "Y")]], {
      playedPile: [R7],
      drawPile: pile(),
      skills: ["club-3", null, null],
      revealed: [true, false, false],
      marks: [{ 盗: 9 }, {}, {}],
    });
    const r = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [a.id], chosenColor: "B", shuffleChoice: "shuffle" }, ctx(),
    );

    expect(r.state.phase).toBe("finished");
    expect(r.state.board!.winner).toBe(0);
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.marks[0]["盗"]).toBe(4); // 9 − 5
  });

  it("取消者自己拿洗牌收官：同一口径，5 盗照样赢", () => {
    const a = sh();
    const c = sh();
    // 座位 2 持司夜 + 5 盗，手上只有那张洗牌，用它取消 → 他自己手牌归零
    const s = table([[a, ...hand(1, "R")], hand(1, "B"), [c]], {
      playedPile: [R7],
      drawPile: pile(),
      skills: [null, null, "club-3"],
      revealed: [false, false, true],
      marks: [{}, {}, { 盗: 5 }],
    });
    const opened = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [a.id], chosenColor: "B", shuffleChoice: "shuffle" }, ctx(),
    );
    const windowId = `w${opened.state.version}:shuffleCancel`;
    const r = applyAction(
      opened.state, { type: "respond", seat: 2, windowId, choice: "cancel", cardIds: [c.id], chosenColor: "Y" }, ctx(),
    );

    expect(r.state.phase).toBe("finished");
    expect(r.state.board!.winner).toBe(2);
    expect(r.state.board!.marks[2]["盗"]).toBe(0);
  });

  it("U6：弃完剩 1 张，这时候点喊才成立（喊是另一个动作，出牌不带它）", () => {
    const c = sh();
    const keep = card("R", "1");
    const s = table([[c, keep], hand(3, "B"), hand(3, "Y")], { playedPile: [R7], drawPile: pile() });
    const opened = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "B", shuffleChoice: "drawDiscard" }, ctx(),
    );
    // 打出洗牌后手上 1 张，窗口期又摸了 1 张 → 2 张：这中间点喊都是虚喊
    expect(opened.state.board!.hands[0]).toHaveLength(2);

    const windowId = `w${opened.state.version}:drawDiscard`;
    const done = applyAction(opened.state, { type: "respond", seat: 0, windowId, choice: "discard", cardIds: [keep.id] }, ctx());
    expect(done.state.board!.hands[0]).toHaveLength(1);

    const said = applyAction(done.state, { type: "callUno", seat: 0 }, ctx());
    expect(said.rejected).toBeUndefined();
    expect(said.state.board!.saidUno[0]).toBe(true);
    expect(said.events.map((e) => e.type)).toEqual(["unoCalled"]);
    expect(legalActions(said.state, 1)).not.toContainEqual({ type: "catchUno", seat: 1, target: 0 });
  });

  it("没点喊就不该凭空补上（弃完仍可被抓）", () => {
    const c = sh();
    const keep = card("R", "1");
    const s = table([[c, keep], hand(3, "B"), hand(3, "Y")], { playedPile: [R7], drawPile: pile() });
    const opened = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "B", shuffleChoice: "drawDiscard" }, ctx(),
    );
    const windowId = `w${opened.state.version}:drawDiscard`;
    const done = applyAction(opened.state, { type: "respond", seat: 0, windowId, choice: "discard", cardIds: [keep.id] }, ctx());

    expect(done.state.board!.saidUno[0]).toBe(false);
    expect(legalActions(done.state, 1)).toContainEqual({ type: "catchUno", seat: 1, target: 0 });
  });

  it("三选一带在多张（并列）路径上也要拒，不能静默忽略", () => {
    const two = [card("R", "5"), card("R", "5")];
    const s = table([[...two, card("B", "1")], hand(1, "B"), hand(1, "Y")], {
      playedPile: [card("R", "7")],
      skills: ["heart-4", null, null],
      revealed: [true, false, false],
    });
    expect(
      applyAction(
        s,
        { type: "playCards", seat: 0, cardIds: two.map((x) => x.id), shuffleChoice: "drawDiscard" },
        ctx(),
      ).rejected?.reason,
    ).toBe("shuffle_choice_not_allowed");
  });

  it("选项②不开取消窗口（只有①开）", () => {
    const a = sh();
    const s = table([[a, ...hand(1, "R")], hand(2, "B"), [sh()]], { playedPile: [R7], drawPile: pile() });
    const r = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [a.id], chosenColor: "B", shuffleChoice: "drawDiscard" }, ctx(),
    );
    expect(r.state.pendingWindow?.type).toBe("drawDiscard");
  });
});

describe("洗牌 · 契约与牌组", () => {
  it("三选一：不带 → shuffle_choice_required；乱填 → bad_shuffle_choice", () => {
    const c = sh();
    const s = table([[c, card("R", "1")], hand(1, "B"), hand(1, "Y")], { playedPile: [R7], drawPile: pile() });

    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "B" }, ctx()).rejected?.reason)
      .toBe("shuffle_choice_required");
    expect(
      applyAction(
        s,
        // 选项③是响应，不能从 playCards 走
        { type: "playCards", seat: 0, cardIds: [c.id], chosenColor: "B", shuffleChoice: "cancel" as never }, ctx(),
      ).rejected?.reason,
    ).toBe("bad_shuffle_choice");
  });

  it("洗牌牌同样要定色", () => {
    const c = sh();
    const s = table([[c, card("R", "1")], hand(1, "B"), hand(1, "Y")], { playedPile: [R7], drawPile: pile() });
    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [c.id], shuffleChoice: "shuffle" }, ctx()).rejected?.reason)
      .toBe("color_required");
  });

  it("牌组：洗牌只在诸神包里，3 张（05 §3）", () => {
    expect(buildDeck("base").filter((c) => c.face === "shuffle")).toHaveLength(0);
    expect(buildDeck("gods").filter((c) => c.face === "shuffle")).toHaveLength(3);
  });
});

// ---------------------------------------------------------------- 取消窗口不泄露谁有洗牌牌

describe("洗牌③取消窗口：谁手上有洗牌牌是暗信息（2026-08-02）", () => {
  /** 座位 0 打①；座位 1 与 2 手上都有洗牌牌，所以两人都是 actors。 */
  const opened = () => {
    const play = sh();
    const s = table([[play, card("R", "9")], [sh(), card("B", "5")], [sh(), card("Y", "4")]], {
      playedPile: [R7],
      drawPile: pile(),
    });
    return applyAction(
      s, { type: "playCards", seat: 0, cardIds: [play.id], chosenColor: "R", shuffleChoice: "shuffle" }, ctx(),
    );
  };

  it("公开事件不带 actors——那一串就是「谁手上有洗牌牌」，而手牌是私有的", () => {
    const e = opened().events.find((x) => x.type === "shuffleCancelWindowOpened")!;
    expect(e.public).not.toHaveProperty("actors");
    // 打出者是谁、窗口到什么时候，这两条本来就公开
    expect(e.public!.seat).toBe(0);
  });

  it("快照里每个人只看得到「有没有自己」，看不到还有谁能取消", () => {
    const s = opened().state;
    // 真相仍在服务端：两个人都能取消
    expect(s.pendingWindow!.actors).toEqual([1, 2]);
    // 投影只留自己；打出者一个名字都拿不到
    expect(projectView(s, 1).pendingWindow!.actors).toEqual([1]);
    expect(projectView(s, 2).pendingWindow!.actors).toEqual([2]);
    expect(projectView(s, 0).pendingWindow!.actors).toEqual([]);
  });

  it("遮罩只管显示，不动合法性：能取消的人照样拿得到 respond", () => {
    const s = opened().state;
    expect(legalActions(s, 1).some((a) => a.type === "respond" && a.choice === "cancel")).toBe(true);
    expect(legalActions(s, 0).some((a) => a.type === "respond")).toBe(false);
  });
});
