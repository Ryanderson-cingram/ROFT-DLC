/**
 * 八门♠8（04 ♠8 / 03 §2 / 03 §4 / 02 §7）。
 * spec：`docs/superpowers/specs/2026-08-02-skills-batch-2.md` 第 5 步。
 *
 * ① 一次性摸 8 弃 8：走 `drawDiscard` 那**一个**窗口（03 §2），
 *   「不受其他技能影响」按 L1 替换落地——连自己②的「所有摸牌 +1」都不加（06-Q69）。
 * ② 回合结束获五彩（03 §4 的互斥照旧兜底）+ 所有摸牌 L2 +1。
 *
 * 五彩本身**能干什么**（不能打只靠颜色接上的牌、变色牌不能改色）钉在 `statuses.test.ts`。
 */
import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../../src/index.ts";
import { card, ctx, lcg, NOW, table } from "../helpers.ts";
import type { Board, GameState, PunishChain } from "../../src/types.ts";

const R7 = card("R", "7");
const filler = (n: number) => Array.from({ length: n }, () => card("G", "9"));
/** 起手 3 张，够挑「刚摸的 + 原本就有的」混着弃。 */
const HAND = () => [card("R", "3"), card("R", "4"), card("B", "5")];

/** 座位 0 亮着八门、轮到他，牌堆 40 张。 */
const seated = (over: Partial<Board> = {}, skills: (string | null)[] = ["spade-8", null, null]): GameState =>
  table([HAND(), [card("Y", "1")], [card("Y", "2")]], {
    playedPile: [R7],
    drawPile: filler(40),
    skills,
    revealed: skills.map((s) => s !== null),
    ...over,
  });

const activate = (s: GameState, seat = 0) =>
  applyAction(s, { type: "activateSkill", seat, effectKey: "1" }, ctx());
const discard = (s: GameState, cardIds: string[], seat = 0) =>
  applyAction(s, { type: "respond", seat, windowId: `w${s.version}:drawDiscard`, choice: "discard", cardIds }, ctx());
const drewCounts = (r: { events: { type: string; public?: Record<string, unknown> }[] }) =>
  r.events.filter((e) => e.type === "cardsDrawn").map((e) => e.public!.count);

describe("八门①：一次摸 8，再从整副手牌里挑 8 张弃掉（03 §2 一个窗口）", () => {
  it("发动 → 一次摸满 8 张并开出弃牌窗口，回合还在自己手上", () => {
    const r = activate(seated());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(3 + 8);
    expect(drewCounts(r)).toEqual([8]); // 一次摸满，不是 8 次「摸 1 弃 1」
    expect(r.state.pendingWindow?.type).toBe("drawDiscard");
    expect(r.state.board!.drawDiscard).toMatchObject({ seat: 0, picks: 8 });
    expect(r.state.board!.currentSeat).toBe(0);
  });

  it("弃完 8 张 → 手牌回到起手数，回合**不交**（阶段 1 的主动，打牌还没打）", () => {
    const r = activate(seated());
    const hand = r.state.board!.hands[0];
    // 混着弃：2 张原本就有的（留下红 3 待会儿还能打）+ 6 张刚摸的
    const ids = [hand[1].id, hand[2].id, ...hand.slice(3, 9).map((c) => c.id)];
    const done = discard(r.state, ids);

    expect(done.rejected).toBeUndefined();
    expect(done.state.board!.hands[0]).toHaveLength(3);
    expect(done.state.board!.discardPile.map((c) => c.id)).toEqual(ids);
    // 06-Q55：弃牌不改牌顶也不改跟色
    expect(done.state.board!.playedPile[0]).toEqual(R7);
    expect(done.state.board!.activeColor).toBe("R");
    expect(done.state.board!.currentSeat).toBe(0);
    expect(done.state.phase).toBe("turnStart");
    expect(done.state.pendingWindow).toBeUndefined();
    // 还能接着出牌 / 摸牌，只是主动额度用掉了（V7）
    expect(done.state.board!.activatedThisTurn[0]).toBe(true);
    expect(legalActions(done.state, 0).some((a) => a.type === "playCards")).toBe(true);
  });

  it("一次性（V5/S15）：整局只发得出一次，下一个回合也发不了", () => {
    const r = activate(seated());
    const done = discard(r.state, r.state.board!.hands[0].slice(0, 8).map((c) => c.id));
    expect(done.state.board!.usedOnce?.[0]).toEqual({ "1": true });
    expect(legalActions(done.state, 0).some((a) => a.type === "activateSkill")).toBe(false);
    // 本回合再点是 V7 的额度先拦下（每回合一条主动）
    expect(activate(done.state).rejected?.reason).toBe("already_activated");
    // 额度到下回合会清零，一次性这本账不会——所以那时拦它的才是 already_used
    const nextTurn: GameState = {
      ...done.state,
      board: { ...done.state.board!, activatedThisTurn: [false, false, false] },
    };
    expect(legalActions(nextTurn, 0).some((a) => a.type === "activateSkill")).toBe(false);
    expect(activate(nextTurn).rejected?.reason).toBe("already_used");
  });

  it("「不受其他技能影响」= L1：自己②的「所有摸牌 +1」也加不上去（摸 8 不是 9）", () => {
    // ②是 while_revealed 的 L2 +1，亮着就在场——普通摸牌确实变 2 张（下面那条对照）
    const r = activate(seated());
    expect(drewCounts(r)).toEqual([8]);
    expect(r.state.board!.drawDiscard!.picks).toBe(8);
  });

  it("对照组：同一个牌桌上，②对**普通**摸牌照样 +1（证明上面测的是 L1，不是②没生效）", () => {
    const r = applyAction(seated(), { type: "drawCard", seat: 0 }, ctx());
    expect(drewCounts(r)).toEqual([2]); // U1 的 1 张 + ②的 L2 +1
  });

  it("牌堆见底：只摸到 5 张 → 只弃 5 张（03 §2「摸到手里的不能少于弃的」）", () => {
    const r = activate(seated({ drawPile: filler(5) }));
    expect(drewCounts(r)).toEqual([5]);
    expect(r.state.board!.drawDiscard!.picks).toBe(5);
    const hand = r.state.board!.hands[0];
    expect(discard(r.state, hand.slice(0, 8).map((c) => c.id)).rejected?.reason).toBe("bad_shape");
    expect(discard(r.state, hand.slice(0, 5).map((c) => c.id)).state.board!.hands[0]).toHaveLength(3);
  });

  it("超时 → 弃掉**刚摸的**那 8 张，原手牌一张不动", () => {
    const r = activate(seated());
    const drawn = r.state.board!.drawDiscard!.drawnIds;
    const late = ctx(lcg(1), new Date(Date.parse(NOW) + 60_000).toISOString());
    const done = applyAction(r.state, { type: "claimTimeout", seat: 1, windowId: `w${r.state.version}:drawDiscard` }, late);

    expect(done.state.board!.hands[0].map((c) => c.id)).toEqual(HAND().map((_c, i) => r.state.board!.hands[0][i].id));
    expect(done.state.board!.discardPile.map((c) => c.id)).toEqual(drawn);
    expect(done.state.board!.currentSeat).toBe(0);
  });

  it("未亮出 → 发不动（V3）", () => {
    expect(activate(seated({ revealed: [false, false, false] })).rejected?.reason).toBe("not_revealed");
  });
});

