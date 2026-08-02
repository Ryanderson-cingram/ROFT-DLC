// 血棘♦2：被动「你链首发起的惩罚被吃下 → 对方被封印」，①「掷 1 骰令被封者摸等量」。
// 规则：01-P8（仅链首）、01-P9（效果全关、原样恢复）、01-P14（含被动、先于摸牌数计算、
// 两条解除条件）、01-P15（被动触发，不算单体）、04 ♦2、06-Q36/Q38/Q41/Q54/Q56。
import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../../src/index.ts";
import { applySeal } from "../../src/actions/bloodthorn.ts";
import { card, ctx, roll, table } from "../helpers.ts";
import type { Action, Board, Card, GameState } from "../../src/types.ts";

const R7 = card("R", "7");
/** 摸牌堆要够吃：默认那 3 张不够 +2/+4 的链。 */
const deck = () => Array.from({ length: 30 }, () => card("G", "9"));

/** 3 人局：座位 0 持血棘并已亮出，座位 1 持恩惠并已亮出（Q36 的那对冤家）。 */
const seated = (over: Partial<Board> = {}, hands?: Card[][], state: Partial<GameState> = {}) =>
  table(
    hands ?? [[card("R", "+2")], [card("R", "+2"), card("R", "5")], [card("R", "+2")]],
    { skills: ["diamond-2", "heart-1", null], revealed: [true, true, false], playedPile: [R7], drawPile: deck(), ...over },
    state,
  );

const wid = (s: GameState) => `w${s.version}:${s.pendingWindow!.type}`;
const play = (s: GameState, seat: number, id: string, extra: Record<string, unknown> = {}) =>
  applyAction(s, { type: "playCards", seat, cardIds: [id], ...extra } as Action, ctx());
const respond = (s: GameState, seat: number, choice: string) =>
  applyAction(s, { type: "respond", seat, windowId: wid(s), choice }, ctx());
const activate = (s: GameState, seat: number, effectKey: string, rng = roll(1)) =>
  applyAction(s, { type: "activateSkill", seat, effectKey }, ctx(rng));
const hand = (s: GameState, seat: number) => s.board!.hands[seat];

// ------------------------------------------------------------ 封印（被动）

