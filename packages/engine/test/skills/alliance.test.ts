/**
 * 合纵♠5 / 连横♠6 的**②「无相应」那半条**（01-S14 / S14b）。
 * spec：`docs/superpowers/specs/2026-08-02-skills-batch-2.md` 第 6 步。
 *
 * ①的「相应 → 换牌」未裁定（06-Q70），两张牌因此还带 `unimplemented`、不进抽 3 选 1 的池；
 * 这里的牌桌都是直接把技能塞给座位的（同 fuzz 的 `forceSkills`）。
 *
 * 四条要害：
 * 1. **每次都是可选**（S14）：先问一句，答应了才摸；超时 = 不要
 * 2. **功能牌 = +2 / 转 / 停**（03 §1）：+4 / 变色 / 毒 / 洗牌是变色牌，不触发
 * 3. **连击看「上一个自己的回合」**（S14b）：别人打了什么都不算数
 * 4. 摸完的弃走 03 §2 那个共用窗口，弃完接着跑这次出牌的收尾（该交回合的照常交）
 */
import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../../src/index.ts";
import { card, ctx, lcg, NOW, table } from "../helpers.ts";
import type { Board, Card, GameState } from "../../src/types.ts";

const Y7 = card("Y", "7");
const filler = (n: number) => Array.from({ length: n }, () => card("G", "9"));

/** 座位 0 亮着 `skill`、轮到他；牌顶黄 7（跟色 Y）。 */
function seated(hand: Card[], skill: string | null, over: Partial<Board> = {}): GameState {
  return table([hand, [card("B", "5")], [card("B", "6")]], {
    playedPile: [Y7],
    drawPile: filler(40),
    skills: [skill, null, null],
    revealed: [skill !== null, false, false],
    ...over,
  });
}

const play = (s: GameState, c: Card, seat = 0, chosenColor?: Card["color"]) =>
  applyAction(s, {
    type: "playCards", seat, cardIds: [c.id], ...(chosenColor && { chosenColor }),
  }, ctx());
const respond = (s: GameState, choice: string, seat = 0) =>
  applyAction(s, { type: "respond", seat, windowId: `w${s.version}:drawOffer`, choice }, ctx());
const discard = (s: GameState, cardIds: string[], seat = 0) =>
  applyAction(s, { type: "respond", seat, windowId: `w${s.version}:drawDiscard`, choice: "discard", cardIds }, ctx());
const drewCounts = (r: { events: { type: string; public?: Record<string, unknown> }[] }) =>
  r.events.filter((e) => e.type === "cardsDrawn").map((e) => e.public!.count);

