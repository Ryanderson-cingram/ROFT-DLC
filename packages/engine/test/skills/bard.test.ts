/**
 * 吟游♣5 的四支歌声（04 ♣5 / 01-S20 / 06-Q62–Q66）。
 * spec：`docs/superpowers/specs/2026-08-02-skills-batch-2.md` 第 9 步。
 *
 * 六条要害，逐条钉：
 * 1. **全场生效**（Q62）：活泼板 +1 让对手也多摸，战争序 ×2 让自己被罚时也翻倍
 * 2. **L2 → L3 的顺序**（Q62 原话「×2 是最后计算的，即先计算加减」）：4 张 → +1 → ×2 = **10**
 * 3. **樱时雨只管惩罚，且把 0 也抬回 1**（Q63）
 * 4. **行进曲**（Q64）：变色/+4 照打照结算，只是**跟色不变**——与五彩共用同一条判定
 * 5. **开唱条件**：上家打出的不是 +2/+4；选/切换各**占一次主动条**（S20）
 * 6. **封印只压制不清值**（Q65）：封印期间没歌声，解封回到**原来那一支**
 */
import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../../src/index.ts";
import { drawModifiersFor } from "../../src/skills/draw-passives.ts";
import { resolveDrawCount } from "../../src/skills/primitives/draw-modifier.ts";
import { card, ctx, table } from "../helpers.ts";
import type { Board, Card, GameState, PunishChain } from "../../src/types.ts";

const R7 = card("R", "7");
const filler = (n: number) => Array.from({ length: n }, () => card("G", "9"));
const SONGS = ["活泼板", "战争序", "樱时雨", "行进曲"] as const;

/** 座位 0 亮着吟游、轮到他；牌顶红 7（不是 +2/+4，所以唱得了歌）。 */
const seated = (over: Partial<Board> = {}, hand: Card[] = [card("R", "3"), card("B", "8")]): GameState =>
  table([hand, [card("Y", "1")], [card("Y", "2")]], {
    playedPile: [R7],
    drawPile: filler(40),
    skills: ["club-5", null, null],
    revealed: [true, false, false],
    ...over,
  });

const sing = (s: GameState, key: string, seat = 0) =>
  applyAction(s, { type: "activateSkill", seat, effectKey: key }, ctx());
/** 直接把牌桌摆成「已经在唱某支歌」。 */
const singing = (key: string, over: Partial<Board> = {}, hand?: Card[]) =>
  seated({ chosen: { "club-5": { key, seat: 0 } }, ...over }, hand);

/** 一条惩罚链，贡献总和 `total`。 */
const chain = (total: number, segs = 2): PunishChain => ({
  initiator: 1,
  segments: Array.from({ length: segs }, () => ({ seat: 1, face: "+2" as const, draw: total / segs, color: "Y" as const })),
  total,
});
/** 座位 `victim` 面前挂着惩罚窗口等他吃。 */
const facing = (s: GameState, victim: number, c: PunishChain): GameState => ({
  ...s,
  phase: "play",
  board: { ...s.board!, punish: c, currentSeat: 1 },
  pendingWindow: {
    type: "punishStack", actors: [victim], deadline: "2026-07-28T12:00:30.000Z", defaultChoice: "accept", resume: "play",
  },
});
const eat = (s: GameState, seat: number) =>
  applyAction(s, { type: "respond", seat, windowId: `w${s.version}:punishStack`, choice: "accept" }, ctx());
const drewCounts = (r: { events: { type: string; public?: Record<string, unknown> }[] }) =>
  r.events.filter((e) => e.type === "cardsDrawn").map((e) => e.public!.count);

