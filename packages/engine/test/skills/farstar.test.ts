// 远星♦J：惩罚窗口里的第三个选项——弃一张代价牌，视为自己也叠了一张进链。
// 规则：01-P7（视为打出 = 合法叠链接法，摸 2 是代价不计惩罚）、04 ♦J（视为的 +4 用所弃 +2 的颜色）、
// 06-Q34（不占主动）、06-Q54（付不起不能发动）、06-Q55（代价牌进弃牌堆）、06-Q56（initiator）。
import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../../src/index.ts";
import { settleFarstar, windowIdOf } from "../../src/actions/punish.ts";
import { skills } from "../../src/skills/registry.ts";
import { card, ctx, table } from "../helpers.ts";
import type { Board, Card, Color, GameState } from "../../src/types.ts";

const R7 = card("R", "7");
const filler = (n: number) => Array.from({ length: n }, () => card("G", "9"));

/** 3 人局：座位 1 持远星并已亮出（V3）。座位 0 打出 `lead` 开链，窗口落在座位 1。 */
function opened(o: {
  lead: Card;
  hand1: Card[];
  hand2?: Card[];
  over?: Partial<Board>;
  chosenColor?: Color;
}): GameState {
  const s = table([[o.lead, card("R", "1")], o.hand1, o.hand2 ?? [card("Y", "2"), card("Y", "4")]], {
    skills: [null, "diamond-j", null],
    revealed: [false, true, false],
    playedPile: [R7],
    drawPile: filler(30),
    ...o.over,
  });
  return applyAction(
    s,
    { type: "playCards", seat: 0, cardIds: [o.lead.id], chosenColor: o.chosenColor },
    ctx(),
  ).state;
}

const farstar = (s: GameState, seat: number, cardId: string) =>
  applyAction(s, { type: "respond", seat, windowId: windowIdOf(s)!, choice: "farstar", cardIds: [cardId] }, ctx());

const responds = (s: GameState, seat: number) =>
  legalActions(s, seat).filter((a) => a.type === "respond");

// ------------------------------------------------------------ 尾段是 +2

describe("远星：尾段是 +2（弃同色停/转）", () => {
  it("视为叠一张同色 +2 进链，链传给下家", () => {
    const skip = card("R", "skip");
    const s = opened({ lead: card("R", "+2"), hand1: [skip, card("Y", "3")] });
    const r = farstar(s, 1, skip.id);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.punish).toEqual({
      initiator: 0,
      segments: [{ seat: 0, face: "+2", draw: 2 }, { seat: 1, face: "+2", draw: 2 }],
      total: 4,
    });
    expect(r.state.pendingWindow!.actors).toEqual([2]);
    expect(r.state.board!.activeColor).toBe("R");
  });

  it("06-Q55：代价牌进弃牌堆，出牌堆一动不动（视为打出的那张是虚拟的）", () => {
    const rev = card("R", "rev");
    const s = opened({ lead: card("R", "+2"), hand1: [rev, card("Y", "3")] });
    const r = farstar(s, 1, rev.id);
    expect(r.state.board!.discardPile).toEqual([rev]);
    expect(r.state.board!.playedPile).toEqual(s.board!.playedPile);
  });

  it("弃 1 摸 2 是代价（01-P7）：手牌净 +1", () => {
    const skip = card("R", "skip");
    const s = opened({ lead: card("R", "+2"), hand1: [skip, card("Y", "3")] });
    expect(farstar(s, 1, skip.id).state.board!.hands[1]).toHaveLength(3);
  });

  it("弃的那张与视为的那一段全公开，摸的 2 张只发给自己", () => {
    const skip = card("R", "skip");
    const s = opened({ lead: card("R", "+2"), hand1: [skip, card("Y", "3")] });
    const r = farstar(s, 1, skip.id);
    expect(r.events.find((e) => e.type === "farstarUsed")!.public).toEqual({
      seat: 1,
      discarded: [skip],
      as: "+2",
      color: "R",
    });
    const drew = r.events.find((e) => e.type === "cardsDrawn")!;
    expect(drew.public).toEqual({ seat: 1, count: 2 });
    expect(drew.private!.seat).toBe(1);
  });

  it("别人的快照里搜不到那 2 张，但弃掉的代价牌谁都看得到（02 §5）", () => {
    const skip = card("R", "skip");
    const s = opened({ lead: card("R", "+2"), hand1: [skip, card("Y", "3")] });
    const r = farstar(s, 1, skip.id);
    const drawn = r.events.find((e) => e.type === "cardsDrawn")!.private!.payload.cards as Card[];
    const view = JSON.stringify(projectView(r.state, 2));
    for (const c of drawn) expect(view).not.toContain(c.id);
    expect(view).toContain(skip.id);
  });
});

