import type { Card } from "@roft/engine";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DECLARABLE, PickSheet } from "./pick-sheet";

/**
 * 宣言盘是 `PickSheet` **唯一**剩下的用法（影歌♦3①）。
 * 从前它还兼着恒心弃 1、司夜②还牌、洗牌②弃牌三条流程——那三条 P4 起在手牌区直接点选，
 * 面板整个没有了，对应的测试搬去了 `hand.test.tsx`。
 */
describe("影歌♦3①：当众宣言一张色 + 数", () => {
  const renderSheet = (onPick: (card: Card) => void, onCancel = () => {}) =>
    render(
      <PickSheet
        eyebrow="发动技能"
        title="当众指定一张牌"
        lead="你手里有没有这张牌都可以指定。"
        cards={DECLARABLE}
        onPick={onPick}
        onCancel={onCancel}
      />,
    );

  // 04 2026-08-02 裁定：宣言收窄为 1–9（0 每色 2 张、1–9 每色 3 张，宣言 0 是严格占优的一手）
  it("候选是四色 × 1–9 的假牌，点中那张的 color/face 就是 payload 里的 declared", async () => {
    const onPick = vi.fn<(card: Card) => void>();
    const { container } = renderSheet(onPick);
    expect(DECLARABLE).toHaveLength(36);
    expect(container.querySelectorAll(".declare .card")).toHaveLength(36);
    expect(DECLARABLE.some((c) => c.face === "0")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "红 3" }));
    const picked = onPick.mock.calls[0][0];
    expect({ color: picked.color, face: picked.face }).toEqual({ color: "R", face: "3" });
  });

  it("壳是 <Sheet>：遮罩只盖牌桌，手牌与命令坞在下面完整露出", () => {
    const { container } = renderSheet(() => {});
    const scrims = [...container.querySelectorAll(".scrim")];
    expect(scrims).toHaveLength(1);
    expect(scrims[0].className).toBe("scrim scrim--table");
    // 全屏遮罩的老壳（.overlay）随这次改版一起没了
    expect(container.querySelector(".overlay")).toBeNull();
  });

  it("提交前的本地选择能反悔：按钮与遮罩都通到 onCancel", async () => {
    const onCancel = vi.fn();
    const { container } = renderSheet(() => {}, onCancel);
    await userEvent.click(screen.getByRole("button", { name: "先不发动" }));
    await userEvent.click(container.querySelector(".scrim") as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
