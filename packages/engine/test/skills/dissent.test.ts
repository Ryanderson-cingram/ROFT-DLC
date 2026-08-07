/**
 * 异议♥8（04 ♥8 / 01-F3 / 02 §7 L2）。
 * spec：`docs/superpowers/specs/2026-08-02-skills-batch-2.md` 第 2 步。
 *
 * 两条各自独立、共用一个惩罚窗口，所以这里按 ① / ② / 交叉 三段分：
 * ① 整局一次，反转方向 + 跳过自己 → 链**原样反弹给上家**；不占 V7 的主动条
 * ② 打出「转」获异；吃下时**可选**弃 N 枚，每枚 L2 −1；超时默认弃 0
 */
import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../../src/index.ts";
import { windowIdOf } from "../../src/legal.ts";
import { card, ctx, ctxAfter, table } from "../helpers.ts";
import type { Action, Board, GameState } from "../../src/types.ts";

const R7 = card("R", "7");
const filler = (n: number) => Array.from({ length: n }, () => card("G", "9"));

/** 座位 0 打了 +2、+4 进链（贡献总和 6），窗口挂在座位 1 头上。 */
const CHAIN = {
  initiator: 0,
  segments: [
    { seat: 0, face: "+2" as const, draw: 2, color: "R" as const },
    { seat: 0, face: "+4" as const, draw: 4, color: "R" as const },
  ],
  total: 6,
};

