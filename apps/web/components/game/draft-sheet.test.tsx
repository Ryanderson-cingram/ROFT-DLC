import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftSheet } from "./draft-sheet";

/** 开局抽 3 选 1（spec §5.3 第 12 条）。候选一律来自快照的 `draftOptions`，面板不自己造。 */

const OPTIONS = ["spade-1", "diamond-3", "club-3"]; // 恒心 / 影歌 / 司夜

describe("抽 3 选 1 面板", () => {
  afterEach(() => vi.useRealTimers());

  it("选项来自 draftOptions（画的是引擎 id 对应的中文技能）", () => {
    render(<DraftSheet options={OPTIONS} picked={false} onPick={() => {}} />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    for (const name of ["恒心", "影歌", "司夜"]) {
      expect(screen.getByRole("radio", { name: new RegExp(name) })).toBeTruthy();
    }
  });

  it("选中后确认 → onPick 收到那个 skillId；确认过一次就禁用（防重复提交）", async () => {
    const onPick = vi.fn();
    render(<DraftSheet options={OPTIONS} picked={false} onPick={onPick} />);
    await userEvent.click(screen.getByRole("radio", { name: /影歌/ }));
    const confirm = screen.getByRole("button", { name: "确认" }) as HTMLButtonElement;
    await userEvent.click(confirm);
    expect(onPick).toHaveBeenCalledWith("diamond-3");
    expect(confirm.disabled).toBe(true);
    // page 把它拼成 respond{choice: skillId}；面板本身不认识 windowId
    await userEvent.click(confirm);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("默认选中第一个候选：不动手直接确认也发得出去", async () => {
    const onPick = vi.fn();
    render(<DraftSheet options={OPTIONS} picked={false} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onPick).toHaveBeenCalledWith("spade-1");
  });

  it("已交卷 → 只剩等待文案，没有确认按钮", () => {
    render(<DraftSheet options={OPTIONS} picked onPick={() => {}} />);
    expect(screen.queryByRole("button", { name: "确认" })).toBeNull();
    expect(screen.getByRole("heading").textContent).toBe("选好了");
  });

  it("池子不够 → 「这局没有技能给你」，同样没有可选项", () => {
    render(<DraftSheet options={[]} picked={false} onPick={() => {}} />);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByRole("heading").textContent).toBe("这局没有技能给你");
  });

  it("到点自动催超时（服务端替没选的人代选第一个候选）", async () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(
      <DraftSheet
        options={OPTIONS}
        picked={false}
        deadline={new Date(Date.now() + 5_000).toISOString()}
        onPick={() => {}}
        onExpire={onExpire}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    expect(onExpire).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