describe("合纵♠5②：打出功能牌后可以摸 2 弃 2（S14：每次可选）", () => {
  it("打出「转」→ 先问一句，牌还没摸", () => {
    const rev = card("Y", "rev");
    const r = play(seated([rev, card("R", "3")], "spade-5"), rev);
    expect(r.rejected).toBeUndefined();
    expect(r.state.pendingWindow?.type).toBe("drawOffer");
    expect(r.state.pendingWindow?.actors).toEqual([0]);
    expect(r.state.board!.drawOffer).toMatchObject({ seat: 0, req: { base: 2 } });
    expect(drewCounts(r)).toEqual([]); // 还没摸
    expect(r.state.board!.hands[0]).toHaveLength(1);
    // 里面没有暗信息，原样投给所有人
    for (const viewer of [0, 1, 2]) expect(projectView(r.state, viewer).drawOffer).toEqual({ seat: 0, picks: 2 });
  });

  it("答应 → 摸 2 张、开弃牌窗口；弃完这次出牌的收尾照跑（转 = 交回合）", () => {
    const rev = card("Y", "rev");
    const opened = play(seated([rev, card("R", "3")], "spade-5"), rev).state;
    const took = respond(opened, "take");
    expect(drewCounts(took)).toEqual([2]);
    expect(took.state.pendingWindow?.type).toBe("drawDiscard");
    expect(took.state.board!.drawDiscard).toMatchObject({ seat: 0, picks: 2 });
    expect(took.state.board!.hands[0]).toHaveLength(3); // 剩的 1 张 + 摸的 2 张

    const done = discard(took.state, took.state.board!.hands[0].slice(0, 2).map((c) => c.id));
    expect(done.rejected).toBeUndefined();
    expect(done.state.board!.hands[0]).toHaveLength(1);
    expect(done.state.pendingWindow).toBeUndefined();
    // 转：3 人局反转方向 → 上家接手
    expect(done.state.board!.currentSeat).toBe(2);
    expect(done.state.phase).toBe("turnStart");
  });

  it("不要 → 一张不摸，直接交回合", () => {
    const rev = card("Y", "rev");
    const opened = play(seated([rev, card("R", "3")], "spade-5"), rev).state;
    const passed = respond(opened, "decline");
    expect(drewCounts(passed)).toEqual([]);
    expect(passed.state.board!.hands[0]).toHaveLength(1);
    expect(passed.state.board!.currentSeat).toBe(2);
    expect(passed.events.some((e) => e.type === "drawOfferDeclined")).toBe(true);
  });

  it("超时 = 不要（S14 本来就是可选的）", () => {
    const rev = card("Y", "rev");
    const opened = play(seated([rev, card("R", "3")], "spade-5"), rev).state;
    const late = ctx(lcg(1), new Date(Date.parse(NOW) + 60_000).toISOString());
    const done = applyAction(opened, { type: "claimTimeout", seat: 1, windowId: `w${opened.version}:drawOffer` }, late);
    expect(done.state.board!.hands[0]).toHaveLength(1);
    expect(done.state.board!.currentSeat).toBe(2);
  });

  it("窗口里只有两条动作，且只开给他一个", () => {
    const rev = card("Y", "rev");
    const opened = play(seated([rev, card("R", "3")], "spade-5"), rev).state;
    const wid = `w${opened.version}:drawOffer`;
    expect(legalActions(opened, 0).filter((a) => a.type === "respond")).toEqual([
      { type: "respond", seat: 0, windowId: wid, choice: "take" },
      { type: "respond", seat: 0, windowId: wid, choice: "decline" },
    ]);
    expect(legalActions(opened, 1).filter((a) => a.type === "respond")).toEqual([]);
    expect(respond(opened, "take", 1).rejected?.reason).toBe("not_your_window");
    expect(respond(opened, "yolo").rejected?.reason).toBe("bad_choice");
  });
});

describe("触发面：03 §1 的功能牌才算（+2 / 转 / 停）", () => {
  it.each([
    { face: "rev" as const, color: "Y" as const, hit: true },
    { face: "skip" as const, color: "Y" as const, hit: true },
    { face: "+2" as const, color: "Y" as const, hit: true },
    { face: "7" as const, color: "R" as const, hit: false }, // 数字牌
    { face: "+4" as const, color: null, hit: false }, // 变色牌，不是功能牌
    { face: "wild" as const, color: null, hit: false },
  ])("打出 $color$face → 触发 = $hit", ({ face, color, hit }) => {
    const c = card(color, face);
    const s = seated([c, card("R", "3")], "spade-5");
    const r = play(s, c, 0, color === null ? "Y" : undefined);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.drawOffer !== undefined, `${face}`).toBe(hit);
  });

  it("+2 触发：先问摸弃，答完才轮到下家决定叠还是吃", () => {
    const p2 = card("Y", "+2");
    const opened = play(seated([p2, card("R", "3")], "spade-5"), p2).state;
    expect(opened.pendingWindow?.type).toBe("drawOffer");
    const passed = respond(opened, "decline");
    expect(passed.state.pendingWindow?.type).toBe("punishStack");
    expect(passed.state.board!.punish?.total).toBe(2);
  });

  it("手上打空了就不问（摸 N 弃 N 在空手时是确定性的空转），U5 的补摸照常", () => {
    const rev = card("Y", "rev");
    const r = play(seated([rev], "spade-5"), rev);
    expect(r.state.board!.drawOffer).toBeUndefined();
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(1); // U5 补摸的那张
    expect(r.state.board!.winner).toBeUndefined();
  });

  it("没有这个技能 / 未亮出 / 被封印 → 一概不问", () => {
    const mk = (skill: string | null, over: Partial<Board> = {}) => {
      const rev = card("Y", "rev");
      return play(seated([rev, card("R", "3")], skill, over), rev).state.board!.drawOffer;
    };
    expect(mk(null)).toBeUndefined();
    expect(mk("spade-5", { revealed: [false, false, false] })).toBeUndefined();
    expect(mk("spade-5", { statuses: [["封印"], [], []] })).toBeUndefined();
    expect(mk("spade-5")).toBeDefined(); // 对照组
  });

  it("只管自己打出的牌：别人打功能牌不给你开窗口", () => {
    const rev = card("Y", "rev");
    const s = seated([card("R", "3")], "spade-5", {
      hands: [[card("R", "3")], [rev], [card("B", "6")]],
      currentSeat: 1,
    });
    expect(play(s, rev, 1).state.board!.drawOffer).toBeUndefined();
  });
});

