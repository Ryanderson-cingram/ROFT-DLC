import type { Action, PendingWindow } from "@roft/engine";
import { describe, expect, it } from "vitest";
import { FIXTURE_NAMES, HAND, PLAYERS, makeSnapshot } from "@/test-support/snapshot";
import { dockSlots, type SlotName } from "./dock-slots";

/**
 * 穷举每种 `pendingWindow.type` × 典型 `legalActions` 组合，逐槽断言。
 * 这张表就是「按钮位置固定」这条设计反馈的回归网：**任何一格都不许变成 undefined**。
 */

const nameOf = (seat: number) => FIXTURE_NAMES[PLAYERS[seat]?.userId ?? ""] ?? `座位 ${seat + 1}`;
const [R3, R7, B7] = HAND;
const Y2 = HAND[4];

const win = (type: string, actors = [0]): PendingWindow => ({
  type,
  actors,
  deadline: new Date(Date.now() + 10_000).toISOString(),
  defaultChoice: "pass",
  resume: "play",
});
const respond = (choice: string, cardIds?: string[]): Action => ({
  type: "respond",
  seat: 0,
  windowId: "w12:x",
  choice,
  ...(cardIds ? { cardIds } : {}),
});
const PUNISH = { initiator: 1, segments: [{ seat: 1, face: "+2" as const, draw: 2 }], total: 6 };
type Snap = Parameters<typeof makeSnapshot>[0];

/** 一格的期望：有动作就写 label（可选 tone / 多条时的 items），没动作就写 disabled 的理由。 */
type Want = { label: string; tone?: string; items?: string[] } | { disabled: string };

