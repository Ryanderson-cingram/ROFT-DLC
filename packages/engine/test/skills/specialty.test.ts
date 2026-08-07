/**
 * 专精♥9（04 ♥9 / 06-Q67 / 06-Q68）。
 * spec：`docs/superpowers/specs/2026-08-02-skills-batch-2.md` 第 10 步。
 *
 * 四条卡面挂在四个**已有的**判定点上，所以这里逐条钉的是「那个判定点确实变了」：
 * 1. 亮出时底牌定色（`Board.chosen`，与吟游的歌声共用那个槽）
 * 2. 该色 +2 **打得出但你不摸**——Q68 **逐段**免，链上贡献一张不减、下家照吃满；
 *    全免则**整个摸牌事件跳过**（不是「摸 0 张」，否则樱时雨会把它抬回 1）
 * 3. 当前色 = 你的色 → 可打**任意数字**
 * 4. 变色牌只能选你的色；免疫五彩（谁来赋都挡得住）
 */
import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../../src/index.ts";
import { canGrantStatus, grantStatus } from "../../src/skills/primitives/statuses.ts";
import { punishBase, specialtyColor } from "../../src/skills/specialty.ts";
import { card, ctx, table } from "../helpers.ts";
import type { Board, Card, Color, GameState, PunishChain } from "../../src/types.ts";

const R7 = card("R", "7");
/** 牌堆：底下那张定专精色，所以要能指定。 */
const pileWithBottom = (bottom: Card, n = 20) => [...Array.from({ length: n }, () => card("G", "9")), bottom];

/** 座位 0 持有专精（`revealed` 决定亮没亮）；`color` 直接把专精色摆好。 */
const seated = (over: Partial<Board> = {}, hand: Card[] = [card("R", "3"), card("B", "8")]): GameState =>
  table([hand, [card("Y", "1")], [card("Y", "2")]], {
    playedPile: [R7],
    drawPile: pileWithBottom(card("B", "5")),
    skills: ["heart-9", null, null],
    revealed: [true, false, false],
    ...over,
  });
/** 已亮出且专精色 = `color`。 */
const withColor = (color: Color, over: Partial<Board> = {}, hand?: Card[]) =>
  seated({ chosen: { "heart-9": { key: color, seat: 0 } }, ...over }, hand);

const chainOf = (segs: { face: "+2" | "+4"; color: Color | null; draw?: number }[]): PunishChain => ({
  initiator: 1,
  segments: segs.map((s) => ({ seat: 1, face: s.face, color: s.color, draw: s.draw ?? (s.face === "+2" ? 2 : 4) })),
  total: segs.reduce((n, s) => n + (s.draw ?? (s.face === "+2" ? 2 : 4)), 0),
});
const facing = (s: GameState, victim: number, chain: PunishChain): GameState => ({
  ...s,
  phase: "play",
  board: { ...s.board!, punish: chain, currentSeat: 1 },
  pendingWindow: {
    type: "punishStack", actors: [victim], deadline: "2026-07-28T12:00:30.000Z", defaultChoice: "accept", resume: "play",
  },
});
const eat = (s: GameState, seat: number) =>
  applyAction(s, { type: "respond", seat, windowId: `w${s.version}:punishStack`, choice: "accept" }, ctx());
const drewCounts = (r: { events: { type: string; public?: Record<string, unknown> }[] }) =>
  r.events.filter((e) => e.type === "cardsDrawn").map((e) => e.public!.count);

describe("① 亮出时底牌定色", () => {
  it("亮出那一刻取摸牌堆最底下那张的颜色，存进 chosen", () => {
    const s = seated({ revealed: [false, false, false], drawPile: pileWithBottom(card("Y", "4")) });
    const r = applyAction(s, { type: "revealSkill", seat: 0 }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.chosen).toEqual({ "heart-9": { key: "Y", seat: 0 } });
    expect(specialtyColor(r.state.board!, 0)).toBe("Y");
  });

  it("底下是无色牌就往上顺延到第一张有色的", () => {
    const s = seated({
      revealed: [false, false, false],
      drawPile: [card("G", "1"), card("R", "6"), card(null, "+4"), card(null, "wild")],
    });
    expect(applyAction(s, { type: "revealSkill", seat: 0 }, ctx()).state.board!.chosen)
      .toEqual({ "heart-9": { key: "R", seat: 0 } });
  });

  it("没亮出 / 被封印 → 没有专精色（V3 / P9）", () => {
    expect(specialtyColor(seated({ revealed: [false, false, false] }).board!, 0)).toBeUndefined();
    expect(specialtyColor(withColor("B", { statuses: [["封印"], [], []] }).board!, 0)).toBeUndefined();
    // 封印只压制、不清值：解封后还是那个色
    expect(specialtyColor(withColor("B").board!, 0)).toBe("B");
  });
});

