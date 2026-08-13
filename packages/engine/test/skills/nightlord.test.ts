// 司夜♣3：①打出无色牌掷骰获盗、②阶段 1 花 1 盗与人盲换 1 张、③3/5 盗放宽末牌。
// 规则：04 ♣3（含 2026-07-30 补齐的②流程）、01-T2/S16/U5、06-Q11/Q34/Q57。
import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../../src/index.ts";
import { loadSkills } from "../../src/skills/registry.ts";
import { markCount } from "../../src/skills/primitives/marks.ts";
import { card, ctx, roll, table } from "../helpers.ts";
import type { Action, Board, Card, GameState } from "../../src/types.ts";

const R7 = card("R", "7");
const LATER = "2026-07-28T12:00:31.000Z";

/** 3 人局：座位 0 持司夜并已亮出（V3），牌顶红 7。 */
const seated = (over: Partial<Board> = {}, hands?: Card[][]) =>
  table(hands ?? [[card(null, "wild"), card("R", "1")], [card("Y", "5"), card("B", "2")], [card("Y", "2")]], {
    skills: ["club-3", null, null],
    revealed: [true, false, false],
    playedPile: [R7],
    ...over,
  });

const wid = (s: GameState) => `w${s.version}:${s.pendingWindow!.type}`;
const play = (s: GameState, seat: number, id: string, extra: Record<string, unknown> = {}, rng = roll(2)) =>
  applyAction(s, { type: "playCards", seat, cardIds: [id], ...extra } as Action, ctx(rng));
const respond = (s: GameState, seat: number, choice: string) =>
  applyAction(s, { type: "respond", seat, windowId: wid(s), choice }, ctx());
const steal = (s: GameState, target: number, pick = 0) =>
  applyAction(s, { type: "stealSwap", seat: 0, target }, ctx(() => pick));
const stealsOf = (s: GameState, seat = 0) => markCount(s.board!, seat, "盗");

// ---------------------------------------------------------------- ① 获盗

describe("司夜① 打出无色牌获盗", () => {
  it("打变色牌掷 2 → 获 2 个盗，点数与标记都进 public", () => {
    const s = seated();
    const r = play(s, 0, s.board!.hands[0][0].id, { chosenColor: "G" }, roll(2));
    expect(r.rejected).toBeUndefined();
    expect(r.events.map((e) => e.type)).toEqual(["cardPlayed", "diceRolled", "marksGained"]);
    expect(r.events[1].public).toEqual({ seat: 0, reason: "nightlord-steal", values: [2] });
    expect(r.events[2].public).toEqual({ seat: 0, mark: "盗", n: 2, total: 2 });
    expect(stealsOf(r.state)).toBe(2);
    // 变色牌不是停/转：照常交给下家
    expect(r.state.board!.currentSeat).toBe(1);
  });

  it("打数字牌一颗骰都不掷", () => {
    const s = seated();
    const r = play(s, 0, s.board!.hands[0][1].id);
    expect(r.events.some((e) => e.type === "diceRolled")).toBe(false);
    expect(stealsOf(r.state)).toBe(0);
  });

  it("V3：没亮出就不获盗", () => {
    const s = seated({ revealed: [false, false, false] });
    const r = play(s, 0, s.board!.hands[0][0].id, { chosenColor: "G" }, roll(2));
    expect(stealsOf(r.state)).toBe(0);
  });

  it("01-P9：被封印的司夜不获盗", () => {
    const s = seated({ statuses: [["封印"], [], []] });
    expect(stealsOf(play(s, 0, s.board!.hands[0][0].id, { chosenColor: "G" }, roll(2)).state)).toBe(0);
  });

  it("06-Q34：惩罚轮里叠 +4 照样获盗", () => {
    const s = seated({ currentSeat: 2 }, [
      [card(null, "+4"), card("R", "1")],
      [card("Y", "5")],
      [card("R", "+2")],
    ]);
    const opened = play(s, 2, s.board!.hands[2][0].id).state;
    const stacked = respond(opened, 0, "stack").state;
    const r = play(stacked, 0, stacked.board!.hands[0][0].id, { chosenColor: "G" }, roll(1));
    expect(stealsOf(r.state)).toBe(1);
    expect(r.state.board!.punish!.total).toBe(6);
  });
});

