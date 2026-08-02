import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_NAMES, makeSnapshot } from "@/test-support/snapshot";
import { LogDrawer } from "./log-drawer";

/**
 * `roomId={null}` 让 `useRoomLog` 在建 supabase 客户端之前就返回——
 * 这里测的是抽屉的开合与可访问性，日志内容的真相在 `humanize()` 的覆盖率测试里。
 */
const renderDrawer = (props: Partial<Parameters<typeof LogDrawer>[0]> = {}) =>
  render(
    <LogDrawer
      open={false}
      onOpen={() => {}}
      onClose={() => {}}
      roomId={null}
      snapshot={makeSnapshot()}
      names={FIXTURE_NAMES}
      {...props}
    />,
  );

describe("LogDrawer · 记录抽屉", () => {
  it("把手的 aria-expanded 随 open 变，aria-controls 指向真实的抽屉（useId）", () => {
    const { rerender, container } = renderDrawer();
    const handle = screen.getByRole("button", { name: "记录" });
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(handle.getAttribute("aria-controls") ?? "")).toBe(
      container.querySelector(".drawer"),
    );

    rerender(
      <LogDrawer
        open
        onOpen={() => {}}
        onClose={() => {}}
        roomId={null}
        snapshot={makeSnapshot()}
        names={FIXTURE_NAMES}
      />,
    );
    expect(handle.getAttribute("aria-expanded")).toBe("true");
  });

  it("点把手 → onOpen", async () => {
    const onOpen = vi.fn();
    renderDrawer({ onOpen });
    await userEvent.click(screen.getByRole("button", { name: "记录" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("点 backdrop → onClose", async () => {
    const onClose = vi.fn();
    const { container } = renderDrawer({ open: true, onClose });
    await userEvent.click(container.querySelector(".drawer-scrim") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc → onClose；关着的时候 Esc 不管事（别抢别人的 Esc）", async () => {
    const onClose = vi.fn();
    const { rerender } = renderDrawer({ open: false, onClose });
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <LogDrawer
        open
        onOpen={() => {}}
        onClose={onClose}
        roomId={null}
        snapshot={makeSnapshot()}
        names={FIXTURE_NAMES}
      />,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点抽屉里的关闭 → onClose", async () => {
    const onClose = vi.fn();
    renderDrawer({ open: true, onClose });
    await userEvent.click(screen.getByRole("button", { name: "关闭记录" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("打开时焦点进抽屉、关闭时还给把手", () => {
    const { rerender } = renderDrawer({ open: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭记录" }));
    rerender(
      <LogDrawer
        open={false}
        onOpen={() => {}}
        onClose={() => {}}
        roomId={null}
        snapshot={makeSnapshot()}
        names={FIXTURE_NAMES}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "记录" }));
  });

  it("没有事件时是一句「还没有动静。」，不是空白面板", () => {
    renderDrawer({ open: true });
    expect(screen.getByText("还没有动静。")).toBeTruthy();
  });
});