describe("② 该色 +2 打得出但你不摸（06-Q67/Q68 逐段免）", () => {
  it("单色链全是你的色 → **整个摸牌事件跳过**，一条 cardsDrawn 都不发", () => {
    const r = eat(facing(withColor("G"), 0, chainOf([{ face: "+2", color: "G" }])), 0);
    expect(r.rejected).toBeUndefined();
    expect(drewCounts(r)).toEqual([]);
    expect(r.state.board!.hands[0]).toHaveLength(2); // 一张没摸
    expect(r.state.board!.punish).toBeUndefined();
  });

  it("混色链逐段免：绿 +2 免掉、红 +2 照吃 → 摸 2（Q68 的原例）", () => {
    const chain = chainOf([{ face: "+2", color: "G" }, { face: "+2", color: "R" }]);
    expect(drewCounts(eat(facing(withColor("G"), 0, chain), 0))).toEqual([2]);
  });

  it("+4 不适用（无色牌没有「该色」可谈）", () => {
    const chain = chainOf([{ face: "+4", color: null }, { face: "+2", color: "G" }]);
    expect(drewCounts(eat(facing(withColor("G"), 0, chain), 0))).toEqual([4]);
  });

  it("按**段贡献**免，段里已含强袭倍率（绿 +2 被掷成 4 张 → 免掉的是 4）", () => {
    const chain = chainOf([{ face: "+2", color: "G", draw: 4 }, { face: "+2", color: "R" }]);
    expect(drewCounts(eat(facing(withColor("G"), 0, chain), 0))).toEqual([2]);
  });

  it("链上贡献一张不减：**下家**照吃满（免摸只发生在受罚侧读它的那一刻）", () => {
    const chain = chainOf([{ face: "+2", color: "G" }, { face: "+2", color: "G" }]);
    // 专精在座位 0；换成座位 2 吃 → 4 张一张不少
    expect(drewCounts(eat(facing(withColor("G"), 2, chain), 2))).toEqual([4]);
    expect(punishBase(withColor("G").board!, 2, chain)).toEqual({ base: 4, skip: false });
  });

  it("判据本身：过滤掉的是「你的色 + 面值 +2」那几段", () => {
    const b = withColor("G").board!;
    expect(punishBase(b, 0, chainOf([{ face: "+2", color: "G" }]))).toEqual({ base: 0, skip: true });
    expect(punishBase(b, 0, chainOf([{ face: "+2", color: "R" }]))).toEqual({ base: 2, skip: false });
    // 没有专精色的人：原样返回，且**不会**误判成「全免」
    expect(punishBase(seated({ revealed: [false, false, false] }).board!, 0, chainOf([{ face: "+2", color: "G" }])))
      .toEqual({ base: 2, skip: false });
  });

  it("全免 ≠ 摸 0：跳过整个事件，所以樱时雨那类覆盖也抬不回来（06-Q27 口径）", () => {
    const singing = withColor("G", {
      skills: ["heart-9", "club-5", null],
      revealed: [true, true, false],
      chosen: { "heart-9": { key: "G", seat: 0 }, "club-5": { key: "樱时雨", seat: 1 } },
    });
    expect(drewCounts(eat(facing(singing, 0, chainOf([{ face: "+2", color: "G" }])), 0))).toEqual([]);
  });
});

describe("③ 当前色 = 你的色 → 可打任意数字", () => {
  it("跟色正好是专精色时，接不上的数字牌也打得出", () => {
    const b8 = card("B", "8");
    const s = withColor("R", {}, [b8, card("Y", "2")]); // 牌顶红 7，跟色 R = 专精色
    expect(legalActions(s, 0).filter((a) => a.type === "playCards").map((a) => a.cardIds[0]))
      .toEqual(expect.arrayContaining([b8.id]));
    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [b8.id] }, ctx()).rejected).toBeUndefined();
  });

  it("只放宽**数字牌**：功能牌照旧要接得上", () => {
    const skip = card("B", "skip");
    const s = withColor("R", {}, [skip, card("Y", "2")]);
    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [skip.id] }, ctx()).rejected?.reason)
      .toBe("illegal_card");
  });

  it("跟色不是你的色时一切照旧（对照组）", () => {
    const b8 = card("B", "8");
    const s = withColor("G", {}, [b8, card("Y", "2")]);
    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [b8.id] }, ctx()).rejected?.reason)
      .toBe("illegal_card");
  });
});

describe("④ 变色牌只能选你的色 + 免疫五彩", () => {
  it("定色只能定成专精色，别的色一律拒", () => {
    const w = card(null, "wild");
    const s = withColor("G", {}, [w, card("R", "3")]);
    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [w.id], chosenColor: "R" }, ctx()).rejected?.reason)
      .toBe("color_locked");
    const ok = applyAction(s, { type: "playCards", seat: 0, cardIds: [w.id], chosenColor: "G" }, ctx());
    expect(ok.rejected).toBeUndefined();
    expect(ok.state.board!.activeColor).toBe("G");
  });

  it("免疫五彩：谁来赋都挡得住（八门②的回合末赋状态也不例外）", () => {
    const b = withColor("G").board!;
    expect(canGrantStatus(b, 0, "五彩")).toBe(false);
    expect(grantStatus(b, 0, "五彩").statuses[0]).toEqual([]);
    // 别的状态照赋（免疫是逐个状态写在数据里的，不是「免疫一切」）
    expect(canGrantStatus(b, 0, "心盲")).toBe(true);
    // 没亮出 → 没有免疫
    expect(canGrantStatus(seated({ revealed: [false, false, false] }).board!, 0, "五彩")).toBe(true);
  });

  it("八门②在回合末给同桌的专精者挂五彩 → 挂不上（整条路自动生效，不用改八门）", () => {
    const s = withColor("G", {
      skills: ["heart-9", "spade-8", null],
      revealed: [true, true, false],
      currentSeat: 1,
      hands: [[card("R", "3")], [card("R", "4"), card("Y", "9")], [card("Y", "2")]],
    });
    // 座位 1（八门）打出红 4 交回合 → 他自己获五彩，座位 0 不受影响
    const r = applyAction(s, { type: "playCards", seat: 1, cardIds: [s.board!.hands[1][0].id] }, ctx());
    expect(r.state.board!.statuses[1]).toEqual(["五彩"]);
    expect(r.state.board!.statuses[0]).toEqual([]);
  });
});
