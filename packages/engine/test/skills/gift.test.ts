/**
 * 神授♥5（04 ♥5 / 01-S17 / 06-Q12）——原语 `draw_obligation`。
 * spec：`docs/superpowers/specs/2026-08-02-skills-batch-2.md` 第 8 步。
 *
 * 它只改一件事：**U1「无牌可出必须摸牌」对他不强制**。所以本文件钉的全是
 * 「什么时候能空过、什么时候不能」，一张牌都不该多摸少摸。
 *
 * 四条要害：
 * 1. 只有**无牌可出**才能空过——手上有得打就照常出牌（不能白过一回合）
 * 2. `legalActions` 与 `endTurn` 用的是**同一个判据**，不会一边给一边拒
 * 3. V3 未亮出 / P9 被封印 → 回到 U1
 * 4. 惩罚轮（选了叠）不给空过（P3：选了叠就得叠）
 */
import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../../src/index.ts";
import { drawIsForced, mustDrawWhenStuck } from "../../src/skills/gift.ts";
import { SKILL_DATA } from "../../src/skills/draw-passives.ts";
import { card, ctx, table } from "../helpers.ts";
import type { SkillData } from "../../src/skills/draw-passives.ts";
import type { Board, Card, GameState, PunishChain } from "../../src/types.ts";

const R7 = card("R", "7");
const filler = (n: number) => Array.from({ length: n }, () => card("G", "9"));
/** 接不上红 7 的两张（跟色 R、跟面 7）。 */
const STUCK = () => [card("B", "3"), card("Y", "9")];

/** 座位 0 亮着 `skill`、轮到他；牌顶红 7。 */
const seated = (hand: Card[], skill: string | null = "heart-5", over: Partial<Board> = {}): GameState =>
  table([hand, [card("B", "5")], [card("B", "6")]], {
    playedPile: [R7],
    drawPile: filler(20),
    skills: [skill, null, null],
    revealed: [skill !== null, false, false],
    ...over,
  });

const endTurn = (s: GameState, seat = 0) => applyAction(s, { type: "endTurn", seat }, ctx());
const canEnd = (s: GameState, seat = 0) => legalActions(s, seat).some((a) => a.type === "endTurn");

describe("神授♥5：无牌可出时可以不摸直接结束（01-S17）", () => {
  it("legalActions 给出「结束回合」，摸牌那条也还在（可以不摸，不是不能摸）", () => {
    const s = seated(STUCK());
    expect(canEnd(s)).toBe(true);
    expect(legalActions(s, 0).some((a) => a.type === "drawCard")).toBe(true);
    expect(legalActions(s, 0).some((a) => a.type === "playCards")).toBe(false);
  });

  it("结束回合：一张不摸、牌堆一张不动，回合交给下家", () => {
    const s = seated(STUCK());
    const r = endTurn(s);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(2);
    expect(r.state.board!.drawPile).toHaveLength(20);
    expect(r.state.board!.currentSeat).toBe(1);
    expect(r.state.phase).toBe("turnStart");
    expect(r.events.map((e) => e.type)).toEqual(["turnEnded"]);
  });

  it("照常摸也行：摸完打不出去就自动结束（U1 的老路一点没变）", () => {
    const s = seated(STUCK(), "heart-5", { drawPile: [card("G", "1"), ...filler(5)] });
    const r = applyAction(s, { type: "drawCard", seat: 0 }, ctx());
    expect(r.state.board!.hands[0]).toHaveLength(3);
    expect(r.state.board!.currentSeat).toBe(1);
  });
});

