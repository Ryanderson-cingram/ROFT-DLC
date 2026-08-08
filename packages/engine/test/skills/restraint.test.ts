/**
 * 忍戒♠J（04 ♠J / 02 §7 L6）。
 * spec：`docs/superpowers/specs/2026-08-02-skills-batch-2.md` 第 4 步。
 *
 * 它是**第一支跑起来的 L6 后置程序**：不改摸牌数，只在惩罚结算之后多跑一段——
 * 按最终值 N 多摸 min(N, 6) 张，再弃等量（走 03 §2 的「摸 N 弃 N 是一个窗口」）。
 *
 * 四条要害，逐条钉：
 * 1. 多摸的是 **min(N, 6)**，N 是**层级算完**的那个数，不是链上的贡献总和
 * 2. 弃的那一步是 `drawDiscard` 窗口，**弃完才交回合**（U6 的声明按最终张数判）
 * 3. 多摸那几张**不是惩罚**（01-P1），所以它不会把自己再触发一遍
 * 4. V3 未亮出 / P9 被封印 → 整支不生效
 */
import { describe, expect, it } from "vitest";
import { applyAction } from "../../src/index.ts";
import { drawModifiersFor } from "../../src/skills/draw-passives.ts";
import { card, ctx, lcg, NOW, table } from "../helpers.ts";
import type { Board, GameState, PunishChain } from "../../src/types.ts";

const R7 = card("R", "7");
const filler = (n: number) => Array.from({ length: n }, () => card("G", "9"));
/** 座位 1 的起手：3 张，够挑「刚摸的 + 原本就有的」混着弃。 */
const HAND1 = () => [card("Y", "1"), card("Y", "5"), card("B", "6")];

/** n 段 +2 的链：贡献总和 2n，链上 n 张。 */
const chainOf = (n: number, draw = 2): PunishChain => ({
  initiator: 0,
  segments: Array.from({ length: n }, () => ({ seat: 0, face: "+2" as const, draw, color: "R" as const })),
  total: n * draw,
});

/**
 * 座位 1 面前挂着惩罚窗口，等他吃。`skills` 决定谁亮着什么。
 * 座位 0 是链首（打出惩罚的人），所以吃完之后回合应该交给座位 **2**。
 */
function opened(over: Partial<Board> = {}, skills: (string | null)[] = [null, "spade-j", null]): GameState {
  const s = table([[card("R", "3")], HAND1(), [card("Y", "2"), card("B", "4")]], {
    playedPile: [R7],
    drawPile: filler(40),
    currentSeat: 0,
    skills,
    revealed: skills.map((x) => x !== null),
    punish: chainOf(2),
    ...over,
  });
  return {
    ...s,
    phase: "play",
    pendingWindow: {
      type: "punishStack",
      actors: [1],
      deadline: "2026-07-28T12:00:30.000Z",
      defaultChoice: "accept",
      resume: "play",
    },
  };
}

const eat = (s: GameState) =>
  applyAction(s, { type: "respond", seat: 1, windowId: `w${s.version}:punishStack`, choice: "accept" }, ctx());

const discard = (s: GameState, cardIds: string[]) =>
  applyAction(s, { type: "respond", seat: 1, windowId: `w${s.version}:drawDiscard`, choice: "discard", cardIds }, ctx());

const timeout = (s: GameState) =>
  applyAction(
    s,
    { type: "claimTimeout", seat: 0, windowId: `w${s.version}:drawDiscard` },
    ctx(lcg(1), new Date(Date.parse(NOW) + 60_000).toISOString()),
  );

const drewCounts = (r: { events: { type: string; public?: Record<string, unknown> }[] }) =>
  r.events.filter((e) => e.type === "cardsDrawn").map((e) => e.public!.count);