describe("血棘 封印的落地（01-P8/P14）", () => {
  it("Q36 的 worked example：封印先于摸牌数计算 → 亮着恩惠的受罚者摸 2，不是 1", () => {
    const s = seated();
    const opened = play(s, 0, hand(s, 0)[0].id);
    const eaten = respond(opened.state, 1, "accept");
    const b = eaten.state.board!;

    expect(b.statuses[1]).toEqual(["封印"]);
    expect(b.sealedBy).toEqual([null, 0, null]);
    // 手牌 2 张 − 打出 0 + 摸 2 = 4；恩惠若还活着只会摸 1（2 − 2 → 至少 1）
    expect(b.hands[1]).toHaveLength(4);
    // 事件顺序就是时序：封印在摸牌之前
    expect(eaten.events.map((e) => e.type)).toEqual(["punishAccepted", "sealed", "cardsDrawn"]);
    expect(eaten.events[1].public).toEqual({ seat: 1, by: 0 });
  });

  it("P8：中间叠牌者有血棘、链首没有 → 不封印（恩惠照常减免）", () => {
    const s = seated({ currentSeat: 2 });
    const opened = play(s, 2, hand(s, 2)[0].id);
    // 座位 0（血棘）只是叠了一张进链，链首是座位 2
    const stacked = respond(opened.state, 0, "stack").state;
    const chained = play(stacked, 0, hand(stacked, 0)[0].id).state;
    const eaten = respond(chained, 1, "accept").state;

    expect(eaten.board!.punish).toBeUndefined();
    expect(eaten.board!.statuses[1]).toEqual([]);
    expect(eaten.board!.sealedBy ?? [null, null, null]).toEqual([null, null, null]);
    // 4 张 − 恩惠 2 = 2：被动没被关掉
    expect(eaten.board!.hands[1]).toHaveLength(2 + 2);
  });

  // 2026-07-31 裁定：04 原文是「你发起的惩罚使**目标**封印技能」，目标指的是别人。
  // 3 人局里叠两次链就退回链首本人，此时封印不成立——血棘不会封印自己。
  it("链绕一圈退回链首本人：不封印自己", () => {
    const two = (): Card[] => [card("R", "+2"), card("R", "5")];
    const s = seated({}, [two(), two(), two()]);
    const opened = play(s, 0, hand(s, 0)[0].id).state; // A 链首打 +2
    const bStack = respond(opened, 1, "stack").state;
    const bPlayed = play(bStack, 1, hand(bStack, 1)[0].id).state; // B 叠
    const cStack = respond(bPlayed, 2, "stack").state;
    const cPlayed = play(cStack, 2, hand(cStack, 2)[0].id).state; // C 叠 → 轮回 A
    const eaten = respond(cPlayed, 0, "accept");

    expect(eaten.rejected).toBeUndefined();
    expect(eaten.state.board!.statuses).toEqual([[], [], []]);
    expect(eaten.state.board!.sealedBy ?? [null, null, null]).toEqual([null, null, null]);
    expect(eaten.events.map((e) => e.type)).toEqual(["punishAccepted", "cardsDrawn"]);
  });

  it("守卫直接问 applySeal：initiator 与 victim 同一人 → 原样返回", () => {
    const b = seated().board!;
    expect(applySeal(b, 0, 0)).toEqual({ board: b, events: [] });
  });

  // 01-P15：狂欢「单体不能以你为目标」挡不住封印（被动触发、无指定动作）。
  // 狂欢本批未实现，这里只留出处，不写代码。

  it("被别人封着的血棘者链首打出 +2：这一打先解了自己的封（P14），封印照常落地", () => {
    const s = seated({ statuses: [["封印"], [], []], sealedBy: [2, null, null] });
    const eaten = respond(play(s, 0, hand(s, 0)[0].id).state, 1, "accept").state;
    expect(eaten.board!.statuses).toEqual([[], ["封印"], []]);
    expect(eaten.board!.sealedBy).toEqual([null, 0, null]);
  });

  // 上一条是「被封着的血棘者」在出牌路径上唯一到得了的情形（链首一打出就解封）。
  // 被动本身仍按 P9 关着——那条守卫直接问 applySeal，免得成了没人跑过的分支。
  it("P9：血棘者自己被封着时，这条被动是关的", () => {
    const b = seated({ statuses: [["封印"], [], []], sealedBy: [2, null, null] }).board!;
    expect(applySeal(b, 0, 1)).toEqual({ board: b, events: [] });
  });
});

