// 摸牌数结算层级 L0–L6，规格是 docs/knowledge-base/02-methodology.md §7 一条不落。
// 修正源全是假的：本轮不牵扯任何具体技能，只验层级本身。
import { describe, expect, it } from "vitest";
import { resolveDrawCount } from "../../src/skills/primitives/draw-modifier.ts";
import type { DrawModifier } from "../../src/skills/primitives/draw-modifier.ts";
import { drawCards } from "../../src/actions/draw.ts";
import { applyAction } from "../../src/index.ts";
import { card, ctx, table } from "../helpers.ts";

const n = (req: { kind?: "punish" | "skill" | "rule"; base: number }, mods: DrawModifier[] = []) =>
  resolveDrawCount({ kind: req.kind ?? "rule", base: req.base, seat: 0 }, mods).count;

/** 洗回来也不够摸的牌桌：drawPile 只有 2 张，弃牌堆只有牌顶（不可洗回）。 */
const pile = (count: number) => Array.from({ length: count }, (_, i) => card("G", "1"));

describe("02 §7 摸牌数结算层级", () => {
  describe("L0 定型", () => {
    it("没有任何修正时就是基础值", () => {
      expect(n({ base: 4 })).toBe(4);
    });

    it("摸 0 张是合法结果，不被当成「没摸」而变成别的数", () => {
      expect(n({ base: 0 })).toBe(0);
    });
  });

  describe("L1 替换", () => {
    it("命中 L1 直接得最终值，L2/L3/L4 全部不生效（伤逝「不受其他技能影响」）", () => {
      const mods: DrawModifier[] = [
        { layer: "L2", source: "恩惠", delta: -2 },
        { layer: "L3", source: "战争序", factor: 2 },
        { layer: "L4", source: "樱时雨", scope: "global", value: 1 },
        { layer: "L1", source: "伤逝", value: 3 },
      ];
      expect(n({ kind: "punish", base: 10 }, mods)).toBe(3);
    });

    it("L1 之后仍然走 L5（§7 的箭头写的是「跳到 L5」，不是跳过 L5）", () => {
      const mods: DrawModifier[] = [
        { layer: "L1", source: "伤逝", value: -4 },
        { layer: "L2", source: "恩惠", delta: -2 },
      ];
      expect(n({ kind: "punish", base: 10 }, mods)).toBe(0);
    });

    it("replacedBy 记下是谁替换的", () => {
      const r = resolveDrawCount({ kind: "punish", base: 10, seat: 0 }, [{ layer: "L1", source: "伤逝", value: 3 }]);
      expect(r.replacedBy).toBe("伤逝");
      expect(resolveDrawCount({ kind: "rule", base: 1, seat: 0 }, []).replacedBy).toBeUndefined();
    });
  });

  describe("L2 加减", () => {
    it("同层多个修正全部累加，一条都不许被吞", () => {
      const mods: DrawModifier[] = [
        { layer: "L2", source: "恩惠", delta: -2 },
        { layer: "L2", source: "狂欢2", delta: 1 },
        { layer: "L2", source: "八门", delta: 1 },
        { layer: "L2", source: "弃异", delta: -1 },
      ];
      expect(n({ kind: "punish", base: 6 }, mods)).toBe(5);
    });

    it("顺序不影响结果", () => {
      const mods: DrawModifier[] = [
        { layer: "L2", source: "a", delta: -2 },
        { layer: "L2", source: "b", delta: 1 },
        { layer: "L2", source: "c", delta: 3 },
      ];
      const shuffled = [mods[2], mods[0], mods[1]];
      const reversed = [...mods].reverse();
      expect(n({ base: 6 }, mods)).toBe(8);
      expect(n({ base: 6 }, shuffled)).toBe(8);
      expect(n({ base: 6 }, reversed)).toBe(8);
    });
  });

  describe("L3 倍率", () => {
    it("在 L2 之后套用，不是之前", () => {
      const mods: DrawModifier[] = [
        { layer: "L3", source: "战争序", factor: 2 },
        { layer: "L2", source: "恩惠", delta: -2 },
      ];
      // (6-2)*2 = 8，若顺序反了会得到 6*2-2 = 10
      expect(n({ kind: "punish", base: 6 }, mods)).toBe(8);
    });
  });

  describe("L4 覆盖", () => {
    it("恒定值覆盖掉 L2/L3 的结果", () => {
      const mods: DrawModifier[] = [
        { layer: "L2", source: "狂欢2", delta: 1 },
        { layer: "L3", source: "战争序", factor: 2 },
        { layer: "L4", source: "樱时雨", scope: "global", value: 1 },
      ];
      expect(n({ kind: "punish", base: 6 }, mods)).toBe(1);
    });

    it("冲突时作用于受罚者自身的覆盖胜过全局覆盖", () => {
      const mods: DrawModifier[] = [
        { layer: "L4", source: "樱时雨", scope: "global", value: 1 },
        { layer: "L4", source: "狂欢4", scope: "self", value: 0 },
      ];
      expect(n({ kind: "punish", base: 6 }, mods)).toBe(0);
      // 顺序反过来结论不变
      expect(n({ kind: "punish", base: 6 }, [mods[1], mods[0]])).toBe(0);
    });
  });

  describe("L5 钳制", () => {
    it("全局最终值 ≥ 0：修正把结果压到负数时收到 0", () => {
      expect(n({ kind: "punish", base: 2 }, [{ layer: "L2", source: "恩惠", delta: -5 }])).toBe(0);
    });

    it("效果自带下限把结果抬到下限", () => {
      const mods: DrawModifier[] = [
        { layer: "L2", source: "恩惠", delta: -2 },
        { layer: "L5", source: "恩惠", min: 1 },
      ];
      expect(n({ kind: "punish", base: 2 }, mods)).toBe(1);
    });

    // 2026-07-31 裁定：下限只在**本次确实减了**时生效——它是减免的地板，不是无中生有的保底。
    // 强袭掷 0 时惩罚基数就是 0，亮着恩惠的人不该反而摸 1 张。
    it("基数本来就在下限之下（掷 0 的惩罚）→ 不抬，摸 0", () => {
      const mods: DrawModifier[] = [
        { layer: "L2", source: "恩惠", delta: -2 },
        { layer: "L5", source: "恩惠", min: 1 },
      ];
      expect(n({ kind: "punish", base: 0 }, mods)).toBe(0);
    });

    it("基数恰好等于下限（劫营让人摸 1）→ 仍是 1，减不下去", () => {
      const mods: DrawModifier[] = [
        { layer: "L2", source: "恩惠", delta: -2 },
        { layer: "L5", source: "恩惠", min: 1 },
      ];
      expect(n({ kind: "punish", base: 1 }, mods)).toBe(1);
    });

    it("效果下限与全局 ≥0 同时存在时，取更高的那个（下限 1 胜过 0）", () => {
      const mods: DrawModifier[] = [
        { layer: "L2", source: "恩惠", delta: -9 },
        { layer: "L5", source: "恩惠", min: 1 },
      ];
      expect(n({ kind: "punish", base: 2 }, mods)).toBe(1);
      // 同一个基础值，没有效果下限时落回全局 0
      expect(n({ kind: "punish", base: 2 }, [mods[0]])).toBe(0);
    });

    it("下限不会把已经更高的值拉下来", () => {
      expect(n({ kind: "punish", base: 6 }, [{ layer: "L5", source: "恩惠", min: 1 }])).toBe(6);
    });
  });

  describe("L6 后置程序", () => {
    it("不改数字，只改执行方式——最终摸牌数不受 L6 影响", () => {
      const l6: DrawModifier[] = [
        { layer: "L6", source: "忍戒", procedure: "draw_then_discard", values: { L6: 6 } },
        { layer: "L6", source: "染手", procedure: "from_discard_pile", values: { L6: 2 } },
      ];
      const mods: DrawModifier[] = [{ layer: "L2", source: "恩惠", delta: -2 }];
      expect(n({ kind: "punish", base: 6 }, mods)).toBe(4);
      expect(n({ kind: "punish", base: 6 }, [...mods, ...l6])).toBe(4);
    });

    it("L6 原样交给调用方去执行", () => {
      const r = resolveDrawCount({ kind: "punish", base: 6, seat: 0 }, [
        { layer: "L6", source: "忍戒", procedure: "draw_then_discard", values: { L6: 6 } },
      ]);
      expect(r.procedures.map((p) => p.procedure)).toEqual(["draw_then_discard"]);
      expect(resolveDrawCount({ kind: "rule", base: 1, seat: 0 }, []).procedures).toEqual([]);
    });
  });
});

