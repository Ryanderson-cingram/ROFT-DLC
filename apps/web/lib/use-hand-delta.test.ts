import type { Card } from "@roft/engine";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHandDelta } from "./use-hand-delta";

/**
 * 手牌被外力改了一批（A1 结盟互换 / A5 近卫收牌 / 洗牌重分）。
 *
 * 这个 hook 是整条改动里唯一有分支的地方，边界全在这里钉：
 * 首渲染、只出不进、既进又出、整副换、连着两次、到点摘掉、手牌没变的下一个快照。
 */

const c = (id: string): Card => ({ id, color: "R", face: "3" });
const HAND = [c("a"), c("b"), c("c")];

const run = (initial: Card[] = HAND) => renderHook(({ hand }) => useHandDelta(hand), { initialProps: { hand: initial } });

describe("useHandDelta", () => {
  afterEach(() => vi.useRealTimers());

  it("首渲染不报：那时候没有「上一次」，一进牌桌满屏乱报是噪音不是提示", () => {
    expect(run().result.current).toBeNull();
  });

  it("同一份手牌换一个数组身份（每来一个快照就换一次）也不报", () => {
    const { result, rerender } = run();
    rerender({ hand: [...HAND] });
    expect(result.current).toBeNull();
  });

  it("A5 近卫收牌：进了几张就报几张", () => {
    const { result, rerender } = run();
    rerender({ hand: [...HAND, c("d"), c("e")] });
    expect(result.current).toEqual({ got: 2, whole: false });
  });

  it("只出不进一律不报——出牌 / 交牌 / 弃牌都是你自己点的，牌当着面离手", () => {
    const { result, rerender } = run();
    rerender({ hand: HAND.slice(0, 1) });
    expect(result.current).toBeNull();
  });

  it("A1 结盟互换：旧手牌一张不剩 → `whole`，张数不同也照样成立", () => {
    const { result, rerender } = run();
    rerender({ hand: [c("x"), c("y")] });
    expect(result.current).toEqual({ got: 2, whole: true });
  });

  it("既进又出但**留下了一张**不算整副换（洗牌重分把你自己的牌发回来一张就是这样）", () => {
    const { result, rerender } = run();
    rerender({ hand: [c("a"), c("x"), c("y")] });
    expect(result.current).toEqual({ got: 2, whole: false });
  });

  it("空手时进牌不叫「整副换过了」（旧手牌本来就是空的，`whole` 得有东西可换）", () => {
    const { result, rerender } = run([]);
    rerender({ hand: [c("x")] });
    expect(result.current).toEqual({ got: 1, whole: false });
  });

  it("3 秒后自己摘掉（定时器而不是 animationend：reduced-motion 下那个事件永远不来）", () => {
    vi.useFakeTimers();
    const { result, rerender } = run();
    rerender({ hand: [...HAND, c("d")] });
    expect(result.current).not.toBeNull();

    act(() => void vi.advanceTimersByTime(3_000));
    expect(result.current).toBeNull();
  });

  it("浮报挂着时来了一个手牌没变的快照，它照样到点走人（两条 effect 分开就是为了这个）", () => {
    vi.useFakeTimers();
    const { result, rerender } = run();
    const got = [...HAND, c("d")];
    rerender({ hand: got });
    act(() => void vi.advanceTimersByTime(1_000));
    // 手牌没变、只是又来了一个快照：合成一条 effect 的话这里会先清掉定时器再提前 return，
    // 浮报就永远挂着不走了
    rerender({ hand: [...got] });
    expect(result.current).not.toBeNull();

    act(() => void vi.advanceTimersByTime(3_000));
    expect(result.current).toBeNull();
  });

  it("3 秒内连着进两批（惩罚摸完接着忍戒♠J 多摸）：报的是**这一次**的张数，计时重来", () => {
    vi.useFakeTimers();
    const { result, rerender } = run();
    const first = [...HAND, c("d"), c("e"), c("f")];
    rerender({ hand: first });
    expect(result.current).toEqual({ got: 3, whole: false });

    act(() => void vi.advanceTimersByTime(2_000));
    rerender({ hand: [...first, c("g"), c("h"), c("i")] });
    expect(result.current).toEqual({ got: 3, whole: false });

    // 计时从第二批起算：第一批那 3 秒到点时它还在
    act(() => void vi.advanceTimersByTime(1_500));
    expect(result.current).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1_500));
    expect(result.current).toBeNull();
  });
});
