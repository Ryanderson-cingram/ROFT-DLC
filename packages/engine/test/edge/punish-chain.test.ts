/**
 * 惩罚叠链的边界（01 §5：P4 / P5 / P6 / P10 / P11）与**人数轴**（3 人 / 4 人局）。
 *
 * 2 人局不在本文件里：spec §1 把 2 人局的语义退化（上家=下家、停/转自指、同命对称）
 * 标为「裁定推迟」，而引擎在 `startGame` 就直接拒（`bad_seat_count`，见
 * `test/start-game.test.ts`）。叠链的每一条规则都要问「下家是谁」，2 人局里那正是
 * 被推迟的那半边——所以这里一条 2 人局的叠链断言都不写。
 */
import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../../src/index.ts";
import { canStack, PUNISH_DRAW } from "../../src/actions/punish.ts";
import { windowIdOf } from "../../src/legal.ts";
import { nextSeat } from "../../src/legal.ts";
import { card, ctx, table } from "../helpers.ts";
import type { PunishFace } from "../../src/actions/punish.ts";
import type { Card, Face, GameState, PunishChain } from "../../src/types.ts";

const R7 = card("R", "7");
const filler = (n: number) => Array.from({ length: n }, () => card("G", "9"));
const WINDOW = {
  type: "punishStack",
  actors: [0],
  deadline: "2026-07-28T12:00:30.000Z",
  defaultChoice: "accept",
  resume: "play",
} as const;

/** 逐段各按面值贡献的链（P6：贡献在打出进链时结算）。 */
const chain = (...faces: PunishFace[]): PunishChain => ({
  initiator: 0,
  segments: faces.map((face, i) => ({ seat: i, face, draw: PUNISH_DRAW[face], color: "R" as const })),
  total: faces.reduce((n, f) => n + PUNISH_DRAW[f], 0),
});

/** 无色牌不带颜色，其余给红——`canStack` 只看牌面，颜色在这一轴上无影响。 */
const faced = (face: Face): Card =>
  card(face === "wild" || face === "+4" || face === "poison" || face === "shuffle" ? null : "R", face);

// ---------------------------------------------------------------- P4 / P5 的接法矩阵

/** 链顶 +2 可接 +2/+4；链顶 +4 只能接 +4。其余牌面一律接不上。 */
const STACK_MATRIX = (["+2", "+4"] as const).flatMap((tail) =>
  (["+2", "+4", "0", "5", "9", "skip", "rev", "wild", "poison", "shuffle"] as Face[]).map((face) => ({
    tail,
    face,
    ok: tail === "+2" ? face === "+2" || face === "+4" : face === "+4",
  })),
);

describe("P4/P5：链顶决定接得上什么", () => {
  it.each(STACK_MATRIX)("链顶 $tail 接 $face → $ok", ({ tail, face, ok }) => {
    expect(canStack(faced(face), chain(tail))).toBe(ok);
  });

  it("只看**链尾**那一段，不看链首：+2 起头、+4 收尾之后就只能接 +4", () => {
    expect(canStack(faced("+2"), chain("+2", "+2"))).toBe(true);
    expect(canStack(faced("+2"), chain("+2", "+4"))).toBe(false);
    expect(canStack(faced("+4"), chain("+2", "+4"))).toBe(true);
  });
});

