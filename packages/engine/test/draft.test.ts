// S1 开局抽 3 选 1：dealing 阶段的 skillDraft 窗口。
// 规则：01-S1/S1c/S2；spec §7（claimTimeout 催促）；registry（只有机制齐备的技能进池）。
import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../src/index.ts";
import { skills } from "../src/skills/registry.ts";
import type { GameState } from "../src/types.ts";
import { ctx, lobby } from "./helpers.ts";

const start = (n = 3) => applyAction(lobby(n), { type: "startGame", seat: 0 }, ctx());
const wid = (s: GameState) => `w${s.version}:skillDraft`;
const pick = (s: GameState, seat: number, choice: string, c = ctx()) =>
  applyAction(s, { type: "respond", seat, windowId: wid(s), choice }, c);
/** 每个还没选的座位都选自己的第一个候选。 */
const pickAll = (s: GameState) => {
  for (const seat of [...s.pendingWindow!.actors]) s = pick(s, seat, s.board!.draftOptions![seat][0]).state;
  return s;
};

describe("openDraft", () => {
  it("池子轮流发：3 人局每人拿到同样多的候选，全部来自可抽池且不重复", () => {
    const b = start(3).state.board!;
    const opts = b.draftOptions!;
    expect(opts).toHaveLength(3);
    const flat = opts.flat();
    expect(new Set(flat).size).toBe(flat.length);
    const poolIds = new Set(skills.pool.map((d) => d.id));
    for (const id of flat) expect(poolIds.has(id)).toBe(true);
    // 轮流发：任何两人的候选数最多差 1
    const counts = opts.map((o) => o.length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("actors = 拿到候选的座位；池子比人少时空手座位不进窗口", () => {
    const r = start(4); // 池子当前 3 个技能，第 4 人拿不到
    const opts = r.state.board!.draftOptions!;
    const expected = opts.flatMap((o, seat) => (o.length ? [seat] : []));
    expect(r.state.pendingWindow!.actors).toEqual(expected);
    if (skills.pool.length < 4) expect(expected.length).toBeLessThan(4);
  });

  it("候选是暗信息：public 只有张数，快照只带自己的", () => {
    const r = start(3);
    for (const e of r.events.filter((e) => e.type === "draftOptionsDealt")) {
      expect(e.public.count).toBeGreaterThan(0);
      expect(JSON.stringify(e.public)).not.toContain("spade");
      expect(JSON.stringify(e.public)).not.toContain("heart");
    }
    const snap = projectView(r.state, 0);
    expect(snap.draftOptions).toEqual(r.state.board!.draftOptions![0]);
    const other = r.state.board!.draftOptions![1];
    // 比对**带引号**的 id：裸 id 是子串匹配，"diamond-1" 会在别人的 "diamond-10" 里假阳性
    if (other.length) expect(JSON.stringify(snap)).not.toContain(JSON.stringify(other[0]));
  });

  it("池序进 audit 不进 public（重放要读它）", () => {
    const started = start(3).events.find((e) => e.type === "draftStarted")!;
    expect(started.audit?.pool).toBeDefined();
    expect(JSON.stringify(started.public)).not.toContain("spade-1");
  });
});

describe("respond(skillDraft)", () => {
  it("选自己的候选：技能到手、自己退出 actors、别人还挂着", () => {
    const s0 = start(3).state;
    const choice = s0.board!.draftOptions![0][0];
    const r = pick(s0, 0, choice);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.skills[0]).toBe(choice);
    expect(r.state.phase).toBe("dealing");
    expect(r.state.pendingWindow!.actors).not.toContain(0);
    expect(r.state.board!.draftOptions![0]).toEqual([]);
  });

  it("选了什么走 private；public 只说选完了", () => {
    const s0 = start(3).state;
    const choice = s0.board!.draftOptions![0][0];
    const e = pick(s0, 0, choice).events.find((e) => e.type === "skillChosen")!;
    expect(e.public).toEqual({ seat: 0, byTimeout: false });
    expect(e.private?.payload.skillId).toBe(choice);
  });

  it("不能选别人的候选或池外 id", () => {
    const s0 = start(3).state;
    expect(pick(s0, 0, s0.board!.draftOptions![1][0]).rejected?.reason).toBe("bad_choice");
    expect(pick(s0, 0, "no-such-skill").rejected?.reason).toBe("bad_choice");
  });

  it("选完的人不能再选（不在 actors 里）", () => {
    const s0 = start(3).state;
    const after = pick(s0, 0, s0.board!.draftOptions![0][0]).state;
    const r = applyAction(after, { type: "respond", seat: 0, windowId: wid(after), choice: "x" }, ctx());
    expect(r.rejected?.reason).toBe("not_your_window");
  });

  it("全员选完：turnStart、窗口关、候选字段消失、技能各归各位", () => {
    const s0 = start(3).state;
    const wanted = s0.board!.draftOptions!.map((o) => o[0] ?? null);
    const done = pickAll(s0);
    expect(done.phase).toBe("turnStart");
    expect(done.pendingWindow).toBeUndefined();
    expect(done.board!.draftOptions).toBeUndefined();
    expect(done.board!.skills).toEqual(wanted);
    expect(done.board!.revealed).toEqual([false, false, false]); // 持有 ≠ 亮出
  });

  it("legalActions：actor 的合法动作恰好是自己的候选，别人是空", () => {
    const s0 = start(3).state;
    const acts = legalActions(s0, 0);
    expect(acts.map((a) => (a.type === "respond" ? a.choice : ""))).toEqual(s0.board!.draftOptions![0]);
    const after = pick(s0, 0, s0.board!.draftOptions![0][0]).state;
    expect(legalActions(after, 0)).toEqual([]);
  });

  it("dealing 阶段其他动作都被窗口挡住", () => {
    const s0 = start(3).state;
    const card = s0.board!.hands[0][0];
    expect(applyAction(s0, { type: "playCards", seat: 0, cardIds: [card.id] }, ctx()).rejected?.reason)
      .toBe("pending_window");
    expect(applyAction(s0, { type: "drawCard", seat: 0 }, ctx()).rejected?.reason).toBe("pending_window");
  });
});

describe("claimTimeout(skillDraft)", () => {
  it("没到点不能催", () => {
    const s0 = start(3).state;
    const r = applyAction(s0, { type: "claimTimeout", seat: 0, windowId: wid(s0) }, ctx());
    expect(r.rejected?.reason).toBe("not_yet_expired");
  });

  it("过点后一次结清：没选的全按第一个候选代选，直接开打", () => {
    const s0 = start(3).state;
    const picked = pick(s0, 0, s0.board!.draftOptions![0][1] ?? s0.board!.draftOptions![0][0]).state;
    const defaults = picked.board!.draftOptions!.map((o, i) => picked.board!.skills[i] ?? o[0] ?? null);
    const late = ctx(undefined, "2026-07-28T12:02:00.000Z"); // 开局 now + 60s 之后
    const r = applyAction(picked, { type: "claimTimeout", seat: 2, windowId: wid(picked) }, late);
    expect(r.rejected).toBeUndefined();
    expect(r.state.phase).toBe("turnStart");
    expect(r.state.board!.skills).toEqual(defaults);
    const chosen = r.events.filter((e) => e.type === "skillChosen");
    expect(chosen.every((e) => e.public.byTimeout === true)).toBe(true);
  });
});
