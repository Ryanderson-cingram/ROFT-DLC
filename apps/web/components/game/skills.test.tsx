import type { ClientSnapshot } from "@roft/engine";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HAND, PLAYERS, makeSnapshot } from "@/test-support/snapshot";
import { buttonLabels, cardNames, pickedCardNames, renderGame } from "@/test-support/render-game";
import { effectLabel } from "@/lib/skills";

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

/**
 * 专精♥9 / 吟游♣5 —— 两条**持续改变合法性**的公开信息（`2026-08-04-batch-2-ui-gaps` 的
 * 改动②，盖住缺口 A2 + A3）。从前它们只在亮出/切换那一刻的日志里出现过一次，之后整局隐性。
 *
 * 两者共用 `Board.chosen` 那一个槽，但画在牌桌的两个地方：个人的（专精的色）在他的座位卡上，
 * 全场的（吟游的歌）在牌桌中央——判据是数据里的 `targeting`，组件不认技能 id。
 */
describe("专精♥9：定色徽常驻在他的座位卡上（A2）", () => {
  const withColor = (seat: number, key: string) =>
    makeSnapshot({
      players: PLAYERS.map((p) => (p.seat === seat ? { ...p, skillId: "heart-9", revealed: true } : p)),
      chosen: { "heart-9": { key, seat } },
    });

  it("色码画成色点 + 颜色名，读屏还听得见是哪个技能给的", () => {
    const { container } = renderGame(withColor(1, "R"));
    const badge = container.querySelectorAll(".seat")[1].querySelector(".chosen")!;
    expect(badge.textContent).toBe("专精：红");
    // 眼睛看到的只有「红」——「专精：」那一截是 .sr-only
    expect(badge.querySelector(".sr-only")?.textContent).toBe("专精：");
    // `.badge` 自己那颗点就是色点，不另加元素
    expect(badge.getAttribute("style")).toContain("var(--card-red)");
  });

  it("徽只挂在**他自己**那张座位卡上，别人的卡上一个都没有", () => {
    const { container } = renderGame(withColor(1, "G"));
    const seats = [...container.querySelectorAll(".seat")];
    expect(seats.map((s) => s.querySelector(".chosen")?.textContent ?? null)).toEqual([
      null,
      "专精：绿",
      null,
      null,
    ]);
  });

  it("被封印时徽**不撤**（01-P9 只压制不清值，解封回到这个色），跟着座位卡一起退灰", () => {
    // 小满（座位 2）在基准快照里就被血棘封着
    const { container } = renderGame(withColor(2, "B"));
    const man = container.querySelectorAll(".seat")[2];
    expect(man.className).toContain("seat--sealed");
    expect(man.querySelector(".chosen")?.textContent).toBe("专精：蓝");
  });

  it("没定过色（刚开局 / 没人持专精）就一个徽都不画", () => {
    const { container } = renderGame(makeSnapshot());
    expect(container.querySelectorAll(".chosen")).toHaveLength(0);
  });
});

