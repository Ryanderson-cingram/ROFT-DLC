import type { ClientSnapshot } from "@roft/engine";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HAND, PLAYERS, makeSnapshot } from "@/test-support/snapshot";
import { buttonLabels, cardNames, pickedCardNames, renderGame } from "@/test-support/render-game";

/**
 * spec §5.3 的「十个技能各一条 UI 路径」：入口存在 + 点击后 payload 正确。
 * **不在这里重判规则**——「这条动作该不该给」是引擎测试的活，前端只负责把 legalActions
 * 里的那条动作原样交回去。
 *
 * 手牌（`HAND`）：红 3 / 红 7 / 蓝 7 / 绿 0 / 黄 +2 / 变色 / +4；牌顶红 7、当前色红。
 */

const [R3, R7, B7, , Y2] = HAND;

/** 把「你」（座位 0）换成持某个技能且已亮出。技能 id 用引擎 id，不是中文名。 */
const withSkill = (skillId: string, patch: Partial<ClientSnapshot["players"][number]> = {}) =>
  PLAYERS.map((p) => (p.seat === 0 ? { ...p, skillId, revealed: true, ...patch } : p));

/** 自己的技能徽在坞左槽（页面中部的技能大卡随 P3a 一起没了，L0/L1 进技能弹窗）。 */
const skillSlot = (root: HTMLElement) => root.querySelector(".dock__row > .dock__slot")!;