describe("司夜①与惩罚窗口的时序", () => {
  it("+4：先掷骰结算盗，再开惩罚窗口——两个窗口不同时挂", () => {
    const s = seated({}, [[card(null, "+4"), card("R", "1")], [card("Y", "5")], [card("Y", "2")]]);
    const r = play(s, 0, s.board!.hands[0][0].id, { chosenColor: "G" }, roll(2));
    expect(r.events.map((e) => e.type)).toEqual([
      "cardPlayed",
      "diceRolled",
      "marksGained",
      "punishWindowOpened",
    ]);
    expect(r.state.pendingWindow!.type).toBe("punishStack");
    expect(r.state.pendingWindow!.actors).toEqual([1]);
    expect(stealsOf(r.state)).toBe(2);
  });

  it("场上有强袭时：先挂接管窗口，盗与惩罚窗口都等它结完", () => {
    const s = seated({ skills: ["club-3", "diamond-1", null], revealed: [true, true, false] }, [
      [card(null, "+4"), card("R", "1")],
      [card("Y", "5")],
      [card("Y", "2")],
    ]);
    const rolled = play(s, 0, s.board!.hands[0][0].id, { chosenColor: "G" }, roll(2));
    expect(rolled.state.pendingWindow!.type).toBe("diceTakeover");
    expect(stealsOf(rolled.state)).toBe(0);

    const settled = respond(rolled.state, 1, "pass").state;
    expect(stealsOf(settled)).toBe(2);
    expect(settled.pendingWindow!.type).toBe("punishStack");
    expect(settled.pendingDice).toBeUndefined();
  });

  it("强袭接管重掷 → 获盗按接管者的点数", () => {
    const s = seated({ skills: ["club-3", "diamond-1", null], revealed: [true, true, false] });
    const rolled = play(s, 0, s.board!.hands[0][0].id, { chosenColor: "G" }, roll(2));
    const taken = applyAction(
      rolled.state,
      { type: "respond", seat: 1, windowId: wid(rolled.state), choice: "takeover" },
      ctx(roll(0)),
    );
    expect(stealsOf(taken.state)).toBe(0);
  });
});

// ---------------------------------------------------------------- ② 花盗换牌

/** 座位 0 持 2 个盗，座位 1 手里两张（Y5 在前）。 */
const withSteals = (n = 2, over: Partial<Board> = {}) =>
  seated({ marks: [{ 盗: n }, {}, {}], ...over });

