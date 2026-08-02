import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GameOver } from "./game-over";
import { FIXTURE_NAMES, makeSnapshot } from "@/test-support/snapshot";

const nameOf = (seat: number) => FIXTURE_NAMES[makeSnapshot().players[seat]?.userId ?? ""] ?? `座位 ${seat + 1}`;
const over = (extra: Parameters<typeof makeSnapshot>[0], onRestart?: () => void | Promise<void>) =>
  render(
    <GameOver snapshot={makeSnapshot({ phase: "finished", ...extra })} nameOf={nameOf} onRestart={onRestart} />,
  );

describe("一局收场（U8）", () => {
  it("赢家是自己 → 「你赢了」", () => {
    over({ winner: 0 });
    expect(screen.getByRole("heading").textContent).toBe("你赢了");
  });

  it("赢家是别人 → 写他的名字", () => {
    over({ winner: 3 });
    expect(screen.getByRole("heading").textContent).toBe("老白赢了");
  });

  // winner 缺席 + finished = 平局，不许当成「座位 1 赢了」
  it("winner 缺席 → 平局", () => {
    over({});
    expect(screen.getByRole("heading").textContent).toBe("平局");
  });

  it("没有关闭键：牌局结束了，没得继续看", () => {
    const { container } = over({ winner: 0 }, () => {});
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
    expect(container.querySelectorAll(".fw i").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- 两个出口（W1–W4/W6）

describe("再来一局（spec 2026-08-02-rematch-and-retention）", () => {
  it("W1：两个出口都在——重开（本房间）与回大厅", () => {
    over({ winner: 0 }, () => {});
    expect(screen.getByRole("button", { name: /再开一局/ })).not.toBeNull();
    expect(screen.getByRole("link", { name: "回大厅" }).getAttribute("href")).toBe("/");
  });

  it("W2：给了 onRestart 就画重开键——在座与否由页面决定，组件不自己判", () => {
    over({ winner: 0 });
    expect(screen.queryByRole("button", { name: /再开一局/ })).toBeNull();
    // 没有重开也总还有回大厅这条路，不会把人困在弹窗里
    expect(screen.getByRole("link", { name: "回大厅" })).not.toBeNull();
  });

  it("W3：点一次就调一次 onRestart，进行中按钮禁用（防连点）", async () => {
    let resolve!: () => void;
    const onRestart = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    over({ winner: 0 }, onRestart);
    const btn = screen.getByRole("button", { name: /再开一局/ }) as HTMLButtonElement;
    await userEvent.click(btn);
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(true);
    await act(async () => resolve());
  });

  it("W4：平局也能重开（winner 缺席不影响出口）", () => {
    over({}, () => {});
    expect(screen.getByRole("heading").textContent).toBe("平局");
    expect(screen.getByRole("button", { name: /再开一局/ })).not.toBeNull();
  });

  it("W6：重开失败 → 出人话，按钮解禁还能再点", async () => {
    const onRestart = vi.fn(() => Promise.reject(new Error("桌面刚变过，看一眼再重来。")));
    over({ winner: 0 }, onRestart);
    const btn = screen.getByRole("button", { name: /再开一局/ }) as HTMLButtonElement;
    await userEvent.click(btn);
    expect(screen.getByRole("alert").textContent).toBe("桌面刚变过，看一眼再重来。");
    expect(btn.disabled).toBe(false);
  });
});
