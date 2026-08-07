import type { Action, ClientSnapshot } from "@roft/engine";
import { describe, expect, it } from "vitest";
import { HAND, PLAYERS, makeSnapshot } from "@/test-support/snapshot";
import { cardNames, renderGame } from "@/test-support/render-game";

/**
 * 跑遍所有状态的不变式，外加终局那两态。
 *
 * 设计稿 spec §9 第 4 条的验收项就是这个：「命令坞三槽位在全部状态下位置不变」。
 * 单个状态的用例各自散在 `dock.test.tsx` / `windows.test.tsx` / `skills.test.tsx` 里，
 * 这里把状态摆成一张表**横着跑**——第 5 条 UI 反馈（按钮别乱跑）的最终防线。
 */

const [R3, , B7] = HAND;
const noop = () => {};

const window9 = (type: string, actors: number[], defaultChoice: string) => ({
  type,
  actors,
  deadline: new Date(Date.now() + 9_000).toISOString(),
  defaultChoice,
  resume: "play" as const,
});

const respond = (type: string, choice: string, cardIds?: string[]): Action => ({
  type: "respond",
  seat: 0,
  windowId: `w9:${type}`,
  choice,
  ...(cardIds ? { cardIds } : {}),
});

/** 一个窗口态：actors 默认是你。 */
const win = (
  type: string,
  defaultChoice: string,
  actions: Action[],
  extra: Parameters<typeof makeSnapshot>[0] = {},
  actors = [0],
): ClientSnapshot =>
  makeSnapshot({
    currentSeat: 1,
    ...extra,
    pendingWindow: window9(type, actors, defaultChoice),
    windowId: `w9:${type}`,
    legalActions: actions,
  });

/**
 * 设计稿 §5 的状态清单（主流程 A–F + 技能窗口），一态一行。
 * `go()` 而不是快照数组：定色与弃代价是**本地态**，进不了快照。
 */
const STATES: { name: string; go: () => ReturnType<typeof renderGame> }[] = [
  { name: "A 你的回合", go: () => renderGame(makeSnapshot()) },
  { name: "B 他人回合", go: () => renderGame(makeSnapshot({ currentSeat: 1, legalActions: [] })) },
  {
    name: "C 惩罚叠链 · 当事人",
    go: () =>
      renderGame(
        win("punishStack", "accept", [respond("punishStack", "stack"), respond("punishStack", "accept")], {
          punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2, color: "Y" }], total: 2 },
        }),
      ),
  },
  {
    name: "C 惩罚叠链 · 旁观",
    go: () =>
      renderGame(
        win("punishStack", "accept", [{ type: "callUno", seat: 0 }], {
          punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2, color: "Y" }], total: 2 },
        }, [1]),
      ),
  },
  {
    name: "H 劫营打断",
    go: () =>
      renderGame(
        win("interrupt", "pass", [respond("interrupt", "raid", [B7.id]), respond("interrupt", "pass")], {
          currentSeat: 2,
        }),
      ),
  },
  {
    name: "M 洗牌取消",
    go: () => renderGame(win("shuffleCancel", "pass", [respond("shuffleCancel", "pass")])),
  },
  {
    name: "N 强袭掷骰接管",
    go: () =>
      renderGame(
        win("diceTakeover", "pass", [respond("diceTakeover", "takeover"), respond("diceTakeover", "pass")], {
          dice: { seat: 1, reason: "punish", values: [2] },
        }),
      ),
  },
  {
    name: "K 影歌攒魂响应",
    go: () =>
      renderGame(
        win("soulHarvest", "draw3", [respond("soulHarvest", "draw3")], {
          currentSeat: 3,
          soulHarvest: { seat: 3, declared: { color: "R", face: "3" }, drawn: 0 },
        }),
      ),
  },
  {
    name: "I 司夜还牌",
    go: () => renderGame(win("swapReturn", "stolen", [respond("swapReturn", R3.id)])),
  },
  {
    name: "I 摸 N 弃 N 的弃牌",
    go: () =>
      renderGame(win("drawDiscard", "drawn", [respond("drawDiscard", "discard")], { drawDiscard: { seat: 0, picks: 1 } })),
  },
  {
    name: "E 开局抽 3 选 1",
    go: () =>
      renderGame(
        win("skillDraft", "first", [respond("skillDraft", "spade-1")], {
          phase: "dealing",
          draftOptions: ["spade-1"],
        }),
      ),
  },
  {
    name: "F 终局 · 有赢家",
    go: () => renderGame(makeSnapshot({ phase: "finished", winner: 1, legalActions: [] })),
  },
  {
    name: "F 终局 · 平局",
    go: () => renderGame(makeSnapshot({ phase: "finished", legalActions: [] })),
  },
  {
    name: "D 定色",
    go: () => renderGame(makeSnapshot(), {}, { card: HAND[6], onPick: noop, onCancel: noop }),
  },
  {
    name: "I 恒心弃 1 代价",
    go: () => renderGame(makeSnapshot(), {}, null, { onPick: noop, onCancel: noop }),
  },
];