describe("血棘 封印的解除（01-P14，先到先解）", () => {
  it("解除①：血棘者另封新目标 → 旧目标解封（statuses 与 sealedBy 双清）", () => {
    // 逆时针：座位 0 的下家是座位 2，所以这一次封的是新目标
    const s = seated({ direction: -1, statuses: [[], ["封印"], []], sealedBy: [null, 0, null] });
    const eaten = respond(play(s, 0, hand(s, 0)[0].id).state, 2, "accept");
    const b = eaten.state.board!;

    expect(b.statuses).toEqual([[], [], ["封印"]]);
    expect(b.sealedBy).toEqual([null, null, 0]);
    expect(eaten.events.filter((e) => e.type === "sealLifted").map((e) => e.public)).toEqual([
      { seat: 1, reason: "replaced" },
    ]);
  });

  it("解除②：被封者链首打出 +2 → 打出即解除（同一个 apply 里已无封印）", () => {
    const s = seated({ currentSeat: 1, statuses: [[], ["封印"], []], sealedBy: [null, 0, null] });
    const played = play(s, 1, hand(s, 1)[0].id);

    expect(played.state.board!.statuses[1]).toEqual([]);
    expect(played.state.board!.sealedBy).toEqual([null, null, null]);
    // 解封排在这次出牌的其余结算之前
    expect(played.events.map((e) => e.type)).toEqual(["sealLifted", "cardPlayed", "punishWindowOpened"]);
    expect(played.events[0].public).toEqual({ seat: 1, reason: "initiated" });
  });

  it("叠链（非链首）打出 +4 → 不解除", () => {
    const p4 = card(null, "+4");
    const s = seated(
      {
        currentSeat: 1,
        statuses: [[], ["封印"], []],
        sealedBy: [null, 0, null],
        punish: { initiator: 2, segments: [{ seat: 2, face: "+2", draw: 2 }], total: 2 },
      },
      [[card("R", "+2")], [p4], [card("R", "+2")]],
      { phase: "play" },
    );
    const played = play(s, 1, p4.id, { chosenColor: "R" });

    expect(played.rejected).toBeUndefined();
    expect(played.state.board!.statuses[1]).toEqual(["封印"]);
    expect(played.state.board!.sealedBy).toEqual([null, 0, null]);
  });

  it("P9：解封后原样恢复——恩惠立刻重新减免下一条（无血棘的）惩罚链", () => {
    const s = seated({ direction: -1, currentSeat: 1, statuses: [[], ["封印"], []], sealedBy: [null, 0, null] });
    // 座位 1 链首打出 +2 解封，下家（逆时针）是座位 0，吃下
    const lifted = respond(play(s, 1, hand(s, 1)[0].id).state, 0, "accept").state;
    // 回合转到座位 2：它没有血棘，链首指向座位 1
    const eaten = respond(play(lifted, 2, hand(lifted, 2)[0].id).state, 1, "accept").state;

    expect(eaten.board!.statuses[1]).toEqual([]);
    // 恩惠回来了：2 − 2 → 至少 1，只摸 1 张
    expect(eaten.board!.hands[1]).toHaveLength(1 + 1);
  });
});

describe("被封印的人（01-P9：效果全关）", () => {
  it("主动发动被拒——连声明了惩罚回合豁免的影歌②也一样（封印不可例外）", () => {
    const s = seated({
      currentSeat: 1,
      skills: ["diamond-2", "diamond-3", null],
      marks: [{}, { 魂: 5 }, {}],
      statuses: [[], ["封印"], []],
      sealedBy: [null, 0, null],
    });
    expect(activate(s, 1, "2").rejected).toEqual({ reason: "suppressed" });
    expect(legalActions(s, 1).some((a) => a.type === "activateSkill")).toBe(false);
  });

  it("未亮出的技能不能亮出", () => {
    const s = seated({
      currentSeat: 1,
      revealed: [true, false, false],
      statuses: [[], ["封印"], []],
      sealedBy: [null, 0, null],
    });
    expect(applyAction(s, { type: "revealSkill", seat: 1 }, ctx()).rejected).toEqual({ reason: "suppressed" });
    expect(legalActions(s, 1).some((a) => a.type === "revealSkill")).toBe(false);
  });
});

// ------------------------------------------------------------ ① 掷骰放血

