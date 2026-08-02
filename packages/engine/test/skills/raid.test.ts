// 劫营♦10：打断多打（01-G5）。规则：04 ♦10、03 glossary（可响应并列任意一张）、
// 06-Q34（占打断者自己的主动、一回合只能打断一次）、06-Q56（被打断者摸的 1 张是他人技能摸牌）。
// 并列侧的返工（先声明、逐张摆）在 parallel.test.ts 与本文件的「逐张摆」一组里钉住。
import { describe, expect, it } from "vitest";
import { settleRaid } from "../../src/actions/raid.ts";
import { applyAction, legalActions, projectView } from "../../src/index.ts";
import { SKILL_DATA } from "../../src/skills/draw-passives.ts";
import type { SkillData } from "../../src/skills/draw-passives.ts";
import type { Board, Card, GameState } from "../../src/types.ts";
import { card, ctx, table } from "../helpers.ts";

/** 4 人 A(0)→B(1)→C(2)→D(3)。A 亮着并列，C 亮着劫营；牌顶蓝 2。 */
const raidTable = (hands: Card[][], over: Partial<Board> = {}) =>
  table(hands, {
    playedPile: [card("B", "2")],
    skills: ["heart-4", null, "diamond-10", null],
    revealed: [true, false, true, false],
    ...over,
  });

const play = (s: GameState, cards: Card[]) =>
  applyAction(s, { type: "playCards", seat: 0, cardIds: cards.map((c) => c.id) }, ctx());

const respond = (s: GameState, seat: number, choice: string, cardIds?: string[]) =>
  applyAction(s, { type: "respond", seat, windowId: `w${s.version}:interrupt`, choice, ...(cardIds && { cardIds }) }, ctx());

/** 六张同色（数字任意）的并列组，按提交顺序。 */
const six = () => ["1", "3", "9", "2", "4", "5"].map((f) => card("B", f as Card["face"]));

// ---------------------------------------------------------------- worked example

describe("劫营♦10 的 worked example（07 号 spec）", () => {
  /** A 打两张黄 2；C 手里也有黄 2。窗口在**第一张**落地时就开。 */
  const setup = () => {
    const two = [card("Y", "2"), card("Y", "2")];
    const c2 = card("Y", "2");
    const s = raidTable([[...two, card("R", "9")], [card("R", "1")], [c2, card("R", "1")], [card("R", "1")]]);
    return { s, two, c2, opened: play(s, two).state };
  };

  it("有人截得动就开窗口，actors 只有那个劫营者", () => {
    const { opened } = setup();
    expect(opened.pendingWindow).toMatchObject({ type: "interrupt", actors: [2], defaultChoice: "pass" });
  });

  it("打断牌压牌顶、跟的就是它；A 摸 1；轮到 D（C 的下家）", () => {
    const { c2, opened } = setup();
    const r = respond(opened, 2, "raid", [c2.id]);
    expect(r.rejected).toBeUndefined();
    const b = r.state.board!;
    expect(b.playedPile[0].id).toBe(c2.id);
    expect(b.activeColor).toBe("Y");
    // 跟牌目标就是这张牌本身，不是并列算好的 follow
    expect(b.activeFace).toBeNull();
    // 整组（两张黄 2）已经全落地，所以手上只剩红 9 + 被打断摸的 1 张
    expect(b.hands[0]).toHaveLength(2);
    expect(b.currentSeat).toBe(3);
    expect(r.state.phase).toBe("turnStart");
  });

  it("06-Q34：占的是**打断者自己**的那条主动，别人的额度不受影响", () => {
    const { c2, opened } = setup();
    const b = respond(opened, 2, "raid", [c2.id]).state.board!;
    expect(b.activatedThisTurn).toEqual([false, false, true, false]);
  });

  it("事件：raided 说清谁截了谁、用的哪张、作废几轮神化", () => {
    const { c2, opened } = setup();
    const r = respond(opened, 2, "raid", [c2.id]);
    const raided = r.events.find((e) => e.type === "raided")!;
    expect(raided.public).toEqual({ by: 2, target: 0, card: c2, voided: 0, won: false });
    expect(r.events.map((e) => e.type)).toContain("cardsDrawn");
  });

  it("打断后下家按劫营那张接：跟黄或跟 2", () => {
    const { c2, opened } = setup();
    const y5 = card("Y", "5");
    const g2 = card("G", "2");
    const g7 = card("G", "7");
    const withHand: GameState = {
      ...opened,
      board: { ...opened.board!, hands: opened.board!.hands.map((h, i) => (i === 3 ? [y5, g2, g7] : h)) },
    };
    const after = respond(withHand, 2, "raid", [c2.id]).state;
    const ids = legalActions(after, 3).flatMap((a) => (a.type === "playCards" ? a.cardIds : []));
    expect(ids).toEqual([y5.id, g2.id]);
  });
});

