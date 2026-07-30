// 恒心♠1 与恩惠♥1：从 JSON 定义到牌桌行为的整条链路。
// 规则：01 §4 V3/V4/V7/V8、T1、P11；02 §7 的 L2/L5；04 的两条摘要。
// 本文件的立身之本是最后一组「数据驱动」——技能的数值与层级来自定义数据，
// 改数据行为就变，引擎代码一行不动。
import { describe, expect, it } from "vitest";
import { activateSkill } from "../../src/actions/skill.ts";
import { applyAction } from "../../src/index.ts";
import { drawModifiersFor, SKILL_DATA } from "../../src/skills/draw-passives.ts";
import { resolveDrawCount } from "../../src/skills/primitives/draw-modifier.ts";
import type { SkillData } from "../../src/skills/draw-passives.ts";
import type { SkillDef, SkillEffect } from "../../src/skills/types.ts";
import type { Board, GameState, PunishChain } from "../../src/types.ts";
import { card, ctx, table } from "../helpers.ts";

const hand = (n: number) => Array.from({ length: n }, () => card("B", "5"));

/** 座位 0 持有 skill 并已亮出（V3：亮出才生效）。 */
const seated = (skill: string, over: Partial<Board> = {}, state: Partial<GameState> = {}) =>
  table([[card("R", "3"), card("R", "4")], [card("Y", "1")], [card("Y", "2")]], {
    skills: [skill, null, null],
    revealed: [true, false, false],
    drawPile: hand(20),
    ...over,
  }, state);

/** 一条已经攒好的惩罚链，等座位 0 吃下。P11：total 是各段贡献的加总。 */
const chain = (...draws: number[]): PunishChain => ({
  initiator: 1,
  segments: draws.map((d, i) => ({ seat: i === 0 ? 1 : 2, face: d === 4 ? "+4" as const : "+2" as const, draw: d })),
  total: draws.reduce((a, b) => a + b, 0),
});

/** 摆一个「座位 0 面前有惩罚窗口，等他 accept」的局面。currentSeat 是打出惩罚牌的人。 */
const facingPunish = (skill: string | null, over: Partial<Board> = {}, ...draws: number[]) =>
  table([[], [card("Y", "1")], [card("Y", "2")]], {
    skills: [skill, null, null],
    revealed: [skill !== null, false, false],
    drawPile: hand(30),
    punish: chain(...(draws.length ? draws : [2])),
    currentSeat: 1,
    ...over,
  }, {
    phase: "afterPlay",
    pendingWindow: {
      type: "punishStack",
      actors: [0],
      deadline: "2026-07-28T12:00:30.000Z",
      defaultChoice: "accept",
      resume: "play",
    },
  });

const eat = (s: GameState) =>
  applyAction(s, { type: "respond", seat: 0, windowId: "w10:punishStack", choice: "accept" }, ctx());

// ---------------------------------------------------------------- 恒心♠1

describe("恒心♠1：主动，弃 1 摸 1", () => {
  const activate = (s: GameState, cardIds?: string[]) =>
    applyAction(s, { type: "activateSkill", seat: 0, effectKey: "1", ...(cardIds && { cardIds }) }, ctx());

  it("弃掉指定的那张、摸进 1 张：手牌总数不变，弃的牌确实离手", () => {
    const s = seated("spade-1");
    const discarded = s.board!.hands[0][0];
    const r = activate(s, [discarded.id]);
    expect(r.rejected).toBeUndefined();
    const h = r.state.board!.hands[0];
    expect(h).toHaveLength(2);
    expect(h.some((c) => c.id === discarded.id)).toBe(false);
    expect(r.state.board!.drawPile).toHaveLength(19);
  });

  it("弃 ≠ 出牌：弃牌堆顶与当前颜色都不受影响", () => {
    const s = seated("spade-1");
    const before = s.board!.discardPile[0];
    const r = activate(s, [s.board!.hands[0][0].id]);
    expect(r.state.board!.discardPile[0]).toEqual(before);
    expect(r.state.board!.activeColor).toBe(s.board!.activeColor);
  });

  it("摸到的牌不进 drawnPlayable：技能摸牌不是 U1 的「摸一张」，本回合照常出牌", () => {
    const s = seated("spade-1");
    expect(activate(s, [s.board!.hands[0][0].id]).state.board!.drawnPlayable).toBeNull();
  });

  it("V7：发动占掉本回合那一条主动额度", () => {
    const s = seated("spade-1");
    const r = activate(s, [s.board!.hands[0][0].id]);
    expect(r.state.board!.activatedThisTurn[0]).toBe(true);
  });

  it("边界：手牌为空就付不起代价，发动被拒", () => {
    const s = seated("spade-1", { hands: [[], [card("Y", "1")], [card("Y", "2")]] });
    expect(activate(s, []).rejected?.reason).toBe("cost_unpayable");
  });

  it("边界：要弃的牌不在手上", () => {
    const s = seated("spade-1");
    expect(activate(s, ["不存在的牌"]).rejected?.reason).toBe("not_in_hand");
  });

  it("边界：弃牌张数与 cost 对不上（一张都没指定 / 指定了两张）", () => {
    const s = seated("spade-1");
    const ids = s.board!.hands[0].map((c) => c.id);
    expect(activate(s).rejected?.reason).toBe("cost_unpayable");
    expect(activate(s, ids).rejected?.reason).toBe("cost_unpayable");
  });

  it("被拒时局面一点没动：额度没被吃掉、手牌没少", () => {
    const s = seated("spade-1");
    const r = activate(s, ["不存在的牌"]);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });

  it("事件：弃的牌是公开的（弃牌堆全公开），摸的牌只有自己看得见", () => {
    const s = seated("spade-1");
    const r = activate(s, [s.board!.hands[0][0].id]);
    expect(r.events.map((e) => e.type)).toEqual(["skillActivated", "cardsDiscarded", "cardsDrawn"]);
    const drawn = r.events.find((e) => e.type === "cardsDrawn")!;
    expect(drawn.private?.seat).toBe(0);
    expect(drawn.public.cards).toBeUndefined();
  });

  it("V8：被动的那条 key 不能拿来「发动」", () => {
    const s = seated("heart-1");
    expect(applyAction(s, { type: "activateSkill", seat: 0, effectKey: "passive" }, ctx()).rejected?.reason)
      .toBe("not_active");
  });

  it("定义里没有的 effectKey 直接拒，不是默默什么都不做", () => {
    const s = seated("spade-1");
    expect(applyAction(s, { type: "activateSkill", seat: 0, effectKey: "9" }, ctx()).rejected?.reason)
      .toBe("unknown_effect");
  });
});

