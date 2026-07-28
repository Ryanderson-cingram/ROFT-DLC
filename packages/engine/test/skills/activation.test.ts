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

  it("V1：不是自己的回合就不能亮出", () => {
    const r = applyAction(withSkill("spade-1"), { type: "revealSkill", seat: 1 }, ctx());
    expect(r.rejected?.reason).toBe("not_your_turn");
  });

  it("没持有技能就没得亮", () => {
    expect(applyAction(withSkill(null), { type: "revealSkill", seat: 0 }, ctx()).rejected?.reason)
      .toBe("no_skill");
  });

  it("已经亮出的不能再亮一次", () => {
    const s = withSkill("spade-1", { revealed: [true, false, false] });
    expect(applyAction(s, { type: "revealSkill", seat: 0 }, ctx()).rejected?.reason).toBe("already_revealed");
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

  it("惩罚窗口里既不能亮出也不能发动（P1）", () => {
    const s = withSkill("spade-1", { punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2 }], total: 2 } });
    const acts = legalActions(s, 0);
    expect(acts.some((a) => a.type === "revealSkill" || a.type === "activateSkill")).toBe(false);
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