describe("连横♠6②：摸 1 弃 1；上一个自己的回合也打过功能牌 → 摸 3 弃 3（S14b）", () => {
  it("上一个自己的回合没打过 → 摸 1 弃 1", () => {
    const rev = card("Y", "rev");
    const r = play(seated([rev, card("R", "3")], "spade-6"), rev);
    expect(r.state.board!.drawOffer).toMatchObject({ seat: 0, req: { base: 1 } });
  });

  it("上一个自己的回合打过 → 这次摸 3 弃 3", () => {
    const rev = card("Y", "rev");
    const s = seated([rev, card("R", "3")], "spade-6", {
      funcPlay: [{ thisTurn: false, lastTurn: true }, { thisTurn: false, lastTurn: false }, { thisTurn: false, lastTurn: false }],
    });
    const r = play(s, rev);
    expect(r.state.board!.drawOffer).toMatchObject({ seat: 0, req: { base: 3 } });
    const took = respond(r.state, "take");
    expect(drewCounts(took)).toEqual([3]);
    expect(took.state.board!.drawDiscard!.picks).toBe(3);
  });

  it("连击账真的会跨回合攒起来：连着两个自己的回合打功能牌 → 第二次升到 3", () => {
    const [s1, s2] = [card("Y", "skip"), card("Y", "skip")];
    // 座位 2 的手牌与摸到的牌都接不上（跟色 Y、跟面 skip），所以他摸完就自动结束回合
    const start = seated([s1, s2, card("R", "3")], "spade-6", {
      hands: [[s1, s2, card("R", "3")], [card("B", "5")], [card("B", "6")]],
      drawPile: filler(20),
    });
    const first = respond(play(start, s1).state, "decline");
    expect(first.state.board!.currentSeat).toBe(2); // 停：跳过座位 1
    expect(first.state.board!.funcPlay![0]).toEqual({ thisTurn: false, lastTurn: true });

    const back = applyAction(first.state, { type: "drawCard", seat: 2 }, ctx());
    expect(back.state.board!.currentSeat).toBe(0);
    // 座位 2 这一回合没打出功能牌，他自己的账仍是空的（各记各的）
    expect(back.state.board!.funcPlay![2]).toEqual({ thisTurn: false, lastTurn: false });

    const second = play(back.state, s2);
    expect(second.state.board!.drawOffer!.req.base).toBe(3);
  });

  it("别人打功能牌不进你的账（S14b：连击只看你自己）", () => {
    const rev = card("Y", "rev");
    const s = seated([card("R", "3")], "spade-6", {
      hands: [[card("R", "3")], [rev], [card("B", "6")]],
      currentSeat: 1,
    });
    const after = play(s, rev, 1);
    // 转打完回合就交出去了，所以座位 1 的账当场轮转成「上回合打过」；座位 0 的一动不动
    expect(after.state.board!.funcPlay![1]).toEqual({ thisTurn: false, lastTurn: true });
    expect(after.state.board!.funcPlay![0]).toEqual({ thisTurn: false, lastTurn: false });
  });

  it("合纵没有连击档：上一个回合打过也还是摸 2 弃 2", () => {
    const rev = card("Y", "rev");
    const s = seated([rev, card("R", "3")], "spade-5", {
      funcPlay: [{ thisTurn: false, lastTurn: true }, { thisTurn: false, lastTurn: false }, { thisTurn: false, lastTurn: false }],
    });
    expect(play(s, rev).state.board!.drawOffer!.req.base).toBe(2);
  });
});

