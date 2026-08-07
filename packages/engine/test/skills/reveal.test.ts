/**
 * 亮出时机的执行面（01-V1 / V2 / V2b，2026-08-03 建）。
 *
 * V1 是默认：只能在自己的回合亮出。V2 说 Excel 写明的时机是**白名单例外**，白名单在定义里
 * （`reveal_window` + 条件 `reveal_when`），所以这里钉的是「按定义放行」而不是某张牌的特例。
 *
 * V2b 的两条口径：
 * 1. 例外**只放宽「必须是自己的回合」**；**反应窗口挂着时一律禁亮**（含「任意时刻」）
 * 2. 认不出的窗口名**保守当作 own_turn**——白名单里有、执行面还没建的（契约的 `when_skipped`、
 *    偏折的 `when_challenged_uno`）宁可少放行，也不静默给出一个谁都没实现的例外
 */
import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../../src/index.ts";
import { revealAllowedOutOfTurn } from "../../src/skills/reveal.ts";
import { SKILL_DATA } from "../../src/skills/draw-passives.ts";
import { card, ctx, table } from "../helpers.ts";
import type { SkillDef } from "../../src/skills/types.ts";
import type { Board, Card, GameState } from "../../src/types.ts";

const hand = (n: number) => Array.from({ length: n }, () => card("B", "5"));

/** 轮到座位 1；座位 0 持有 `skill` 但没亮出，手上 `n` 张。 */
const table0 = (skill: string | null, n: number, over: Partial<Board> = {}): GameState =>
  table([hand(n), [card("Y", "1")], [card("Y", "2")]], {
    skills: [skill, "spade-1", null],
    revealed: [false, false, false],
    currentSeat: 1,
    ...over,
  });

const reveal = (s: GameState, seat = 0) => applyAction(s, { type: "revealSkill", seat }, ctx());
const canReveal = (s: GameState, seat = 0) => legalActions(s, seat).some((a) => a.type === "revealSkill");

describe("V1 默认：只能在自己的回合亮出", () => {
  it("没写例外的技能（恒心♠1），别人的回合亮不出来，也不给按钮", () => {
    const s = table0("spade-1", 12);
    expect(reveal(s).rejected?.reason).toBe("not_your_turn");
    expect(canReveal(s)).toBe(false);
  });

  it("轮到自己就照常亮（对照组）", () => {
    const s = table0("spade-1", 12, { currentSeat: 0 });
    expect(reveal(s).rejected).toBeUndefined();
    expect(canReveal(s)).toBe(true);
  });
});

describe("V2 白名单例外：神授♥5「手牌 >10 可主动亮出」（阈值 11）", () => {
  it("手上 11 张 → 别人的回合也亮得出，按钮也给", () => {
    const s = table0("heart-5", 11);
    const r = reveal(s);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.revealed[0]).toBe(true);
    expect(r.events.map((e) => e.type)).toContain("skillRevealed");
    expect(canReveal(s)).toBe(true);
  });

  it("手上 10 张 → 还不够（「>10」= 11 张起），只能等自己的回合", () => {
    const s = table0("heart-5", 10);
    expect(reveal(s).rejected?.reason).toBe("not_your_turn");
    expect(canReveal(s)).toBe(false);
    // 自己的回合照常亮得出——条件只管「回合之外」那一半
    expect(reveal(table0("heart-5", 10, { currentSeat: 0 })).rejected).toBeUndefined();
  });

  it("亮出不可逆：亮完手牌掉到 3 张也照样亮着", () => {
    const opened = reveal(table0("heart-5", 11)).state;
    const fewer: GameState = {
      ...opened,
      board: { ...opened.board!, hands: opened.board!.hands.map((h, i) => (i === 0 ? h.slice(0, 3) : h)) },
    };
    expect(fewer.board!.revealed[0]).toBe(true);
    expect(reveal(fewer).rejected?.reason).toBe("already_revealed");
  });

  it("V2b：反应窗口挂着时一律禁亮（哪怕手上 11 张）", () => {
    const s: GameState = {
      ...table0("heart-5", 11),
      pendingWindow: {
        type: "punishStack", actors: [2], deadline: "2026-07-28T12:00:30.000Z", defaultChoice: "accept", resume: "play",
      },
    };
    expect(reveal(s).rejected?.reason).toBe("pending_window");
    expect(canReveal(s)).toBe(false);
  });

  it("封印照样挡得住（01-P14：未亮出也不能亮）", () => {
    const s = table0("heart-5", 11, { statuses: [["封印"], [], []] });
    expect(reveal(s).rejected?.reason).toBe("suppressed");
    expect(canReveal(s)).toBe(false);
  });

  it("轮不到你时能做的事只多出这一条亮出（其余仍是 UNO 那两条）", () => {
    const s = table0("heart-5", 11);
    const kinds = new Set(legalActions(s, 0).map((a) => a.type));
    expect([...kinds].sort()).toEqual(["callUno", "catchUno", "revealSkill"]);
    // 没到 11 张时，同一个牌桌就只剩 UNO 那两条
    expect(new Set(legalActions(table0("heart-5", 10), 0).map((a) => a.type)).has("revealSkill")).toBe(false);
  });
});