describe("P5：链顶 +4 时接 +2 必须被拒（三条入口一致）", () => {
  const p4 = card(null, "+4");
  const opened = () => {
    const s = table([[p4, card("R", "1")], [card("Y", "+2"), card("Y", "3")], [card("Y", "2")]], {
      playedPile: [R7],
      drawPile: filler(30),
    });
    return applyAction(s, { type: "playCards", seat: 0, cardIds: [p4.id], chosenColor: "Y" }, ctx()).state;
  };

  // 窗口挂着时 playCards 先撞上 `pending_window`，所以 `must_stack` 那条守卫只有把链
  // 直接摆在牌桌上（= respond 选了 stack 之后的相位）才问得到。它够不着不等于可以不成立：
  // 少了它，「选了叠」与「叠得合法」之间就没有第二道闩（同 bloodthorn.test 直接问 applySeal）。
  it("入口一：链已在手上时把 +2 打出去 → must_stack（守卫）", () => {
    const s = opened();
    const y2 = s.board!.hands[1][0];
    expect(applyAction(s, { type: "playCards", seat: 1, cardIds: [y2.id] }, ctx()).rejected?.reason)
      .toBe("pending_window");
    const handed: GameState = {
      ...s,
      phase: "play",
      pendingWindow: undefined,
      board: { ...s.board!, currentSeat: 1 },
    };
    expect(applyAction(handed, { type: "playCards", seat: 1, cardIds: [y2.id] }, ctx()).rejected?.reason)
      .toBe("must_stack");
    const y4 = card(null, "+4");
    const withPlus4: GameState = {
      ...handed,
      board: { ...handed.board!, hands: handed.board!.hands.map((h, i) => (i === 1 ? [...h, y4] : h)) },
    };
    expect(applyAction(withPlus4, { type: "playCards", seat: 1, cardIds: [y4.id], chosenColor: "G" }, ctx()).rejected)
      .toBeUndefined();
  });

  it("入口二：respond 选 stack → cannot_stack（选了叠却叠不出来，窗口不许卡死）", () => {
    const s = opened();
    expect(applyAction(s, { type: "respond", seat: 1, windowId: windowIdOf(s)!, choice: "stack" }, ctx())
      .rejected?.reason).toBe("cannot_stack");
  });

  it("入口三：legalActions 里连 stack 这个选项都不给", () => {
    const s = opened();
    const choices = legalActions(s, 1).flatMap((a) => (a.type === "respond" ? [a.choice] : []));
    expect(choices).toEqual(["accept"]);
  });
});

// ---------------------------------------------------------------- P11 受罚侧：先加总再套用

/**
 * P11：受罚侧的减免作用在**各段贡献的加总**上，不是每段各减一次。
 * 恩惠♥1 = L2 −2 / L5 至少 1（`skill-defs.json` 的 heart-1）。
 * 三段 +2 是唯一能把两种读法分开的形状：整链 6−2=4，逐段各减则是 1+1+1=3。
 */
const GRACE_CASES: { faces: PunishFace[]; total: number; drawn: number; perSegment: number }[] = [
  { faces: ["+2"], total: 2, drawn: 1, perSegment: 1 },
  { faces: ["+2", "+2"], total: 4, drawn: 2, perSegment: 2 },
  { faces: ["+2", "+2", "+2"], total: 6, drawn: 4, perSegment: 3 },
  { faces: ["+2", "+4"], total: 6, drawn: 4, perSegment: 3 },
  { faces: ["+4", "+4"], total: 8, drawn: 6, perSegment: 4 },
  { faces: ["+4", "+4", "+4"], total: 12, drawn: 10, perSegment: 6 },
];

describe("P11：恩惠♥1 按整条链的总数减 2（至少 1），不是每段各减", () => {
  const eat = (faces: PunishFace[]) => {
    const c = chain(...faces);
    const s = table([[], [], []], {
      playedPile: [R7],
      drawPile: filler(40),
      punish: c,
      currentSeat: 1,
      skills: ["heart-1", null, null],
      revealed: [true, false, false],
    }, { phase: "afterPlay", pendingWindow: { ...WINDOW, actors: [0] } });
    return applyAction(s, { type: "respond", seat: 0, windowId: windowIdOf(s)!, choice: "accept" }, ctx());
  };

  it.each(GRACE_CASES)("链 $faces（总 $total）→ 摸 $drawn 张", ({ faces, total, drawn, perSegment }) => {
    const r = eat(faces);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.punish?.total ?? total).toBe(total);
    expect(r.state.board!.hands[0]).toHaveLength(drawn);
    // 逐段各减是另一个数：这一条把两种读法钉开（相等的形状上它是同义反复，无害）
    if (perSegment !== drawn) expect(r.state.board!.hands[0]).not.toHaveLength(perSegment);
  });

  it("L5 至少 1：单张 +2 减 2 本该是 0，恩惠的地板把它抬回 1", () => {
    expect(eat(["+2"]).state.board!.hands[0]).toHaveLength(1);
  });

  it("没有恩惠的人照总数摸满，减免不是全场性的", () => {
    const c = chain("+2", "+2", "+2");
    const s = table([[], [], []], {
      playedPile: [R7],
      drawPile: filler(40),
      punish: c,
      currentSeat: 1,
    }, { phase: "afterPlay", pendingWindow: { ...WINDOW, actors: [0] } });
    const r = applyAction(s, { type: "respond", seat: 0, windowId: windowIdOf(s)!, choice: "accept" }, ctx());
    expect(r.state.board!.hands[0]).toHaveLength(6);
  });
});