describe("八门②a：回合结束获五彩（03 §4）", () => {
  /** 座位 0 打出一张能接上的牌 → 回合交给座位 1。 */
  const playAndPass = (s: GameState) =>
    applyAction(s, { type: "playCards", seat: 0, cardIds: [s.board!.hands[0][0].id] }, ctx());

  it("自己的回合一结束就获得五彩，并发公开事件", () => {
    const s = seated();
    expect(s.board!.statuses[0]).toEqual([]);
    const r = playAndPass(s);
    expect(r.state.board!.currentSeat).toBe(1);
    expect(r.state.board!.statuses[0]).toEqual(["五彩"]);
    expect(r.events.find((e) => e.type === "statusGranted")!.public)
      .toEqual({ seat: 0, status: "五彩", skillId: "spade-8" });
  });

  it("幂等：已经有了就不再发事件（§4 不叠层）", () => {
    const r = playAndPass(seated({ statuses: [["五彩"], [], []] }));
    expect(r.state.board!.statuses[0]).toEqual(["五彩"]);
    expect(r.events.some((e) => e.type === "statusGranted")).toBe(false);
  });

  it("负面三者互斥：已有恋战 → 拿不到五彩，也不发事件（§4 兜底，八门自己不判）", () => {
    const r = playAndPass(seated({ statuses: [["恋战"], [], []] }));
    expect(r.state.board!.statuses[0]).toEqual(["恋战"]);
    expect(r.events.some((e) => e.type === "statusGranted")).toBe(false);
  });

  it("未亮出 → 不给（V3）", () => {
    const r = playAndPass(seated({ revealed: [false, false, false] }));
    expect(r.state.board!.statuses[0]).toEqual([]);
  });

  it("被封印 → 不给（P9 封印含被动）", () => {
    const r = playAndPass(seated({ statuses: [["封印"], [], []] }));
    expect(r.state.board!.statuses[0]).toEqual(["封印"]);
  });

  it("只结算**离场的那个人**：别人回合结束不会给八门持有者挂状态", () => {
    const s = seated({ currentSeat: 1 });
    const r = applyAction(s, { type: "drawCard", seat: 1 }, ctx());
    expect(r.state.board!.currentSeat).not.toBe(1);
    expect(r.state.board!.statuses[0]).toEqual([]);
  });
});

describe("八门②b：所有摸牌 +1（02 §7 的 L2）", () => {
  it("U1 的规则摸牌：1 → 2 张", () => {
    expect(drewCounts(applyAction(seated(), { type: "drawCard", seat: 0 }, ctx()))).toEqual([2]);
  });

  it("惩罚摸牌：4 → 5 张（applies_to 缺席 = 一切摸牌）", () => {
    const chain: PunishChain = {
      initiator: 1,
      segments: [{ seat: 1, face: "+2", draw: 2, color: "Y" }, { seat: 1, face: "+2", draw: 2, color: "Y" }],
      total: 4,
    };
    const s = seated({ currentSeat: 1, punish: chain });
    const opened: GameState = {
      ...s,
      phase: "play",
      pendingWindow: { type: "punishStack", actors: [0], deadline: "2026-07-28T12:00:30.000Z", defaultChoice: "accept", resume: "play" },
    };
    const r = applyAction(opened, { type: "respond", seat: 0, windowId: `w${opened.version}:punishStack`, choice: "accept" }, ctx());
    expect(drewCounts(r)).toEqual([5]);
  });

  it("只加自己的（targeting: self）：别人摸牌照旧", () => {
    const s = seated({ currentSeat: 1 });
    expect(drewCounts(applyAction(s, { type: "drawCard", seat: 1 }, ctx()))).toEqual([1]);
  });

  it("未亮出 → 不加（V3）", () => {
    const s = seated({ revealed: [false, false, false] });
    expect(drewCounts(applyAction(s, { type: "drawCard", seat: 0 }, ctx()))).toEqual([1]);
  });
});