// ---------------------------------------------------------------- 整组落地与「截组内任意一张」

describe("并列整组落地：一次全出，落地后只截一次（04 ♥4 2026-08-02 改判）", () => {
  /** C 手里只有 `raidCard` 一张能截。整组落地后开**一次**窗口，配的是组内任意一张。 */
  const opened = (raidCard: Card) => {
    const group = six();
    const s = raidTable(
      [[...group, card("R", "9")], [card("R", "1")], [raidCard, card("R", "1")], [card("R", "1")]],
      { playedPile: [card("B", "7")] },
    );
    return { group, state: play(s, group).state };
  };

  it.each([
    ["组内第 1 张", "1"],
    ["组内中间那张", "9"],
    ["组内最后一张", "5"],
  ] as const)("配上%s也能截：整组早已落地，窗口只开一次", (_name, face) => {
    const { group, state } = opened(card("B", face));
    expect(state.pendingWindow?.type).toBe("interrupt");
    // 六张全在牌河，牌顶是提交顺序的最后一张；手上只剩那张红 9
    expect(state.board!.playedPile[0].id).toBe(group[5].id);
    expect(state.board!.hands[0]).toHaveLength(1);
    expect(state.board!.parallelPending!.cards).toHaveLength(6);
  });

  it("被截：整组留在牌河（没有「未摆的回手」了），跟牌目标是劫营那张", () => {
    const raidCard = card("B", "9");
    const { state } = opened(raidCard);
    const b = respond(state, 2, "raid", [raidCard.id]).state.board!;
    expect(b.playedPile[0].id).toBe(raidCard.id);
    expect(b.activeFace).toBeNull();
    expect(b.parallelPending).toBeUndefined();
    // 手上只剩那张红 9 + 被打断摸的 1 张 = 2（逐张模型下这里是 5）
    expect(b.hands[0]).toHaveLength(2);
  });

  it("放弃 → 这次并列就结束了，回合交出去（不再有「下一张」）", () => {
    const { state } = opened(card("B", "9"));
    const r = respond(state, 2, "pass");
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.parallelPending).toBeUndefined();
    expect(r.state.board!.currentSeat).toBe(1);
  });

  it("一回合最多截一次并列：手上两张对得上也只有一个窗口", () => {
    const group = six();
    // 座位 2 手上蓝 1 与蓝 9 都配得上组内的牌
    const s = raidTable(
      [[...group, card("R", "9")], [card("R", "1")], [card("B", "1"), card("B", "9")], [card("R", "1")]],
      { playedPile: [card("B", "7")] },
    );
    const first = play(s, group).state;
    expect(first.pendingWindow?.type).toBe("interrupt");
    // 放过这一个，就没有第二个了
    const after = respond(first, 2, "pass").state;
    expect(after.pendingWindow).toBeUndefined();
    expect(after.board!.currentSeat).toBe(1);
  });
});

// ---------------------------------------------------------------- 不开窗口的那些路径