const CASES: { name: string; snap: Snap; want: Record<SlotName, Want> }[] = [
  {
    name: "无窗口的你的回合：出牌靠点牌，所以中槽写着「点高亮」而不是消失",
    snap: {},
    want: {
      skill: { disabled: "现在不能发动技能" },
      main: { disabled: "高亮 = 现在能打" },
      yield: { label: "摸牌" },
    },
  },
  {
    name: "你的回合：一张都打不出",
    snap: { legalActions: [{ type: "drawCard", seat: 0 }] },
    want: {
      skill: { disabled: "现在不能发动技能" },
      main: { disabled: "这一轮没有能打的牌" },
      yield: { label: "摸牌" },
    },
  },
  {
    name: "刚摸到能打的那张（U1）：右槽变成结束回合，强袭变体占中槽",
    snap: {
      drawnPlayable: Y2,
      legalActions: [
        { type: "playCards", seat: 0, cardIds: [Y2.id] },
        { type: "playCards", seat: 0, cardIds: [Y2.id], useAssault: true },
        { type: "endTurn", seat: 0 },
      ],
    },
    want: {
      skill: { disabled: "现在不能发动技能" },
      main: { label: "掷骰打黄 +2（0 / 1 / 2 倍）", tone: "primary" },
      yield: { label: "结束回合" },
    },
  },
  {
    name: "亮出技能：左槽",
    snap: { legalActions: [{ type: "revealSkill", seat: 0 }, { type: "drawCard", seat: 0 }] },
    want: { skill: { label: "亮出技能" }, main: { disabled: "这一轮没有能打的牌" }, yield: { label: "摸牌" } },
  },
  {
    name: "两条主动（影歌①②）：左槽亮第一条并报个数",
    snap: {
      players: PLAYERS.map((p) => (p.seat === 0 ? { ...p, skillId: "diamond-3" } : p)),
      legalActions: [
        { type: "activateSkill", seat: 0, effectKey: "1" },
        { type: "activateSkill", seat: 0, effectKey: "2" },
        { type: "drawCard", seat: 0 },
      ],
    },
    want: {
      skill: {
        label: "发动技能",
        items: ["发动技能：攒 1 个魂（最多 6）", "发动技能：花 2 魂跳过这一回合"],
      },
      main: { disabled: "这一轮没有能打的牌" },
      yield: { label: "摸牌" },
    },
  },
  {
    name: "司夜②盗换：也是左槽（不是「发动」，但仍是技能的主动）",
    snap: {
      legalActions: [{ type: "stealSwap", seat: 0, target: 3 }, { type: "drawCard", seat: 0 }],
    },
    want: {
      skill: { label: "花 1 盗与老白换 1 张" },
      main: { disabled: "这一轮没有能打的牌" },
      yield: { label: "摸牌" },
    },
  },
  {
    name: "被血棘封印：左槽灰着，理由是封印而不是「现在不能发动」",
    snap: { players: PLAYERS.map((p) => (p.seat === 0 ? { ...p, statuses: ["封印"] } : p)) },
    want: {
      skill: { disabled: "被血棘封印：技能连被动一起关着" },
      main: { disabled: "高亮 = 现在能打" },
      yield: { label: "摸牌" },
    },
  },
  {
    name: "还没有技能：左槽照样在，只是灰着",
    snap: { players: PLAYERS.map((p) => (p.seat === 0 ? { ...p, skillId: null } : p)) },
    want: {
      skill: { disabled: "你还没有技能" },
      main: { disabled: "高亮 = 现在能打" },
      yield: { label: "摸牌" },
    },
  },
  {
    name: "punishStack：叠占中槽、吃下占右槽、左槽写明惩罚回合不能用主动",
    snap: {
      pendingWindow: win("punishStack"),
      punish: PUNISH,
      legalActions: [respond("stack"), respond("accept")],
    },
    want: {
      skill: { disabled: "惩罚回合不能用主动技能" },
      main: { label: "接着叠", tone: "primary" },
      yield: { label: "吃下 6 张", tone: "danger" },
    },
  },
  {
    name: "punishStack + 远星代价牌：代价牌走手牌高亮，不挤占中槽",
    snap: {
      pendingWindow: win("punishStack"),
      punish: PUNISH,
      legalActions: [respond("accept"), respond("farstar", [R7.id]), respond("farstar", [R3.id])],
    },
    want: {
      skill: { disabled: "惩罚回合不能用主动技能" },
      main: { disabled: "高亮 = 能当代价弃掉" },
      yield: { label: "吃下 6 张", tone: "danger" },
    },
  },
  {
    name: "punishStack + 影歌②花魂跳过：豁免的那条主动占住左槽",
    snap: {
      pendingWindow: win("punishStack"),
      punish: PUNISH,
      legalActions: [respond("stack"), respond("accept"), respond("soul-skip")],
    },
    want: {
      skill: { label: "花魂跳过本回合", tone: "primary" },
      main: { label: "接着叠", tone: "primary" },
      yield: { label: "吃下 6 张", tone: "danger" },
    },
  },
  {
    name: "interrupt（劫营）：截牌是点牌，中槽指路、右槽放弃",
    snap: {
      pendingWindow: win("interrupt"),
      currentSeat: 2,
      legalActions: [respond("raid", [B7.id]), respond("pass")],
    },
    want: {
      skill: { disabled: "现在不能发动技能" },
      main: { disabled: "高亮 = 能用来打断（同色同数）" },
      yield: { label: "放弃", tone: "ghost" },
    },
  },
  {
    name: "shuffleCancel：取消牌也是点牌",
    snap: {
      pendingWindow: win("shuffleCancel"),
      currentSeat: 3,
      legalActions: [respond("cancel", [B7.id]), respond("pass")],
    },
    want: {
      skill: { disabled: "现在不能发动技能" },
      main: { disabled: "高亮 = 能用来取消这次洗牌（点了先定色）" },
      yield: { label: "放弃", tone: "ghost" },
    },
  },
  {
    name: "diceTakeover（强袭②）：重掷占中槽",
    snap: {
      pendingWindow: win("diceTakeover"),
      dice: { seat: 1, reason: "punish", values: [2] },
      legalActions: [respond("takeover"), respond("pass")],
    },
    want: {
      skill: { disabled: "现在不能发动技能" },
      main: { label: "重掷，采用我的结果", tone: "primary" },
      yield: { label: "放弃", tone: "ghost" },
    },
  },
  {
    name: "soulHarvest（影歌①）：亮牌占中槽（这里的按牌 respond 不是代价牌，出得成按钮）",
    snap: {
      pendingWindow: win("soulHarvest"),
      currentSeat: 3,
      legalActions: [respond("show-exact", [R7.id]), respond("show-partial", [R3.id]), respond("draw3")],
    },
    want: {
      skill: { disabled: "现在不能发动技能" },
      main: {
        label: "亮牌",
        tone: "primary",
        items: ["亮出红 7（同色同数，不摸牌）", "亮出红 3（半匹配，摸 1 张）"],
      },
      // tone 沿用 `hud.tsx::buttonClass` 那张表（respond 非 accept/pass 一律 primary），P3 再谈配色
      yield: { label: "不亮牌，摸 3 张", tone: "primary" },
    },
  },
  {
    name: "swapReturn（司夜②还牌）：choice 是牌 id，两槽都指向手牌",
    snap: {
      pendingWindow: win("swapReturn"),
      currentSeat: 3,
      legalActions: HAND.map((c) => respond(c.id)),
    },
    want: {
      skill: { disabled: "现在不能发动技能" },
      main: { disabled: "盲抽完了：从手牌里挑 1 张还给对方" },
      yield: { disabled: "盲抽完了：从手牌里挑 1 张还给对方" },
    },
  },
  {
    // 摸 N 弃 N 的确认按钮要带本地选中的那几张，只有坞自己填得上（同并列的「打出 N 张」），
    // 所以引擎给的那条模板 respond 不占中槽
    name: "drawDiscard（摸 N 弃 N）：同上",
    snap: {
      pendingWindow: win("drawDiscard"),
      currentSeat: 3,
      drawDiscard: { seat: 0, picks: 1 },
      legalActions: [respond("discard")],
    },
    want: {
      skill: { disabled: "现在不能发动技能" },
      main: { disabled: "摸完了：从手牌里挑 1 张弃掉" },
      yield: { disabled: "摸完了：从手牌里挑 1 张弃掉" },
    },
  },
  {
    // 吟游♣5：一条主动有四个选项 → 左槽一个按钮点开菜单（槽位不长高、不换位）
    name: "吟游：四支歌声收进左槽的菜单",
    snap: {
      players: PLAYERS.map((p) => (p.seat === 0 ? { ...p, skillId: "club-5" } : p)),
      legalActions: (["活泼板", "战争序", "樱时雨", "行进曲"] as const).map((k) => ({
        type: "activateSkill" as const, seat: 0, effectKey: k,
      })),
    },
    want: {
      // 多条挤一个槽 → 按钮写组名，四条进菜单（槽位不长高、不换位）
      skill: {
        label: "发动技能",
        items: [
          "发动技能：唱活泼板（所有摸牌 +1）",
          "发动技能：唱战争序（惩罚摸牌 ×2）",
          "发动技能：唱樱时雨（惩罚摸牌恒为 1）",
          "发动技能：唱行进曲（变色牌不能改色）",
        ],
      },
      main: { disabled: "这一轮没有能打的牌" },
      yield: { disabled: "你的回合：挑一张能打的牌，或者摸牌" },
    },
  },
  {
    // 神授♥5（01-S17）：无牌可出时可以不摸直接结束 → 右槽同时有「摸牌」与「结束回合」，
    // 两条就收进同一个按钮的菜单里（槽位不长高、不换位）
    name: "神授：无牌可出时右槽给两条（摸 / 直接结束）",
    snap: { legalActions: [{ type: "drawCard", seat: 0 }, { type: "endTurn", seat: 0 }] },
    want: {
      skill: { disabled: "现在不能发动技能" },
      main: { disabled: "这一轮没有能打的牌" },
      yield: { label: "摸牌", items: ["摸牌", "结束回合"] },
    },
  },
  {
    // 近卫♥6：交牌那条要带本地选中的牌，所以不占中槽（同摸 N 弃 N）；「不交」进右槽
    name: "handOver（近卫交牌）：模板不占中槽，不交进右槽",
    snap: {
      pendingWindow: win("handOver"),
      currentSeat: 3,
      handOver: { seat: 0, target: 3, max: 2 },
      legalActions: [respond("give"), respond("keep")],
    },
    want: {
      skill: { disabled: "现在不能发动技能" },
      main: { disabled: "吃完了：可以从手牌里挑最多 2 张交给老白，也可以不交" },
      yield: { label: "不交牌", tone: "ghost" },
    },
  },
  {
    // 合纵/连横②：要 → 中槽（推进），不要 → 右槽（退让）
    name: "drawOffer（要不要摸 N 弃 N）：两条各归各槽",
    snap: {
      pendingWindow: win("drawOffer"),
      currentSeat: 3,
      drawOffer: { seat: 0, picks: 2 },
      legalActions: [respond("take"), respond("decline")],
    },
    want: {
      skill: { disabled: "现在不能发动技能" },
      main: { label: "摸 2 张再弃 2 张", tone: "primary" },
      yield: { label: "这次不摸", tone: "ghost" },
    },
  },
  {
    name: "skillDraft：全屏面板接管，坞整个歇着",
    snap: {
      phase: "dealing",
      currentSeat: null,
      pendingWindow: win("skillDraft"),
      legalActions: [respond("spade-1"), respond("heart-1"), respond("diamond-2")],
    },
    want: {
      skill: { disabled: "开局：每人挑一个技能带上桌" },
      main: { disabled: "开局：每人挑一个技能带上桌" },
      yield: { disabled: "开局：每人挑一个技能带上桌" },
    },
  },
  {
    name: "他人回合：三槽全灰，理由就是那句人话",
    snap: {
      currentSeat: 3,
      legalActions: [{ type: "callUno", seat: 0 }, { type: "catchUno", seat: 0, target: 2 }],
    },
    want: {
      skill: { disabled: "老白的回合，等一等" },
      main: { disabled: "老白的回合，等一等" },
      yield: { disabled: "老白的回合，等一等" },
    },
  },
  {
    name: "窗口不等你：三槽全灰",
    snap: { pendingWindow: win("punishStack", [1]), currentSeat: 1, legalActions: [] },
    want: {
      skill: { disabled: "等阿柴响应，其他操作先停下" },
      main: { disabled: "等阿柴响应，其他操作先停下" },
      yield: { disabled: "等阿柴响应，其他操作先停下" },
    },
  },
  {
    name: "终局：坞歇着",
    snap: { winner: 1, phase: "finished", legalActions: [] },
    want: {
      skill: { disabled: "阿柴赢了这一局。" },
      main: { disabled: "阿柴赢了这一局。" },
      yield: { disabled: "阿柴赢了这一局。" },
    },
  },
];

