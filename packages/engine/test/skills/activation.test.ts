// 技能的「亮出 / 发动」脊梁。规则：01 §4（V1–V8）、T1/T3、P1。
// 这里只测脊梁本身，不涉及任何具体技能的效果。
import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../../src/index.ts";
import { card, ctx, table } from "../helpers.ts";

/** 摆一个牌桌：座位 0 持有 skill，未亮出。 */
const withSkill = (skill: string | null, over: Parameters<typeof table>[1] = {}) =>
  table([[card("R", "3"), card("R", "4")], [card("Y", "1")], [card("Y", "2")]], {
    skills: [skill, null, null],
    ...over,
  });

describe("revealSkill", () => {
  it("V1：己方回合可以亮出", () => {
    const r = applyAction(withSkill("spade-1"), { type: "revealSkill", seat: 0 }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.revealed[0]).toBe(true);
    expect(r.events.map((e) => e.type)).toContain("skillRevealed");
  });

  // V2 之后这条要用**持有技能**的座位来问：没技能的人先被 `no_skill` 拦下，测不到 V1
  it("V1：不是自己的回合就不能亮出（技能没写例外时）", () => {
    const s = withSkill("spade-1", { skills: ["spade-1", "spade-1", null] });
    expect(applyAction(s, { type: "revealSkill", seat: 1 }, ctx()).rejected?.reason).toBe("not_your_turn");
  });

  it("没持有技能就没得亮", () => {
    expect(applyAction(withSkill(null), { type: "revealSkill", seat: 0 }, ctx()).rejected?.reason)
      .toBe("no_skill");
  });

  it("已经亮出的不能再亮一次", () => {
    const s = withSkill("spade-1", { revealed: [true, false, false] });
    expect(applyAction(s, { type: "revealSkill", seat: 0 }, ctx()).rejected?.reason).toBe("already_revealed");
  });

  // 01 §3「可亮出技能；可发动主动技能（非惩罚回合）」——括号只修饰「发动」。
  // 01-V6 亮出不占额度，01-P14 又特意写「封印连未亮出也不能亮」（惩罚回合本就禁止的话那句是废话）。
  it("惩罚回合照样可以亮出技能（只有封印挡得住）", () => {
    const punish = { punish: { initiator: 1, segments: [{ seat: 1, face: "+2" as const, draw: 2 }], total: 2 } };
    const s = { ...withSkill("diamond-j", punish), phase: "play" as const };
    const r = applyAction(s, { type: "revealSkill", seat: 0 }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.revealed[0]).toBe(true);
    // 可点性同源：legalActions 也要给出这条，否则 UI 上根本没有亮出的按钮
    expect(legalActions(s, 0)).toContainEqual({ type: "revealSkill", seat: 0 });
  });

  it("被封印时仍然亮不出来（01-P14）", () => {
    const s = withSkill("diamond-j", { statuses: [["封印"], [], []] });
    expect(applyAction(s, { type: "revealSkill", seat: 0 }, ctx()).rejected?.reason).toBe("suppressed");
    expect(legalActions(s, 0).some((a) => a.type === "revealSkill")).toBe(false);
  });

  it("V6：亮出不占「每回合一条主动」的额度", () => {
    const r = applyAction(withSkill("spade-1"), { type: "revealSkill", seat: 0 }, ctx());
    expect(r.state.board!.activatedThisTurn[0]).toBe(false);
  });
});

