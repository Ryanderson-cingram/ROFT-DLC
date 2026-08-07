/**
 * 近卫♥6（04 ♥6 / 01-P11/P12 / 02 §7 L6）。
 * spec：`docs/superpowers/specs/2026-08-02-skills-batch-2.md` 第 7 步。
 *
 * 「受 ≥4 惩罚时，每张 +2/+4 可交 1 张手牌给**链首**。」它是第二支 L6 后置程序，
 * 整条路复用忍戒那一套：定义声明 → `drawModifiersFor` 采集 → `punish.ts` 吃牌路径消费。
 *
 * 五条要害：
 * 1. 门槛看**链上贡献总和**（P11 的那个数），4 张以下不给
 * 2. 最多交**段数 × 1** 张，可以少交、也可以不交（「**可**交」）
 * 3. 交的是**自己手牌**、给**链首**（P12）；链首是自己时不成立
 * 4. 交完（或不交）才交回合——U6 的声明按最终手牌数结算
 * 5. 只公开**张数**：交出去的牌进了链首的手，内容只有他们两个知道
 */
import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../../src/index.ts";
import { card, ctx, lcg, NOW, table } from "../helpers.ts";
import type { Board, GameState, PunishChain } from "../../src/types.ts";

const R7 = card("R", "7");
const filler = (n: number) => Array.from({ length: n }, () => card("G", "9"));
/** 座位 1 的起手 3 张。 */
const HAND1 = () => [card("Y", "1"), card("Y", "5"), card("B", "6")];

/** n 段 +2 的链，链首是座位 0；贡献总和 2n。 */
const chainOf = (n: number, draw = 2, initiator = 0): PunishChain => ({
  initiator,
  segments: Array.from({ length: n }, () => ({ seat: initiator, face: "+2" as const, draw, color: "R" as const })),
  total: n * draw,
});

/** 座位 1 面前挂着惩罚窗口等他吃；链首是座位 0。 */
function opened(over: Partial<Board> = {}, skills: (string | null)[] = [null, "heart-6", null]): GameState {
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
      type: "punishStack", actors: [1], deadline: "2026-07-28T12:00:30.000Z", defaultChoice: "accept", resume: "play",
    },
  };
}

const eat = (s: GameState) =>
  applyAction(s, { type: "respond", seat: 1, windowId: `w${s.version}:punishStack`, choice: "accept" }, ctx());
const give = (s: GameState, cardIds: string[], seat = 1) =>
  applyAction(s, { type: "respond", seat, windowId: `w${s.version}:handOver`, choice: "give", cardIds }, ctx());
const keep = (s: GameState, seat = 1) =>
  applyAction(s, { type: "respond", seat, windowId: `w${s.version}:handOver`, choice: "keep" }, ctx());

describe("近卫♥6：吃完 ≥4 的惩罚之后，可以交牌给链首", () => {
  it("摸完才开窗口，且回合还没交出去", () => {
    const r = eat(opened()); // 链上 2 段、贡献 4
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[1]).toHaveLength(3 + 4); // 惩罚照常摸满，L6 不改数字
    expect(r.state.pendingWindow?.type).toBe("handOver");
    expect(r.state.pendingWindow?.actors).toEqual([1]);
    // 每张 +2/+4 交 1 张 → 2 段就是最多 2 张；交给链首（座位 0）
    expect(r.state.board!.handOver).toEqual({ seat: 1, target: 0, max: 2 });
    expect(r.state.board!.currentSeat).toBe(0);
    // 里面没有暗信息，原样投给所有人
    for (const viewer of [0, 1, 2])
      expect(projectView(r.state, viewer).handOver).toEqual({ seat: 1, target: 0, max: 2 });
  });

  it("交 2 张 → 牌真的进了链首手里，回合随即交出去", () => {
    const r = eat(opened());
    const hand = r.state.board!.hands[1];
    const ids = [hand[0].id, hand[1].id];
    const done = give(r.state, ids);

    expect(done.rejected).toBeUndefined();
    expect(done.state.board!.hands[1]).toHaveLength(3 + 4 - 2);
    expect(done.state.board!.hands[1].map((c) => c.id)).not.toEqual(expect.arrayContaining(ids));
    expect(done.state.board!.hands[0].map((c) => c.id).slice(-2)).toEqual(ids);
    // 弃牌堆一张没进——交牌不是弃牌
    expect(done.state.board!.discardPile).toEqual([]);
    expect(done.state.board!.currentSeat).toBe(2);
    expect(done.state.phase).toBe("turnStart");
    expect(done.state.board!.handOver).toBeUndefined();
  });

  it("公开的只有张数：事件里没有牌，别人的快照里也搜不到那几张", () => {
    const r = eat(opened());
    const ids = r.state.board!.hands[1].slice(0, 2).map((c) => c.id);
    const done = give(r.state, ids);
    const ev = done.events.find((e) => e.type === "cardsHandedOver")!;
    expect(ev.public).toEqual({ seat: 1, target: 0, count: 2 });
    for (const id of ids) expect(JSON.stringify(ev.public)).not.toContain(id);
    // 交过去之后那几张是**链首**的暗牌：座位 2 看不见
    for (const id of ids) expect(JSON.stringify(projectView(done.state, 2))).not.toContain(id);
  });

  it("可以少交（1 张），也可以不交；不交与超时同一条路", () => {
    const r = eat(opened());
    const one = give(r.state, [r.state.board!.hands[1][0].id]);
    expect(one.rejected).toBeUndefined();
    expect(one.state.board!.hands[0]).toHaveLength(2);
    expect(one.state.board!.currentSeat).toBe(2);

    const kept = keep(eat(opened()).state);
    expect(kept.state.board!.hands[0]).toHaveLength(1);
    expect(kept.state.board!.hands[1]).toHaveLength(3 + 4);
    expect(kept.state.board!.currentSeat).toBe(2);

    const late = ctx(lcg(1), new Date(Date.parse(NOW) + 60_000).toISOString());
    const s = eat(opened()).state;
    const timedOut = applyAction(s, { type: "claimTimeout", seat: 0, windowId: `w${s.version}:handOver` }, late);
    expect(timedOut.state.board!.hands[0]).toHaveLength(1);
    expect(timedOut.state.board!.currentSeat).toBe(2);
  });

  it("窗口里两条动作（模板 + 不交），别人插不进来", () => {
    const s = eat(opened()).state;
    const wid = `w${s.version}:handOver`;
    expect(legalActions(s, 1).filter((a) => a.type === "respond")).toEqual([
      { type: "respond", seat: 1, windowId: wid, choice: "give", cardIds: [] },
      { type: "respond", seat: 1, windowId: wid, choice: "keep" },
    ]);
    expect(legalActions(s, 0).filter((a) => a.type === "respond")).toEqual([]);
    expect(give(s, [s.board!.hands[0][0].id], 0).rejected?.reason).toBe("not_your_window");
  });

  it("硬校验：超过上限 / 一张都不填 / 重复 / 不在自己手上，一律拒", () => {
    const s = eat(opened()).state;
    const hand = s.board!.hands[1];
    expect(give(s, hand.slice(0, 3).map((c) => c.id)).rejected?.reason).toBe("bad_shape"); // max 是 2
    expect(give(s, []).rejected?.reason).toBe("bad_shape"); // 不交请走 keep
    expect(give(s, [hand[0].id, hand[0].id]).rejected?.reason).toBe("bad_shape");
    expect(give(s, [hand[0].id, s.board!.hands[2][0].id]).rejected?.reason).toBe("not_in_hand");
    expect(applyAction(s, { type: "respond", seat: 1, windowId: `w${s.version}:handOver`, choice: "yolo" }, ctx())
      .rejected?.reason).toBe("bad_choice");
  });
});