const opened = (over: Partial<Board> = {}, seats = 3): GameState => {
  const hands = Array.from({ length: seats }, (_x, i) => [card("Y", String(i + 1) as "1")]);
  const s = table(hands, {
    playedPile: [R7],
    drawPile: filler(40),
    currentSeat: 0,
    skills: hands.map(() => null),
    revealed: hands.map(() => true),
    punish: CHAIN,
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
};

/** 座位 1 亮着异议的标准局面。`marks` 给「异」的余额。 */
const withDissent = (marks = 0, over: Partial<Board> = {}, seats = 3) =>
  opened({
    skills: Array.from({ length: seats }, (_x, i) => (i === 1 ? "heart-8" : null)),
    marks: Array.from({ length: seats }, (_x, i): Record<string, number> => (i === 1 && marks ? { 异: marks } : {})),
    ...over,
  }, seats);

const respond = (s: GameState, seat: number, choice: string) =>
  applyAction(s, { type: "respond", seat, windowId: windowIdOf(s)!, choice }, ctx());

const choicesOf = (s: GameState, seat: number) =>
  legalActions(s, seat).filter((a): a is Action & { choice: string } => a.type === "respond").map((a) => a.choice);

// ───────────────────────────── ① 反弹给上家

describe("异议①：反转方向 + 跳过自己 → 链原样反弹给上家", () => {
  it("窗口转到座位 0（打出者本人），链一张不动，座位 1 一张不摸", () => {
    const s = withDissent();
    const r = respond(s, 1, "dissent");
    expect(r.rejected).toBeUndefined();
    expect(r.state.pendingWindow?.actors).toEqual([0]);
    // 段与贡献总和原样传过去——异议免的是「我吃」，不是把那两张从链上拿走
    expect(r.state.board!.punish).toEqual(CHAIN);
    expect(r.state.board!.hands[1]).toHaveLength(1);
  });

  it("方向真的翻了（1 → −1），不是只把窗口挪个位置", () => {
    expect(respond(withDissent(), 1, "dissent").state.board!.direction).toBe(-1);
  });

  it("四人局照样反弹给上家：反转后座位 1 的下家就是座位 0", () => {
    const r = respond(withDissent(0, {}, 4), 1, "dissent");
    expect(r.state.pendingWindow?.actors).toEqual([0]);
  });

  it("不占 01-V7 的主动条（在别人的回合触发，没有回合可占）", () => {
    const r = respond(withDissent(), 1, "dissent");
    expect(r.state.board!.activatedThisTurn).toEqual([false, false, false]);
  });

  it("发的是 dissentUsed + turnSkipped + 新窗口三条事件", () => {
    const r = respond(withDissent(), 1, "dissent");
    expect(r.events.map((e) => e.type)).toEqual(["dissentUsed", "turnSkipped", "punishWindowOpened"]);
    expect(r.events[0].public).toEqual({ seat: 1, direction: -1 });
  });
});

describe("异议①：整局一次（01-S15 / usedOnce）", () => {
  it("用过之后 legalActions 里不再有它，再发被拒", () => {
    const first = respond(withDissent(), 1, "dissent").state;
    expect(first.board!.usedOnce![1]).toEqual({ "1": true });

    // 反弹到座位 0 的窗口里，座位 0 没有异议，本来就没这一项
    expect(choicesOf(first, 0)).not.toContain("dissent");
    // 让链再走回座位 1：座位 0 叠一张 +4，反转后的下家又是座位 1
    const s2 = {
      ...first,
      pendingWindow: { ...first.pendingWindow!, actors: [1] },
    };
    expect(choicesOf(s2, 1)).not.toContain("dissent");
    expect(respond(s2, 1, "dissent").rejected?.reason).toBe("skill_unavailable");
  });
});

describe("异议①：亮出与封印这两道门（V3 / P9）", () => {
  it("未亮出 → 没有这个选项，硬发被拒", () => {
    const s = withDissent(0, { revealed: [true, false, true] });
    expect(choicesOf(s, 1)).not.toContain("dissent");
    expect(respond(s, 1, "dissent").rejected?.reason).toBe("skill_unavailable");
  });

  it("被封印 → 同上（P9：封印含被动与响应）", () => {
    const s = withDissent(0, { statuses: [[], ["封印"], []] });
    expect(choicesOf(s, 1)).not.toContain("dissent");
    expect(respond(s, 1, "dissent").rejected?.reason).toBe("skill_unavailable");
  });

  it("没有异议的人发它照样被拒（不是「谁都能反弹」）", () => {
    expect(respond(opened(), 1, "dissent").rejected?.reason).toBe("skill_unavailable");
  });
});

// ───────────────────────────── ② 打出转获异

describe("异议②前半：打出「转」获 1 枚异", () => {
  const play = (skills: (string | null)[], face: "rev" | "skip" | "3", revealed = true) => {
    const c = card("R", face);
    const s = table([[c, card("Y", "9")], [card("Y", "1")], [card("Y", "2")]], {
      playedPile: [R7],
      drawPile: filler(20),
      currentSeat: 0,
      skills,
      revealed: skills.map(() => revealed),
    });
    return applyAction(s, { type: "playCards", seat: 0, cardIds: [c.id] }, ctx());
  };

  it("打出转 → 异 +1，并发 marksGained", () => {
    const r = play(["heart-8", null, null], "rev");
    expect(r.state.board!.marks[0]).toEqual({ 异: 1 });
    expect(r.events.find((e) => e.type === "marksGained")!.public)
      .toEqual({ seat: 0, mark: "异", n: 1, total: 1 });
  });

  it("打出停 / 数字牌 → 不获异（只有「转」算）", () => {
    expect(play(["heart-8", null, null], "skip").state.board!.marks[0]).toEqual({});
    expect(play(["heart-8", null, null], "3").state.board!.marks[0]).toEqual({});
  });

  it("未亮出打转 → 不获异（V3：没亮出的技能对局面毫无影响）", () => {
    const r = play(["heart-8", null, null], "rev", false);
    expect(r.state.board!.marks[0]).toEqual({});
    expect(r.events.some((e) => e.type === "marksGained")).toBe(false);
  });

  it("没有异议的人打转 → 不获异（对照组）", () => {
    expect(play([null, null, null], "rev").state.board!.marks[0]).toEqual({});
  });
});

// ───────────────────────────── ② 受罚弃异

describe("异议②后半：吃下时可选弃 N 枚，每枚 L2 −1", () => {
  it.each([[0, 6], [1, 5], [2, 4], [3, 3]])("弃 %i 枚 → 摸 %i 张", (n, expected) => {
    const s = withDissent(3);
    const r = respond(s, 1, n === 0 ? "accept" : `accept:${n}`);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[1]).toHaveLength(1 + expected);
    expect(r.state.board!.marks[1]).toEqual({ 异: 3 - n });
  });

  it("弃 0 走的就是那个本来就有的 accept：余额一枚不动，也不发 marksSpent", () => {
    const r = respond(withDissent(3), 1, "accept");
    expect(r.state.board!.marks[1]).toEqual({ 异: 3 });
    expect(r.state.board!.marksSpent).toBeUndefined();
    expect(r.events.some((e) => e.type === "marksSpent")).toBe(false);
  });

  it("弃 2 枚：marksSpent 记账 + 事件带余额", () => {
    const r = respond(withDissent(3), 1, "accept:2");
    expect(r.state.board!.marksSpent![1]).toEqual({ 异: 2 });
    expect(r.events.find((e) => e.type === "marksSpent")!.public)
      .toEqual({ seat: 1, mark: "异", n: 2, total: 1 });
  });

  it("弃够了就一张都不摸：6 张的链弃 6 枚 → 摸 0（异议没有 L5 下限）", () => {
    const r = respond(withDissent(6), 1, "accept:6");
    expect(r.state.board!.hands[1]).toHaveLength(1);
    expect(r.state.board!.punish).toBeUndefined();
  });

  it("弃过头也摸 0，不会摸成负数（L5 之外还有全局的 ≥0 兜底）", () => {
    const r = respond(withDissent(9), 1, "accept:9");
    expect(r.state.board!.hands[1]).toHaveLength(1);
  });
});

describe("异议②：付不起就发不了（06-Q54 的同一条纪律）", () => {
  it("异不够 → cost_unpayable，且一枚都不扣", () => {
    const r = respond(withDissent(1), 1, "accept:2");
    expect(r.rejected?.reason).toBe("cost_unpayable");
  });

  it("一枚都没有 → 档位一条都不给", () => {
    expect(choicesOf(withDissent(0), 1).filter((c) => c.startsWith("accept:"))).toEqual([]);
  });

  it("没有异议的人带档位 → cost_unpayable（choice 是客户端给的，不能信）", () => {
    expect(respond(opened({ marks: [{}, { 异: 3 }, {}] }), 1, "accept:2").rejected?.reason)
      .toBe("cost_unpayable");
  });

  it("被封印 → 手上有异也弃不了（P9 把技能整个关掉）", () => {
    const s = withDissent(3, { statuses: [[], ["封印"], []] });
    expect(choicesOf(s, 1).filter((c) => c.startsWith("accept:"))).toEqual([]);
    expect(respond(s, 1, "accept:2").rejected?.reason).toBe("cost_unpayable");
    // 弃不了，所以照吃 6 张
    expect(respond(s, 1, "accept").state.board!.hands[1]).toHaveLength(1 + 6);
  });
});

describe("异议②：超时默认弃 0——异是资源，不替玩家花", () => {
  it("窗口超时按 accept 收场：摸满 6，异一枚不少", () => {
    const s = withDissent(3);
    const r = applyAction(s, { type: "claimTimeout", seat: 2, windowId: windowIdOf(s)! }, ctxAfter(31_000));
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[1]).toHaveLength(1 + 6);
    expect(r.state.board!.marks[1]).toEqual({ 异: 3 });
  });
});