describe("司夜② 花盗换牌", () => {
  it("盲抽：盗 −1，抽走的牌进自己手，窗口等还牌", () => {
    const s = withSteals();
    const target = s.board!.hands[1][0];
    const r = steal(s, 1);
    expect(r.rejected).toBeUndefined();
    expect(stealsOf(r.state)).toBe(1);
    expect(r.state.board!.hands[0].map((c) => c.id)).toContain(target.id);
    expect(r.state.board!.hands[1].map((c) => c.id)).not.toContain(target.id);
    expect(r.state.pendingWindow).toMatchObject({ type: "swapReturn", actors: [0], defaultChoice: "stolen" });
  });

  it("还一张自己原有的牌：牌到对方手里，回合还在自己这儿", () => {
    const s = withSteals();
    const mine = s.board!.hands[0][1];
    const drawn = steal(s, 1).state;
    const r = respond(drawn, 0, mine.id);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[1].map((c) => c.id)).toContain(mine.id);
    expect(r.state.board!.hands[0].map((c) => c.id)).not.toContain(mine.id);
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.currentSeat).toBe(0);
    expect(r.state.phase).toBe("turnStart");
  });

  it("还刚抽到的那张 = 双方手牌原样恢复，只少了 1 个盗", () => {
    const s = withSteals();
    const before = s.board!.hands.map((h) => h.map((c) => c.id).sort());
    const stolen = s.board!.hands[1][0];
    const r = respond(steal(s, 1).state, 0, stolen.id);
    expect(r.state.board!.hands.map((h) => h.map((c) => c.id).sort())).toEqual(before);
    expect(stealsOf(r.state)).toBe(1);
  });

  it("同一阶段 1 可以连花：两次换牌 = 盗 −2", () => {
    const s = withSteals();
    const once = respond(steal(s, 1).state, 0, "stolen").state;
    const twice = respond(steal(once, 2).state, 0, "stolen").state;
    expect(stealsOf(twice)).toBe(0);
    expect(twice.board!.activatedThisTurn).toEqual([false, false, false]); // 06-Q57：不占 V7
  });

  // 01-U7：抓漏喊的窗口自其**回合结束**开启。换牌窗口挂着时目标手上少了一张是**假象**——
  // 他既不在回合结束、也从未真正持有 1 张，抓不得。
  it("换牌窗口挂着时，2 张手牌的目标抓不得（01-U7）", () => {
    // 座位 1 恰好 2 张：盲抽走 1 张之后看上去只剩 1 张
    const s = withSteals();
    expect(s.board!.hands[1]).toHaveLength(2);
    const drawn = steal(s, 1).state;
    expect(drawn.board!.hands[1]).toHaveLength(1);
    expect(applyAction(drawn, { type: "catchUno", seat: 2, target: 1 }, ctx()).rejected?.reason)
      .toBe("not_catchable");
    expect(legalActions(drawn, 2).some((a) => a.type === "catchUno" && a.target === 1)).toBe(false);
    // 还完牌他就是 2 张，本来也抓不着
    const back = respond(drawn, 0, "stolen").state;
    expect(back.board!.hands[1]).toHaveLength(2);
  });

  it("超时：默认还刚抽到的那张", () => {
    const s = withSteals();
    const before = s.board!.hands.map((h) => h.map((c) => c.id).sort());
    const drawn = steal(s, 1).state;
    const r = applyAction(drawn, { type: "claimTimeout", seat: 1, windowId: wid(drawn) }, ctx(roll(0), LATER));
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands.map((h) => h.map((c) => c.id).sort())).toEqual(before);
  });
});

describe("司夜②的隐私", () => {
  it("抽到什么只有双方知道：public 里搜不到牌 id，两边各收到一条 private", () => {
    const s = withSteals();
    const stolen = s.board!.hands[1][0];
    const r = steal(s, 1);
    expect(JSON.stringify(r.events.map((e) => e.public))).not.toContain(stolen.id);
    expect(r.events.filter((e) => e.private).map((e) => e.private!.seat)).toEqual([0, 1]);
    for (const e of r.events.filter((e) => e.private))
      expect((e.private!.payload.card as Card).id).toBe(stolen.id);
    // 公开的只有「谁与谁换了 1 张」
    expect(r.events[0].public).toMatchObject({ seat: 0, target: 1 });
  });

  it("盲抽的随机下标只进 audit", () => {
    const r = steal(withSteals(), 1, 0.99);
    expect(r.events[0].audit).toEqual({ index: 1 });
    expect(r.events[0].public.index).toBeUndefined();
  });

  it("还了哪张同样只有双方知道", () => {
    const s = withSteals();
    const mine = s.board!.hands[0][1];
    const r = respond(steal(s, 1).state, 0, mine.id);
    expect(JSON.stringify(r.events.map((e) => e.public))).not.toContain(mine.id);
    expect(r.events.filter((e) => e.private).map((e) => e.private!.seat)).toEqual([0, 1]);
  });

  it("旁观者的快照里没有换过的牌", () => {
    const s = withSteals();
    const stolen = s.board!.hands[1][0];
    expect(JSON.stringify(projectView(steal(s, 1).state, 2))).not.toContain(stolen.id);
  });
});

