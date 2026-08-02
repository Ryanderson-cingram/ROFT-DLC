import type { Action, ClientSnapshot, PendingWindow } from "@roft/engine";
import { describe, expect, it } from "vitest";
import { FIXTURE_NAMES, HAND, PLAYERS, makeSnapshot } from "@/test-support/snapshot";
import { buttonLabel, handHint, sayFor } from "./hud-copy";

/**
 * 零 DOM 表驱动：取代原来靠 `querySelector(".hudsay")` / `.actions button` 的间接断言。
 * 文案是产品资产，这里逐字钉住——`hud.tsx` 里那几段是同一份字符串搬过来的。
 */

const nameOf = (seat: number) => FIXTURE_NAMES[PLAYERS[seat]?.userId ?? ""] ?? `座位 ${seat + 1}`;

const [R3, R7, B7] = HAND;
const Y2 = HAND[4];

/** 快照里没有 windowId 的默认值不重要（sayFor 不看它），但动作要与窗口同 id 才像真的。 */
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

describe("sayFor（牌桌中央那句人话）", () => {
  type Snap = Parameters<typeof makeSnapshot>[0];
  const CASES: { name: string; snap: Snap; want: string }[] = [
    { name: "1 有赢家", snap: { winner: 1 }, want: "阿柴赢了这一局。" },
    {
      name: "2 终局无赢家 = 平局（U8）",
      snap: { phase: "finished" },
      want: "牌摸完了，两次重洗之后还是没人打完：本局平局。",
    },
    { name: "3 开局抽技能", snap: { pendingWindow: win("skillDraft") }, want: "开局：每人挑一个技能带上桌" },
    {
      name: "4 惩罚窗口（无代价牌）",
      snap: { pendingWindow: win("punishStack"), punish: PUNISH, legalActions: [respond("stack"), respond("accept")] },
      want: "被 +2/+4 了：接着叠，或者吃下 6 张",
    },
    {
      name: "5 惩罚窗口 + 远星代价牌高亮",
      snap: {
        pendingWindow: win("punishStack"),
        punish: PUNISH,
        legalActions: [respond("accept"), respond("farstar", [R7.id])],
      },
      want: "被 +2/+4 了：接着叠，或者吃下 6 张；也可以点高亮的牌当代价弃掉，视为你也叠了一张",
    },
    {
      name: "6 影歌攒魂",
      snap: { pendingWindow: win("soulHarvest") },
      want: "轮到你了：亮一张对得上的牌，或者不亮直接摸牌（对方按此攒魂）",
    },
    { name: "7 司夜还牌", snap: { pendingWindow: win("swapReturn") }, want: "盲抽完了：从手牌里挑 1 张还给对方" },
    {
      name: "8 洗牌·摸一弃一",
      snap: { pendingWindow: win("shuffleDiscard") },
      want: "洗牌·摸一弃一：摸完了，从手牌里挑 1 张弃掉",
    },
    {
      name: "9 洗牌取消",
      snap: { pendingWindow: win("shuffleCancel"), currentSeat: 3 },
      want: "老白打出了洗牌（全体手牌打乱重分）：点高亮的洗牌牌取消，或者放弃",
    },
    {
      name: "10 强袭接管",
      snap: { pendingWindow: win("diceTakeover"), dice: { seat: 1, reason: "punish", values: [2, 1] } },
      want: "阿柴掷出了 2、1：你可以重掷同样数量并采用你的结果",
    },
    {
      name: "11 劫营打断",
      snap: { pendingWindow: win("interrupt"), currentSeat: 2 },
      want: "小满刚摆下一张：点高亮的牌打断这一轮，或者放弃",
    },
    {
      name: "12 未知窗口类型（保底句）",
      snap: { pendingWindow: win("someNewWindow"), currentSeat: 2 },
      want: "等待你响应：小满打出了牌，这一轮只等你要不要打断",
    },
    {
      name: "13 窗口不等你（旁观）",
      snap: { pendingWindow: win("punishStack", [1, 2]), currentSeat: 1 },
      want: "等阿柴、小满响应，其他操作先停下",
    },
    {
      // 那一串 actors 就是「谁手上有洗牌牌」（手牌私有）。引擎已经把它遮成「只有你自己」，
      // 文案这边也不许点名——哪怕手上这份快照里塞了名字，也不能漏出去
      name: "13b 洗牌取消窗口（旁观）：不点名谁能取消",
      snap: { pendingWindow: win("shuffleCancel", [1, 2]), currentSeat: 3 },
      want: "等其他人决定要不要取消这次洗牌，其他操作先停下",
    },
    { name: "14 别人的回合", snap: { currentSeat: 3 }, want: "老白的回合，等一等" },
    { name: "15 刚摸到能打的牌（U1）", snap: { drawnPlayable: R3 }, want: "刚摸到的这张能打：打它，或者结束回合" },
    { name: "16 叠链里轮到你打", snap: { punish: PUNISH }, want: "接着叠：打一张能接的惩罚牌（累计 6 张）" },
    { name: "17 你的回合（默认）", snap: {}, want: "你的回合：挑一张能打的牌，或者摸牌" },
  ];

  it.each(CASES)("$name", ({ snap, want }) => {
    expect(sayFor(makeSnapshot(snap), nameOf)).toBe(want);
  });
});