describe("activateSkill", () => {
  const revealed = (over: Parameters<typeof table>[1] = {}) =>
    withSkill("spade-1", { revealed: [true, false, false], ...over });

  // 恒心的代价是「弃 1 张手牌」，所以发动时要带上弃哪张——付得起代价才轮到 V1–V8 之外的事。
  const cost = (s: Parameters<typeof applyAction>[0]) => [s.board!.hands[0][0].id];

  it("V4：亮出的当回合就能发动，不必等下回合", () => {
    const afterReveal = applyAction(withSkill("spade-1"), { type: "revealSkill", seat: 0 }, ctx()).state;
    const r = applyAction(
      afterReveal,
      { type: "activateSkill", seat: 0, effectKey: "1", cardIds: cost(afterReveal) },
      ctx(),
    );
    expect(r.rejected).toBeUndefined();
  });

  it("V3/V4：没亮出就不能发动", () => {
    expect(applyAction(withSkill("spade-1"), { type: "activateSkill", seat: 0, effectKey: "1" }, ctx())
      .rejected?.reason).toBe("not_revealed");
  });

  it("V7：发动占 1 次，同回合不能再发动第二条", () => {
    const s = revealed();
    const first = applyAction(s, { type: "activateSkill", seat: 0, effectKey: "1", cardIds: cost(s) }, ctx());
    expect(first.state.board!.activatedThisTurn[0]).toBe(true);
    expect(applyAction(first.state, { type: "activateSkill", seat: 0, effectKey: "2" }, ctx())
      .rejected?.reason).toBe("already_activated");
  });

  it("T1：主动技能只在回合开始阶段发动", () => {
    const s = revealed({ drawnPlayable: card("R", "9") }); // 已经摸过牌 = 过了阶段 1
    expect(applyAction({ ...s, phase: "play" }, { type: "activateSkill", seat: 0, effectKey: "1" }, ctx())
      .rejected?.reason).toBe("not_turn_start");
  });

  it("T3/P1：惩罚回合不能发动主动技能", () => {
    const s = revealed({ punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2 }], total: 2 } });
    expect(applyAction(s, { type: "activateSkill", seat: 0, effectKey: "1" }, ctx())
      .rejected?.reason).toBe("suppressed");
  });

  it("回合切换后额度重置", () => {
    const s = revealed();
    const used = applyAction(s, { type: "activateSkill", seat: 0, effectKey: "1", cardIds: cost(s) }, ctx()).state;
    expect(used.board!.activatedThisTurn[0]).toBe(true);
    // 座位 0 打出一张牌结束自己的回合
    const played = applyAction(used, { type: "playCards", seat: 0, cardIds: [used.board!.hands[0][0].id] }, ctx());
    expect(played.state.board!.activatedThisTurn[0]).toBe(false);
  });
});

describe("legalActions 暴露亮出与发动", () => {
  it("持有未亮出 → 己方回合出现 revealSkill", () => {
    const acts = legalActions(withSkill("spade-1"), 0);
    expect(acts.some((a) => a.type === "revealSkill")).toBe(true);
  });

  it("没持有技能 → 不出现 revealSkill", () => {
    expect(legalActions(withSkill(null), 0).some((a) => a.type === "revealSkill")).toBe(false);
  });

  it("亮出的恒心在 turnStart 暴露 activateSkill；发动后消失（V7）", () => {
    const s = withSkill("spade-1", { revealed: [true, false, false] });
    const act = legalActions(s, 0).find((a) => a.type === "activateSkill");
    expect(act).toEqual({ type: "activateSkill", seat: 0, effectKey: "1" });
    const used = applyAction(s, { type: "activateSkill", seat: 0, effectKey: "1", cardIds: [s.board!.hands[0][0].id] }, ctx()).state;
    expect(legalActions(used, 0).some((a) => a.type === "activateSkill")).toBe(false);
  });

  it("被动技能（恩惠）没有 activateSkill 可暴露", () => {
    const s = withSkill("heart-1", { revealed: [true, false, false] });
    expect(legalActions(s, 0).some((a) => a.type === "activateSkill")).toBe(false);
  });

  // 01 §3 的括号只修饰「发动」：惩罚回合关的是主动，亮出照给（V6 不占额度）。
  it("惩罚回合里可以亮出，但不能发动（P1）", () => {
    const s = withSkill("spade-1", { punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2 }], total: 2 } });
    const acts = legalActions(s, 0);
    expect(acts.some((a) => a.type === "revealSkill")).toBe(true);
    expect(acts.some((a) => a.type === "activateSkill")).toBe(false);
  });
});

describe("视角投影不泄漏未亮出的技能", () => {
  const s = table([[card("R", "3")], [card("Y", "1")], [card("Y", "2")]], {
    skills: ["spade-1", "heart-1", "diamond-2"],
    revealed: [false, true, false],
  });

  it("别人未亮出的技能，你看不到（V3：没亮出等于暗牌）", () => {
    const v = projectView(s, 0);
    expect(v.players[2].skillId).toBeNull();               // 老白持血棘但没亮
    expect(JSON.stringify(v)).not.toContain("diamond-2");  // 整个快照里搜不到
  });

  it("别人已亮出的技能是公开信息", () => {
    expect(projectView(s, 0).players[1].skillId).toBe("heart-1");
  });

  it("自己的技能自己当然看得见，哪怕还没亮出", () => {
    expect(projectView(s, 0).players[0].skillId).toBe("spade-1");
  });
});