describe("血棘① 掷骰放血（04 ♦2 补齐）", () => {
  const drained = (over: Partial<Board> = {}, rng = roll(2)) =>
    activate(seated({ statuses: [[], ["封印"], []], sealedBy: [null, 0, null], ...over }), 0, "1", rng);

  it("掷 2 → 被封者摸 2；他亮着的恩惠已被封，减不掉（双重否定）", () => {
    const r = drained();
    expect(r.rejected).toBeUndefined();
    expect(r.events.map((e) => e.type)).toEqual(["skillActivated", "diceRolled", "cardsDrawn"]);
    expect(r.events[1].public).toEqual({ seat: 0, reason: "bloodthorn-drain", values: [2] });
    expect(hand(r.state, 1)).toHaveLength(2 + 2);
    // V7：占掉本回合那一条主动
    expect(r.state.board!.activatedThisTurn[0]).toBe(true);
  });

  it("掷 0 → 摸 0，但发动与 V7 额度照常消耗", () => {
    const r = drained({}, roll(0));
    expect(r.events[1].public).toMatchObject({ values: [0] });
    expect(hand(r.state, 1)).toHaveLength(2);
    expect(r.state.board!.activatedThisTurn[0]).toBe(true);
  });

  it("场上没人被自己封印 → no_target，次数不消耗", () => {
    const s = seated();
    const r = activate(s, 0, "1");
    expect(r.rejected).toEqual({ reason: "no_target" });
    expect(r.state.board!.activatedThisTurn[0]).toBe(false);
  });

  it("legalActions 给出发动入口（UI 的可点性只来自它）", () => {
    const s = seated({ statuses: [[], ["封印"], []], sealedBy: [null, 0, null] });
    expect(legalActions(s, 0)).toContainEqual({ type: "activateSkill", seat: 0, effectKey: "1" });
  });

  it("无封印目标时 legalActions **不给**入口——点了才拿到 no_target 是不可用的按钮", () => {
    expect(legalActions(seated(), 0)).not.toContainEqual({ type: "activateSkill", seat: 0, effectKey: "1" });
  });

  it("①的骰子照样走强袭②的接管窗口：重掷之后按接管者的点数放血", () => {
    const s = seated({
      statuses: [[], ["封印"], []],
      sealedBy: [null, 0, null],
      skills: ["diamond-2", "heart-1", "diamond-1"],
      revealed: [true, true, true],
    });
    const rolled = activate(s, 0, "1", roll(2));
    // 场上有强袭 → 骰子先挂起，摸牌等窗口结完
    expect(rolled.state.pendingWindow!.type).toBe("diceTakeover");
    expect(rolled.state.pendingDice).toMatchObject({ reason: "bloodthorn-drain", values: [2] });
    expect(hand(rolled.state, 1)).toHaveLength(2);

    const taken = applyAction(
      rolled.state,
      { type: "respond", seat: 2, windowId: wid(rolled.state), choice: "takeover" },
      ctx(roll(0)),
    );
    expect(taken.rejected).toBeUndefined();
    expect(taken.state.pendingWindow).toBeUndefined();
    // 接管者重掷出 0 → 被封者一张都不摸（原掷的 2 作废）
    expect(hand(taken.state, 1)).toHaveLength(2);
    expect(taken.events.map((e) => e.type)).toEqual(["diceRolled", "cardsDrawn"]);
    expect(taken.events[0].public).toEqual({ seat: 2, reason: "bloodthorn-drain-takeover", values: [0] });
  });

  it("只认自己封的人：别人封的不算目标", () => {
    const r = activate(seated({ statuses: [[], ["封印"], []], sealedBy: [null, 2, null] }), 0, "1");
    expect(r.rejected).toEqual({ reason: "no_target" });
  });
});

// ------------------------------------------------------------ 快照

describe("血棘 的快照投影", () => {
  const sealed = seated({ statuses: [[], ["封印"], []], sealedBy: [null, 0, null] });

  it("封印是公开状态：各视角一致", () => {
    for (const viewer of [0, 1, 2])
      expect(projectView(sealed, viewer).players.map((p) => p.statuses)).toEqual([[], ["封印"], []]);
  });

  // 2026-08-02 改判：「谁封的我」进快照。`sealed` 事件的 public payload 一直带 `by`，
  // 行动记录早就在渲染「被老白封印了技能」——瞒着它只是让 UI 写不出 01-P14 的解封条件。
  it("「谁封的我」是公开信息：各视角一致", () => {
    for (const viewer of [0, 1, 2])
      expect(projectView(sealed, viewer).players.map((p) => p.sealedBy)).toEqual([null, 0, null]);
  });
});
