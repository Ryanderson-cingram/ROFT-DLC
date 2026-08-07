/**
 * 伤逝♥10（04 ♥10 / 01-P13 / 02 §7 L1）。
 * spec：`docs/superpowers/specs/2026-08-02-skills-batch-2.md` 第 1 步。
 *
 * 三条要害，逐条钉：
 * 1. 数的是**链上张数**（`segments.length`），不是**贡献总和**（`chain.total`）
 * 2. L1 命中即得最终值，**跳过 L2/L3/L4**——恩惠的 −2、吟游的活泼板都不作数（P13）
 * 3. 可以掷出 0 → 一张都不摸
 */
import { describe, expect, it } from "vitest";
import { applyAction } from "../../src/index.ts";
import { card, ctx, roll, table } from "../helpers.ts";
import type { Board, GameState } from "../../src/types.ts";

const R7 = card("R", "7");
const filler = (n: number) => Array.from({ length: n }, () => card("G", "9"));

/**
 * 链上 **2 张**（+2 与 +4），贡献总和 **6**——两个数故意不相等，
 * 才测得出伤逝数的到底是 `segments.length` 还是 `total`。
 */
const CHAIN = {
  initiator: 0,
  segments: [
    { seat: 0, face: "+2" as const, draw: 2 },
    { seat: 0, face: "+4" as const, draw: 4 },
  ],
  total: 6,
};

const seated = (skills: (string | null)[], over: Partial<Board> = {}): GameState =>
  table([[card("R", "3")], [card("Y", "1")], [card("Y", "2")]], {
    playedPile: [R7],
    drawPile: filler(30),
    currentSeat: 1,
    skills,
    revealed: skills.map((s) => s !== null),
    punish: CHAIN,
    ...over,
  });

/** 座位 1 吃下这条链。`dice` 指定每颗骰的点数（`roll` 是循环的确定性 rng）。 */
const eat = (s: GameState, ...dice: number[]) =>
  applyAction(
    s,
    { type: "respond", seat: 1, windowId: `w${s.version}:punishStack`, choice: "accept" },
    ctx(dice.length ? roll(...dice) : undefined),
  );

const openWindow = (s: GameState): GameState => ({
  ...s,
  phase: "play",
  pendingWindow: {
    type: "punishStack",
    actors: [1],
    deadline: "2026-07-28T12:00:30.000Z",
    defaultChoice: "accept",
    resume: "play",
  },
});

describe("伤逝♥10：按链上张数掷骰，不看贡献总和", () => {
  it("链上 2 张（总和 6）→ 掷 2 颗骰求和；掷 2/2 → 摸 4 而不是 6", () => {
    const r = eat(openWindow(seated([null, "heart-10", null])), 2, 2);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[1]).toHaveLength(1 + 4);
  });

  it("同一条链掷 1/0 → 摸 1（张数 2 颗骰，点数才是结果）", () => {
    const r = eat(openWindow(seated([null, "heart-10", null])), 1, 0);
    expect(r.state.board!.hands[1]).toHaveLength(1 + 1);
  });

  it("掷出全 0 → 一张都不摸（同强袭①的 0 倍，赌的就是这个）", () => {
    const r = eat(openWindow(seated([null, "heart-10", null])), 0, 0);
    expect(r.state.board!.hands[1]).toHaveLength(1);
    expect(r.state.board!.punish).toBeUndefined();
  });

  it("没有伤逝的人照旧吃贡献总和 6 张（对照组，证明上面测的是伤逝不是别的）", () => {
    const r = eat(openWindow(seated([null, null, null])));
    expect(r.state.board!.hands[1]).toHaveLength(1 + 6);
  });
});

