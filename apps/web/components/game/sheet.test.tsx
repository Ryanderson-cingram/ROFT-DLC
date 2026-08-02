import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "./sheet";

/**
 * `<Sheet>` 的头号命题（spec §3.4）：**手牌与命令坞必须在面板下方完整露出**。
 * 落在代码里就是「遮罩是 `.scrim--table`（`bottom: var(--dock-h)`），不是全屏的 `.scrim`」。
 */
describe("Sheet · 不遮手牌的升起面板", () => {
  it("遮罩只盖牌桌：唯一那层 scrim 带 --table 修饰，没有全屏遮罩", () => {
    const { container } = render(<Sheet title="当众指定一张牌" />);
    const scrims = [...container.querySelectorAll(".scrim")];
    expect(scrims).toHaveLength(1);
    // 少一个 scrim--table 就等于把手牌盖住了——这条断言就是为拦住那次改动而存在
    expect(scrims[0].className).toBe("scrim scrim--table");
  });

  it("CSS 侧同样钉住：遮罩与面板都止于坞顶（bottom: var(--dock-h)），而不是 inset:0", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toMatch(/\.scrim--table\s*\{[^}]*bottom:\s*var\(--dock-h\)/);
    expect(css).toMatch(/\.sheet\s*\{[^}]*bottom:\s*var\(--dock-h\)/);
  });

  it("eyebrow / title / lead / children 全画出来，标题由 aria-labelledby 指着（id 来自 useId）", () => {
    render(
      <Sheet eyebrow="影歌 ① · 宣言" title="当众指定一张牌" lead="从你的下家起依次比对">
        <button type="button">红5</button>
      </Sheet>,
    );
    const dial = screen.getByRole("dialog");
    // 非模态：决定在盘里做、提交在坞上按，坞必须一直可点
    expect(dial.getAttribute("aria-modal")).toBe("false");
    const labelId = dial.getAttribute("aria-labelledby") ?? "";
    expect(document.getElementById(labelId)?.textContent).toBe("当众指定一张牌");
    expect(screen.getByText("影歌 ① · 宣言")).toBeTruthy();
    expect(screen.getByText("从你的下家起依次比对")).toBeTruthy();
    expect(screen.getByRole("button", { name: "红5" })).toBeTruthy();
  });

  it("点遮罩 → onCancel", async () => {
    const onCancel = vi.fn();
    const { container } = render(<Sheet title="选一种玩法，然后定色" onCancel={onCancel} />);
    await userEvent.click(container.querySelector(".scrim") as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
