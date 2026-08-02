// 强袭♦1：①打出 +2/+4 时掷骰定这一张的倍率；②任何人掷骰后可重掷同数量一次并采用你的结果。
// 规则：04 ♦1（2026-07-30 补齐的倍率算法）、01-R1（三面骰 0/1/2）、01-P6/P11、06-Q34、06-Q40。
import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../../src/index.ts";
import { rollDice, rollWithTakeover } from "../../src/actions/dice.ts";
import { loadSkills } from "../../src/skills/registry.ts";
import { card, ctx, lcg, roll, table } from "../helpers.ts";
import type { Action, Board, Card, GameState } from "../../src/types.ts";

const R7 = card("R", "7");
const LATER = "2026-07-28T12:00:31.000Z";

/** 3 人局：座位 0 持强袭并已亮出（V3），手里有一张红 +2。 */
const seated = (over: Partial<Board> = {}, hands?: Card[][]) =>
  table(hands ?? [[card("R", "+2"), card("R", "1")], [card("Y", "+2"), card(null, "+4")], [card("Y", "2")]], {
    skills: ["diamond-1", null, null],
    revealed: [true, false, false],
    playedPile: [R7],
    ...over,
  });

const wid = (s: GameState) => `w${s.version}:${s.pendingWindow!.type}`;
const play = (s: GameState, seat: number, id: string, extra: Record<string, unknown> = {}, rng = roll(2)) =>
  applyAction(s, { type: "playCards", seat, cardIds: [id], ...extra } as Action, ctx(rng));
const respond = (s: GameState, seat: number, choice: string, rng = roll(0)) =>
  applyAction(s, { type: "respond", seat, windowId: wid(s), choice }, ctx(rng));

/** 座位 0 带旗标打出红 +2，骰子掷出 `n`。返回接管窗口挂着的那一步。 */
const assaulted = (n: number, s = seated()) => play(s, 0, s.board!.hands[0][0].id, { useAssault: true }, roll(n));

// ---------------------------------------------------------------- ① 倍率