describe("接线：每一次摸牌都过层级", () => {
  it("drawCards 摸的是 reducer 算出来的数，不是请求里的基础值", () => {
    const b = table([[], [], []], { drawPile: pile(20) }).board!;
    const { drawn, resolution } = drawCards(b, { kind: "punish", base: 6, seat: 0 }, ctx().rng, [
      { layer: "L2", source: "恩惠", delta: -2 },
    ]);
    expect(resolution.count).toBe(4);
    expect(drawn).toHaveLength(4);
  });

  it("摸牌堆不够就摸到几张算几张（结算出的数与实际摸到的数可以不等）", () => {
    // drawPile 2 张，弃牌堆只有牌顶所以洗不回来
    const b = table([[], [], []], { drawPile: pile(2) }).board!;
    const { drawn, resolution } = drawCards(b, { kind: "punish", base: 6, seat: 0 }, ctx().rng);
    expect(resolution.count).toBe(6);
    expect(drawn).toHaveLength(2);
  });

  it("结算为 0 张时一张都不摸", () => {
    const b = table([[], [], []], { drawPile: pile(20) }).board!;
    const { drawn, board } = drawCards(b, { kind: "punish", base: 6, seat: 0 }, ctx().rng, [
      { layer: "L4", source: "狂欢4", scope: "self", value: 0 },
    ]);
    expect(drawn).toEqual([]);
    expect(board.drawPile).toHaveLength(20);
  });

  it("P11/P6：受罚侧摸的是各段贡献的加总，进链时已入贡献的修正不在 L0 重复计算", () => {
    // 第一段的贡献在打出进链时已经被改成 5（P6「只作用于自己打出的那一张」）。
    // 受罚者摸 5+4=9：既不是把基础 2 再加一遍的 11，也不是无视贡献的 2+4=6。
    const chain = {
      initiator: 1,
      segments: [
        { seat: 1, face: "+2" as const, draw: 5 },
        { seat: 2, face: "+4" as const, draw: 4 },
      ],
      total: 9,
    };
    const state = table([[], [], []], { drawPile: pile(30), punish: chain, currentSeat: 0 }, {
      phase: "afterPlay",
      pendingWindow: {
        type: "punishStack",
        actors: [0],
        deadline: "2026-07-28T12:00:30.000Z",
        defaultChoice: "accept",
        resume: "play",
      },
    });
    const r = applyAction(state, { type: "respond", seat: 0, windowId: "w10:punishStack", choice: "accept" }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(9);
  });
});