describe("选歌：四支各一个按钮，选/切换占主动条（01-S20）", () => {
  it("legalActions 给出四条（报的是那一支的 key），发动即记下", () => {
    const s = seated();
    expect(legalActions(s, 0).filter((a) => a.type === "activateSkill").map((a) => a.effectKey)).toEqual([...SONGS]);

    const r = sing(s, "活泼板");
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.chosen).toEqual({ "club-5": { key: "活泼板", seat: 0 } });
    expect(r.events.find((e) => e.type === "optionChosen")!.public)
      .toEqual({ seat: 0, skillId: "club-5", key: "活泼板" });
    // 当众选的，全场都看得见
    for (const v of [0, 1, 2]) expect(projectView(r.state, v).chosen).toEqual({ "club-5": { key: "活泼板", seat: 0 } });
  });

  it("S20：占掉本回合的主动条，同回合换不了第二支", () => {
    const r = sing(seated(), "活泼板");
    expect(r.state.board!.activatedThisTurn[0]).toBe(true);
    expect(legalActions(r.state, 0).some((a) => a.type === "activateSkill")).toBe(false);
    expect(sing(r.state, "战争序").rejected?.reason).toBe("already_activated");
  });

  it("换歌：下一个回合可以改成另一支（后选覆盖先选，06-Q66）", () => {
    const s = singing("活泼板", { activatedThisTurn: [false, false, false] });
    const r = sing(s, "战争序");
    expect(r.state.board!.chosen).toEqual({ "club-5": { key: "战争序", seat: 0 } });
  });

  it("开唱条件：上家打出的是 +2/+4 时唱不了（惩罚轮里换不了歌）", () => {
    const s = seated({ playedPile: [card("Y", "+2")] });
    expect(legalActions(s, 0).some((a) => a.type === "activateSkill")).toBe(false);
    expect(sing(s, "活泼板").rejected?.reason).toBe("skill_unavailable");
    // +4 同理
    expect(sing(seated({ playedPile: [card(null, "+4")] }), "活泼板").rejected?.reason).toBe("skill_unavailable");
  });

  it("未亮出 / 不是自己的回合 → 唱不了（V3 / T1）", () => {
    expect(sing(seated({ revealed: [false, false, false] }), "活泼板").rejected?.reason).toBe("not_revealed");
    expect(sing(seated({ currentSeat: 1 }), "活泼板").rejected?.reason).toBe("not_your_turn");
  });

  it("亮出时无歌声（初始态）：没选之前一条修正都不产", () => {
    const b = seated().board!;
    expect(b.chosen).toBeUndefined();
    expect(drawModifiersFor(b, { kind: "punish", base: 4, seat: 0 })).toEqual([]);
    expect(drawModifiersFor(b, { kind: "rule", base: 1, seat: 1 })).toEqual([]);
  });
});

describe("歌声全场生效（06-Q62）：对手也吃", () => {
  it("活泼板：**所有**摸牌 +1——自己的、对手的、规则的、技能的都算", () => {
    const b = singing("活泼板").board!;
    for (const req of [
      { kind: "rule" as const, base: 1, seat: 0 },
      { kind: "rule" as const, base: 1, seat: 2 }, // 没有技能的对手
      { kind: "punish" as const, base: 4, seat: 1 },
      { kind: "skill" as const, base: 2, seat: 0, initiator: 0 }, // 自己发动造成的也算
    ]) {
      expect(resolveDrawCount(req, drawModifiersFor(b, req)).count, JSON.stringify(req)).toBe(req.base + 1);
    }
  });

  it("对手 U1 摸牌真的变成 2 张（跑完整条动作，不只是修正表）", () => {
    const s = singing("活泼板", { currentSeat: 2 });
    expect(drewCounts(applyAction(s, { type: "drawCard", seat: 2 }, ctx()))).toEqual([2]);
  });

  it("战争序：只翻惩罚，规则摸牌不受影响；唱的人自己被罚也照样翻倍", () => {
    const b = singing("战争序").board!;
    expect(resolveDrawCount({ kind: "punish", base: 4, seat: 2 }, drawModifiersFor(b, { kind: "punish", base: 4, seat: 2 })).count).toBe(8);
    expect(resolveDrawCount({ kind: "rule", base: 1, seat: 2 }, drawModifiersFor(b, { kind: "rule", base: 1, seat: 2 })).count).toBe(1);
    // 双刃剑：唱的人自己吃 4 张的链，也是 8 张
    const s = facing(singing("战争序"), 0, chain(4));
    expect(drewCounts(eat(s, 0))).toEqual([8]);
  });
});

describe("L2 → L3 的顺序（06-Q62 原话「×2 是最后计算的，即先计算加减」）", () => {
  it("同时有活泼板与战争序：4 张 → +1 → ×2 = **10**，不是 9", () => {
    // 两支歌声不可能同时唱（一个槽），所以这里直接把两条修正摆在一起验层序
    const mods = [
      { layer: "L2" as const, source: "活泼板", delta: 1 },
      { layer: "L3" as const, source: "战争序", factor: 2 },
    ];
    expect(resolveDrawCount({ kind: "punish", base: 4, seat: 0 }, mods).count).toBe(10);
  });
});