describe("恩惠♥1（纯被动）", () => {
  it("坞左槽只有技能徽，没有任何发动入口", () => {
    const { container } = renderGame(
      makeSnapshot({
        players: withSkill("heart-1"),
        legalActions: [{ type: "drawCard", seat: 0 }],
      }),
    );
    const slot = skillSlot(container);
    // 技能徽在座位卡上（坞里没有）
    expect(container.querySelector(".seat--you .skillbadge")?.textContent).toBe("♥1恩惠");
    // 纯被动 → 左槽置灰保位
    expect((slot.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    expect(buttonLabels(container).filter((l) => l.includes("发动技能："))).toEqual([]);
  });
});

describe("精英♥3（数字牌当大 1 点打）", () => {
  it("同一张牌的 useSkill 打法：点牌发出的 payload 带 useSkill: true", async () => {
    const onPlay = vi.fn();
    renderGame(
      makeSnapshot({
        players: withSkill("heart-3"),
        // 黄 +2 接不上红 7，只有「当大 1 点」这一条打法，所以它带 useSkill
        legalActions: [{ type: "playCards", seat: 0, cardIds: [Y2.id], useSkill: true }],
      }),
      { onPlay },
    );
    await userEvent.click(screen.getByRole("button", { name: "黄 +2" }));
    expect(onPlay).toHaveBeenCalledWith(Y2, true);
  });
});

describe("并列♥4（一次多张）", () => {
  it("canPlayMultiple → 出现「多张一起打」，多选后 payload 的牌就是点选的那几张", async () => {
    const onPlayMany = vi.fn();
    const { container } = renderGame(
      makeSnapshot({
        players: withSkill("heart-4"),
        canPlayMultiple: true,
        legalActions: [
          { type: "playCards", seat: 0, cardIds: [R3.id] },
          { type: "playCards", seat: 0, cardIds: [R7.id] },
        ],
      }),
      { onPlayMany },
    );
    await userEvent.click(screen.getByRole("button", { name: "多张一起打" }));
    // 多选模式下每张牌都可点：合法形状由服务端判（组内单张往往打不出去）
    expect(cardNames(container)).toHaveLength(HAND.length);
    await userEvent.click(screen.getByRole("button", { name: "红 3" }));
    await userEvent.click(screen.getByRole("button", { name: "红 7" }));
    // 选中的牌带 aria-pressed（`.card--picked`），且**不重排**——手指不追着牌跑
    expect(pickedCardNames(container)).toEqual(["红 3", "红 7"]);
    expect(cardNames(container)).toEqual(["红 3", "红 7", "蓝 7", "黄 +2", "绿 0", "无色 变色", "无色 +4"]);
    await userEvent.click(screen.getByRole("button", { name: "打出 2 张" }));
    expect(onPlayMany).toHaveBeenCalledWith([R3, R7]);
  });

  it("没有并列就没有这个入口", () => {
    const { container } = renderGame(makeSnapshot({ canPlayMultiple: false }));
    expect(buttonLabels(container)).not.toContain("多张一起打");
  });
});

describe("强袭♦1", () => {
  it("①掷骰打是独立按钮，与「按面值点牌」两条路径同时在", async () => {
    const onAction = vi.fn();
    const onPlay = vi.fn();
    const assault = { type: "playCards" as const, seat: 0, cardIds: [Y2.id], useAssault: true };
    renderGame(
      makeSnapshot({
        players: withSkill("diamond-1"),
        legalActions: [{ type: "playCards", seat: 0, cardIds: [Y2.id] }, assault],
      }),
      { onAction, onPlay },
    );
    // 点牌 = 按面值打（不带旗标）
    await userEvent.click(screen.getByRole("button", { name: "黄 +2" }));
    expect(onPlay).toHaveBeenCalledWith(Y2, undefined);
    // 另一条打法表达不成「点牌」，所以单独出按钮
    await userEvent.click(screen.getByRole("button", { name: /掷骰打黄 \+2/ }));
    expect(onAction).toHaveBeenCalledWith(assault);
  });

  it("② diceTakeover 窗口给出接管 / 放过两个按钮，点击 payload 原样交回", async () => {
    const onAction = vi.fn();
    const takeover = { type: "respond" as const, seat: 0, windowId: "w20:diceTakeover", choice: "takeover" };
    renderGame(
      makeSnapshot({
        players: withSkill("diamond-1"),
        currentSeat: 1,
        dice: { seat: 1, reason: "punish", values: [2] },
        pendingWindow: {
          type: "diceTakeover",
          actors: [0],
          deadline: new Date(Date.now() + 10_000).toISOString(),
          defaultChoice: "pass",
          resume: "play",
        },
        windowId: "w20:diceTakeover",
        legalActions: [takeover, { type: "respond", seat: 0, windowId: "w20:diceTakeover", choice: "pass" }],
      }),
      { onAction },
    );
    await userEvent.click(screen.getByRole("button", { name: "重掷，采用我的结果" }));
    expect(onAction).toHaveBeenCalledWith(takeover);
    expect(screen.getByRole("button", { name: "放弃" })).toBeTruthy();
  });
});

describe("血棘♦2", () => {
  it("被封印：坞左槽的技能徽画成朱砂、原地写理由 + 手牌全灰", () => {
    const { container } = renderGame(
      makeSnapshot({
        players: withSkill("diamond-2", { statuses: ["封印"] }),
        legalActions: [],
      }),
    );
    const slot = skillSlot(container);
    // 封印画在座位卡的技能徽上（朱砂），理由写在灰着的坞左槽里
    expect(container.querySelector(".seat--you .skillbadge")?.className).toContain("skillbadge--sealed");
    // 01-P9：连被动一起关着——左槽整个灰掉（理由字符串在 lib/dock-slots.test.ts）
    expect((slot.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    // 置灰只是显示：能不能用照旧只看 legalActions
    expect(container.querySelectorAll(".hand .card--dim")).toHaveLength(HAND.length);
    expect(cardNames(container)).toEqual([]);
  });

  it("①发动按钮说的是「掷骰放血」，不是被动那句 L0", async () => {
    const onAction = vi.fn();
    const activate = { type: "activateSkill" as const, seat: 0, effectKey: "1" };
    const { container } = renderGame(
      makeSnapshot({ players: withSkill("diamond-2"), legalActions: [activate] }),
      { onAction },
    );
    const label = buttonLabels(container).find((l) => l.includes("发动技能"))!;
    expect(label).toContain("掷骰放血");
    expect(label).not.toContain("你发起的惩罚会封印对方技能");
    await userEvent.click(screen.getByRole("button", { name: label }));
    expect(onAction).toHaveBeenCalledWith(activate);
  });
});

describe("影歌♦3（同一技能两条主动）", () => {
  it("①②进左槽的菜单，两条标签不同，且没有 React 重复 key 警告", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const onAction = vi.fn();
    const harvest = { type: "activateSkill" as const, seat: 0, effectKey: "1" };
    const skip = { type: "activateSkill" as const, seat: 0, effectKey: "2" };
    renderGame(makeSnapshot({ players: withSkill("diamond-3"), legalActions: [harvest, skip] }), {
      onAction,
    });

    // 两条动作 = 一个按钮 + 点开的菜单（槽位位置与一条时一模一样）
    await userEvent.click(screen.getByRole("button", { name: "发动技能" }));
    const labels = screen.getAllByRole("menuitem").map((i) => i.textContent ?? "");
    expect(labels).toHaveLength(2);
    expect(labels[0]).not.toBe(labels[1]);
    expect(labels[0]).toContain("攒 1 个魂");
    expect(labels[1]).toContain("花 2 魂跳过");

    // 菜单项 key 不拼 effectKey 的话，两条都是 "activateSkill" → React 报重复 key
    const logged = errors.mock.calls.flat().join(" ");
    expect(logged).not.toMatch(/same key|重复/);
    errors.mockRestore();

    await userEvent.click(screen.getByRole("menuitem", { name: labels[1] }));
    expect(onAction).toHaveBeenCalledWith(skip);
  });
});

describe("劫营♦10（打断窗口）", () => {
  it("高亮的牌来自 legalActions.cardIds，点击发 respond{choice:raid, cardIds}", async () => {
    const onAction = vi.fn();
    const raid = {
      type: "respond" as const, seat: 0, windowId: "w14:interrupt", choice: "raid", cardIds: [B7.id],
    };
    const { container } = renderGame(
      makeSnapshot({
        players: withSkill("diamond-10"),
        currentSeat: 2,
        pendingWindow: {
          type: "interrupt",
          actors: [0],
          deadline: new Date(Date.now() + 8_000).toISOString(),
          defaultChoice: "pass",
          resume: "play",
        },
        windowId: "w14:interrupt",
        legalActions: [raid, { type: "respond", seat: 0, windowId: "w14:interrupt", choice: "pass" }],
      }),
      { onAction },
    );
    expect(container.querySelector(".hand-meta")?.textContent).toContain("高亮 = 能用来打断（同色同数）");
    expect(cardNames(container)).toEqual(["蓝 7"]);
    await userEvent.click(screen.getByRole("button", { name: "蓝 7" }));
    expect(onAction).toHaveBeenCalledWith(raid);
    // 代价牌已经在手牌里可点了，不再重复出一排按钮
    expect(buttonLabels(container)).not.toContain("劫营打断");
  });
});

describe("远星♦J（惩罚窗口里弃代价牌）", () => {
  it("代价牌高亮，点击发 respond{choice:farstar, cardIds}", async () => {
    const onAction = vi.fn();
    const farstar = {
      type: "respond" as const, seat: 0, windowId: "w13:punishStack", choice: "farstar", cardIds: [Y2.id],
    };
    const { container } = renderGame(
      makeSnapshot({
        players: withSkill("diamond-j"),
        currentSeat: 1,
        punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2 }], total: 2 },
        pendingWindow: {
          type: "punishStack",
          actors: [0],
          deadline: new Date(Date.now() + 12_000).toISOString(),
          defaultChoice: "accept",
          resume: "play",
        },
        windowId: "w13:punishStack",
        legalActions: [{ type: "respond", seat: 0, windowId: "w13:punishStack", choice: "accept" }, farstar],
      }),
      { onAction },
    );
    expect(container.querySelector(".hand-meta")?.textContent).toContain("高亮 = 能当代价弃掉");
    expect(cardNames(container)).toEqual(["黄 +2"]);
    await userEvent.click(screen.getByRole("button", { name: "黄 +2" }));
    expect(onAction).toHaveBeenCalledWith(farstar);
  });
});