describe("神授：什么时候**不能**空过", () => {
  it("手上有能打的牌 → 不给（04 原文是「**无牌可出**时」，不是随便过）", () => {
    const s = seated([card("R", "3"), ...STUCK()]);
    expect(canEnd(s)).toBe(false);
    expect(endTurn(s).rejected?.reason).toBe("must_draw_first");
  });

  it("未亮出 → 回到 U1（V3）", () => {
    const s = seated(STUCK(), "heart-5", { revealed: [false, false, false] });
    expect(canEnd(s)).toBe(false);
    expect(endTurn(s).rejected?.reason).toBe("must_draw_first");
  });

  it("被封印 → 回到 U1（P9 封印含被动）", () => {
    const s = seated(STUCK(), "heart-5", { statuses: [["封印"], [], []] });
    expect(canEnd(s)).toBe(false);
    expect(endTurn(s).rejected?.reason).toBe("must_draw_first");
  });

  it("没有这个技能的人照旧必须先摸（对照组）", () => {
    const s = seated(STUCK(), null);
    expect(canEnd(s)).toBe(false);
    expect(endTurn(s).rejected?.reason).toBe("must_draw_first");
  });

  it("是别人的回合 → 轮不到你结束（targeting: self 之外，脊梁那条 not_your_turn 也在）", () => {
    const s = seated(STUCK(), "heart-5", { currentSeat: 1 });
    expect(canEnd(s, 0)).toBe(false);
    expect(endTurn(s, 0).rejected?.reason).toBe("not_your_turn");
  });

  it("惩罚轮里选了叠 → 只能叠，不能空过（P3）", () => {
    const chain: PunishChain = {
      initiator: 1,
      segments: [{ seat: 1, face: "+2", draw: 2, color: "Y" }],
      total: 2,
    };
    const s = seated(STUCK(), "heart-5", { punish: chain });
    expect(canEnd(s)).toBe(false);
    expect(endTurn(s).rejected?.reason).toBe("must_stack");
  });

  it("挂着反应窗口时谁都不能结束回合", () => {
    const s: GameState = {
      ...seated(STUCK()),
      pendingWindow: {
        type: "punishStack", actors: [1], deadline: "2026-07-28T12:00:30.000Z", defaultChoice: "accept", resume: "play",
      },
    };
    expect(endTurn(s).rejected?.reason).toBe("pending_window");
  });
});

describe("神授：「无牌可出」的口径与出牌路径同源", () => {
  it("五彩把「只靠颜色相同」的牌锁掉之后，那也算无牌可出（03 §4）", () => {
    // 红 3 只靠颜色接得上红 7；带五彩就打不出去 → 无牌可出
    const s = seated([card("R", "3")], "heart-5", { statuses: [["五彩"], [], []] });
    expect(canEnd(s)).toBe(true);
    expect(endTurn(s).rejected).toBeUndefined();
    // 对照：没有五彩时那张红 3 打得出，就不能空过
    expect(canEnd(seated([card("R", "3")]))).toBe(false);
  });

  it("无色牌任何时候都打得出 → 有它就不算无牌可出", () => {
    expect(canEnd(seated([card(null, "wild"), ...STUCK()]))).toBe(false);
  });

  it("摸到可打的牌之后，「结束回合」照旧只有一条（不会因为神授出现两条）", () => {
    const s = seated(STUCK(), "heart-5", { drawPile: [card("R", "1"), ...filler(5)] });
    const drew = applyAction(s, { type: "drawCard", seat: 0 }, ctx()).state;
    expect(drew.board!.drawnPlayable?.id).toBeDefined();
    expect(legalActions(drew, 0).filter((a) => a.type === "endTurn")).toHaveLength(1);
  });
});

describe("神授：判据是唯一出处（恋战将来问同一个）", () => {
  const withEffect = (id: string, over: Record<string, unknown>): SkillData => {
    const def = SKILL_DATA.byId.get(id)!;
    return { byId: new Map(SKILL_DATA.byId).set(id, { ...def, effects: [{ ...def.effects![0], ...over }] }) };
  };

  it("默认 true：U1 是基础规则，没人改它就必须摸", () => {
    const b = seated(STUCK(), null).board!;
    expect(mustDrawWhenStuck(b, 0)).toBe(true);
  });

  it("有神授且无牌可出 → false；有牌可出 → 仍是 true", () => {
    expect(mustDrawWhenStuck(seated(STUCK()).board!, 0)).toBe(false);
    expect(mustDrawWhenStuck(seated([card("R", "3")]).board!, 0)).toBe(true);
  });

  it("数据驱动：把定义里的 draw_obligation 去掉，行为立刻回到 U1", () => {
    const b = seated(STUCK()).board!;
    expect(mustDrawWhenStuck(b, 0, withEffect("heart-5", { modifies: [] }))).toBe(true);
  });
});

// ───────────────────────── 01-S17b：「一定要摸」的五种情形（2026-08-03 给全）