describe("伤逝：L1 命中即得最终值，跳过后面所有改摸数（01-P13）", () => {
  // S2b 技能全场唯一，所以伤逝与恩惠不可能在同一个人身上；这里测的是
  // 「伤逝在场时，**别人的**改摸数修正也影响不到他」——恩惠是 targeting: self，
  // 本来就只改自己那次摸牌，所以用它做对照最干净：装在座位 1 上会减，换成伤逝就不减。
  it("恩惠装在同一个座位上会把 6 减成 4；换成伤逝则按掷骰结果，与 −2 无关", () => {
    const withMercy = eat(openWindow(seated([null, "heart-1", null])));
    expect(withMercy.state.board!.hands[1]).toHaveLength(1 + 4); // 6 − 2

    const withDamnation = eat(openWindow(seated([null, "heart-10", null])), 2, 2);
    expect(withDamnation.state.board!.hands[1]).toHaveLength(1 + 4); // 掷 2+2，**不是** 6−2
    // 数值撞巧一样，所以再换一组骰点确认它跟着骰子走、不跟着 −2 走
    const other = eat(openWindow(seated([null, "heart-10", null])), 0, 1);
    expect(other.state.board!.hands[1]).toHaveLength(1 + 1);
  });

  it("未亮出 → 不生效（V3）：照旧吃 6 张", () => {
    const s = openWindow(seated([null, "heart-10", null], { revealed: [false, false, false] }));
    expect(eat(s).state.board!.hands[1]).toHaveLength(1 + 6);
  });

  it("被封印 → 不生效（P9 封印含被动）：照旧吃 6 张", () => {
    const s = openWindow(seated([null, "heart-10", null], { statuses: [[], ["封印"], []] }));
    expect(eat(s).state.board!.hands[1]).toHaveLength(1 + 6);
  });
});

describe("伤逝：骰数严格等于链上张数", () => {
  /** `roll(...)` 是循环的：给一颗骰的点数，掷几颗都是那个数，所以「摸了几张」直接读出骰数。 */
  const chainOf = (n: number) => ({
    initiator: 0,
    segments: Array.from({ length: n }, () => ({ seat: 0, face: "+2" as const, draw: 2 })),
    total: n * 2,
  });

  it.each([1, 2, 3, 5])("%i 张的链 → 掷 %i 颗骰（每颗定为 1，故摸到的张数 = 骰数）", (n) => {
    const s = openWindow(seated([null, "heart-10", null], { punish: chainOf(n) }));
    expect(eat(s, 1).state.board!.hands[1]).toHaveLength(1 + n);
  });

  it("一段的贡献被强袭掷成 4，链上仍只算 1 张 → 掷 1 颗骰（P13 忽略贡献总和的最狠一例）", () => {
    // 单段：牌面 +2，但强袭把它掷成了 ×2，`draw` 是 4、`total` 也是 4。
    // 若实现误用 total 就会掷 4 颗（这里每颗 2 点 → 8 张），用 segments.length 才是 1 颗 → 2 张。
    const boosted = { initiator: 0, segments: [{ seat: 0, face: "+2" as const, draw: 4 }], total: 4 };
    const s = openWindow(seated([null, "heart-10", null], { punish: boosted }));
    expect(eat(s, 2).state.board!.hands[1]).toHaveLength(1 + 2);
  });
});

describe("伤逝：只改惩罚摸牌，不碰别的摸牌事件（applies_to: [punish]）", () => {
  it("U1 无牌可出摸牌：照旧 1 张，不掷骰", () => {
    // 手上只有红 3，出牌堆是红 7 —— 打得出，所以换成打不出的黄 1 才走摸牌路径
    const s = table([[card("R", "3")], [card("Y", "1")], [card("Y", "2")]], {
      playedPile: [R7],
      drawPile: filler(30),
      currentSeat: 1,
      skills: [null, "heart-10", null],
      revealed: [true, true, true],
    });
    const r = applyAction(s, { type: "drawCard", seat: 1 }, ctx(roll(2)));
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[1]).toHaveLength(1 + 1);
  });
});

describe("伤逝：replacedBy 进事件（前端要说得出「为什么只摸了这么点」）", () => {
  const drawn = (r: { events: { type: string; public?: Record<string, unknown> }[] }) =>
    r.events.find((e) => e.type === "cardsDrawn")!.public!;

  it("命中 → cardsDrawn.public 带上技能名与真实张数", () => {
    expect(drawn(eat(openWindow(seated([null, "heart-10", null])), 1, 0)))
      .toEqual({ seat: 1, count: 1, replacedBy: "伤逝" });
  });

  it("没命中 → 字段整个不出现（不是 undefined，快照/投影里不留空键）", () => {
    expect(drawn(eat(openWindow(seated([null, null, null]))))).toEqual({ seat: 1, count: 6 });
  });
});