describe("强袭① 掷骰定倍率", () => {
  it("掷 2：段贡献 = 面值 × 点数 = 4（掷骰紧跟在 cardPlayed 之后）", () => {
    const rolled = assaulted(2);
    expect(rolled.rejected).toBeUndefined();
    expect(rolled.events.map((e) => e.type)).toEqual(["cardPlayed", "diceRolled", "diceTakeoverOpened"]);
    // 骰子还挂着，链没成型——贡献几张要等接管窗口结完才知道
    expect(rolled.state.board!.punish).toBeUndefined();

    const settled = respond(rolled.state, 0, "pass").state;
    expect(settled.board!.punish!.segments).toEqual([{ seat: 0, face: "+2", draw: 4, color: "R" }]);
    expect(settled.board!.punish!.total).toBe(4);
  });

  it("+4 掷 2 → 贡献 8", () => {
    const p4 = card(null, "+4");
    const s = seated({}, [[p4, card("R", "1")], [card(null, "+4")], [card("Y", "2")]]);
    const rolled = play(s, 0, p4.id, { useAssault: true, chosenColor: "G" }, roll(2));
    expect(respond(rolled.state, 0, "pass").state.board!.punish!.total).toBe(8);
  });

  it("掷 0：贡献就是 0，链照样成立", () => {
    const settled = respond(assaulted(0).state, 0, "pass").state;
    expect(settled.board!.punish!.segments).toEqual([{ seat: 0, face: "+2", draw: 0, color: "R" }]);
    expect(settled.board!.punish!.total).toBe(0);
    expect(settled.pendingWindow!.type).toBe("punishStack");
  });

  // 2026-07-31 裁定（02 §7 L5）：恩惠的「至少 1」是**减免的下限**，不是保底。
  // 掷 0 时惩罚基数就是 0，亮着恩惠的受罚者摸 0，不该反而摸 1。
  it("掷 0 且受罚者亮着恩惠：摸 0，不是摸 1", () => {
    const s = seated({ skills: ["diamond-1", "heart-1", null], revealed: [true, true, false] });
    const zero = respond(assaulted(0, s).state, 0, "pass").state;
    const eaten = respond(zero, 1, "accept");
    expect(eaten.state.board!.hands[1]).toHaveLength(2); // 一张没摸
    expect(eaten.events.find((e) => e.type === "cardsDrawn")!.public.count).toBe(0);
  });

  it("掷 0 之后下家照样叠得上（P4/P5 只看牌面），吃下按 total", () => {
    const zero = respond(assaulted(0).state, 0, "pass").state;
    const stacked = respond(zero, 1, "stack").state;
    const chained = play(stacked, 1, stacked.board!.hands[1][1].id, { chosenColor: "G" }).state;
    expect(chained.board!.punish!.total).toBe(4); // 0 + 4
    expect(respond(chained, 2, "accept").state.board!.hands[2]).toHaveLength(5); // 1 张 + 吃下 4
  });

  it("spec 的 worked example：A 掷 2 → 4，B 叠 +4 → 8，C 吃下摸 8", () => {
    const s = seated({ drawPile: Array.from({ length: 20 }, () => card("G", "9")) });
    const rolled = assaulted(2, s);
    const chain = respond(rolled.state, 0, "pass").state;
    expect(chain.board!.punish!.total).toBe(4);
    const stacked = respond(chain, 1, "stack").state;
    const eight = play(stacked, 1, stacked.board!.hands[1][1].id, { chosenColor: "G" }).state;
    expect(eight.board!.punish!.total).toBe(8);
    expect(respond(eight, 2, "accept").state.board!.hands[2]).toHaveLength(9); // 1 张 + 吃下 8
  });

  it("摸到的 +2 也能改掷骰打（U1 那条路同样给出这条动作）", () => {
    const drawn = card("R", "+2");
    const s = seated({ drawnPlayable: drawn }, [[drawn], [card("Y", "3")], [card("Y", "2")]]);
    expect(legalActions(s, 0)).toContainEqual({ type: "playCards", seat: 0, cardIds: [drawn.id], useAssault: true });
  });

  it("不带 useAssault 就按面值进链，一颗骰子都不掷", () => {
    const s = seated();
    const r = play(s, 0, s.board!.hands[0][0].id);
    expect(r.events.some((e) => e.type === "diceRolled")).toBe(false);
    expect(r.state.board!.punish!.segments).toEqual([{ seat: 0, face: "+2", draw: 2, color: "R" }]);
    expect(r.state.pendingWindow!.type).toBe("punishStack");
  });

  it("V3：没亮出还带旗标 → 拒，局面一点没动", () => {
    const hidden = seated({ revealed: [false, false, false] });
    const r = assaulted(2, hidden);
    expect(r.rejected?.reason).toBe("assault_unavailable");
    expect(r.state).toBe(hidden);
  });

  it("旗标只对自己打出的 +2/+4 有意义：数字牌带旗标 → 拒", () => {
    const s = seated();
    expect(play(s, 0, s.board!.hands[0][1].id, { useAssault: true }).rejected?.reason).toBe("assault_unavailable");
  });

  it("01-P9：被封印的强袭掷不了（`sealable` 缺席 = 可封）", () => {
    const sealed = seated({ statuses: [["封印"], [], []] });
    expect(assaulted(2, sealed).rejected?.reason).toBe("assault_unavailable");
  });

  it("叠链时照样能掷（04：链首或叠链皆可）", () => {
    // 座位 1 持强袭，被座位 0 的 +2 指着，叠 +4 时改掷骰
    const s = seated({ skills: [null, "diamond-1", null], revealed: [false, true, false] });
    const opened = play(s, 0, s.board!.hands[0][0].id).state;
    const stacked = respond(opened, 1, "stack").state;
    const rolled = play(stacked, 1, stacked.board!.hands[1][1].id, { useAssault: true, chosenColor: "G" }, roll(2));
    expect(rolled.state.pendingWindow!.type).toBe("diceTakeover");
    const settled = respond(rolled.state, 1, "pass").state;
    expect(settled.board!.punish!.segments).toEqual([
      { seat: 0, face: "+2", draw: 2, color: "R" },
      { seat: 1, face: "+4", draw: 8, color: "G" },
    ]);
  });
});

