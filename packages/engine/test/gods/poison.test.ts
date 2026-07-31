/**
 * 毒（05 §2b「毒（5 张）」）。规则出处：01-P1（打出毒不是惩罚）、01-P1b（同命不响应）、
 * 01-U5 的 2026-07-31 判定时点澄清（摸完 3 张手牌非空 → 不补摸）。
 * spec：`docs/superpowers/specs/2026-08-01-gods-cards/01-毒.md`
 */
import { describe, expect, it } from "vitest";
import { applyAction, buildDeck, legalActions } from "../../src/index.ts";
import { card, ctx, table } from "../helpers.ts";

const R7 = card("R", "7");
const poison = () => card(null, "poison");

/** 摸牌堆按顺序给出这几张，够 3 张有余。 */
const pile = () => [card("G", "1"), card("G", "2"), card("G", "3"), card("G", "4")];

describe("毒（05 §2b）", () => {
  it("worked example：打出毒 → 自己摸 3 张、定色、轮到下家", () => {
    const p = poison();
    const s = table(
      [[p, card("R", "1"), card("R", "2")], [card("Y", "1")], [card("Y", "2")], [card("Y", "3")]],
      { playedPile: [R7], drawPile: pile() },
    );
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [p.id], chosenColor: "B" }, ctx());

    expect(r.rejected).toBeUndefined();
    const b = r.state.board!;
    expect(b.hands[0]).toHaveLength(5); // 3 − 1（打出）+ 3（毒）
    expect(b.playedPile[0]).toEqual(p);
    expect(b.activeColor).toBe("B");
    expect(b.activeFace ?? null).toBeNull();
    expect(b.currentSeat).toBe(1);
    // 没开任何窗口，一次 apply 跑完
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.version).toBe(11);
  });

  it("U5（2026-07-31 澄清）：毒作末牌 → 摸 3 张后手牌非空，**不再补摸第 4 张**、不判胜", () => {
    const p = poison();
    const s = table([[p], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7], drawPile: pile() });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [p.id], chosenColor: "G" }, ctx());

    const b = r.state.board!;
    expect(b.hands[0]).toHaveLength(3);
    expect(b.winner).toBeUndefined();
    expect(r.state.phase).toBe("turnStart");
    expect(b.currentSeat).toBe(1);
  });

  it("司夜③ 持 5 盗以毒收官：**打出即胜**，那 3 张不再摸（2026-08-01 裁定）", () => {
    const p = poison();
    const s = table([[p], [card("Y", "1")], [card("Y", "2")]], {
      playedPile: [R7],
      drawPile: pile(),
      skills: ["club-3", null, null],
      revealed: [true, false, false],
      marks: [{ 盗: 5 }, {}, {}],
    });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [p.id], chosenColor: "G" }, ctx());

    expect(r.state.phase).toBe("finished");
    expect(r.state.board!.winner).toBe(0);
    expect(r.state.board!.hands[0]).toHaveLength(0); // 赢了就不再摸那 3 张
    expect(r.state.board!.marks[0]["盗"]).toBe(0); // 变色牌门槛 5 盗
  });

  it("P1：毒摸的 3 张不是惩罚——不开惩罚窗口、不建链", () => {
    const p = poison();
    const s = table([[p, card("R", "1")], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7], drawPile: pile() });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [p.id], chosenColor: "R" }, ctx());

    expect(r.state.board!.punish).toBeUndefined();
    expect(r.events.some((e) => e.type === "punishWindowOpened")).toBe(false);
    // 摸牌事件按 spec §4 分层：公开只说张数，牌面走 private
    const drawn = r.events.find((e) => e.type === "cardsDrawn")!;
    expect(drawn.public).toEqual({ seat: 0, count: 3 });
    expect(drawn.private?.seat).toBe(0);
  });

  it("P1：恩惠♥1 减不到毒的 3 张（它只吃 punish 与**他人**技能，毒走 rule）", () => {
    const p = poison();
    // 座位 0 亮着恩惠。`kind` 若被误改成 "skill"，恩惠的 −2 就会咬进来 → 摸 1 张，本条当场变红
    const s = table([[p, card("R", "1")], [card("Y", "1")], [card("Y", "2")]], {
      playedPile: [R7],
      drawPile: pile(),
      skills: ["heart-1", null, null],
      revealed: [true, false, false],
    });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [p.id], chosenColor: "R" }, ctx());

    expect(r.rejected).toBeUndefined();
    expect(r.events.find((e) => e.type === "cardsDrawn")!.public).toEqual({ seat: 0, count: 3 });
    expect(r.state.board!.hands[0]).toHaveLength(4); // 2 − 1 + 3
  });

  it("U1：毒摸到的牌不设 drawnPlayable——不会把本回合收窄成「只能打那张」", () => {
    const p = poison();
    // 摸到的第一张是 R1，牌顶 R7 跟色 R → 本来「可打」，但它不是 U1 那条路摸的
    const s = table([[p, card("B", "9")], [card("Y", "1")], [card("Y", "2")]], {
      playedPile: [R7],
      drawPile: [card("R", "1"), card("R", "2"), card("R", "3")],
    });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [p.id], chosenColor: "R" }, ctx());

    expect(r.state.board!.drawnPlayable).toBeNull();
    // 回合已经交出去了，座位 0 手上没有动作
    expect(legalActions(r.state, 0).some((a) => a.type === "playCards")).toBe(false);
  });

  it("定色：不带 chosenColor → color_required；三选一是洗牌的特权，毒带了要拒", () => {
    const p = poison();
    const s = table([[p, card("R", "1")], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7], drawPile: pile() });

    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [p.id] }, ctx()).rejected?.reason)
      .toBe("color_required");
    expect(
      applyAction(s, { type: "playCards", seat: 0, cardIds: [p.id], chosenColor: "R", shuffleChoice: "shuffle" }, ctx())
        .rejected?.reason,
    ).toBe("shuffle_choice_not_allowed");
  });

  it("牌堆枯竭：摸到 0 张时手牌仍为 0 → 回落到 U5 的通用补摸，引擎不抛", () => {
    const p = poison();
    // 洗回上限已满（U8）且摸牌堆空 → drawCards 一张也给不出来
    const s = table([[p], [card("Y", "1")], [card("Y", "2")]], {
      playedPile: [R7],
      drawPile: [],
      discardPile: [],
      reshuffles: 2,
    });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [p.id], chosenColor: "R" }, ctx());

    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(0);
    expect(r.state.board!.winner).toBeUndefined(); // 功能牌打完不判胜
  });

  it("P3：惩罚链挂着时打毒 → must_stack（毒不是 +2/+4）", () => {
    const p = poison();
    const s = table([[p, card("R", "1")], [card("Y", "1")], [card("Y", "2")]], {
      playedPile: [card("R", "+2")],
      punish: { initiator: 2, segments: [{ seat: 2, face: "+2", draw: 2 }], total: 2 },
    });
    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [p.id], chosenColor: "R" }, ctx()).rejected?.reason)
      .toBe("must_stack");
  });

  it("牌组：毒只在诸神包里，5 张（05 §3）", () => {
    expect(buildDeck("base").filter((c) => c.face === "poison")).toHaveLength(0);
    expect(buildDeck("gods").filter((c) => c.face === "poison")).toHaveLength(5);
  });
});