describe("恒心♠1（弃 1 摸 1）", () => {
  it("发动按钮回落到 L0 文案（这个技能只有一条主动），点击 payload 原样交回", async () => {
    const onAction = vi.fn();
    const activate = { type: "activateSkill" as const, seat: 0, effectKey: "1" };
    renderGame(makeSnapshot({ players: withSkill("spade-1"), legalActions: [activate] }), { onAction });
    // 弃哪张是提交前的本地选择（page 的 PickSheet），HUD 这一步不带 cardIds
    await userEvent.click(screen.getByRole("button", { name: "发动技能：弃一张牌，摸一张牌" }));
    expect(onAction).toHaveBeenCalledWith(activate);
  });
});

describe("司夜♣3②（花 1 盗换牌）", () => {
  it("每个目标一条菜单项，payload 的 target 正确", async () => {
    const onAction = vi.fn();
    const { container } = renderGame(
      makeSnapshot({
        players: withSkill("club-3"),
        legalActions: [
          { type: "stealSwap", seat: 0, target: 1 },
          { type: "stealSwap", seat: 0, target: 3 },
        ],
      }),
      { onAction },
    );
    // 多目标不再在坞里排成一行按钮（那正是「按钮乱跑」的来源）：一个组按钮 + 菜单
    expect(buttonLabels(container).filter((l) => l.includes("花 1 盗"))).toEqual(["花 1 盗换牌"]);
    await userEvent.click(screen.getByRole("button", { name: "花 1 盗换牌" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "花 1 盗与阿柴换 1 张",
      "花 1 盗与老白换 1 张",
    ]);
    await userEvent.click(screen.getByRole("menuitem", { name: "花 1 盗与老白换 1 张" }));
    expect(onAction).toHaveBeenCalledWith({ type: "stealSwap", seat: 0, target: 3 });
  });
});