// ─────────────────────────────────────────────────── ①：结盟（01-S13/S13b / 06-Q70）

/** 座位 0 拿合纵、座位 2 拿连横，两边都还没亮出。 */
const paired = (over: Partial<Board> = {}): GameState =>
  table([[card("Y", "rev"), card("R", "3")], [card("B", "5")], [card("G", "8"), card("G", "9")]], {
    playedPile: [Y7],
    drawPile: filler(20),
    skills: ["spade-5", null, "spade-6"],
    revealed: [false, false, false],
    ...over,
  });

const reveal = (s: GameState, seat = 0) => applyAction(s, { type: "revealSkill", seat }, ctx());
const answer = (s: GameState, choice: string, seat = 2) =>
  applyAction(s, { type: "respond", seat, windowId: `w${s.version}:alliance`, choice }, ctx());

describe("合纵/连横①：亮出当下问另一半「相应吗」（S13）", () => {
  it("亮出合纵 → 问持连横的那个人，且只问他", () => {
    const r = reveal(paired());
    expect(r.state.pendingWindow?.type).toBe("alliance");
    expect(r.state.pendingWindow?.actors).toEqual([2]);
    expect(r.state.board!.alliance).toBeUndefined(); // 还没答
    expect(legalActions(r.state, 2).filter((a) => a.type === "respond").map((a) => a.choice))
      .toEqual(["ally", "refuse"]);
    expect(legalActions(r.state, 1).filter((a) => a.type === "respond")).toEqual([]);
  });

  it("相应 → 响应即亮出 + 两人整副手牌互换（S13b / Q70）", () => {
    const s = paired();
    const [h0, h2] = [s.board!.hands[0], s.board!.hands[2]];
    const done = answer(reveal(s).state, "ally");

    expect(done.rejected).toBeUndefined();
    expect(done.state.board!.alliance).toEqual({ allied: true, seats: [2, 0] });
    expect(done.state.board!.revealed).toEqual([true, false, true]); // 响应即亮出
    expect(done.state.board!.hands[0].map((c) => c.id)).toEqual(h2.map((c) => c.id));
    expect(done.state.board!.hands[2].map((c) => c.id)).toEqual(h0.map((c) => c.id));
    expect(done.state.board!.hands[1]).toHaveLength(1); // 局外人一张不动
    expect(done.events.find((e) => e.type === "handsSwapped")!.public)
      .toEqual({ seats: [2, 0], counts: [2, 2] });
    expect(done.state.pendingWindow).toBeUndefined();
  });

  it("不相应 / 超时 → 一锤定音，此后谁再亮出都不再问（S13）", () => {
    const refused = answer(reveal(paired()).state, "refuse");
    expect(refused.state.board!.alliance).toEqual({ allied: false });
    expect(refused.state.board!.revealed[2]).toBe(false); // 没相应就没亮出

    // 连横之后自己亮出：不再问第二次
    const later = reveal({ ...refused.state, board: { ...refused.state.board!, currentSeat: 2 } }, 2);
    expect(later.state.pendingWindow).toBeUndefined();
    expect(later.state.board!.alliance).toEqual({ allied: false });

    const timedOut = applyAction(
      reveal(paired()).state,
      { type: "claimTimeout", seat: 0, windowId: `w${reveal(paired()).state.version}:alliance` },
      ctx(lcg(1), new Date(Date.parse(NOW) + 60_000).toISOString()),
    );
    expect(timedOut.state.board!.alliance).toEqual({ allied: false });
  });

  it("另一半不在场 / 已经问过 → 不开窗口，亮出照旧", () => {
    const alone = reveal(paired({ skills: ["spade-5", null, null] }));
    expect(alone.state.pendingWindow).toBeUndefined();
    expect(alone.state.board!.alliance).toBeUndefined(); // 没问过 ≠ 问过没结成
    expect(alone.state.board!.revealed[0]).toBe(true);

    const asked = reveal(paired({ alliance: { allied: false } }));
    expect(asked.state.pendingWindow).toBeUndefined();
  });

  it("另一半被血棘封印（亮不出来，01-P14）→ 当场写死无相应", () => {
    const r = reveal(paired({ statuses: [[], [], ["封印"]] }));
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.alliance).toEqual({ allied: false });
  });
});

