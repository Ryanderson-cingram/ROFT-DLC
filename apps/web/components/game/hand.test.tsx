import type { Card, PendingWindow } from "@roft/engine";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HAND, makeSnapshot } from "@/test-support/snapshot";
import { cardNames, renderGame } from "@/test-support/render-game";

/**
 * 手牌区的 `pickFromHand` 态（spec §3.4 的头号命题）。
 *
 * 三条「从手牌里挑一张」的流程——司夜♣3②还牌 / 洗牌②弃牌 / 恒心♠1 的弃 1 代价——
 * **一律在手牌区直接点选，不弹任何面板、不上任何遮罩**。手牌本来就是操作对象，
 * 再盖一层全屏面板等于把操作对象藏起来。这三条从前各弹一次 `PickSheet`。
 *
 * 前两条的真相在快照里（`pendingWindow` + `legalActions`，choice 就是牌 id），
 * 第三条是提交前的本地选择（页面的 `Pending`），所以走 `costPick`。
 */

const [R3, R7, B7] = HAND;

const win = (type: string): PendingWindow => ({
  type,
  actors: [0],
  deadline: new Date(Date.now() + 10_000).toISOString(),
  defaultChoice: "stolen",
  resume: "play",
});

/** 窗口给的可选牌：动作逐字相同，两个窗口共用（`lib/legal.ts::handPickActionsOf`）。 */
const offer = (type: string, cards: Card[]) =>
  makeSnapshot({
    currentSeat: 1,
    pendingWindow: win(type),
    windowId: `w9:${type}`,
    legalActions: cards.map((c) => ({
      type: "respond" as const,
      seat: 0,
      windowId: `w9:${type}`,
      choice: c.id,
    })),
  });

/** 面板与遮罩都不许有——这三条断言就是为拦住「又弹回去」而存在。 */
const expectNoPanel = (root: HTMLElement) => {
  expect(root.querySelector(".overlay")).toBeNull();
  expect(root.querySelector(".scrim")).toBeNull();
  expect(root.querySelector(".sheet")).toBeNull();
};

describe("司夜♣3②：还牌（服务端窗口 swapReturn）", () => {
  it("可点的是 legalActions 给的那几张，点一张就发 respond{choice: 牌 id}", async () => {
    const onAction = vi.fn();
    const offered = [R3, R7, B7];
    const { container } = renderGame(offer("swapReturn", offered), { onAction });

    expect(cardNames(container)).toEqual(["红 3", "红 7", "蓝 7"]);
    await userEvent.click(screen.getByRole("button", { name: "蓝 7" }));
    expect(onAction).toHaveBeenCalledWith({
      type: "respond",
      seat: 0,
      windowId: "w9:swapReturn",
      choice: B7.id,
    });
  });

  it("提示语说的是「可以还给对方」，不是笼统的「现在能打」；页面上没有面板", () => {
    const { container } = renderGame(offer("swapReturn", [R3, R7, B7]));
    expect(container.querySelector(".hand-meta")?.textContent).toContain("高亮 = 可以还给对方");
    expectNoPanel(container);
  });
});

describe("洗牌②：摸一弃一的弃牌（服务端窗口 shuffleDiscard）", () => {
  it("动作与司夜②逐字相同，点一张就交，提示语换成「可以弃掉」", async () => {
    const onAction = vi.fn();
    const { container } = renderGame(offer("shuffleDiscard", [R3, R7]), { onAction });

    expect(cardNames(container)).toEqual(["红 3", "红 7"]);
    expect(container.querySelector(".hand-meta")?.textContent).toContain("高亮 = 可以弃掉");
    expectNoPanel(container);
    await userEvent.click(screen.getByRole("button", { name: "红 3" }));
    expect(onAction).toHaveBeenCalledWith({
      type: "respond",
      seat: 0,
      windowId: "w9:shuffleDiscard",
      choice: R3.id,
    });
  });
});

describe("恒心♠1：发动前的弃 1 代价（提交前的本地选择）", () => {
  const costPick = (onPick: (c: Card) => void, onCancel = () => {}) => ({ onPick, onCancel });

  it("手牌**全部**可点（弃哪张随你），点一张就把那一张交回去", async () => {
    const onPick = vi.fn();
    const { container } = renderGame(makeSnapshot(), {}, null, costPick(onPick));

    expect(cardNames(container)).toHaveLength(HAND.length);
    expectNoPanel(container);
    await userEvent.click(screen.getByRole("button", { name: "绿 0" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    // page 拿这张拼 activateSkill{ effectKey, cardIds: [id] }
    expect(onPick).toHaveBeenCalledWith(HAND[3]);
  });

  it("提示语写清楚这一刻在做什么，中槽留一条「先不发动」的退路", async () => {
    const onCancel = vi.fn();
    const { container } = renderGame(makeSnapshot(), {}, null, costPick(() => {}, onCancel));
    expect(container.querySelector(".hand-meta")?.textContent).toContain("点一张牌弃掉当代价");
    await userEvent.click(screen.getByRole("button", { name: "先不发动" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