describe("没人截得动就不开窗口——一次 apply 摆完，version 只 +1", () => {
  const two = () => [card("Y", "2"), card("Y", "2")];
  /** 座位 2 的技能/亮出/手牌按 over 摆；返回打完之后的结果。 */
  const parallelWith = (over: Partial<Board>, hand2: Card[]) => {
    const cards = two();
    const s = raidTable([[...cards, card("R", "9")], [card("R", "1")], hand2, [card("R", "1")]], over);
    return { s, r: play(s, cards) };
  };

  it("场上根本没有劫营：整组一次摆完", () => {
    const { s, r } = parallelWith({ skills: ["heart-4", null, null, null] }, [card("Y", "2")]);
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.version).toBe(s.version + 1);
    expect(r.state.board!.parallelPending).toBeUndefined();
    expect(r.state.board!.activeFace).toBe("2");
    expect(r.state.board!.currentSeat).toBe(1);
  });

  it("持有劫营但没亮出（V3）：不开窗口", () => {
    const { s, r } = parallelWith({ revealed: [true, false, false, false] }, [card("Y", "2")]);
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.version).toBe(s.version + 1);
  });

  it("亮着劫营但手里没有同色同数的牌：不开窗口", () => {
    const { s, r } = parallelWith({}, [card("G", "2"), card("Y", "5")]);
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.version).toBe(s.version + 1);
  });

  it("被封印的劫营者截不动（01-P9）", () => {
    const { r } = parallelWith({ statuses: [[], [], ["封印"], []] }, [card("Y", "2")]);
    expect(r.state.pendingWindow).toBeUndefined();
  });

  it("单张出牌但没人手里有同色同数的：不开窗口", () => {
    const y2 = card("Y", "2");
    const s = raidTable([[y2, card("R", "9")], [card("R", "1")], [card("G", "2")], [card("R", "1")]]);
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [y2.id] }, ctx());
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.version).toBe(s.version + 1);
    expect(r.state.board!.currentSeat).toBe(1);
  });

  it("收官那一张不开窗口：摆完手牌就空了，游戏已经结束", () => {
    const group = six();
    const s = raidTable([group, [card("R", "1")], [card("B", "5")], [card("R", "1")]], {
      playedPile: [card("B", "7")],
    });
    const r = play(s, group);
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.phase).toBe("finished");
    expect(r.state.board!.winner).toBe(0);
  });

  // 逐张模型的推论：手上还捏着牌就不算收官，所以收官组的**前几张**照样可被截住。
  // 原子模型下「多张收官不可打断」是整组一起说的，逐张之后只剩最后那一张享有这条豁免。
  // 2026-08-02 拍板：整组一次打空手牌 → 照 U5c 当场获胜，劫营窗口**根本不开**
  it("并列收官截不了：整组落地即赢，窗口不开（逐张模型下这里会开一个）", () => {
    const group = six();
    const s = raidTable([group, [card("R", "1")], [card("B", "1")], [card("R", "1")]], {
      playedPile: [card("B", "7")],
    });
    const r = play(s, group);
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.winner).toBe(0);
    expect(r.state.phase).toBe("finished");
  });
});

// ------------------------------------------------------ 2026-07-31 裁定：触发面 = 任何一张牌