describe("神授：五种情形照摸，其余一律先问一句（01-S17b）", () => {
  it("五条判据只认 kind / initiator / reason，不认技能 id", () => {
    const forced = [
      { kind: "punish" as const, base: 4, seat: 0 }, // ① 受到惩罚
      { kind: "skill" as const, base: 2, seat: 0, initiator: 1 }, // ③ 他人技能
      { kind: "rule" as const, base: 3, seat: 0, reason: "poison" as const }, // ② 打出毒
      { kind: "rule" as const, base: 1, seat: 0, reason: "lastCard" as const }, // ④ 末牌非数字的补摸
      { kind: "rule" as const, base: 2, seat: 0, reason: "unoPenalty" as const }, // ⑤ UNO 罚摸
    ];
    for (const req of forced) expect(drawIsForced(req), JSON.stringify(req)).toBe(true);
    // 其余：U1 那一张、自己技能造成的
    expect(drawIsForced({ kind: "rule", base: 1, seat: 0 })).toBe(false);
    expect(drawIsForced({ kind: "skill", base: 2, seat: 0, initiator: 0 })).toBe(false);
    expect(drawIsForced({ kind: "skill", base: 2, seat: 0 })).toBe(false); // 缺席 = 自己
  });

  it("① 惩罚照摸：神授不救惩罚（吃 4 张就是 4 张，一句都不问）", () => {
    const chain: PunishChain = {
      initiator: 1,
      segments: [{ seat: 1, face: "+2", draw: 2, color: "Y" }, { seat: 1, face: "+2", draw: 2, color: "Y" }],
      total: 4,
    };
    const s: GameState = {
      ...seated(STUCK(), "heart-5", { currentSeat: 1, punish: chain }),
      phase: "play",
      pendingWindow: {
        type: "punishStack", actors: [0], deadline: "2026-07-28T12:00:30.000Z", defaultChoice: "accept", resume: "play",
      },
    };
    const r = applyAction(s, { type: "respond", seat: 0, windowId: `w${s.version}:punishStack`, choice: "accept" }, ctx());
    expect(r.state.board!.hands[0]).toHaveLength(2 + 4);
    expect(r.state.pendingWindow).toBeUndefined();
  });

  it("④ 打出的最后一张是非数字牌 → U5 的补摸照摸（不问）", () => {
    const rev = card("R", "rev");
    const r = applyAction(seated([rev], "heart-5"), { type: "playCards", seat: 0, cardIds: [rev.id] }, ctx());
    expect(r.state.board!.hands[0]).toHaveLength(1); // 补摸的那张
    expect(r.state.pendingWindow).toBeUndefined();
  });

  it("⑤ 被抓漏喊的罚摸照摸（不问）", () => {
    const s = seated([card("R", "3")], "heart-5", {
      currentSeat: 1,
      saidUno: [false, false, false],
      unoGrace: { seat: 2, until: "2026-07-28T11:00:00.000Z" },
    });
    const r = applyAction(s, { type: "catchUno", seat: 1, target: 0 }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(3); // 1 + 罚摸 2
  });

  it("非强制的摸 N 弃 N（洗牌②）→ 先问一句「要不要」，不要就一张不摸", () => {
    const shuffle = card(null, "shuffle");
    const s = seated([shuffle, card("R", "3")], "heart-5", { rulePack: "gods" });
    const played = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [shuffle.id], chosenColor: "R", shuffleChoice: "drawDiscard" }, ctx(),
    );
    expect(played.state.pendingWindow?.type).toBe("drawOffer");
    expect(played.state.board!.drawOffer).toMatchObject({ seat: 0, req: { base: 1 } });
    expect(played.state.board!.hands[0]).toHaveLength(1); // 只出掉了洗牌牌，一张没摸

    const declined = applyAction(
      played.state, { type: "respond", seat: 0, windowId: `w${played.state.version}:drawOffer`, choice: "decline" }, ctx(),
    );
    expect(declined.state.board!.hands[0]).toHaveLength(1);
    expect(declined.state.board!.currentSeat).toBe(1);
  });

  it("同一张洗牌②：没有神授的人不问，照旧摸 1 弃 1（对照组）", () => {
    const shuffle = card(null, "shuffle");
    const s = seated([shuffle, card("R", "3")], null, { rulePack: "gods" });
    const played = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [shuffle.id], chosenColor: "R", shuffleChoice: "drawDiscard" }, ctx(),
    );
    expect(played.state.pendingWindow?.type).toBe("drawDiscard");
    expect(played.state.board!.hands[0]).toHaveLength(2); // 1 张原有 + 摸的 1 张，等着弃
  });

  it("要 → 照常摸 N 弃 N（问一句不改结果，只是多一步）", () => {
    const shuffle = card(null, "shuffle");
    const s = seated([shuffle, card("R", "3")], "heart-5", { rulePack: "gods" });
    const played = applyAction(
      s, { type: "playCards", seat: 0, cardIds: [shuffle.id], chosenColor: "R", shuffleChoice: "drawDiscard" }, ctx(),
    );
    const took = applyAction(
      played.state, { type: "respond", seat: 0, windowId: `w${played.state.version}:drawOffer`, choice: "take" }, ctx(),
    );
    expect(took.state.pendingWindow?.type).toBe("drawDiscard");
    expect(took.state.board!.hands[0]).toHaveLength(2);
  });
});