describe("吟游♣5：当前歌声画在牌桌上，点开有一句说明（A3）", () => {
  const singing = (key: string, seat = 3) =>
    makeSnapshot({
      players: PLAYERS.map((p) => (p.seat === seat ? { ...p, skillId: "club-5", revealed: true } : p)),
      chosen: { "club-5": { key, seat } },
    });

  const mark = (root: HTMLElement) => root.querySelector<HTMLButtonElement>(".songmark")!;

  it("牌桌上一枚常驻的牌：沿印 + 歌名 + 谁在唱；可及名把这几样说全", () => {
    const { container } = renderGame(singing("战争序"));
    expect(mark(container).textContent).toContain("战争序");
    expect(mark(container).textContent).toContain("老白");
    expect(mark(container).getAttribute("aria-label")).toBe("吟游：战争序，老白选的（全场生效）");
    // 它是**牌桌**上的东西，不挂在谁的座位卡上（座位卡那一档是给个人的选项留的）
    expect(container.querySelector(".seat .songmark")).toBeNull();
    expect(container.querySelectorAll(".chosen")).toHaveLength(0);
  });

  it("点一下浮出说明：那句话直接用发动按钮的文案，不写第二份", async () => {
    const { container } = renderGame(singing("樱时雨"));
    expect(mark(container).getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(mark(container));
    expect(mark(container).getAttribute("aria-expanded")).toBe("true");
    const pop = document.getElementById(mark(container).getAttribute("aria-controls")!)!;
    expect(pop).toBe(container.querySelector(".songpop"));
    expect(pop.querySelector(".songpop__line")?.textContent).toBe(effectLabel("club-5", "樱时雨"));
    expect(pop.querySelector(".songpop__head")?.textContent).toContain("吟游");
    expect(pop.querySelector(".badge")?.textContent).toBe("全场生效");

    // 再点一下收起来（触屏上没有 hover 可以退出）
    await userEvent.click(mark(container));
    expect(mark(container).getAttribute("aria-expanded")).toBe("false");
  });

  it("四支歌各画各的名字（组件不认识歌名，key 是什么就写什么）", () => {
    for (const song of ["活泼板", "战争序", "樱时雨", "行进曲"]) {
      const { container, unmount } = renderGame(singing(song));
      expect(mark(container).querySelector(".nm")?.textContent, song).toBe(song);
      unmount();
    }
  });

  it("唱的人被封印：牌**不撤**（06-Q65 解封回到原来那一支），改口说暂停生效", () => {
    // 小满（座位 2）被血棘封着
    const { container } = renderGame(singing("行进曲", 2));
    expect(mark(container).className).toContain("songmark--sealed");
    expect(mark(container).getAttribute("aria-label")).toContain("被封印，暂停生效");
    expect(container.querySelector(".songpop .badge")?.getAttribute("data-tone")).toBe("bad");
    expect(container.querySelector(".songpop__foot")?.textContent).toContain("解封后回到这一条");
  });

  it("同一时刻只浮出一层：开着牌堆的扇形时点歌声牌，扇形自己收起来", async () => {
    const { container } = renderGame(singing("活泼板"));
    const played = [...container.querySelectorAll<HTMLButtonElement>("button.pile")].find((b) =>
      b.textContent?.includes("出牌堆"),
    )!;
    await userEvent.click(played);
    expect(played.getAttribute("aria-expanded")).toBe("true");

    await userEvent.click(mark(container));
    expect(played.getAttribute("aria-expanded")).toBe("false");
    expect(mark(container).getAttribute("aria-expanded")).toBe("true");
  });

  it("没人在唱（刚亮出时无歌声）就不画这枚牌", () => {
    const { container } = renderGame(makeSnapshot());
    expect(container.querySelector(".songmark")).toBeNull();
  });

  /*
    位置量过才定的：摆在牌河**下面**时，320px 的机器上它会被从坞里探头的 UNO 定点压住
    （用 playwright 在 320/375/414 五个尺寸上量的）。排在 `.field` 第一个还顺带保证了
    骰子 / 影歌宣言那两块出现时它不会被顶下去——那两块是临时的，它是常驻的。
  */
  it("排在牌河**之上**（与惩罚链同一档），且骰子出现时也不被顶下去", () => {
    const withDice = makeSnapshot({
      ...singing("战争序"),
      dice: { seat: 3, reason: "assault", values: [2] },
    });
    const { container } = renderGame(withDice);
    const kids = [...container.querySelector(".field")!.children];
    const at = (sel: string) => kids.findIndex((el) => el.matches(sel));
    expect(at(".songmark")).toBeGreaterThanOrEqual(0);
    expect(at(".songmark")).toBeLessThan(at(".piles"));
    expect(at(".songmark")).toBeLessThan(at(".field__aside"));
  });
});
