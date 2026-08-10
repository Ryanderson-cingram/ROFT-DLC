import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorModal } from "./error-modal";
import type { ChannelError } from "@/lib/game-channel";

/**
 * 服务端报错的弹窗（2026-08-10）。从前它是 `.game-page` 最后一行小字，落在粘性底坞
 * **下方**，手机上滚不到就看不见。这里钉三件事：**看得见**（在 dialog 里）、
 * **关得掉**、以及**两档来源给的出口不一样**（`sync` 那一档多一条重载牌面）。
 */
const show = (over: Partial<ChannelError> = {}, more: { onClose?: () => void; onReload?: () => void } = {}) =>
  render(
    <ErrorModal
      error={{ text: "还没轮到你。", kind: "action", ...over }}
      onClose={more.onClose ?? (() => {})}
      onReload={more.onReload}
    />,
  );

describe("服务端报错弹窗", () => {
  it("报错落在弹窗里，不再是页面底部那行小字", () => {
    const { container } = show();
    expect(container.querySelector("dialog")).not.toBeNull();
    expect(screen.getByText("还没轮到你。")).toBeTruthy();
  });

  // 出事了要立刻打断读屏，`alertdialog` 才是那个角色（原生 <dialog> 隐含的是 dialog）
  it("role 是 alertdialog", () => {
    const { container } = show();
    expect(container.querySelector("dialog")!.getAttribute("role")).toBe("alertdialog");
  });

  it("action：只有「知道了」，没有重载入口（牌面是新的，没什么可重载）", () => {
    show({ kind: "action" }, { onReload: () => {} });
    expect(screen.getByRole("heading").textContent).toBe("这一步没成功");
    expect(screen.queryByRole("button", { name: "重新载入牌面" })).toBeNull();
    expect(screen.getByRole("button", { name: "知道了" })).toBeTruthy();
  });

  /*
    sync = 拉快照失败或撞上 409：**屏幕上的牌面可能是陈的**。只给「知道了」等于
    让人关掉之后对着一个骗他的页面继续打，所以这一档必须多一条重载出口。
  */
  it("sync：标题说牌面可能过时，并给出重载入口", () => {
    show({ kind: "sync", text: "桌面刚变过，看一眼再重来。" }, { onReload: () => {} });
    expect(screen.getByRole("heading").textContent).toBe("牌面可能不是最新的");
    expect(screen.getByRole("button", { name: "重新载入牌面" })).toBeTruthy();
  });

  it("「知道了」通到 onClose", async () => {
    const onClose = vi.fn();
    show({}, { onClose });
    await userEvent.click(screen.getByRole("button", { name: "知道了" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("重载：先 onReload 再 onClose（拉完才收起，不然一闪而过看不出发生了什么）", async () => {
    const calls: string[] = [];
    show(
      { kind: "sync" },
      { onReload: () => void calls.push("reload"), onClose: () => void calls.push("close") },
    );
    await userEvent.click(screen.getByRole("button", { name: "重新载入牌面" }));
    expect(calls).toEqual(["reload", "close"]);
  });

  // `<Modal>` 的关闭键（Esc / 点遮罩走同一个 onClose）
  it("右上角关闭键也通到 onClose", async () => {
    const onClose = vi.fn();
    show({}, { onClose });
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 没有 onReload（调用方没给）时不该画出一个点了没反应的按钮
  it("没给 onReload 时 sync 也不画重载键", () => {
    show({ kind: "sync" });
    expect(screen.queryByRole("button", { name: "重新载入牌面" })).toBeNull();
  });
});