// ---------------------------------------------------------------- 恩惠♥1

describe("恩惠♥1：被动，惩罚/他人技能摸牌 −2（至少 1）", () => {
  it("P11：多段惩罚链先加总再减——+2 与 +4 累计 6，恩惠后摸 4", () => {
    const r = eat(facingPunish("heart-1", {}, 2, 4));
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(4);
  });

  it("边界：基数只有 2 时结果是 1 而不是 0（L5 自带下限）", () => {
    expect(eat(facingPunish("heart-1", {}, 2)).state.board!.hands[0]).toHaveLength(1);
  });

  it("V3：没亮出不生效——照样摸满 2 张", () => {
    expect(eat(facingPunish("heart-1", { revealed: [false, false, false] }, 2)).state.board!.hands[0])
      .toHaveLength(2);
  });

  it("被封印时不生效（走 suppression 原语，不在惩罚结算里写 if）", () => {
    const s = facingPunish("heart-1", { statuses: [["封印"], [], []] }, 2);
    expect(eat(s).state.board!.hands[0]).toHaveLength(2);
  });

  it("targeting self：别人持恩惠救不了你", () => {
    const s = facingPunish(null, { skills: [null, "heart-1", null], revealed: [false, true, false] }, 2, 4);
    expect(eat(s).state.board!.hands[0]).toHaveLength(6);
  });

  it("非惩罚且非他人技能的普通摸牌不生效（U1 摸一张）", () => {
    const b = seated("heart-1").board!;
    // 修正列表本身就是空的——不是靠 L5 的下限把 1−2 抬回 1 而看起来「对」
    expect(drawModifiersFor(b, { kind: "rule", base: 1, seat: 0 })).toEqual([]);
    const r = applyAction(seated("heart-1"), { type: "drawCard", seat: 0 }, ctx());
    expect(r.state.board!.hands[0]).toHaveLength(3);
  });

  it("修正是按定义里的 layer 逐层生成的，不是硬编码的两条", () => {
    const b = seated("heart-1").board!;
    expect(drawModifiersFor(b, { kind: "punish", base: 6, seat: 0 })).toEqual([
      { layer: "L2", source: "恩惠", delta: -2 },
      { layer: "L5", source: "恩惠", min: 1 },
    ]);
  });
});

// ---------------------------------------------------------------- 数据驱动

describe("数据驱动：改定义，行为跟着变，引擎代码一行不动", () => {
  const board = () => seated("heart-1").board!;
  const req = { kind: "punish" as const, base: 6, seat: 0 };
  /** 只改定义里的那条子效果——数值就在定义里，没有第二处可改（原 Q53 裁定后）。 */
  const withEffect = (id: string, over: Partial<SkillEffect>): SkillData => {
    const def = SKILL_DATA.byId.get(id)!;
    const patched: SkillDef = { ...def, effects: [{ ...def.effects![0], ...over }] };
    return { byId: new Map(SKILL_DATA.byId).set(id, patched) };
  };
  const count = (src: SkillData) => resolveDrawCount(req, drawModifiersFor(board(), req, src)).count;

  it("把恩惠的 −2 改成 −3，摸的张数从 4 变成 3", () => {
    const tweaked = withEffect("heart-1", { values: { L2: -3, L5: 1 } });
    expect(count(SKILL_DATA)).toBe(4);
    expect(count(tweaked)).toBe(3);
  });

  it("把定义里的 layer 从 [L2, L5] 删成 [L2]，「至少 1」的下限就没了", () => {
    const tweaked = withEffect("heart-1", { layer: ["L2"], values: { L2: -2 } });
    const small = { kind: "punish" as const, base: 2, seat: 0 };
    expect(resolveDrawCount(small, drawModifiersFor(board(), small, SKILL_DATA)).count).toBe(1);
    expect(resolveDrawCount(small, drawModifiersFor(board(), small, tweaked)).count).toBe(0);
  });

  it("把恩惠的 appliesTo 放开到普通摸牌，普通摸牌也开始受影响", () => {
    const rule = { kind: "rule" as const, base: 1, seat: 0 };
    const tweaked = withEffect("heart-1", { applies_to: ["rule"] });
    expect(drawModifiersFor(board(), rule, SKILL_DATA)).toEqual([]);
    expect(drawModifiersFor(board(), rule, tweaked)).toHaveLength(2);
  });

  it("恒心弃几张摸几张也来自定义数据，不是写死的 1", () => {
    const s = seated("spade-1", { hands: [[card("R", "3"), card("R", "4"), card("R", "5")], [], []] });
    const two = withEffect("spade-1", { values: { discard: 2, draws: 2 } });
    const r = activateSkill(s, { seat: 0, effectKey: "1", cardIds: s.board!.hands[0].slice(0, 2).map((c) => c.id) }, ctx(), two);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(3);
    expect(r.state.board!.drawPile).toHaveLength(18);
  });
});