describe("dockSlots（三固定槽位）", () => {
  it.each(CASES)("$name", ({ snap, want }) => {
    const slots = dockSlots(makeSnapshot(snap), nameOf);
    for (const name of ["skill", "main", "yield"] as SlotName[]) {
      const got = slots[name];
      const w = want[name];
      if ("disabled" in w) {
        expect({ [name]: got.actions }).toEqual({ [name]: [] });
        expect(got.disabled).toBe(true);
        expect(got.reason).toBe(w.disabled);
        expect(got.label.length).toBeGreaterThan(0);
      } else {
        expect(got.actions.length).toBe(w.items?.length ?? 1);
        expect(got.disabled).toBe(false);
        expect(got.label).toBe(w.label);
        expect(got.tone).toBe(w.tone);
        expect(got.itemLabels).toEqual(w.items);
      }
    }
  });

  it("三个槽位永远都在；disabled 与「没有动作」恒等，灰着必给理由", () => {
    for (const { snap } of CASES) {
      const slots = dockSlots(makeSnapshot(snap), nameOf);
      for (const name of ["skill", "main", "yield"] as SlotName[]) {
        const slot = slots[name];
        expect(slot.label).toBeTruthy();
        expect(slot.disabled).toBe(slot.actions.length === 0);
        if (slot.disabled) expect(slot.reason).toBeTruthy();
        // 多条才给菜单文案，且与 actions 同序同长
        expect(slot.itemLabels?.length).toBe(slot.actions.length > 1 ? slot.actions.length : undefined);
      }
    }
  });

  it("callUno / catchUno / claimTimeout 是常驻定点，永远不进三槽", () => {
    const s = makeSnapshot({
      legalActions: [
        { type: "callUno", seat: 0 },
        { type: "catchUno", seat: 0, target: 2 },
        { type: "claimTimeout", seat: 0, windowId: "w12:x" },
        { type: "drawCard", seat: 0 },
      ],
    });
    const slots = dockSlots(s, nameOf);
    expect(slots.skill.actions).toEqual([]);
    expect(slots.main.actions).toEqual([]);
    expect(slots.yield.actions).toEqual([{ type: "drawCard", seat: 0 }]);
  });

  it("影歌①②：左槽一次装下两条主动，菜单文案逐条不同", () => {
    const slots = dockSlots(
      makeSnapshot({
        players: PLAYERS.map((p) => (p.seat === 0 ? { ...p, skillId: "diamond-3" } : p)),
        legalActions: [
          { type: "activateSkill", seat: 0, effectKey: "1" },
          { type: "activateSkill", seat: 0, effectKey: "2" },
          { type: "drawCard", seat: 0 },
        ],
      }),
      nameOf,
    );
    expect(slots.skill.actions).toHaveLength(2);
    expect(slots.skill.label).toBe("发动技能");
    expect(new Set(slots.skill.itemLabels)).toHaveLength(2);
    // 槽位没挪窝：右槽照旧是摸牌
    expect(slots.yield.label).toBe("摸牌");
  });

  it("司夜②多目标：每个目标一条，逐条写明跟谁换", () => {
    const slots = dockSlots(
      makeSnapshot({
        players: PLAYERS.map((p) => (p.seat === 0 ? { ...p, skillId: "club-3" } : p)),
        legalActions: [
          { type: "stealSwap", seat: 0, target: 1 },
          { type: "stealSwap", seat: 0, target: 2 },
          { type: "stealSwap", seat: 0, target: 3 },
          { type: "drawCard", seat: 0 },
        ],
      }),
      nameOf,
    );
    expect(slots.skill.actions).toHaveLength(3);
    expect(slots.skill.label).toBe("花 1 盗换牌");
    expect(slots.skill.itemLabels).toEqual([
      "花 1 盗与阿柴换 1 张",
      "花 1 盗与小满换 1 张",
      "花 1 盗与老白换 1 张",
    ]);
  });
});