describe("司夜②的边界", () => {
  it("盗不够 → cost_unpayable，局面一点没动", () => {
    const s = withSteals(0);
    const r = steal(s, 1);
    expect(r.rejected?.reason).toBe("cost_unpayable");
    expect(r.state).toBe(s);
  });

  it("换自己、换空手的人都不行", () => {
    expect(steal(withSteals(), 0).rejected?.reason).toBe("bad_target");
    const empty = withSteals(2, { hands: [[card("R", "1")], [], [card("Y", "2")]] });
    expect(steal(empty, 1).rejected?.reason).toBe("bad_target");
  });

  it("没亮出（V3）/ 被封印（P9）都用不了", () => {
    expect(steal(withSteals(2, { revealed: [false, false, false] }), 1).rejected?.reason)
      .toBe("skill_unavailable");
    expect(steal(withSteals(2, { statuses: [["封印"], [], []] }), 1).rejected?.reason)
      .toBe("skill_unavailable");
  });

  it("不是自己的回合、或已经有窗口挂着 → 拒", () => {
    expect(steal(withSteals(2, { currentSeat: 1 }), 1).rejected?.reason).toBe("not_your_turn");
    const drawn = steal(withSteals(), 1).state;
    expect(steal(drawn, 2).rejected?.reason).toBe("pending_window");
  });

  it("还的必须是自己手里的牌", () => {
    expect(respond(steal(withSteals(), 1).state, 0, "no-such-card").rejected?.reason).toBe("not_in_hand");
  });

  // 01-T2：花盗要在**自己的阶段 1**。惩罚轮里换牌等于绕过 P1 的「只能叠或吃」，两条路都堵死：
  // 窗口挂着时是 pending_window，叠链者接管回合后相位是 play 而不是 turnStart。
  it("惩罚轮用不了②：窗口挂着时拒，叠链接管回合后（phase=play）也拒", () => {
    const p2 = card("R", "+2");
    // 司夜坐在**座位 1**：座位 0 打 +2 指着他，他叠一张就接管了回合——但那是惩罚轮
    const s = seated(
      {
        skills: [null, "club-3", null],
        revealed: [false, true, false],
        marks: [{}, { 盗: 2 }, {}],
        drawPile: Array.from({ length: 20 }, () => card("G", "9")),
      },
      [[p2, card("R", "1")], [card("R", "+2"), card("Y", "5")], [card("Y", "2"), card("Y", "6")]],
    );
    const opened = play(s, 0, p2.id).state;
    expect(opened.pendingWindow!.type).toBe("punishStack");
    const swap = (st: GameState) => applyAction(st, { type: "stealSwap", seat: 1, target: 2 }, ctx());
    expect(swap(opened).rejected?.reason).toBe("pending_window");
    expect(legalActions(opened, 1).some((a) => a.type === "stealSwap")).toBe(false);

    const stacked = respond(opened, 1, "stack").state;
    expect(stacked.phase).toBe("play");
    expect(stacked.board!.currentSeat).toBe(1);
    expect(swap(stacked).rejected?.reason).toBe("wrong_phase");
    expect(legalActions(stacked, 1).some((a) => a.type === "stealSwap")).toBe(false);
  });
});

// ---------------------------------------------------------------- ③ 盗改末牌