describe("单张出牌也能被截（不再限于并列/神化的多打）", () => {
  /** A 打出 `played` 一张；C（劫营）手上是 `cHand`。 */
  const single = (played: Card, cHand: Card[], over: Partial<Board> = {}, extra: Record<string, unknown> = {}) => {
    const s = raidTable([[played, card("R", "9")], [card("R", "1")], cHand, [card("R", "1")]], over);
    return { s, r: applyAction(s, { type: "playCards", seat: 0, cardIds: [played.id], ...extra }, ctx()) };
  };

  const y2 = () => card("Y", "2");

  it("落地就开窗口，actors 只有那个劫营者", () => {
    const { r } = single(y2(), [y2(), card("R", "8")]);
    expect(r.rejected).toBeUndefined();
    expect(r.state.pendingWindow).toMatchObject({ type: "interrupt", actors: [2], defaultChoice: "pass" });
    expect(r.events.map((e) => e.type)).toEqual(["cardPlayed", "raidWindowOpened"]);
  });

  it("截了：打断牌压顶成跟牌目标、A 摸 1、轮到 D、占 C 自己的 V7", () => {
    const c2 = y2();
    const { r } = single(y2(), [c2, card("R", "8")]);
    const done = respond(r.state, 2, "raid", [c2.id]);
    expect(done.rejected).toBeUndefined();
    const b = done.state.board!;
    expect(b.playedPile[0].id).toBe(c2.id);
    expect(b.activeColor).toBe("Y");
    expect(b.activeFace).toBeNull();
    expect(b.hands[0]).toHaveLength(2); // 红 9 + 被打断摸的 1 张
    expect(b.currentSeat).toBe(3);
    expect(b.activatedThisTurn).toEqual([false, false, true, false]);
    expect(b.playPending).toBeUndefined();
  });

  it("放弃 → 这次出牌照常结算完，回合交给出牌者的下家 B", () => {
    const { r } = single(y2(), [y2(), card("R", "8")]);
    const passed = respond(r.state, 2, "pass");
    expect(passed.rejected).toBeUndefined();
    expect(passed.state.pendingWindow).toBeUndefined();
    expect(passed.state.board!.playPending).toBeUndefined();
    expect(passed.state.board!.currentSeat).toBe(1);
    expect(passed.state.board!.activeColor).toBe("Y");
  });

  it("「停」被放弃后照常跳过下家：结算是完整的，不只是交回合", () => {
    const skip = card("B", "skip");
    const s = raidTable(
      [[skip, card("B", "3"), card("R", "9")], [card("R", "1")], [card("B", "3"), card("R", "8")], [card("R", "1")]],
      {},
    );
    // 先打蓝 3 引出窗口（C 手上也有蓝 3），放弃后回合正常到 B
    const opened = applyAction(s, { type: "playCards", seat: 0, cardIds: [s.board!.hands[0][1].id] }, ctx()).state;
    expect(opened.pendingWindow?.type).toBe("interrupt");
    expect(respond(opened, 2, "pass").state.board!.currentSeat).toBe(1);
  });

  it("功能牌截不了：同色同数只有数字牌成立（04 ♦10）", () => {
    const p2 = card("B", "+2");
    const { r } = single(p2, [card("B", "+2"), card("R", "8")]);
    expect(r.state.pendingWindow?.type).toBe("punishStack");
  });

  it("无色牌截不了", () => {
    const w = card(null, "wild");
    const { r } = single(w, [card(null, "wild"), card("R", "8")], {}, { chosenColor: "G" });
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.currentSeat).toBe(1);
  });

  it("惩罚链挂着时叠的 +2 同样截不了（叠链牌都是功能牌）", () => {
    const b2 = card("B", "+2");
    const s = raidTable([[b2, card("R", "9")], [card("R", "1")], [card("B", "+2")], [card("R", "1")]], {
      punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2 }], total: 2 },
      currentSeat: 0,
    });
    const r = applyAction({ ...s, phase: "play" }, { type: "playCards", seat: 0, cardIds: [b2.id] }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.pendingWindow?.type).toBe("punishStack");
  });

  it("单张收官那一张不开窗口：他已经赢了", () => {
    const y = y2();
    const s = raidTable([[y], [card("R", "1")], [y2(), card("R", "8")], [card("R", "1")]]);
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [y.id] }, ctx());
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.phase).toBe("finished");
    expect(r.state.board!.winner).toBe(0);
  });

  it("打断者用最后一张单张打断也算赢", () => {
    const only = y2();
    const { r } = single(y2(), [only]);
    const done = respond(r.state, 2, "raid", [only.id]);
    expect(done.state.phase).toBe("finished");
    expect(done.state.board!.winner).toBe(2);
  });

  it("快照里搜不到 playPending（它只是引擎的续跑记账）", () => {
    const { r } = single(y2(), [y2(), card("R", "8")]);
    for (const seat of [0, 1, 2, 3])
      expect(JSON.stringify(projectView(r.state, seat))).not.toContain("playPending");
  });
});

// ------------------------------------------------- 窗口不吞掉提交前的两个选择（B5/B7）