describe("命令坞三槽位：位置在所有状态下不变（设计稿 §9 验收第 4 条）", () => {
  it.each(STATES)("$name", ({ go }) => {
    const { container } = go();
    const slots = [...container.querySelectorAll<HTMLElement>(".dock__row > .dock__slot")];
    expect(slots).toHaveLength(3);
    // 中槽永远是主操作
    expect(slots[1].className).toContain("dock__slot--main");
    // 技能徽只住在轮转轨的座位卡上，坞里一枚都没有（同一件东西不在一屏出现两次）
    expect(container.querySelector(".dock__row .skillbadge")).toBeNull();
    expect(container.querySelector(".seat--you .skillbadge")).not.toBeNull();
    // 每个槽里都有得点的东西：没有动作时是置灰保位的按钮，不是空壳
    for (const slot of slots) expect(slot.querySelector("button")).not.toBeNull();
  });
});

describe("牌桌不变式：摸牌堆没有展开入口 · 轮转轨含自己", () => {
  it.each(STATES)("$name", ({ go }) => {
    const { container } = go();

    // 摸牌堆是暗信息（spec §5 #1）：不是 button、没有 data-fan / .fan / .fan__more
    const draw = container.querySelectorAll(".piles .pile")[0];
    expect(draw.tagName).toBe("DIV");
    expect(draw.hasAttribute("data-fan")).toBe(false);
    expect(draw.querySelector(".fan")).toBeNull();
    expect(draw.querySelector(".fan__more")).toBeNull();
    expect(draw.getAttribute("aria-expanded")).toBeNull();

    // 第 1 条 UI 反馈：座位含自己，且标着「你」
    const seats = [...container.querySelectorAll(".dial__track .seat")];
    expect(seats).toHaveLength(PLAYERS.length);
    const you = container.querySelectorAll(".seat--you");
    expect(you).toHaveLength(1);
    expect(you[0].querySelector(".seat__you")?.textContent).toBe("你");
  });
});

/**
 * F 终局（设计稿 game-status.html 的 P5）。引擎在 `phase === "finished"` 时不再给任何动作，
 * 所以这里守的是「坞照旧在原地、说得出赢没赢、每人剩几张看得见」。
 */
describe("终局两态", () => {
  const finished = (over: Parameters<typeof makeSnapshot>[0] = {}) =>
    makeSnapshot({ phase: "finished", legalActions: [], ...over });

  it("有赢家：说出是谁赢了", () => {
    const { container } = renderGame(finished({ winner: 1 }));
    expect(container.querySelector(".dock__say")?.textContent).toBe("阿柴赢了这一局。");
  });

  // U8：牌堆洗满两次后又见底，无人打完 → 终局但没有 winner
  it("平局：终局却没有 winner，文案不许含糊成「谁赢了」", () => {
    const { container } = renderGame(finished());
    expect(container.querySelector(".dock__say")?.textContent).toBe(
      "牌摸完了，两次重洗之后还是没人打完：本局平局。",
    );
    expect(container.querySelector(".dock__say")?.textContent).not.toContain("赢");
  });

  it.each([
    { name: "有赢家", snap: () => finished({ winner: 1 }) },
    { name: "平局", snap: () => finished() },
  ])("$name：三槽全灰、手牌一张都点不动（引擎这时一条动作都不给）", ({ snap }) => {
    const { container } = renderGame(snap());
    for (const slot of container.querySelectorAll<HTMLElement>(".dock__row > .dock__slot")) {
      const btn = slot.querySelector("button:not(.skillbadge)") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    }
    expect(cardNames(container)).toEqual([]);
    // 没有窗口就没有倒计时
    expect(container.querySelector(".tickline")).toBeNull();
  });

  it("结算：每人剩几张就在座位卡上，逐个对得上快照", () => {
    // 赢家打完了手牌，所以他那格是 0——数字一律来自快照，页面不自己算
    const players = PLAYERS.map((p) => (p.seat === 1 ? { ...p, handCount: 0 } : p));
    const { container } = renderGame(finished({ winner: 1, players }));
    const seats = [...container.querySelectorAll(".dial__track .seat")];
    expect(seats.map((s) => s.querySelector(".seat__hand")?.textContent)).toEqual(
      players.map((p) => `手牌 ${p.handCount}`),
    );
  });
});