describe("忍戒♠J：吃完惩罚多摸等量，再开弃牌窗口", () => {
  it("链上贡献 4 → 摸 4 张，然后多摸 4 张并开出摸 N 弃 N 的窗口", () => {
    const r = eat(opened());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[1]).toHaveLength(3 + 4 + 4);
    expect(r.state.pendingWindow?.type).toBe("drawDiscard");
    expect(r.state.pendingWindow?.actors).toEqual([1]);
    expect(r.state.board!.drawDiscard).toMatchObject({ seat: 1, picks: 4 });
    // 惩罚的 4 张与多摸的 4 张是**两次**摸牌事件，各走各的层级（02 §7「每次摸牌独立走一遍」）
    expect(drewCounts(r)).toEqual([4, 4]);
    // 链已经吃掉了，多摸的那几张不再是惩罚（P1）
    expect(r.state.board!.punish).toBeUndefined();
    expect(r.events.filter((e) => e.type === "punishAccepted")).toHaveLength(1);
  });

  it("回合**还没**交出去：弃完才算走完这条惩罚（P10）", () => {
    const r = eat(opened());
    expect(r.state.board!.currentSeat).toBe(0);
    expect(r.state.phase).toBe("afterPlay");
  });

  it("弃完等量 → 手牌回到「起手 + 惩罚那几张」，回合交给受罚者的下家", () => {
    const r = eat(opened());
    const hand = r.state.board!.hands[1];
    // 混着弃：2 张原本就有的 + 2 张刚摸的（03 §2「从摸完之后的整副手牌里挑」）
    const ids = [hand[0].id, hand[1].id, hand[9].id, hand[10].id];
    const done = discard(r.state, ids);

    expect(done.rejected).toBeUndefined();
    expect(done.state.board!.hands[1]).toHaveLength(3 + 4);
    expect(done.state.board!.hands[1].map((c) => c.id)).not.toEqual(expect.arrayContaining(ids));
    // 06-Q55 三堆模型：弃的进弃牌堆，牌顶与跟色一动不动
    expect(done.state.board!.discardPile.map((c) => c.id)).toEqual(ids);
    expect(done.state.board!.playedPile[0]).toEqual(R7);
    expect(done.state.board!.currentSeat).toBe(2);
    expect(done.state.phase).toBe("turnStart");
    expect(done.state.pendingWindow).toBeUndefined();
    expect(done.state.board!.drawDiscard).toBeUndefined();
  });

  it("超时 → 弃掉**刚多摸的**那几张，原手牌与惩罚摸的都留着，回合照样交出去", () => {
    const r = eat(opened());
    const extra = r.state.board!.drawDiscard!.drawnIds;
    const done = timeout(r.state);

    expect(done.state.board!.hands[1]).toHaveLength(3 + 4);
    expect(done.state.board!.discardPile.map((c) => c.id)).toEqual(extra);
    expect(done.state.board!.currentSeat).toBe(2);
  });
});

describe("忍戒：多摸 min(N, 6)——N 是层级算完的那个数", () => {
  it.each([
    { segs: 1, n: 2, extra: 2 },
    { segs: 3, n: 6, extra: 6 },
    { segs: 4, n: 8, extra: 6 }, // 上限：N = 8 也只多摸 6，不是 8
    { segs: 5, n: 10, extra: 6 },
  ])("链上 $segs 段（摸 $n 张）→ 多摸 $extra 张", ({ segs, n, extra }) => {
    const r = eat(opened({ punish: chainOf(segs) }));
    expect(drewCounts(r)).toEqual([n, extra]);
    expect(r.state.board!.drawDiscard!.picks).toBe(extra);
  });

  it("惩罚摸 0 张（强袭掷 0）→ 没有 N 可以翻倍，不开窗口、直接交回合", () => {
    const r = eat(opened({ punish: chainOf(1, 0) }));
    expect(drewCounts(r)).toEqual([0]);
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.hands[1]).toHaveLength(3);
    expect(r.state.board!.currentSeat).toBe(2);
  });
});

describe("忍戒：牌堆见底（03 §2「摸到手里的不能少于弃的」）", () => {
  it("多摸只摸到 1 张 → 只弃 1 张（picks 跟着下调）", () => {
    // 牌堆 5 张：惩罚吃掉 4 张，多摸只剩 1 张；出牌堆只有牌顶、弃牌堆空 → 洗不回任何东西
    const r = eat(opened({ drawPile: filler(5) }));
    expect(drewCounts(r)).toEqual([4, 1]);
    expect(r.state.board!.drawDiscard!.picks).toBe(1);
    const hand = r.state.board!.hands[1];
    expect(discard(r.state, hand.slice(0, 2).map((c) => c.id)).rejected?.reason).toBe("bad_shape");
    expect(discard(r.state, [hand[0].id]).state.board!.hands[1]).toHaveLength(3 + 4 - 1 + 1);
  });

  it("一张都多摸不到 → 不开窗口、不弃牌，直接交回合", () => {
    const r = eat(opened({ drawPile: filler(4) }));
    expect(drewCounts(r)).toEqual([4, 0]);
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.discardPile).toEqual([]);
    expect(r.state.board!.currentSeat).toBe(2);
  });
});