describe("近卫：门槛与上限都从定义读（04 ♥6 的 values）", () => {
  it.each([
    { segs: 1, total: 2, open: false }, // 贡献 2 < 门槛 4
    { segs: 2, total: 4, open: true, max: 2 },
    { segs: 3, total: 6, open: true, max: 3 },
  ])("链上 $segs 段（贡献 $total）→ 开窗口 = $open", ({ segs, open, max }) => {
    const r = eat(opened({ punish: chainOf(segs) }));
    expect(r.state.board!.handOver !== undefined).toBe(open);
    if (open) expect(r.state.board!.handOver!.max).toBe(max);
    if (!open) expect(r.state.board!.currentSeat).toBe(2); // 不开窗口就直接交回合
  });

  it("单张 +4 也够门槛（4 = 一段贡献 4）：最多交 1 张", () => {
    const chain: PunishChain = {
      initiator: 0,
      segments: [{ seat: 0, face: "+4", draw: 4, color: null }],
      total: 4,
    };
    expect(eat(opened({ punish: chain })).state.board!.handOver).toEqual({ seat: 1, target: 0, max: 1 });
  });

  it("上限还受手牌数限制：手上只剩 1 张就最多交 1 张", () => {
    const r = eat(opened({ hands: [[card("R", "3")], [card("Y", "1")], [card("Y", "2")]], drawPile: [] }));
    // 牌堆空 → 惩罚一张都没摸到，手上还是那 1 张
    expect(r.state.board!.hands[1]).toHaveLength(1);
    expect(r.state.board!.handOver!.max).toBe(1);
  });

  it("手上一张都没有 → 不开窗口", () => {
    const r = eat(opened({ hands: [[card("R", "3")], [], [card("Y", "2")]], drawPile: [] }));
    expect(r.state.board!.handOver).toBeUndefined();
    expect(r.state.board!.currentSeat).toBe(2);
  });
});

describe("近卫：什么时候**不**触发", () => {
  it("链首就是自己（链绕回来了）→ 不成立，同 P8「不封自己」的口径", () => {
    const r = eat(opened({ punish: chainOf(2, 2, 1) }));
    expect(r.state.board!.handOver).toBeUndefined();
    expect(r.state.board!.currentSeat).toBe(2);
  });

  it("未亮出 → 不生效（V3）", () => {
    expect(eat(opened({ revealed: [false, false, false] })).state.board!.handOver).toBeUndefined();
  });

  it("被封印 → 不生效（P9 封印含被动）", () => {
    expect(eat(opened({ statuses: [[], ["封印"], []] })).state.board!.handOver).toBeUndefined();
  });

  it("是别人在受罚 → 不触发（targeting: self）", () => {
    expect(eat(opened({}, [null, null, "heart-6"])).state.board!.handOver).toBeUndefined();
  });

  it("L6 不改摸牌数：带近卫与不带近卫，摸到的张数一模一样", () => {
    const withGuard = eat(opened());
    const without = eat(opened({}, [null, null, null]));
    const drawn = (r: { events: { type: string; public?: Record<string, unknown> }[] }) =>
      r.events.filter((e) => e.type === "cardsDrawn").map((e) => e.public!.count);
    expect(drawn(withGuard)).toEqual([4]);
    expect(drawn(without)).toEqual([4]);
  });
});
