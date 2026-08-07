/**
 * 摸 N 弃 N（03 §2）——**一个窗口**：一次摸满 N 张，再从摸完之后的整副手牌里挑 N 张弃掉。
 *
 * 洗牌②的「摸一弃一」是 N = 1 的特例，它那一路走 `playCards` 的完整流程，
 * 钉在 `shuffle-card.test.ts`；这里钉的是 **N > 1** 与各条边界，直接调 `openDrawDiscard`
 * ——第 4 步的忍戒♠J、第 5 步的八门♠8 接上来之前，那条路上没有别的入口。
 */
import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../../src/index.ts";
import { openDrawDiscard } from "../../src/actions/draw-discard.ts";
import { SKILL_DATA } from "../../src/skills/draw-passives.ts";
import { card, ctx, lcg, NOW, table } from "../helpers.ts";
import type { DrawModifier } from "../../src/skills/primitives/draw-modifier.ts";
import type { ApplyResult, Card, GameState } from "../../src/types.ts";

const R7 = card("R", "7");
/** 牌堆：牌面无所谓，只看张数与 id。 */
const pile = (n: number) => Array.from({ length: n }, () => card("G", "9"));
const KEEP = () => [card("R", "1"), card("R", "2"), card("B", "5")];

/**
 * 座位 0 手上 3 张、牌顶是数字牌，直接开一个摸 n 弃 n 的窗口。
 * `resume: afterFace` = 弃完接着跑这次出牌的收尾（洗牌②那一支），所以牌顶那张就是「刚打出的」。
 */
function open(n: number, opts: { pile?: Card[]; hand?: Card[]; mods?: DrawModifier[] } = {}): ApplyResult {
  const s = table([opts.hand ?? KEEP(), [card("Y", "3"), card("Y", "4")], [card("B", "6"), card("B", "7")]], {
    playedPile: [R7],
    drawPile: opts.pile ?? pile(10),
  });
  return openDrawDiscard(
    s, s.board!, 0, { kind: "skill", base: n, seat: 0 }, { kind: "afterFace" },
    ctx(), [], SKILL_DATA, opts.mods ?? [],
  );
}

const wid = (s: GameState) => `w${s.version}:drawDiscard`;
const discard = (s: GameState, cardIds: string[], seat = 0) =>
  applyAction(s, { type: "respond", seat, windowId: wid(s), choice: "discard", cardIds }, ctx());
/** 刚摸到的那几张（手牌尾部）。 */
const drawnOf = (s: GameState, n: number) => s.board!.hands[0].slice(-n).map((c) => c.id);

describe("摸 N 弃 N · 开窗口", () => {
  it("一次摸满 N 张再开一个窗口——不是 N 个「摸 1 弃 1」", () => {
    const r = open(3);
    expect(r.state.pendingWindow?.type).toBe("drawDiscard");
    expect(r.state.pendingWindow?.actors).toEqual([0]);
    expect(r.state.board!.hands[0]).toHaveLength(6); // 原有 3 + 摸的 3
    expect(r.state.board!.drawDiscard).toMatchObject({ seat: 0, picks: 3 });
    // 摸牌事件只有一条（一次摸满，不是三次）
    expect(r.events.filter((e) => e.type === "cardsDrawn")).toHaveLength(1);
    expect(r.events.filter((e) => e.type === "drawDiscardOpened")).toHaveLength(1);
  });

  it("摸到的牌 id 绝不进公开的窗口（超时走哨兵）", () => {
    const r = open(3);
    expect(r.state.pendingWindow?.defaultChoice).toBe("drawn");
    const opened = r.events.find((e) => e.type === "drawDiscardOpened")!;
    expect(opened.public).toEqual({ windowId: wid(r.state), seat: 0, picks: 3, deadline: r.state.pendingWindow!.deadline });
    // 中间态记着刚摸的那几张，但它是暗信息：谁的快照里都没有
    expect(r.state.board!.drawDiscard!.drawnIds).toEqual(drawnOf(r.state, 3));
    for (const viewer of [0, 1, 2]) {
      expect(projectView(r.state, viewer).drawDiscard).toEqual({ seat: 0, picks: 3 });
      expect(JSON.stringify(projectView(r.state, viewer))).not.toContain("drawnIds");
    }
  });

  it("组合不进 legalActions（会爆炸），只给一条模板", () => {
    const r = open(3);
    const acts = legalActions(r.state, 0).filter((a) => a.type === "respond");
    expect(acts).toEqual([{ type: "respond", seat: 0, windowId: wid(r.state), choice: "discard", cardIds: [] }]);
    // 别人在这个窗口里没有任何 respond
    expect(legalActions(r.state, 1).filter((a) => a.type === "respond")).toEqual([]);
  });

  it("摸那 N 张走层级（spec §5.3）：L2 修正抬高**摸**的张数，**弃**的张数照牌面不变", () => {
    const r = open(3, { mods: [{ layer: "L2", source: "test", delta: 1 }] });
    expect(r.state.board!.hands[0]).toHaveLength(7); // 原有 3 + 摸的 4
    expect(r.state.board!.drawDiscard!.picks).toBe(3);
    expect(r.state.board!.drawDiscard!.drawnIds).toHaveLength(4);
  });
});