describe("整组落地要带上声明时的 chosenColor（B7）", () => {
  /** 四张同数（跟色由 A 选红），C 只有绿 2 —— 整组落地后开一次窗口，绿 2 配得上组内那张绿 2。 */
  const setup = () => {
    const four = [card("R", "2"), card("G", "2"), card("B", "2"), card("Y", "2")];
    const s = raidTable([[...four, card("R", "9")], [card("R", "1")], [card("G", "2"), card("R", "8")], [card("R", "1")]]);
    const opened = applyAction(
      s,
      { type: "playCards", seat: 0, cardIds: four.map((c) => c.id), chosenColor: "R" },
      ctx(),
    ).state;
    return { four, opened };
  };

  it("整组一次落地：四张全进牌河，牌顶是提交顺序的最后一张", () => {
    const { four, opened } = setup();
    expect(opened.pendingWindow?.type).toBe("interrupt");
    expect(opened.board!.playedPile[0].id).toBe(four[3].id);
    expect(opened.board!.hands[0]).toHaveLength(1); // 只剩红 9
  });

  it("B5：喊 UNO 是另一个动作——窗口挂着时手上恰 1 张，点得成", () => {
    const { opened } = setup();
    expect(opened.board!.hands[0]).toHaveLength(1);
    const said = applyAction(opened, { type: "callUno", seat: 0 }, ctx());
    expect(said.rejected).toBeUndefined();
    expect(said.state.board!.saidUno[0]).toBe(true);
    expect(said.events.map((e) => e.type)).toEqual(["unoCalled"]);
  });

  it("B7：整组那一条 cardPlayed 带着 chosenColor，事件流与牌桌一致", () => {
    const { four, opened } = setup();
    // 整组只发一条 cardPlayed（逐张模型下会拆成两条：被截前的一半 + 续摆的一半）
    const r = respond(opened, 2, "pass");
    // 放弃之后不再有新的 cardPlayed——牌早就落地了
    expect(r.events.filter((e) => e.type === "cardPlayed")).toHaveLength(0);
    expect(r.state.board!.activeColor).toBe("R");
    expect(r.state.board!.playedPile.slice(0, 4).map((c) => c.id))
      .toEqual([...four].reverse().map((c) => c.id));
  });
});

// ---------------------------------------------------------------- 校验与放弃

describe("打断牌只能截刚摆的那张", () => {
  /** A 打两张黄 2 并被 C 的黄 2 拦下窗口；C 手里另外那两张是拿来试非法打断的。 */
  const opened = (extra: Card[]) => {
    const two = [card("Y", "2"), card("Y", "2")];
    const s = raidTable(
      [[...two, card("R", "9")], [card("R", "1")], [card("Y", "2"), ...extra], [card("R", "1")]],
      {},
    );
    return play(s, two).state;
  };

  /** 六张并列被第 3 张（蓝 9）拦下，C 手里没有别的能截——放弃/超时之后剩下三张摆得完。 */
  const midGroup = () => {
    const group = six();
    const s = raidTable(
      [[...group, card("R", "9")], [card("R", "1")], [card("B", "9")], [card("R", "1")]],
      { playedPile: [card("B", "7")] },
    );
    return play(s, group).state;
  };

  it("异色同数截不了", () => {
    const g2 = card("G", "2");
    expect(respond(opened([g2]), 2, "raid", [g2.id]).rejected?.reason).toBe("bad_choice");
  });

  it("同色异数截不了", () => {
    const y5 = card("Y", "5");
    expect(respond(opened([y5]), 2, "raid", [y5.id]).rejected?.reason).toBe("bad_choice");
  });

  it("手上没有的牌截不了", () => {
    expect(respond(opened([]), 2, "raid", [card("Y", "2").id]).rejected?.reason).toBe("not_in_hand");
  });

  it("不是 actor 的人插不进来", () => {
    expect(respond(opened([]), 1, "raid", []).rejected?.reason).toBe("not_your_window");
  });

  it("放弃 → 这次并列收尾，轮到出牌者的下家 B", () => {
    const r = respond(midGroup(), 2, "pass");
    expect(r.rejected).toBeUndefined();
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.parallelPending).toBeUndefined();
    // 跟牌目标在整组落地时就定好了（同色六张跟最大的数），放弃只是把回合交出去
    expect(r.state.board!.activeFace).toBe("9");
    expect(r.state.board!.hands[0]).toHaveLength(1);
    expect(r.state.board!.currentSeat).toBe(1);
  });

  it("超时 = 没人截，按 defaultChoice 收尾", () => {
    const s = midGroup();
    const late = ctx(undefined, "2026-07-28T12:01:00.000Z");
    const r = applyAction(s, { type: "claimTimeout", seat: 1, windowId: `w${s.version}:interrupt` }, late);
    expect(r.rejected).toBeUndefined();
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.currentSeat).toBe(1);
  });

  // 2026-08-02 改判：并列整组落地、只开一次窗口，所以放弃 = 整次并列的机会都放掉了
  it("放弃就没有第二次机会了（逐张模型下这里会再开一个窗口）", () => {
    const r = respond(opened([]), 2, "pass");
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.parallelPending).toBeUndefined();
  });
});

// ---------------------------------------------------------------- 「任意一张」