describe("司夜③ 盗改末牌", () => {
  it("3 盗打出末张 +2：收官获胜、扣 3 盗、惩罚链不再结算", () => {
    const s = seated({ marks: [{ 盗: 3 }, {}, {}] }, [[card("R", "+2")], [card("Y", "5")], [card("Y", "2")]]);
    const r = play(s, 0, s.board!.hands[0][0].id);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.winner).toBe(0);
    expect(r.state.phase).toBe("finished");
    expect(stealsOf(r.state)).toBe(0);
    expect(r.state.board!.punish).toBeUndefined();
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.events.map((e) => e.type)).toEqual(["cardPlayed", "marksSpent", "gameEnded"]);
  });

  it("2 盗同一局面：走原 01-U5，摸 1 张不判胜", () => {
    const s = seated({ marks: [{ 盗: 2 }, {}, {}] }, [[card("R", "+2")], [card("Y", "5")], [card("Y", "2")]]);
    const r = play(s, 0, s.board!.hands[0][0].id);
    expect(r.state.board!.winner).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(1);
    expect(stealsOf(r.state)).toBe(2);
    expect(r.state.pendingWindow!.type).toBe("punishStack");
  });

  it("5 盗打出末张 +4（惩罚轮里合法叠）：收官获胜，扣 5 盗", () => {
    const s = seated({ currentSeat: 2, marks: [{ 盗: 5 }, {}, {}] }, [
      [card(null, "+4")],
      [card("Y", "5")],
      [card("R", "+2")],
    ]);
    const opened = play(s, 2, s.board!.hands[2][0].id).state;
    const stacked = respond(opened, 0, "stack").state;
    const r = play(stacked, 0, stacked.board!.hands[0][0].id, { chosenColor: "G" });
    expect(r.state.board!.winner).toBe(0);
    expect(stealsOf(r.state)).toBe(0);
    // 赢了就终局：①的掷骰与惩罚链都不再结算
    expect(r.events.some((e) => e.type === "diceRolled")).toBe(false);
  });

  it("3 盗但末张是无色牌：门槛是 5，走原 U5（摸 1 之后照样获盗）", () => {
    const s = seated({ marks: [{ 盗: 3 }, {}, {}] }, [[card(null, "wild")], [card("Y", "5")], [card("Y", "2")]]);
    const r = play(s, 0, s.board!.hands[0][0].id, { chosenColor: "G" }, roll(1));
    expect(r.state.board!.winner).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(1);
    expect(stealsOf(r.state)).toBe(4); // 3 + ①掷出的 1
  });

  it("06-Q11：仍须合法打出——接不上牌顶的功能牌照样拒", () => {
    const s = seated({ marks: [{ 盗: 5 }, {}, {}] }, [[card("Y", "+2")], [card("Y", "5")], [card("Y", "2")]]);
    const r = play(s, 0, s.board!.hands[0][0].id);
    expect(r.rejected?.reason).toBe("illegal_card");
    expect(r.state).toBe(s);
  });

  it("数字末牌照常获胜，一个盗都不扣（U5 本来就允许）", () => {
    const s = seated({ marks: [{ 盗: 5 }, {}, {}] }, [[card("R", "1")], [card("Y", "5")], [card("Y", "2")]]);
    const r = play(s, 0, s.board!.hands[0][0].id);
    expect(r.state.board!.winner).toBe(0);
    expect(stealsOf(r.state)).toBe(5);
  });
});

// ---------------------------------------------------------------- 可点性与快照

describe("司夜的 legalActions 与快照", () => {
  it("阶段 1 盗够花时，对每个有手牌的对手各给一条 stealSwap", () => {
    expect(legalActions(withSteals(), 0).filter((a) => a.type === "stealSwap")).toEqual([
      { type: "stealSwap", seat: 0, target: 1 },
      { type: "stealSwap", seat: 0, target: 2 },
    ]);
  });

  it("盗不够就没有那条动作", () => {
    expect(legalActions(withSteals(0), 0).some((a) => a.type === "stealSwap")).toBe(false);
  });

  it("还牌窗口里，自己手上每张牌各是一个选项（含刚抽那张）", () => {
    const drawn = steal(withSteals(), 1).state;
    expect(legalActions(drawn, 0).filter((a) => a.type === "respond").map((a) => a.choice))
      .toEqual(drawn.board!.hands[0].map((c) => c.id));
    // 单人窗口：别人插不了手
    expect(legalActions(drawn, 1).some((a) => a.type === "respond")).toBe(false);
  });

  it("03 §5：盗是公开计数，别人的快照里也看得到", () => {
    const s = withSteals(3);
    expect(projectView(s, 2).players[0].marks).toEqual({ 盗: 3 });
    expect(projectView(s, 0).players[0].marks).toEqual({ 盗: 3 });
  });

  it("③同样点名 play_legality，但司夜不能一次打多张（那是并列的）", () => {
    expect(projectView(seated(), 0).canPlayMultiple).toBe(false);
  });

  it("司夜在抽 3 选 1 的池里（行为建好了才进池）", () => {
    expect(loadSkills().pool.map((s) => s.id)).toContain("club-3");
  });
});