describe("handHint（手牌上方那行）", () => {
  it("多选中：说多打的三种形状", () => {
    expect(handHint(makeSnapshot(), true)).toBe("多打：点选 2 张同色同数 / 4 张同数 / 6 张同色");
  });

  it("打断窗口：高亮 = 能用来打断", () => {
    const s = makeSnapshot({ pendingWindow: win("interrupt"), legalActions: [respond("raid", [B7.id])] });
    expect(handHint(s, false)).toBe("高亮 = 能用来打断（同色同数）");
  });

  it("洗牌取消窗口：高亮 = 能取消（点了先定色）", () => {
    const s = makeSnapshot({ pendingWindow: win("shuffleCancel"), legalActions: [respond("cancel", [B7.id])] });
    expect(handHint(s, false)).toBe("高亮 = 能用来取消这次洗牌（点了先定色）");
  });

  it("惩罚窗口的远星代价牌：高亮 = 能当代价弃掉", () => {
    const s = makeSnapshot({ pendingWindow: win("punishStack"), legalActions: [respond("farstar", [R7.id])] });
    expect(handHint(s, false)).toBe("高亮 = 能当代价弃掉");
  });

  /**
   * 司夜②还牌与洗牌②弃牌两个窗口里手牌就是操作对象，高亮的意思跟「现在能打」是两回事。
   * 泛化的那句话在这两个窗口下会误导人：它写着「能打」，实际点下去是把牌交出去。
   */
  it("司夜②还牌窗口：高亮 = 可以还给对方", () => {
    const s = makeSnapshot({
      pendingWindow: win("swapReturn"),
      legalActions: [respond(R3.id), respond(B7.id)],
    });
    expect(handHint(s, false)).toBe("高亮 = 可以还给对方");
  });

  it("洗牌②弃牌窗口：高亮 = 可以弃掉", () => {
    const s = makeSnapshot({
      pendingWindow: win("shuffleDiscard"),
      legalActions: [respond(R3.id)],
    });
    expect(handHint(s, false)).toBe("高亮 = 可以弃掉");
  });

  it("两个窗口不等你的时候不套用那两句（actors 里没有你）", () => {
    const s = makeSnapshot({ pendingWindow: win("swapReturn", [1]), legalActions: [] });
    expect(handHint(s, false)).toBe("这一轮没有能打的牌");
  });

  it("挑代价牌（恒心弃 1）：说清楚手牌全部可选", () => {
    expect(handHint(makeSnapshot(), false, true)).toBe("点一张牌弃掉当代价（手牌全部可选）");
  });

  it("你的回合有能打的牌：高亮 = 现在能打", () => {
    expect(handHint(makeSnapshot(), false)).toBe("高亮 = 现在能打");
  });

  it("一张都打不出：这一轮没有能打的牌", () => {
    expect(handHint(makeSnapshot({ legalActions: [{ type: "drawCard", seat: 0 }] }), false)).toBe(
      "这一轮没有能打的牌",
    );
  });
});