describe("03 glossary：可响应并列的任意一张", () => {
  it("截的是六张里的第 4 张（非首张、非堆顶最终态）也合法", () => {
    const group = six();
    const b2 = card("B", "2"); // 与第 4 张同色同数
    const s = raidTable(
      [[...group, card("R", "9")], [card("R", "1")], [b2], [card("R", "1")]],
      { playedPile: [card("B", "7")] },
    );
    const opened = play(s, group).state;
    // 整组落地后开一次窗口，牌顶是提交顺序的最后一张；配得上组内任意一张即可截
    expect(opened.board!.playedPile[0].id).toBe(group[5].id);
    const r = respond(opened, 2, "raid", [b2.id]);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.playedPile[0].id).toBe(b2.id);
  });
});

// ---------------------------------------------------------------- 窗口期间的其他动作

describe("窗口挂着时的可点性与隐私", () => {
  const setup = () => {
    const two = [card("Y", "2"), card("Y", "2")];
    const s = raidTable(
      [[...two, card("R", "9")], [card("R", "1")], [card("Y", "2"), card("Y", "5")], [card("R", "1")]],
      {},
    );
    return { two, opened: play(s, two).state };
  };

  it("actor 拿到的是「每张截得动的牌一条」+ 放弃", () => {
    const { opened } = setup();
    const acts = legalActions(opened, 2).filter((a) => a.type === "respond");
    expect(acts).toHaveLength(2);
    expect(acts[0]).toMatchObject({ choice: "raid" });
    expect(acts[1]).toMatchObject({ choice: "pass" });
  });

  it("非 actor 在窗口期间没有出牌动作", () => {
    const { opened } = setup();
    expect(legalActions(opened, 1).some((a) => a.type === "playCards")).toBe(false);
  });

  it("U6/U7：窗口不挡喊 UNO 与抓漏喊", () => {
    const { opened } = setup();
    // 座位 3 只剩 1 张且没喊，谁都抓得着
    const caught = applyAction(opened, { type: "catchUno", seat: 2, target: 3 }, ctx());
    expect(caught.rejected).toBeUndefined();
    expect(caught.state.pendingWindow?.type).toBe("interrupt");
    const called = applyAction(opened, { type: "callUno", seat: 3 }, ctx());
    expect(called.rejected).toBeUndefined();
  });

  // 整组已经全在牌河（都发过 cardPlayed），所以 `cards` 本身不再是暗信息；
  // 中间态照旧不投影——快照里没有 `parallelPending` 这个键
  it("中间态不进快照：搜不到 parallelPending", () => {
    const { opened } = setup();
    expect(opened.board!.parallelPending!.cards.length).toBeGreaterThan(0);
    for (const seat of [1, 2, 3]) {
      const snap = JSON.stringify(projectView(opened, seat));
      expect(snap).not.toContain("parallelPending");
    }
  });
});

// ---------------------------------------------------------------- 06-Q56 的摸牌账