// ---------------------------------------------------------------- 4 人局的整条链

describe("人数轴：4 人局跑完一条三段链（P6 + P10 + P11）", () => {
  const p2 = () => card("R", "+2");

  /** 座位 3 持恩惠并已亮出；0/1/2 各有一张 +2 用来接力。 */
  const four = () =>
    table(
      [[p2(), card("R", "1")], [p2(), card("R", "2")], [p2(), card("R", "3")], [card("Y", "5"), card("Y", "6")]],
      {
        playedPile: [R7],
        drawPile: filler(40),
        skills: [null, null, null, "heart-1"],
        revealed: [false, false, false, true],
      },
    );

  /** 打第一张 → 每个中间座位 respond stack 再打自己那张。 */
  function relay(s: GameState, seats: number[]): GameState {
    let cur = applyAction(s, { type: "playCards", seat: seats[0], cardIds: [s.board!.hands[seats[0]][0].id] }, ctx()).state;
    for (const seat of seats.slice(1)) {
      cur = applyAction(cur, { type: "respond", seat, windowId: windowIdOf(cur)!, choice: "stack" }, ctx()).state;
      cur = applyAction(cur, { type: "playCards", seat, cardIds: [cur.board!.hands[seat][0].id] }, ctx()).state;
    }
    return cur;
  }

  it("链依次传到座位 3：三段各记自己的贡献，总数是它们的和（P6）", () => {
    const s = relay(four(), [0, 1, 2]);
    expect(s.board!.punish).toEqual({
      initiator: 0,
      segments: [
        { seat: 0, face: "+2", draw: 2, color: "R" },
        { seat: 1, face: "+2", draw: 2, color: "R" },
        { seat: 2, face: "+2", draw: 2, color: "R" },
      ],
      total: 6,
    });
    expect(s.pendingWindow!.actors).toEqual([3]);
  });

  it("座位 3 吃下：恩惠按总数 6 减 2 → 摸 4（逐段各减会是 3）", () => {
    const s = relay(four(), [0, 1, 2]);
    const r = applyAction(s, { type: "respond", seat: 3, windowId: windowIdOf(s)!, choice: "accept" }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[3]).toHaveLength(2 + 4);
  });

  it("P10：吃完即回合结束——链清空、回合交给座位 0，受罚者当场出不了牌", () => {
    const s = relay(four(), [0, 1, 2]);
    const r = applyAction(s, { type: "respond", seat: 3, windowId: windowIdOf(s)!, choice: "accept" }, ctx());
    const b = r.state.board!;
    expect(b.punish).toBeUndefined();
    expect(r.state.pendingWindow).toBeUndefined();
    expect(b.currentSeat).toBe(0);
    expect(applyAction(r.state, { type: "playCards", seat: 3, cardIds: [b.hands[3][0].id] }, ctx()).rejected?.reason)
      .toBe("not_your_turn");
  });

  it("4 人局的链绕满一圈退回链首本人：他自己吃下自己发起的链", () => {
    const s = relay(four(), [0, 1, 2, 3]);
    // 座位 3 手上没有 +2，接力到他那里就断了——换个牌桌让四个人各带一张
    expect(s.board!.punish!.segments).toHaveLength(3);
    const all = table(
      [[p2(), card("R", "1")], [p2(), card("R", "2")], [p2(), card("R", "3")], [p2(), card("R", "4")]],
      { playedPile: [R7], drawPile: filler(40) },
    );
    const looped = relay(all, [0, 1, 2, 3]);
    expect(looped.board!.punish!.total).toBe(8);
    expect(looped.pendingWindow!.actors).toEqual([0]);
    const r = applyAction(looped, { type: "respond", seat: 0, windowId: windowIdOf(looped)!, choice: "accept" }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(1 + 8);
    expect(r.state.board!.currentSeat).toBe(1);
  });
});

// ---------------------------------------------------------------- 座位环形

describe("人数轴：座位环形与停/转（3 / 4 人局）", () => {
  it.each([
    { n: 3, dir: 1 as const, from: 2, step: 1, to: 0 },
    { n: 3, dir: -1 as const, from: 0, step: 1, to: 2 },
    { n: 3, dir: 1 as const, from: 2, step: 2, to: 1 },
    { n: 4, dir: 1 as const, from: 3, step: 1, to: 0 },
    { n: 4, dir: -1 as const, from: 0, step: 1, to: 3 },
    { n: 4, dir: 1 as const, from: 2, step: 2, to: 0 },
    { n: 4, dir: -1 as const, from: 1, step: 2, to: 3 },
  ])("$n 人局 · 方向 $dir · 从 $from 走 $step 步 → $to", ({ n, dir, from, step, to }) => {
    const b = table(Array.from({ length: n }, () => [card("R", "1")]), { direction: dir }).board!;
    expect(nextSeat(b, from, step)).toBe(to);
  });

  it("4 人局：停跳过下家（0 → 2）", () => {
    const skip = card("R", "skip");
    const s = table([[skip, card("R", "1")], [card("Y", "1")], [card("Y", "2")], [card("Y", "3")]], {
      playedPile: [R7],
    });
    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [skip.id] }, ctx()).state.board!.currentSeat).toBe(2);
  });

  it("4 人局：转翻向（0 → 3）", () => {
    const rev = card("R", "rev");
    const s = table([[rev, card("R", "1")], [card("Y", "1")], [card("Y", "2")], [card("Y", "3")]], {
      playedPile: [R7],
    });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [rev.id] }, ctx());
    expect(r.state.board!.direction).toBe(-1);
    expect(r.state.board!.currentSeat).toBe(3);
  });

  it("4 人局：惩罚窗口开给**方向上的**下家，转过向之后是座位 3", () => {
    const p2 = card("R", "+2");
    const s = table([[p2, card("R", "1")], [card("Y", "1")], [card("Y", "2")], [card("Y", "3")]], {
      playedPile: [R7],
      direction: -1,
    });
    expect(applyAction(s, { type: "playCards", seat: 0, cardIds: [p2.id] }, ctx()).state.pendingWindow!.actors)
      .toEqual([3]);
  });
});