// ───────────────────────────── 交叉

describe("异议：与别的机制交叉", () => {
  it("legalActions 把 ① 与每个弃异档位都摊开给 UI", () => {
    const s = withDissent(2);
    expect(choicesOf(s, 1).sort()).toEqual(["accept", "accept:1", "accept:2", "dissent"]);
  });

  it("血棘封印先落地 → 这一次就弃不了异（同恩惠，06-Q36 的时点）", () => {
    // 链首（座位 0）亮着血棘，座位 1 吃下 → 先被封印，再算摸牌数
    const s = withDissent(3, { skills: ["diamond-2", "heart-8", null] });
    const r = respond(s, 1, "accept:2");
    expect(r.rejected?.reason).toBe("cost_unpayable");
    expect(respond(s, 1, "accept").state.board!.hands[1]).toHaveLength(1 + 6);
  });

  it("①反弹之后上家自己吃：摸的是原样的 6 张（异议不减别人）", () => {
    const bounced = respond(withDissent(), 1, "dissent").state;
    const r = respond(bounced, 0, "accept");
    expect(r.state.board!.hands[0]).toHaveLength(1 + 6);
  });

  it("远星弃「转」是代价不是打出 → 不获异（S2b 造不出同桌，用手写盘面钉住口径）", () => {
    // 座位 1 是远星，手上有一张可作代价的红转；即使他同时有异议也不该获异——
    // S2b 保证这两个技能不会同在一人身上，所以这里钉的是 `gainDissentMark` 只挂单张出牌那一处
    const rev = card("R", "rev");
    const s = opened({
      skills: [null, "diamond-j", null],
      hands: [[card("Y", "1")], [rev, card("Y", "2")], [card("Y", "3")]],
      activeColor: "R",
      punish: { initiator: 0, segments: [{ seat: 0, face: "+2", draw: 2, color: "R" }], total: 2 },
    });
    const r = applyAction(
      s, { type: "respond", seat: 1, windowId: windowIdOf(s)!, choice: "farstar", cardIds: [rev.id] }, ctx(),
    );
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.marks[1]).toEqual({});
  });
});