describe("樱时雨（06-Q63）：惩罚恒为 1，连 0 也抬回 1", () => {
  it("链上 6 张 → 摸 1", () => {
    expect(drewCounts(eat(facing(singing("樱时雨"), 2, chain(6, 3)), 2))).toEqual([1]);
  });

  it("强袭掷 0 → 惩罚基数 0，樱时雨仍抬回 1（L4 是覆盖，不是下限）", () => {
    const zero: PunishChain = { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 0, color: "Y" }], total: 0 };
    expect(drewCounts(eat(facing(singing("樱时雨"), 2, zero), 2))).toEqual([1]);
  });

  it("只管惩罚：规则摸牌照旧 1 张、技能摸牌照旧（不是「所有摸牌恒为 1」）", () => {
    const b = singing("樱时雨").board!;
    const rule = { kind: "rule" as const, base: 3, seat: 2 };
    expect(resolveDrawCount(rule, drawModifiersFor(b, rule)).count).toBe(3);
  });
});

describe("行进曲（06-Q64）：变色牌照打照结算，只是不改色", () => {
  const wild = () => card(null, "wild");

  it("定色只能定成当前跟色，改色要拒——与五彩共用同一条判定", () => {
    const w = wild();
    const s = singing("行进曲", {}, [w, card("R", "3")]);
    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [w.id], chosenColor: "B" }, ctx()).rejected?.reason)
      .toBe("color_locked");
    const ok = applyAction(s, { type: "playCards", seat: 0, cardIds: [w.id], chosenColor: "R" }, ctx());
    expect(ok.rejected).toBeUndefined();
    expect(ok.state.board!.activeColor).toBe("R");
  });

  it("+4 照打、惩罚照常成立（只是颜色不变）", () => {
    const p4 = card(null, "+4");
    const s = singing("行进曲", {}, [p4, card("R", "3")]);
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [p4.id], chosenColor: "R" }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.punish?.total).toBe(4);
    expect(r.state.board!.activeColor).toBe("R");
  });

  it("全场生效：**对手**打变色牌也改不了色", () => {
    const w = wild();
    const s = singing("行进曲", { currentSeat: 2, hands: [[card("R", "3")], [card("Y", "1")], [w, card("Y", "2")]] });
    expect(applyAction(s, { type: "playCards", seat: 2, cardIds: [w.id], chosenColor: "G" }, ctx()).rejected?.reason)
      .toBe("color_locked");
  });

  it("没在唱行进曲时一切照旧（对照组）", () => {
    const w = wild();
    const s = singing("活泼板", {}, [w, card("R", "3")]);
    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [w.id], chosenColor: "B" }, ctx()).rejected)
      .toBeUndefined();
  });

  it("行进曲不改摸牌数（它不在 02 §7 的表里）", () => {
    const b = singing("行进曲").board!;
    expect(drawModifiersFor(b, { kind: "punish", base: 4, seat: 0 })).toEqual([]);
  });
});

describe("封印：只压制、不清值（06-Q65）", () => {
  it("封印期间歌声失效，解封回到**原来那一支**（不是无歌声）", () => {
    const sealed = singing("活泼板", { statuses: [["封印"], [], []] });
    const req = { kind: "rule" as const, base: 1, seat: 2 };
    expect(drawModifiersFor(sealed.board!, req)).toEqual([]);
    // 值原样留着
    expect(sealed.board!.chosen).toEqual({ "club-5": { key: "活泼板", seat: 0 } });

    const lifted: GameState = { ...sealed, board: { ...sealed.board!, statuses: [[], [], []] } };
    expect(resolveDrawCount(req, drawModifiersFor(lifted.board!, req)).count).toBe(2);
  });

  it("封印期间行进曲也失效（同一个压制口径）", () => {
    const w = card(null, "wild");
    const s = singing("行进曲", { statuses: [["封印"], [], []] }, [w, card("R", "3")]);
    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [w.id], chosenColor: "B" }, ctx()).rejected)
      .toBeUndefined();
  });
});

describe("选项闸门是通用的：只有被选中的那一支生效", () => {
  it.each(SONGS)("在唱 %s 时，只有它那一条修正在场", (key) => {
    const b = singing(key).board!;
    const punish = { kind: "punish" as const, base: 4, seat: 2 };
    const rule = { kind: "rule" as const, base: 1, seat: 2 };
    const sources = [...drawModifiersFor(b, punish), ...drawModifiersFor(b, rule)];
    // 四支歌声共用一个技能名（吟游），所以按层数认：每支至多产出一条修正
    expect(sources.length, key).toBeLessThanOrEqual(2);
    expect(resolveDrawCount(punish, drawModifiersFor(b, punish)).count).toBe(
      key === "活泼板" ? 5 : key === "战争序" ? 8 : key === "樱时雨" ? 1 : 4,
    );
  });
});