// ---------------------------------------------------------------- ② 掷骰接管

describe("强袭② 掷骰接管", () => {
  it("接管：重掷同数量，采用接管者的结果，两次掷骰各留一条事件", () => {
    const rolled = assaulted(2);
    const r = respond(rolled.state, 0, "takeover", roll(1));
    expect(r.rejected).toBeUndefined();
    const dice = r.events.filter((e) => e.type === "diceRolled");
    expect(rolled.events.find((e) => e.type === "diceRolled")!.public)
      .toEqual({ seat: 0, reason: "assault-multiplier", values: [2] });
    expect(dice[0].public).toEqual({ seat: 0, reason: "assault-multiplier-takeover", values: [1] });
    // 采用的是重掷的 1，不是原来的 2
    expect(r.state.board!.punish!.total).toBe(2);
  });

  it("pass：按原结果续跑", () => {
    expect(respond(assaulted(1).state, 0, "pass").state.board!.punish!.total).toBe(2);
  });

  it("超时：没人重掷，同样按原结果续跑", () => {
    const rolled = assaulted(1).state;
    const r = applyAction(rolled, { type: "claimTimeout", seat: 1, windowId: wid(rolled) }, ctx(lcg(1), LATER));
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.punish!.total).toBe(2);
    expect(r.state.pendingDice).toBeUndefined();
  });

  it("同一次掷骰只能被接管一次：窗口已关，旧 id 是 stale_window", () => {
    const rolled = assaulted(2).state;
    const id = wid(rolled);
    const once = applyAction(rolled, { type: "respond", seat: 0, windowId: id, choice: "takeover" }, ctx(roll(0)));
    expect(once.rejected).toBeUndefined();
    const twice = applyAction(once.state, { type: "respond", seat: 0, windowId: id, choice: "takeover" }, ctx(roll(2)));
    expect(twice.rejected?.reason).toBe("stale_window");
  });

  it("接管窗口关掉后挂起的骰子也没了", () => {
    const rolled = assaulted(2).state;
    expect(rolled.pendingDice).toEqual({
      seat: 0,
      reason: "assault-multiplier",
      values: [2],
      resume: { kind: "assault", seat: 0, face: "+2" },
    });
    expect(respond(rolled, 0, "pass").state.pendingDice).toBeUndefined();
  });

  it("窗口里只认 takeover / pass", () => {
    expect(respond(assaulted(2).state, 0, "stack").rejected?.reason).toBe("bad_choice");
  });

  it("窗口挂着时其他动作都被挡住", () => {
    const rolled = assaulted(2).state;
    expect(applyAction(rolled, { type: "drawCard", seat: 0 }, ctx()).rejected?.reason).toBe("pending_window");
  });

  it("不限回合、不限是谁掷的：别人掷的骰子也接管得了（这里的挂起态由测试注入）", () => {
    // 模拟「座位 2 因别的技能掷了 2 颗骰」：强袭者是座位 0，不是当前行动者
    const s = seated({ currentSeat: 2 });
    const pending: GameState = {
      ...s,
      pendingDice: { seat: 2, reason: "nightlord-steal", values: [2, 2], resume: { kind: "assault", seat: 2, face: "+2" } },
      pendingWindow: {
        type: "diceTakeover",
        actors: [0],
        deadline: "2026-07-28T12:00:30.000Z",
        defaultChoice: "pass",
        resume: "play",
      },
    };
    const r = respond(pending, 0, "takeover", roll(1, 1));
    expect(r.rejected).toBeUndefined();
    // 重掷的是**同数量**（2 颗），事件里两颗都在
    expect(r.events[0].public).toEqual({ seat: 0, reason: "nightlord-steal-takeover", values: [1, 1] });
  });

  it("不是 actor 的人插不了手", () => {
    expect(respond(assaulted(2).state, 1, "takeover").rejected?.reason).toBe("not_your_window");
  });

  it("没有强袭在场就不开窗口，动作一气呵成（版本只 +1）", () => {
    const s = seated({ skills: [null, null, null], revealed: [false, false, false] });
    const b = s.board!;
    const r = rollWithTakeover(s, b, 1, "nightlord-steal", 1, { kind: "assault", seat: 1, face: "+2" }, ctx(roll(2)));
    expect(r.state.version).toBe(s.version + 1);
    expect(r.state.pendingDice).toBeUndefined();
    expect(r.state.pendingWindow!.type).toBe("punishStack");
    expect(r.events.map((e) => e.type)).toEqual(["diceRolled", "punishWindowOpened"]);
  });
});

