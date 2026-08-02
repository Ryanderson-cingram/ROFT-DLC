import type { Card } from "@roft/engine";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Modal, PileModal } from "./modal";

const c = (id: string, color: Card["color"], face: Card["face"]): Card => ({ id, color, face });

// 引擎给的 playedPile：`[0]` 是**牌顶**（新 → 旧）
const PLAYED = [c("R7#1", "R", "7"), c("W#1", null, "wild"), c("B停#1", "B", "skip")];
// discardPile 方向相反：本来就是旧 → 新
const DISCARD = [c("G2#d", "G", "2"), c("Y9#d", "Y", "9")];

const facesOf = (root: ParentNode) =>
  [...root.querySelectorAll(".picks .card")].map((el) => el.getAttribute("aria-label"));

describe("Modal · 全屏弹窗", () => {
  it("用的是原生 <dialog>（focus trap / Esc / 背景 inert 都由浏览器给）", () => {
    render(<Modal label="牌堆完整列表" onClose={() => {}} />);
    expect(screen.getByRole("dialog").tagName).toBe("DIALOG");
  });

  it("点关闭 → onClose", async () => {
    const onClose = vi.fn();
    render(<Modal label="牌堆完整列表" eyebrow="牌堆" onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("不给 onClose = 必须选完才能走：连关闭按钮都没有", () => {
    render(<Modal label="开局 · 抽 3 选 1" eyebrow="开局" />);
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
  });
});

describe("PileModal · 牌堆全貌", () => {
  it("出牌堆按「旧 → 新」呈现：引擎给的 playedPile[0] 是牌顶，要倒过来画", () => {
    const { container } = render(<PileModal playedPile={PLAYED} discardPile={DISCARD} onClose={() => {}} />);
    const panel = container.querySelector('[role="tabpanel"]:not([hidden])') as ParentNode;
    // 牌顶（红 7）排在最后一张，与末尾那枚「牌顶」徽对齐
    expect(facesOf(panel)).toEqual(["蓝 停", "无色 变色", "红 7"]);
    expect(screen.getByRole("heading", { name: "出牌堆 · 3 张（旧 → 新）" })).toBeTruthy();
    expect(panel.querySelector(".badge")?.textContent).toBe("牌顶");
  });

  it("弃牌堆本来就是旧 → 新，原样画", async () => {
    const { container } = render(<PileModal playedPile={PLAYED} discardPile={DISCARD} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("tab", { name: "弃牌堆" }));
    const panel = container.querySelector('[role="tabpanel"]:not([hidden])') as ParentNode;
    expect(facesOf(panel)).toEqual(["绿 2", "黄 9"]);
    expect(screen.getByRole("heading", { name: "弃牌堆 · 2 张（旧 → 新）" })).toBeTruthy();
  });

  // 从哪一堆的「查看全部」点进来就先落在哪一页（两个页签都在）
  it("initial=discard：直接落在弃牌堆那一页", () => {
    render(<PileModal playedPile={PLAYED} discardPile={DISCARD} initial="discard" onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "弃牌堆" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "出牌堆" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("heading", { name: "弃牌堆 · 2 张（旧 → 新）" })).toBeTruthy();
  });

  // 说明文字已按产品要求删掉（占地方且是常识），但「摸牌堆不给看」这条边界本身仍要守住
  it("摸牌堆没有这个入口（暗信息）：只有出牌堆与弃牌堆两个页签", () => {
    render(<PileModal playedPile={PLAYED} discardPile={DISCARD} onClose={() => {}} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["出牌堆", "弃牌堆"]);
    expect(screen.queryByRole("tab", { name: /摸牌堆/ })).toBeNull();
  });
});