describe("忍戒：什么时候**不**触发", () => {
  it("未亮出 → 不生效（V3）：吃完 4 张直接交回合", () => {
    const r = eat(opened({ revealed: [false, false, false] }));
    expect(drewCounts(r)).toEqual([4]);
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.currentSeat).toBe(2);
  });

  it("被封印 → 不生效（P9 封印含被动）", () => {
    const r = eat(opened({ statuses: [[], ["封印"], []] }));
    expect(drewCounts(r)).toEqual([4]);
    expect(r.state.pendingWindow).toBeUndefined();
  });

  it("只吃惩罚摸牌（applies_to: [punish]）：U1 无牌可出的那 1 张不触发", () => {
    const s = table([[card("Y", "1")], HAND1(), [card("Y", "2")]], {
      playedPile: [R7],
      drawPile: [card("B", "8"), ...filler(20)],
      currentSeat: 1,
      skills: [null, "spade-j", null],
      revealed: [true, true, true],
    });
    const r = applyAction(s, { type: "drawCard", seat: 1 }, ctx());
    expect(drewCounts(r)).toEqual([1]);
    expect(r.state.pendingWindow).toBeUndefined();
  });

  it("是**别人**在受罚 → 不触发（targeting: self，忍戒只管自己那次摸牌）", () => {
    // 忍戒在座位 2 上，吃惩罚的是座位 1
    const r = eat(opened({}, [null, null, "spade-j"]));
    expect(drewCounts(r)).toEqual([4]);
    expect(r.state.pendingWindow).toBeUndefined();
  });

  it("与伤逝♥10 各在各的座位上：S2b 技能全场唯一，两支互不串门", () => {
    const r = eat(opened({}, [null, "spade-j", "heart-10"]));
    // 座位 1 摸的是贡献总和 4（伤逝在座位 2，替换不了他的计算）
    expect(drewCounts(r)).toEqual([4, 4]);
    expect(r.events.find((e) => e.type === "cardsDrawn")!.public!.replacedBy).toBeUndefined();
  });
});

describe("忍戒：多摸那几张不是惩罚（01-P1），所以不会自我递归", () => {
  it("多摸走 kind: skill → 采集器一条 L6 都不给它，弃完就收场，不会再开第二个窗口", () => {
    const r = eat(opened());
    const b = r.state.board!;
    // 同一个牌桌、同一个座位，只换摸牌事件的类型：惩罚给 L6，技能摸牌一条都不给
    expect(drawModifiersFor(b, { kind: "punish", base: 4, seat: 1 })).toEqual([
      { layer: "L6", source: "忍戒", procedure: "draw_then_discard", values: { L6: 6 } },
    ]);
    expect(drawModifiersFor(b, { kind: "skill", base: 4, seat: 1 })).toEqual([]);

    const done = discard(r.state, b.hands[1].slice(0, 4).map((c) => c.id));
    expect(done.rejected).toBeUndefined();
    expect(done.state.pendingWindow).toBeUndefined();
    expect(done.state.board!.drawDiscard).toBeUndefined();
  });
});

describe("忍戒 × 交回合：那一整套账在**弃完之后**才结（U6/U7b）", () => {
  it("多摸完还没交回合 → 没有 unoGrace；弃完才有，且记的是受罚者", () => {
    const r = eat(opened());
    expect(r.state.board!.unoGrace).toBeUndefined();
    const done = discard(r.state, r.state.board!.hands[1].slice(0, 4).map((c) => c.id));
    // passTurn 在弃完那一刻才跑：交出回合的是受罚者，补喊宽限记给他（U7b）
    expect(done.state.board!.unoGrace?.seat).toBe(1);
  });

  it("链首的虚喊照样罚得到，只是**晚了一步**：结算在弃完那一刻，不在吃下那一刻（U6）", () => {
    // 座位 0 喊了 UNO 却握着 2 张：他的回合在这条链走完时结束 → 罚摸 2
    const s = opened({
      hands: [[card("R", "3"), card("R", "4")], HAND1(), [card("Y", "2")]],
      saidUno: [true, false, false],
      unoThisTurn: [true, false, false], // 本回合按的 → 虚喊结算认它
    });
    const r = eat(s);
    expect(r.events.some((e) => e.type === "unoMiscalled")).toBe(false); // 回合还没交，还没到结算时点
    expect(r.state.board!.hands[0]).toHaveLength(2);

    const done = discard(r.state, r.state.board!.hands[1].slice(0, 4).map((c) => c.id));
    expect(done.events.filter((e) => e.type === "unoMiscalled").map((e) => e.public!.seat)).toEqual([0]);
    expect(done.state.board!.hands[0]).toHaveLength(4); // 罚摸 2
  });

  // 弃完的张数恒为「起手 + 惩罚那几张」（多摸几张就弃几张），所以受罚者不可能靠这条路
  // 落到 1 张——「弃完恰好剩 1」的用例造不出来，这里只钉「按弃完之后的张数判」这一半。
  it("弃完还剩 5 张 → 声明在交回合那一刻作废（passTurn 读的是弃完之后的手牌）", () => {
    const r = eat(opened({ punish: chainOf(1) })); // 起手 3 + 摸 2 + 多摸 2 = 7
    const said: GameState = { ...r.state, board: { ...r.state.board!, saidUno: [false, true, false] } };
    const done = discard(said, said.board!.hands[1].slice(0, 2).map((c) => c.id));
    expect(done.state.board!.hands[1]).toHaveLength(5);
    expect(done.state.board!.saidUno[1]).toBe(false);
  });
});