describe("buttonLabel（每种动作类型各一例）", () => {
  const s = makeSnapshot({ punish: PUNISH });
  const label = (a: Action, snap: ClientSnapshot = s) => buttonLabel(a, snap, nameOf);

  it("playCards（强袭的掷骰打变体）", () => {
    expect(label({ type: "playCards", seat: 0, cardIds: [Y2.id], useAssault: true })).toBe(
      "掷骰打黄 +2（0 / 1 / 2 倍）",
    );
  });

  it("playCards：牌不在手里也不留空按钮", () => {
    expect(label({ type: "playCards", seat: 0, cardIds: ["不存在"], useAssault: true })).toBe(
      "掷骰打（0 / 1 / 2 倍）",
    );
  });

  it("drawCard", () => expect(label({ type: "drawCard", seat: 0 })).toBe("摸牌"));
  it("endTurn", () => expect(label({ type: "endTurn", seat: 0 })).toBe("结束回合"));
  it("claimTimeout", () =>
    expect(label({ type: "claimTimeout", seat: 0, windowId: "w12:x" })).toBe("催促超时"));
  it("catchUno", () => expect(label({ type: "catchUno", seat: 0, target: 2 })).toBe("抓小满：没喊 UNO"));
  it("revealSkill", () => expect(label({ type: "revealSkill", seat: 0 })).toBe("亮出技能"));
  it("stealSwap", () => expect(label({ type: "stealSwap", seat: 0, target: 3 })).toBe("花 1 盗与老白换 1 张"));

  it("activateSkill：单主动技能回落到 l0", () => {
    // 座位 0 持恒心（spade-1），没写 per-effect 文案
    expect(label({ type: "activateSkill", seat: 0, effectKey: "1" })).toBe("发动技能：弃一张牌，摸一张牌");
  });

  it("activateSkill：多主动技能按 effectKey 分（否则两个按钮字面一样）", () => {
    const shadow = makeSnapshot({
      players: PLAYERS.map((p) => (p.seat === 0 ? { ...p, skillId: "diamond-3" } : p)),
    });
    expect(label({ type: "activateSkill", seat: 0, effectKey: "1" }, shadow)).toBe("发动技能：攒 1 个魂（最多 6）");
    expect(label({ type: "activateSkill", seat: 0, effectKey: "2" }, shadow)).toBe(
      "发动技能：花 2 魂跳过这一回合",
    );
  });

  it("respond accept：吃几张从叠链读", () => {
    expect(label(respond("accept"))).toBe("吃下 6 张");
    expect(label(respond("accept"), makeSnapshot())).toBe("吃下 0 张");
  });

  it("respond show-exact / show-partial：写清楚亮的是什么、亮完摸不摸", () => {
    expect(label(respond("show-exact", [R3.id]))).toBe("亮出红 3（同色同数，不摸牌）");
    expect(label(respond("show-partial", [B7.id]))).toBe("亮出蓝 7（半匹配，摸 1 张）");
  });

  it("respond 其余 choice 走人话表", () => expect(label(respond("pass"))).toBe("放弃"));

  it("respond 未知 choice：原样显示，总比空按钮强", () =>
    expect(label(respond("brand-new-choice"))).toBe("brand-new-choice"));

  it("未知动作类型：回落到类型名", () =>
    expect(label({ type: "startGame", seat: 0 })).toBe("startGame"));
});