// ------------------------------------------------------------ 尾段是 +4

describe("远星：尾段是 +4（弃 +2，任意色）", () => {
  it("04 ♦J：视为的 +4 用**所弃 +2 的颜色**，不能另选定色", () => {
    const b2 = card("B", "+2");
    const s = opened({ lead: card(null, "+4"), hand1: [b2, card("Y", "3")], chosenColor: "Y" });
    expect(s.board!.activeColor).toBe("Y");
    const r = farstar(s, 1, b2.id);
    expect(r.state.board!.activeColor).toBe("B");
    expect(r.state.board!.punish!.segments[1]).toEqual({ seat: 1, face: "+4", draw: 4 });
    expect(r.state.board!.punish!.total).toBe(8);
  });

  it("P5：视为的这一段是 +4，所以下家只剩「吃下」可选", () => {
    const b2 = card("B", "+2");
    const s = opened({
      lead: card(null, "+4"),
      hand1: [b2, card("Y", "3")],
      hand2: [card("Y", "+2"), card("G", "5")],
      chosenColor: "Y",
    });
    const r = farstar(s, 1, b2.id);
    expect(responds(r.state, 2).map((a) => a.type === "respond" && a.choice)).toEqual(["accept"]);
  });

  it("链上多段之后仍按**尾段**判断：A 打 +2、B 叠 +4，C 要弃的是 +2 而不是同色停", () => {
    const p2 = card("R", "+2");
    const p4 = card(null, "+4");
    const skip = card("R", "skip");
    const b2 = card("B", "+2");
    const s = table([[p2, card("G", "1")], [p4, card("G", "2")], [skip, b2, card("G", "5")]], {
      skills: [null, null, "diamond-j"],
      revealed: [false, false, true],
      playedPile: [R7],
      drawPile: filler(30),
    });
    const a = applyAction(s, { type: "playCards", seat: 0, cardIds: [p2.id] }, ctx()).state;
    const chose = applyAction(a, { type: "respond", seat: 1, windowId: windowIdOf(a)!, choice: "stack" }, ctx()).state;
    const b = applyAction(chose, { type: "playCards", seat: 1, cardIds: [p4.id], chosenColor: "Y" }, ctx()).state;
    // 红停只对 +2 尾段合法；此刻尾段是 +4，代价必须是一张 +2
    expect(farstar(b, 2, skip.id).rejected?.reason).toBe("cost_unpayable");
    const r = farstar(b, 2, b2.id);
    expect(r.state.board!.punish!.total).toBe(10);
    expect(r.state.board!.activeColor).toBe("B");
  });
});

// ------------------------------------------------------------ 可点性与拒绝