// ---------------------------------------------------------------- U7 在 4 人局

describe("人数轴：4 人局的抓漏喊（U7）", () => {
  /** 座位 1 与座位 3 各剩 1 张未喊；currentSeat 是 0，所以谁都不在宽限期。 */
  const four = () =>
    table([[card("R", "3"), card("R", "4")], [card("Y", "1")], [card("Y", "2"), card("Y", "6")], [card("Y", "3")]], {
      playedPile: [R7],
      drawPile: filler(30),
    });

  it("legalActions 把每个可抓的目标各给一条，不可抓的不给", () => {
    const s = four();
    expect(legalActions(s, 0).filter((a) => a.type === "catchUno")).toEqual([
      { type: "catchUno", seat: 0, target: 1 },
      { type: "catchUno", seat: 0, target: 3 },
    ]);
  });

  it("抓一个不影响另一个：座位 3 仍然抓得着", () => {
    const caught = applyAction(four(), { type: "catchUno", seat: 2, target: 1 }, ctx());
    expect(caught.rejected).toBeUndefined();
    expect(caught.state.board!.hands[1]).toHaveLength(3);
    expect(applyAction(caught.state, { type: "catchUno", seat: 0, target: 3 }, ctx()).rejected).toBeUndefined();
    // 摸满 2 张之后不再是 1 张 → 同一个人抓不了第二次
    expect(applyAction(caught.state, { type: "catchUno", seat: 0, target: 1 }, ctx()).rejected?.reason)
      .toBe("not_catchable");
  });
});