describe("判据本身：按定义放行，不认技能 id", () => {
  const def = (over: Partial<SkillDef>): SkillDef => ({
    id: "x", name: "假技能", suit_rank: "♠0", status: "✅", summary: "", caveats: null, structured: true, ...over,
  });
  const b = table0("heart-5", 11).board!;

  it("any_time 且条件满足 → 放行；条件不满足 → 不放行", () => {
    expect(revealAllowedOutOfTurn(b, 0, def({ reveal_window: "any_time" }))).toBe(true);
    expect(revealAllowedOutOfTurn(b, 0, def({ reveal_window: "any_time", reveal_when: { hand_at_least: 11 } }))).toBe(true);
    expect(revealAllowedOutOfTurn(b, 0, def({ reveal_window: "any_time", reveal_when: { hand_at_least: 12 } }))).toBe(false);
  });

  it("执行面还没建的窗口名保守当作 own_turn（契约 when_skipped / 偏折 when_challenged_uno）", () => {
    for (const w of ["when_skipped", "when_challenged_uno", "own_turn"] as const)
      expect(revealAllowedOutOfTurn(b, 0, def({ reveal_window: w })), w).toBe(false);
    expect(revealAllowedOutOfTurn(b, 0, def({}))).toBe(false);
    expect(revealAllowedOutOfTurn(b, 0, undefined)).toBe(false);
  });

  it("认不出的条件键 → 不放行（宁可少放行，也不静默当成无条件）", () => {
    const d = def({ reveal_window: "any_time", reveal_when: { no_such: 1 } });
    expect(revealAllowedOutOfTurn(b, 0, d)).toBe(false);
  });

  it("神授的定义就是这么写的（数据与行为同源）", () => {
    const heart5 = SKILL_DATA.byId.get("heart-5")!;
    expect(heart5.reveal_window).toBe("any_time");
    expect(heart5.reveal_when).toEqual({ hand_at_least: 11 });
  });
});

describe("亮出之后照常按 V3 生效（例外只管「什么时候能亮」）", () => {
  it("在别人的回合亮出神授，轮到自己时那条被动已经在了", () => {
    const opened = reveal(table0("heart-5", 11)).state;
    // 手上 11 张全是蓝 5，牌顶红 7 → 一张都打不出
    const mine: GameState = { ...opened, board: { ...opened.board!, currentSeat: 0 } };
    const cards: Card[] = mine.board!.hands[0];
    expect(cards.every((c) => c.color === "B")).toBe(true);
    expect(legalActions(mine, 0).some((a) => a.type === "endTurn")).toBe(true);
  });
});
