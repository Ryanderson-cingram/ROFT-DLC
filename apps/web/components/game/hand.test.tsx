import type { Card, PendingWindow } from "@roft/engine";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HAND, makeSnapshot } from "@/test-support/snapshot";
import { cardNames, pickedCardNames, renderGame } from "@/test-support/render-game";

/**
 * 手牌区的 `pickFromHand` 态（spec §3.4 的头号命题）。
 *
 * 三条「从手牌里挑牌交上去」的流程——司夜♣3②还牌 / 摸 N 弃 N 的弃牌 / 恒心♠1 的弃 1 代价——
 * **一律在手牌区直接点选，不弹任何面板、不上任何遮罩**。手牌本来就是操作对象，
 * 再盖一层全屏面板等于把操作对象藏起来。这三条从前各弹一次 `PickSheet`。
 *
 * 前两条的真相在快照里（`pendingWindow` + `legalActions`），第三条是提交前的本地选择
 * （页面的 `Pending`），所以走 `costPick`。挑**一张**的（司夜②）点了就交；
 * 挑**一组**的（摸 N 弃 N）先在本地攒够再交。
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

/**
 * 摸 N 弃 N（03 §2）：要挑的是**一组**，所以引擎只给一条模板动作（组合枚举会爆炸），
 * 手牌整个进多选态、凑齐 N 张再由坞里的按钮提交。洗牌②的「摸一弃一」是 N = 1 的特例，
 * 走的是同一条路——**没有**「点一张就交」的捷径。
 */
describe("摸 N 弃 N：手牌多选 + 坞里确认（服务端窗口 drawDiscard）", () => {
  /** 模板动作 + 快照里的 picks。手牌全部可选，所以不列牌。 */
  const discardWin = (picks: number) =>
    makeSnapshot({
      currentSeat: 1,
      pendingWindow: { ...win("drawDiscard"), defaultChoice: "drawn" },
      windowId: "w9:drawDiscard",
      drawDiscard: { seat: 0, picks },
      legalActions: [{ type: "respond" as const, seat: 0, windowId: "w9:drawDiscard", choice: "discard", cardIds: [] }],
    });

  it("手牌**全部**可点、不弹面板，提示语说要挑几张", () => {
    const { container } = renderGame(discardWin(2));
    expect(cardNames(container)).toHaveLength(HAND.length);
    expect(container.querySelector(".hand-meta")?.textContent).toContain("点选 2 张弃掉");
    expectNoPanel(container);
  });

  it("凑齐 N 张之前按钮点不动，凑齐了才把那一组交上去", async () => {
    const onAction = vi.fn();
    const { container } = renderGame(discardWin(2), { onAction });
    const confirm = () => screen.getByRole("button", { name: /弃掉 \d \/ 2 张/ }) as HTMLButtonElement;

    expect(confirm().disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "红 3" }));
    expect(pickedCardNames(container)).toEqual(["红 3"]);
    expect(confirm().disabled).toBe(true);
    expect(onAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "红 7" }));
    expect(confirm().disabled).toBe(false);
    await userEvent.click(confirm());
    expect(onAction).toHaveBeenCalledWith({
      type: "respond",
      seat: 0,
      windowId: "w9:drawDiscard",
      choice: "discard",
      // 按点选顺序，两张一起交——不是两次「点一张就交」
      cardIds: [R3.id, R7.id],
    });
  });

  it("点第二次取消选中（选错了能改，窗口本身没有退路）", async () => {
    const { container } = renderGame(discardWin(2));
    await userEvent.click(screen.getByRole("button", { name: "红 3" }));
    await userEvent.click(screen.getByRole("button", { name: "红 3" }));
    expect(pickedCardNames(container)).toEqual([]);
    expect((screen.getByRole("button", { name: /弃掉 0 \/ 2 张/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("洗牌②（N = 1）走的是同一条路，不是「点一张就交」", async () => {
    const onAction = vi.fn();
    renderGame(discardWin(1), { onAction });
    await userEvent.click(screen.getByRole("button", { name: "红 3" }));
    expect(onAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "弃掉 1 / 1 张" }));
    expect(onAction).toHaveBeenCalledWith({
      type: "respond", seat: 0, windowId: "w9:drawDiscard", choice: "discard", cardIds: [R3.id],
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