describe("合纵/连横①b：结盟后回合开始可再换（占 V7 的主动条）", () => {
  /** 已结盟、轮到座位 0 的回合开始。 */
  const allied = (over: Partial<Board> = {}): GameState =>
    paired({
      revealed: [true, false, true],
      alliance: { allied: true, seats: [0, 2] },
      ...over,
    });

  it("legalActions 给出这条主动；发动 = 再换一次整副手牌", () => {
    const s = allied();
    const [h0, h2] = [s.board!.hands[0], s.board!.hands[2]];
    expect(legalActions(s, 0).filter((a) => a.type === "activateSkill").map((a) => a.effectKey)).toEqual(["1b"]);

    const r = applyAction(s, { type: "activateSkill", seat: 0, effectKey: "1b" }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0].map((c) => c.id)).toEqual(h2.map((c) => c.id));
    expect(r.state.board!.hands[2].map((c) => c.id)).toEqual(h0.map((c) => c.id));
    // 06-Q70：占 V7 的主动条
    expect(r.state.board!.activatedThisTurn[0]).toBe(true);
    expect(legalActions(r.state, 0).filter((a) => a.type === "activateSkill")).toEqual([]);
  });

  it("盟友那边的回合开始同样可以换（不需对方同意）", () => {
    const s = allied({ currentSeat: 2 });
    expect(legalActions(s, 2).filter((a) => a.type === "activateSkill").map((a) => a.effectKey)).toEqual(["1b"]);
    expect(applyAction(s, { type: "activateSkill", seat: 2, effectKey: "1b" }, ctx()).rejected).toBeUndefined();
  });

  it("没结盟 → 这条主动压根不给，硬发也拒", () => {
    const s = paired({ revealed: [true, false, true] });
    expect(legalActions(s, 0).filter((a) => a.type === "activateSkill")).toEqual([]);
    expect(applyAction(s, { type: "activateSkill", seat: 0, effectKey: "1b" }, ctx()).rejected?.reason)
      .toBe("skill_unavailable");
  });

  it("任一方被封印 → 两人同时失去（03 §7 / Q70：只压制，解封恢复）", () => {
    const sealed = allied({ statuses: [[], [], ["封印"]] });
    expect(legalActions(sealed, 0).filter((a) => a.type === "activateSkill")).toEqual([]);
    // 值留着：解封之后照旧
    const lifted = { ...sealed, board: { ...sealed.board!, statuses: [[], [], []] } };
    expect(legalActions(lifted, 0).filter((a) => a.type === "activateSkill").map((a) => a.effectKey)).toEqual(["1b"]);
  });
});

describe("结盟与②互斥（Q70：卡面「相应则换牌…；**无响应**则每张功能牌后摸弃」）", () => {
  it("结盟之后，打出功能牌不再问「要不要摸弃」——双方都关掉", () => {
    const rev = card("Y", "rev");
    const s = table([[rev, card("R", "3")], [card("B", "5")], [card("G", "8")]], {
      playedPile: [Y7],
      drawPile: filler(20),
      skills: ["spade-5", null, "spade-6"],
      revealed: [true, false, true],
      alliance: { allied: true, seats: [0, 2] },
    });
    expect(play(s, rev).state.board!.drawOffer).toBeUndefined();
  });

  it("问过但没结成 → ②照常（对照组）", () => {
    const rev = card("Y", "rev");
    const s = table([[rev, card("R", "3")], [card("B", "5")], [card("G", "8")]], {
      playedPile: [Y7],
      drawPile: filler(20),
      skills: ["spade-5", null, "spade-6"],
      revealed: [true, false, true],
      alliance: { allied: false },
    });
    expect(play(s, rev).state.board!.drawOffer).toMatchObject({ seat: 0, req: { base: 2 } });
  });
});