// ---------------------------------------------------------------- 次数账与可点性

describe("强袭的次数账与 legalActions", () => {
  it("06-Q34：①②都不占 V7 的每回合一条主动", () => {
    const rolled = assaulted(2);
    expect(rolled.state.board!.activatedThisTurn).toEqual([false, false, false]);
    expect(respond(rolled.state, 0, "takeover").state.board!.activatedThisTurn).toEqual([false, false, false]);
  });

  it("打 +2/+4 时多出一条带 useAssault 的动作，数字牌没有", () => {
    const s = seated();
    const [p2, r1] = s.board!.hands[0];
    const acts = legalActions(s, 0).filter((a) => a.type === "playCards");
    expect(acts).toContainEqual({ type: "playCards", seat: 0, cardIds: [p2.id], useAssault: true });
    expect(acts).toContainEqual({ type: "playCards", seat: 0, cardIds: [p2.id] });
    expect(acts.filter((a) => a.cardIds[0] === r1.id)).toEqual([{ type: "playCards", seat: 0, cardIds: [r1.id] }]);
  });

  it("没亮出就没有那条动作（V3）", () => {
    const hidden = seated({ revealed: [false, false, false] });
    expect(legalActions(hidden, 0).some((a) => a.type === "playCards" && a.useAssault)).toBe(false);
  });

  it("惩罚轮里叠链的选项也带上它", () => {
    const s = seated({ skills: [null, "diamond-1", null], revealed: [false, true, false] });
    const opened = play(s, 0, s.board!.hands[0][0].id).state;
    const stacked = respond(opened, 1, "stack").state;
    expect(legalActions(stacked, 1).some((a) => a.type === "playCards" && a.useAssault)).toBe(true);
  });

  it("接管窗口只给 actors 两个选择", () => {
    const rolled = assaulted(2).state;
    // U6/U7 的喊话与抓漏喊不被窗口挡，所以只看 respond 那一批
    expect(legalActions(rolled, 0).filter((a) => a.type === "respond")).toEqual([
      { type: "respond", seat: 0, windowId: wid(rolled), choice: "takeover" },
      { type: "respond", seat: 0, windowId: wid(rolled), choice: "pass" },
    ]);
    expect(legalActions(rolled, 1).some((a) => a.type === "respond")).toBe(false);
  });
});

// ---------------------------------------------------------------- 骰子与快照

describe("骰子本身与快照", () => {
  it("01-R1：掷出来的每一颗都是 0/1/2", () => {
    const rng = lcg(7);
    const values = rollDice(rng, 200);
    expect(values).toHaveLength(200);
    expect([...new Set(values)].sort()).toEqual([0, 1, 2]);
  });

  it("挂起的点数进快照（当众掷），续跑指令不进", () => {
    const rolled = assaulted(2).state;
    const view = projectView(rolled, 1);
    expect(view.dice).toEqual({ seat: 0, reason: "assault-multiplier", values: [2] });
    expect(JSON.stringify(view)).not.toContain("resume\":{");
  });

  it("接管窗口不泄露任何人的手牌", () => {
    const rolled = assaulted(2).state;
    for (const seat of [0, 1, 2]) {
      const wire = JSON.stringify(projectView(rolled, seat));
      for (const c of rolled.board!.hands.flatMap((h, i) => (i === seat ? [] : h)))
        expect(wire).not.toContain(c.id);
    }
  });

  it("强袭在抽 3 选 1 的池里（机制齐了才进池）", () => {
    expect(loadSkills().pool.map((s) => s.id)).toContain("diamond-1");
  });
});