describe("摸 N 弃 N · 弃", () => {
  it("从摸完之后的**整副手牌**里挑：刚摸的与原本就有的混着弃，全进弃牌堆", () => {
    const r = open(3);
    const hand = r.state.board!.hands[0];
    const ids = [hand[0].id, hand[1].id, hand[5].id]; // 两张原有的 + 一张刚摸的
    const done = discard(r.state, ids);

    expect(done.rejected).toBeUndefined();
    const b = done.state.board!;
    expect(b.hands[0]).toHaveLength(3);
    expect(b.hands[0].map((c) => c.id)).not.toEqual(expect.arrayContaining(ids));
    expect(b.discardPile.map((c) => c.id)).toEqual(ids);
    // 06-Q55：弃牌不改牌顶也不改跟色
    expect(b.playedPile[0]).toEqual(R7);
    expect(b.activeColor).toBe("R");
    expect(b.drawDiscard).toBeUndefined();
    expect(done.state.pendingWindow).toBeUndefined();
    expect(done.events.find((e) => e.type === "cardsDiscarded")!.public).toMatchObject({ seat: 0 });
  });

  it("弃完接着跑收尾：回合交给下家", () => {
    const r = open(3);
    const done = discard(r.state, r.state.board!.hands[0].slice(0, 3).map((c) => c.id));
    expect(done.state.board!.currentSeat).toBe(1);
    expect(done.state.phase).toBe("turnStart");
  });

  it("张数不对一律拒：少一张 / 多一张 / 一张不弃", () => {
    const r = open(3);
    const hand = r.state.board!.hands[0];
    for (const ids of [
      hand.slice(0, 2).map((c) => c.id),
      hand.slice(0, 4).map((c) => c.id),
      [],
    ])
      expect(discard(r.state, ids).rejected?.reason, `${ids.length} 张`).toBe("bad_shape");
  });

  it("同一张报两遍要拒——放过就是白赚一张（弃 3 只掉 2）", () => {
    const r = open(3);
    const hand = r.state.board!.hands[0];
    expect(discard(r.state, [hand[0].id, hand[0].id, hand[1].id]).rejected?.reason).toBe("bad_shape");
  });

  it("牌不在自己手上要拒：不存在的 id、以及**别人**手上的牌", () => {
    const r = open(3);
    const hand = r.state.board!.hands[0];
    const other = r.state.board!.hands[1][0].id;
    expect(discard(r.state, [hand[0].id, hand[1].id, "nope"]).rejected?.reason).toBe("not_in_hand");
    expect(discard(r.state, [hand[0].id, hand[1].id, other]).rejected?.reason).toBe("not_in_hand");
  });

  it("choice 乱填要拒（哨兵与 discard 之外都不是合法提交）", () => {
    const r = open(3);
    const ids = r.state.board!.hands[0].slice(0, 3).map((c) => c.id);
    expect(
      applyAction(r.state, { type: "respond", seat: 0, windowId: wid(r.state), choice: "yolo", cardIds: ids }, ctx())
        .rejected?.reason,
    ).toBe("bad_choice");
  });

  it("窗口只开给他一个：别人提交是 not_your_window", () => {
    const r = open(3);
    expect(discard(r.state, r.state.board!.hands[1].map((c) => c.id), 1).rejected?.reason).toBe("not_your_window");
  });
});

describe("摸 N 弃 N · 超时", () => {
  it("按哨兵弃掉**刚摸的那 N 张**，原有的一张不动", () => {
    const r = open(3);
    const before = r.state.board!.hands[0];
    const drawn = drawnOf(r.state, 3);
    const late = ctx(lcg(1), new Date(Date.parse(NOW) + 60_000).toISOString());
    const done = applyAction(r.state, { type: "claimTimeout", seat: 1, windowId: wid(r.state) }, late);

    const b = done.state.board!;
    expect(b.hands[0].map((c) => c.id)).toEqual(before.slice(0, 3).map((c) => c.id));
    expect(b.discardPile.map((c) => c.id)).toEqual(drawn);
    expect(done.state.pendingWindow).toBeUndefined();
  });

  it("摸的比要弃的多时（L2 抬高），超时只弃前 picks 张，多摸的留在手上", () => {
    const r = open(3, { mods: [{ layer: "L2", source: "test", delta: 2 }] });
    expect(r.state.board!.hands[0]).toHaveLength(8); // 原有 3 + 摸的 5
    const late = ctx(lcg(1), new Date(Date.parse(NOW) + 60_000).toISOString());
    const done = applyAction(r.state, { type: "claimTimeout", seat: 1, windowId: wid(r.state) }, late);

    expect(done.state.board!.hands[0]).toHaveLength(5);
    expect(done.state.board!.discardPile.map((c) => c.id)).toEqual(r.state.board!.drawDiscard!.drawnIds.slice(0, 3));
  });
});

describe("摸 N 弃 N · 牌堆见底（03 §2「摸到手里的不能少于弃的」）", () => {
  it("只摸到 2 张 → 只弃 2 张（picks 跟着下调）", () => {
    // 牌堆只剩 2 张，出牌堆只有牌顶（洗不回任何东西），弃牌堆空 → 摸满 2 张就没了
    const r = open(3, { pile: pile(2) });
    expect(r.state.board!.hands[0]).toHaveLength(5);
    expect(r.state.board!.drawDiscard!.picks).toBe(2);
    // 这时候交 3 张反而是错的
    const hand = r.state.board!.hands[0];
    expect(discard(r.state, hand.slice(0, 3).map((c) => c.id)).rejected?.reason).toBe("bad_shape");
    const done = discard(r.state, hand.slice(0, 2).map((c) => c.id));
    expect(done.rejected).toBeUndefined();
    expect(done.state.board!.hands[0]).toHaveLength(3);
  });

  it("一张都摸不到 → 不开窗口、不弃牌，直接跑收尾", () => {
    const r = open(3, { pile: [] });
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.drawDiscard).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(3);
    expect(r.state.board!.discardPile).toEqual([]);
    expect(r.state.board!.currentSeat).toBe(1);
  });
});