// 被打断者摸的那 1 张是**他人技能**造成的（06-Q56），所以请求带 initiator = 打断者。
// 注意：S2「一人一技能」下这个组合今天摆不出来——被打断者必须持并列才多得了牌，
// 就不可能同时持恩惠。所以这里直接摆一个摆到一半的牌桌，把 06-Q56 点名的那条账钉住；
// 神化连出（G1）落地后它就是真实可达的局面了。
describe("06-Q56：被打断者摸的 1 张按「他人技能」计", () => {
  const midway = (skill: string | null) => {
    const y2 = card("Y", "2");
    const c2 = card("Y", "2");
    const rest = card("Y", "2");
    // C 手里除了打断牌还留一张：否则截完手牌归零会直接判胜（2026-07-31 裁定），
    // 就走不到「被打断者摸 1」这条要测的分支了
    const s = table(
      [[rest, card("R", "9")], [card("R", "1")], [c2, card("R", "8")], [card("R", "1")]],
      {
        playedPile: [y2, card("B", "2")],
        activeColor: "Y",
        skills: [skill, null, "diamond-10", null],
        revealed: [skill !== null, false, true, false],
        drawPile: Array.from({ length: 10 }, () => card("G", "7")),
        parallelPending: { seat: 0, cards: [y2] },
      },
      {
        phase: "afterPlay",
        pendingWindow: {
          type: "interrupt", actors: [2], deadline: "2026-07-28T12:00:30.000Z",
          defaultChoice: "pass", resume: "turnStart",
        },
      },
    );
    return { s, c2 };
  };

  it("被打断者亮着恩惠：−2 至少 1 → 仍摸 1 张", () => {
    const { s, c2 } = midway("heart-1");
    const b = respond(s, 2, "raid", [c2.id]).state.board!;
    // 手上留着没摆的黄 2 + 红 9 + 摸的 1 张
    expect(b.hands[0]).toHaveLength(3);
  });

  it("把劫营的 draws 调大到 5：恩惠真的减了 2（证明走的是 skill + 他人发起 那条分支）", () => {
    const { s, c2 } = midway("heart-1");
    const def = SKILL_DATA.byId.get("diamond-10")!;
    const data: SkillData = {
      byId: new Map(SKILL_DATA.byId).set("diamond-10", {
        ...def,
        effects: [{ ...def.effects![0], values: { draws: 5 } }],
      }),
    };
    const drew = (d: SkillData) =>
      settleRaid(s, { seat: 2, choice: "raid", cardIds: [c2.id] }, ctx(), d).state.board!.hands[0].length - 2;
    expect(drew(SKILL_DATA)).toBe(1); // max(1 − 2, 1)
    expect(drew(data)).toBe(3); // 5 − 2；没走 initiator 分支的话会是 5
  });

  it("没有恩惠时按定义的 1 张摸", () => {
    const { s, c2 } = midway(null);
    expect(respond(s, 2, "raid", [c2.id]).state.board!.hands[0]).toHaveLength(3);
  });
});

// 2026-07-31 裁定：打断牌是自己最后一张 → 算赢。牌确实进了牌河，U5 只要求末牌是数字牌，
// 而劫营要同色同数，本来就只可能是数字牌。胜利优先：不摸、不流转回合。
describe("打断者用最后一张手牌打断就赢了", () => {
  /** A 摆两张黄 2（并列），C 手里只剩一张黄 2 用来截。 */
  const lastCardRaid = (cHand: Card[]) => {
    const pair = [card("Y", "2"), card("Y", "2")];
    const s = raidTable([[...pair, card("R", "9")], [card("R", "1")], cHand, [card("R", "1")]]);
    return play(s, pair).state;
  };

  it("截完手牌归零 → winner 是打断者、phase finished", () => {
    const only = card("Y", "2");
    const opened = lastCardRaid([only]);
    expect(opened.pendingWindow?.type).toBe("interrupt");
    const r = respond(opened, 2, "raid", [only.id]);
    expect(r.rejected).toBeUndefined();
    expect(r.state.phase).toBe("finished");
    expect(r.state.board!.winner).toBe(2);
    expect(r.state.board!.hands[2]).toEqual([]);
  });

  it("胜利优先：被打断者不摸那 1 张，回合也不再流转", () => {
    const only = card("Y", "2");
    const opened = lastCardRaid([only]);
    const before = opened.board!.hands[0].length;
    const r = respond(opened, 2, "raid", [only.id]);
    expect(r.state.board!.hands[0]).toHaveLength(before); // 没摸
    expect(r.events.map((e) => e.type)).toEqual(["raided"]); // 没有 cardsDrawn
    expect(r.state.board!.currentSeat).toBe(opened.board!.currentSeat); // 回合没动
  });

  it("事件带 won 标志，输赢两条路径都说得清", () => {
    const only = card("Y", "2");
    const won = respond(lastCardRaid([only]), 2, "raid", [only.id]);
    expect(won.events[0].public.won).toBe(true);
    // 手里还有别的牌 → 照常走打断流程，不判胜
    const two = [card("Y", "2"), card("R", "5")];
    const notWon = respond(lastCardRaid(two), 2, "raid", [two[0].id]);
    expect(notWon.events[0].public.won).toBe(false);
    expect(notWon.state.board!.winner).toBeUndefined();
    expect(notWon.state.phase).toBe("turnStart");
  });

  it("赢了之后没有任何合法动作（终局）", () => {
    const only = card("Y", "2");
    const r = respond(lastCardRaid([only]), 2, "raid", [only.id]);
    for (let seat = 0; seat < 4; seat++) expect(legalActions(r.state, seat)).toEqual([]);
  });
});
