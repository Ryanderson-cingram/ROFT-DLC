import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GameOver } from "./game-over";
import type { Seal } from "@/lib/unlocks";
import { FIXTURE_NAMES, makeSnapshot } from "@/test-support/snapshot";

const nameOf = (seat: number) => FIXTURE_NAMES[makeSnapshot().players[seat]?.userId ?? ""] ?? `座位 ${seat + 1}`;
const over = (
  extra: Parameters<typeof makeSnapshot>[0],
  onRestart?: () => void | Promise<void>,
  more: { onLeave?: () => void | Promise<void>; roomHref?: string; unlocked?: Seal[] } = {},
) =>
  render(
    <GameOver
      snapshot={makeSnapshot({ phase: "finished", ...extra })}
      nameOf={nameOf}
      onRestart={onRestart}
      {...more}
    />,
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

// ---------------------------------------------------------------- 退出房间（防幽灵座位）

describe("返回大厅 = 退出房间；返回房间 = 回等候室座位不动", () => {
  it("给了 onLeave → 「返回大厅」是按钮（先打服务端），不再是纯导航", async () => {
    const onLeave = vi.fn(() => Promise.resolve());
    over({ winner: 0 }, () => {}, { onLeave, roomHref: "/room/ABC123" });
    expect(screen.queryByRole("link", { name: "回大厅" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /返回大厅/ }));
    expect(onLeave).toHaveBeenCalledTimes(1);
    // 返回房间是普通链接：座位不动，回等候室等重开
    expect(screen.getByRole("link", { name: /返回房间/ }).getAttribute("href")).toBe("/room/ABC123");
  });

  it("退出失败 → 出人话，按钮解禁还能再点（也还能走别的出口）", async () => {
    const onLeave = vi.fn(() => Promise.reject(new Error("对局还没结束，现在不能退出房间。")));
    over({ winner: 0 }, undefined, { onLeave });
    const btn = screen.getByRole("button", { name: /返回大厅/ }) as HTMLButtonElement;
    await userEvent.click(btn);
    expect(screen.getByRole("alert").textContent).toBe("对局还没结束，现在不能退出房间。");
    expect(btn.disabled).toBe(false);
  });

  it("没给 onLeave / roomHref → 退化成原来的「回大厅」纯导航（兼容旧用法）", () => {
    over({ winner: 0 });
    expect(screen.getByRole("link", { name: "回大厅" }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("link", { name: /返回房间/ })).toBeNull();
  });
});

// ------------------------------------------------ 本局解锁的封泥（spec 2026-08-10 §5）

describe("解锁的封泥画在收场弹窗里", () => {
  const SEALS: Seal[] = [
    { id: "swift", tier: "天", mark: "速", name: "速通" },
    { id: "pantheon", tier: "神", mark: "殿", name: "万神殿" },
  ];

  it("每枚一行：字 + 名 + 品级，品级写进 data-tier（品级色与 profile 页同一套）", () => {
    const { container } = over({ winner: 0 }, () => {}, { unlocked: SEALS });
    const rows = [...container.querySelectorAll(".overseal")];
    expect(rows.map((r) => r.getAttribute("data-tier"))).toEqual(["天", "神"]);
    expect(rows[0].textContent).toBe("速解锁 · 速通天 品");
    expect(screen.getByLabelText("本局解锁 2 枚封泥")).not.toBeNull();
  });

  // 没解锁的那一局（多数局都是）不许留一个空盒子在「你赢了」下面
  it("没解锁 → 整块不出现", () => {
    const { container } = over({ winner: 0 }, () => {});
    expect(container.querySelector(".overseals")).toBeNull();
  });
});