describe("远星的可点性（06-Q54）", () => {
  it("legalActions 对每张合法代价牌各给一条：同色停与同色转都在，异色停与数字牌不在", () => {
    const skip = card("R", "skip");
    const rev = card("R", "rev");
    const s = opened({ lead: card("R", "+2"), hand1: [skip, rev, card("Y", "skip"), card("R", "3")] });
    const wid = windowIdOf(s)!;
    const offered = responds(s, 1).filter((a) => a.type === "respond" && a.choice === "farstar");
    expect(offered).toEqual([
      { type: "respond", seat: 1, windowId: wid, choice: "farstar", cardIds: [skip.id] },
      { type: "respond", seat: 1, windowId: wid, choice: "farstar", cardIds: [rev.id] },
    ]);
  });

  it("异色的停不是合法代价", () => {
    const ySkip = card("Y", "skip");
    const s = opened({ lead: card("R", "+2"), hand1: [ySkip, card("Y", "3")] });
    expect(farstar(s, 1, ySkip.id).rejected?.reason).toBe("cost_unpayable");
  });

  it("普通数字牌不是合法代价", () => {
    const r3 = card("R", "3");
    const s = opened({ lead: card("R", "+2"), hand1: [r3, card("R", "skip")] });
    expect(farstar(s, 1, r3.id).rejected?.reason).toBe("cost_unpayable");
  });

  it("一张合法代价牌都没有 → 选项根本不出现，硬发也发不了", () => {
    const y3 = card("Y", "3");
    const s = opened({ lead: card("R", "+2"), hand1: [y3, card("G", "4")] });
    expect(responds(s, 1).map((a) => a.type === "respond" && a.choice)).toEqual(["accept"]);
    expect(farstar(s, 1, y3.id).rejected?.reason).toBe("cost_unpayable");
  });

  it("V3：没亮出的远星对局面毫无影响", () => {
    const skip = card("R", "skip");
    const s = opened({
      lead: card("R", "+2"),
      hand1: [skip, card("Y", "3")],
      over: { revealed: [false, false, false] },
    });
    expect(responds(s, 1).map((a) => a.type === "respond" && a.choice)).toEqual(["accept"]);
    expect(farstar(s, 1, skip.id).rejected?.reason).toBe("skill_unavailable");
  });

  it("01-P9：被封印就用不了（封印不可例外）", () => {
    const skip = card("R", "skip");
    const s = opened({
      lead: card("R", "+2"),
      hand1: [skip, card("Y", "3")],
      over: { statuses: [[], ["封印"], []] },
    });
    expect(responds(s, 1).map((a) => a.type === "respond" && a.choice)).toEqual(["accept"]);
    expect(farstar(s, 1, skip.id).rejected?.reason).toBe("skill_unavailable");
  });
});

// ------------------------------------------------------------ 与别的账目的关系

describe("远星不是「发动」", () => {
  it("06-Q34：不占 V7 额度，也不发 skillActivated", () => {
    const skip = card("R", "skip");
    const s = opened({ lead: card("R", "+2"), hand1: [skip, card("Y", "3")] });
    const r = farstar(s, 1, skip.id);
    expect(r.state.board!.activatedThisTurn).toEqual([false, false, false]);
    expect(r.events.some((e) => e.type === "skillActivated")).toBe(false);
  });

  it("摸的 2 张是**自己**技能造成的代价：initiator = 自己，恩惠不减（06-Q56）", () => {
    // S2 一人一技能，恩惠与远星注定不可能同人，所以这条只能靠注入定义来测：
    // 牌桌上座位 1 拿的是恩惠（被动照常从生产定义生效），而 settleFarstar 读到的定义
    // 被换成「这个 id 上挂着远星那条响应」。恩惠若生效，2 张会被减成 1 张（L2 -2、L5 至少 1）。
    const skip = card("R", "skip");
    const s = opened({
      lead: card("R", "+2"),
      hand1: [skip, card("Y", "3")],
      over: { skills: [null, "heart-1", null] },
    });
    const r = settleFarstar(s, 1, [skip.id], ctx(), {
      byId: new Map([["heart-1", skills.byId.get("diamond-j")!]]),
    });
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[1]).toHaveLength(3);
  });

  it("01-U5：弃到 0 张不判胜，代价摸牌照常执行", () => {
    const skip = card("R", "skip");
    const s = opened({ lead: card("R", "+2"), hand1: [skip] });
    const r = farstar(s, 1, skip.id);
    expect(r.state.board!.winner).toBeUndefined();
    expect(r.state.phase).toBe("afterPlay");
    expect(r.state.board!.hands[1]).toHaveLength(2);
  });

  it("远星点名的 play_legality 不改出牌规则：既不能多张一起打，也不放宽末牌", () => {
    const skip = card("R", "skip");
    const s = table([[skip], [card("Y", "2"), card("Y", "3")], [card("B", "5"), card("B", "6")]], {
      skills: ["diamond-j", null, null],
      revealed: [true, false, false],
      playedPile: [R7],
      drawPile: filler(10),
    });
    expect(projectView(s, 0).canPlayMultiple).toBe(false);
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [skip.id] }, ctx());
    // U5：功能牌打空手牌不算赢，照旧摸 1 张
    expect(r.state.board!.winner).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(1);
  });
});
