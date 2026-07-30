// 精英♥3：把一张数字牌**当作大 1 点**打出（最大 9），牌照常按牌面进牌顶。
// 规则：04 ♥3 + 03 Q&A；2026-07-29 裁定——主动（用不用自己选，原 Q45）、
// 占 V7 额度、只对数字牌有效（原 Q28）。数值 { card_value: 1, max: 9 } 来自定义数据。
import { describe, expect, it } from "vitest";
import { isPlayable, legalActions } from "../../src/index.ts";
import { playCards } from "../../src/actions/play-cards.ts";
import type { Board, GameState } from "../../src/types.ts";
import { card, ctx, table } from "../helpers.ts";

/** 牌顶红 4；座位 0 持精英并已亮出，手上有蓝 3（当作蓝 4 才打得出去）。 */
const elite = (over: Partial<Board> = {}, state: Partial<GameState> = {}) =>
  table([[card("B", "3"), card("Y", "8")], [card("Y", "1")], [card("Y", "2")]], {
    discardPile: [card("R", "4")],
    skills: ["heart-3", null, null],
    revealed: [true, false, false],
    ...over,
  }, state);

const play = (s: GameState, useSkill = true, i = 0) =>
  playCards(s, { seat: 0, cardIds: [s.board!.hands[0][i].id], useSkill }, ctx());

describe("精英♥3：数字牌当作大 1 点", () => {
  it("牌顶红 4，蓝 3 当作蓝 4 打出——颜色对不上正是它的用武之地", () => {
    const r = play(elite());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(1);
  });

  it("牌顶按**牌面**记作蓝 3，下家跟的是蓝 3 不是蓝 4", () => {
    const b = play(elite()).state.board!;
    expect(b.discardPile[0].face).toBe("3");
    expect(b.activeColor).toBe("B");
    // 下家可以跟蓝色、也可以跟牌面 3；跟不了 4——被当作的那个点数不留在桌上
    expect(isPlayable(card("B", "7"), b.discardPile[0], b.activeColor)).toBe(true);
    expect(isPlayable(card("Y", "3"), b.discardPile[0], b.activeColor)).toBe(true);
    expect(isPlayable(card("Y", "4"), b.discardPile[0], b.activeColor)).toBe(false);
  });

  it("不带 useSkill 就不生效——它是主动，不自动帮你圆牌", () => {
    expect(play(elite(), false).rejected).toEqual({ reason: "illegal_card" });
  });

  it("发动后占掉本回合的主动额度（V7）", () => {
    const b = play(elite()).state.board!;
    // 出牌即交出回合，passTurn 会清空；所以查的是「这一手确实记过账」——事件是唯一留痕
    expect(b.currentSeat).toBe(1);
    expect(play(elite()).events[0]).toMatchObject({ type: "skillActivated", public: { skillId: "heart-3", effectKey: "1" } });
  });

  it("本回合已发动过主动，就再也用不了精英", () => {
    expect(play(elite({ activatedThisTurn: [true, false, false] })).rejected).toEqual({ reason: "already_activated" });
  });
});

describe("精英的边界", () => {
  it("9 不能当作 10——上限 9 来自定义里的 values.max", () => {
    const s = elite({ hands: [[card("B", "9"), card("Y", "8")], [], []], discardPile: [card("R", "0")] });
    expect(play(s).rejected).toEqual({ reason: "illegal_card" });
  });

  it("只剩 1 张手牌时失效（04 ♥3）", () => {
    const s = elite({ hands: [[card("B", "3")], [card("Y", "1")], [card("Y", "2")]] });
    expect(play(s).rejected).toEqual({ reason: "illegal_card" });
  });

  it("未亮出不生效（V3）", () => {
    expect(play(elite({ revealed: [false, false, false] })).rejected).toEqual({ reason: "illegal_card" });
  });

  it("被封印时不生效（P9 / 02 §2 压制层）", () => {
    expect(play(elite({ statuses: [["封印"], [], []] })).rejected).toEqual({ reason: "illegal_card" });
  });

  it("功能牌加不了点数（原 Q28：只对数字牌有效）", () => {
    const s = elite({ hands: [[card("B", "+2"), card("Y", "8")], [], []], discardPile: [card("R", "3")] });
    expect(play(s).rejected).toEqual({ reason: "illegal_card" });
  });

  it("牌顶是功能牌时也帮不上——没有点数可跟", () => {
    const s = elite({ hands: [[card("B", "3"), card("Y", "8")], [], []], discardPile: [card("R", "skip")] });
    expect(play(s).rejected).toEqual({ reason: "illegal_card" });
  });

  it("加点后差得更远也不行：牌顶红 7，蓝 3 只能当 4", () => {
    expect(play(elite({ discardPile: [card("R", "7")] })).rejected).toEqual({ reason: "illegal_card" });
  });

  it("本来就能打的牌不吃额度，也不发技能事件", () => {
    const s = elite({ hands: [[card("R", "9"), card("Y", "8")], [], []], discardPile: [card("R", "4")] });
    const r = play(s); // 同色，本来就合法
    expect(r.rejected).toBeUndefined();
    expect(r.events[0].type).toBe("cardPlayed");
  });

  it("惩罚链未结算时，精英救不了——数字牌不是合法叠牌（P3）", () => {
    const s = elite({ punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2 }], total: 2 } });
    expect(play(s).rejected).toEqual({ reason: "must_stack" });
  });

  it("没有精英的人带 useSkill 也没用", () => {
    expect(play(elite({ skills: [null, null, null] })).rejected).toEqual({ reason: "illegal_card" });
  });
});

describe("legalActions 把精英能打的牌单列出来", () => {
  it("蓝 3 以 useSkill 的形式出现，普通出牌里没有它", () => {
    const s = elite();
    const acts = legalActions(s, 0).filter((a) => a.type === "playCards");
    expect(acts).toContainEqual({ type: "playCards", seat: 0, cardIds: [s.board!.hands[0][0].id], useSkill: true });
    expect(acts.filter((a) => !("useSkill" in a && a.useSkill))).toHaveLength(0);
  });

  it("没亮出时不列（V3）", () => {
    const s = elite({ revealed: [false, false, false] });
    expect(legalActions(s, 0).filter((a) => a.type === "playCards")).toHaveLength(0);
  });
});
