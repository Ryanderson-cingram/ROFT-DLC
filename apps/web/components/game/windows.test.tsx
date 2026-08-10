import type { Action, Card } from "@roft/engine";
import { act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HAND, makeSnapshot } from "@/test-support/snapshot";
import { buttonLabels, cardNames, pickedCardNames, renderGame } from "@/test-support/render-game";
import { wildColorLockFor } from "@/lib/legal";

/**
 * 反应窗口的**两侧**：当事人与旁观者。
 *
 * 已有的 `dock.test.tsx` 只钉了「三个槽还在」，`skills.test.tsx` 钉的是单个技能的那条路径；
 * 这里补的是横切：每一种 `pendingWindow.type` 各渲染两遍（在 actors 里 / 不在 actors 里），
 * 断言三槽的归属、坞顶读条、`body[data-turn]`，以及**旁观者手上不该有当事人的按钮**。
 *
 * 纪律照旧：只断言「入口在不在 + 交上去的 payload 对不对」。每个窗口给哪些动作，
 * 逐条照引擎 `index.ts::legalActions` 的对应分支抄——前端一条合法性都不判。
 */

const [R3, R7, B7, , , WILD] = HAND;
/** 洗牌③的取消牌：基准手牌里没有洗牌牌，取消窗口的用例自带一张。 */
const SHUFFLE: Card = { id: "Wshuffle#0", color: null, face: "shuffle" };
/** `sortHand` 之后的全部手牌（红 → 蓝 → 黄 → 绿 → 无色）。 */
const ALL_CARDS = ["红 3", "红 7", "蓝 7", "黄 +2", "绿 0", "无色 变色", "无色 +4"];

const WINDOW_MS = 9_000;
const wid = (type: string) => `w9:${type}`;
const respond = (type: string, choice: string, cardIds?: string[]): Action => ({
  type: "respond",
  seat: 0,
  windowId: wid(type),
  choice,
  ...(cardIds ? { cardIds } : {}),
});

/** 一个槽此刻该是什么：有动作就写按钮上的字，没动作就写灰着时原地那条理由。 */
/** 有动作 = 可点的按钮；没动作 = 置灰保位（**不消失、不换位**）。
    槽下面那行「为什么灰」2026-08-02 从坞里撤了；理由字符串本身在
    `lib/dock-slots.test.ts` 里逐条盯着，这里只管「灰没灰、在不在原位」。 */
type SlotWant = { label: string } | { off: true };

type WindowCase = {
  name: string;
  type: string;
  defaultChoice: string;
  /** 当事人拿到的动作，逐条照引擎那一支给。 */
  actions: Action[];
  /** 这个窗口要摆在场上的东西（叠链 / 骰子 / 宣言 / 自带的手牌）。 */
  extra?: Parameters<typeof makeSnapshot>[0];
  skill: SlotWant;
  main: SlotWant;
  yield: SlotWant;
  /** 手牌里此刻该点得动的牌（`aria-label`）。 */
  hand: string[];
};

/** 每回合一条主动的额度在这几个窗口里都没得用。 */
const NO_SKILL = { off: true } as const;

const CASES: WindowCase[] = [
  {
    name: "punishStack 惩罚叠链",
    type: "punishStack",
    defaultChoice: "accept",
    actions: [respond("punishStack", "stack"), respond("punishStack", "accept")],
    extra: {
      currentSeat: 1,
      punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2, color: "Y" }], total: 2 },
    },
    // P1：惩罚窗口里只有叠或吃，主动技能整个关着
    skill: { off: true },
    main: { label: "接着叠" },
    yield: { label: "吃下 2 张" },
    hand: [],
  },
  {
    name: "interrupt 劫营打断",
    type: "interrupt",
    defaultChoice: "pass",
    actions: [respond("interrupt", "raid", [B7.id]), respond("interrupt", "pass")],
    extra: { currentSeat: 2 },
    skill: NO_SKILL,
    // 打断牌是按牌给出的 respond → 在手牌里高亮，不占中槽
    main: { off: true },
    yield: { label: "放弃" },
    hand: ["蓝 7"],
  },
  {
    name: "shuffleCancel 洗牌取消",
    type: "shuffleCancel",
    defaultChoice: "pass",
    actions: [respond("shuffleCancel", "cancel", [SHUFFLE.id]), respond("shuffleCancel", "pass")],
    extra: { currentSeat: 1, yourHand: [...HAND, SHUFFLE] },
    skill: NO_SKILL,
    main: { off: true },
    yield: { label: "放弃" },
    hand: ["无色 洗牌"],
  },
  {
    name: "diceTakeover 强袭接管",
    type: "diceTakeover",
    defaultChoice: "pass",
    actions: [respond("diceTakeover", "takeover"), respond("diceTakeover", "pass")],
    extra: { currentSeat: 1, dice: { seat: 1, reason: "punish", values: [2] } },
    skill: NO_SKILL,
    main: { label: "重掷，采用我的结果" },
    yield: { label: "放弃" },
    hand: [],
  },
  {
    name: "soulHarvest 影歌攒魂",
    type: "soulHarvest",
    defaultChoice: "draw3",
    actions: [respond("soulHarvest", "show-exact", [R3.id]), respond("soulHarvest", "draw3")],
    extra: { currentSeat: 3, soulHarvest: { seat: 3, declared: { color: "R", face: "3" }, drawn: 0 } },
    skill: NO_SKILL,
    // 亮牌走中槽的按钮（按钮上写清楚亮的是哪张、亮完摸不摸），不走手牌高亮
    main: { label: "亮出红 3（同色同数，不摸牌）" },
    yield: { label: "不亮牌，摸 3 张" },
    hand: [],
  },
  {
    name: "swapReturn 司夜还牌",
    type: "swapReturn",
    defaultChoice: "stolen",
    // 引擎逐张给出「还这张」，choice 就是牌 id
    actions: HAND.map((c) => respond("swapReturn", c.id)),
    extra: { currentSeat: 1, swap: { seat: 0, target: 1 } },
    skill: NO_SKILL,
    // 手牌本身就是操作对象：中槽没得点，理由用那句人话
    main: { off: true },
    yield: { off: true },
    hand: ALL_CARDS,
  },
  {
    name: "drawDiscard 摸 N 弃 N",
    type: "drawDiscard",
    defaultChoice: "drawn",
    // 组合不枚举：引擎只给一条模板，手牌整个进多选态（`dock.tsx` 的 picks 分支）
    actions: [respond("drawDiscard", "discard")],
    extra: { drawDiscard: { seat: 0, picks: 1 } },
    skill: NO_SKILL,
    main: { off: true },
    yield: { off: true },
    hand: ALL_CARDS,
  },
  {
    name: "handOver 近卫交牌",
    type: "handOver",
    defaultChoice: "keep",
    // 同摸 N 弃 N：组合不枚举，手牌整个进多选态；「不交」是右槽那条
    actions: [respond("handOver", "give"), respond("handOver", "keep")],
    extra: { handOver: { seat: 0, target: 1, max: 2 } },
    skill: NO_SKILL,
    main: { off: true },
    yield: { label: "不交牌" },
    hand: ALL_CARDS,
  },
  {
    name: "skillDraft 开局抽 3 选 1",
    type: "skillDraft",
    defaultChoice: "first",
    actions: ["spade-1", "diamond-3", "club-3"].map((id) => respond("skillDraft", id)),
    extra: { phase: "dealing", draftOptions: ["spade-1", "diamond-3", "club-3"] },
    // 抽技能是全屏模态的活，坞整个歇着：三槽写的都是同一句人话
    skill: { off: true },
    main: { off: true },
    yield: { off: true },
    hand: [],
  },
];

const windowOf = (c: WindowCase, actors: number[]) => ({
  type: c.type,
  actors,
  deadline: new Date(Date.now() + WINDOW_MS).toISOString(),
  defaultChoice: c.defaultChoice,
  resume: "play" as const,
});

/** 你在 actors 里。 */
const actorSnap = (c: WindowCase) =>
  makeSnapshot({
    currentSeat: 1,
    ...c.extra,
    pendingWindow: windowOf(c, [0]),
    windowId: wid(c.type),
    legalActions: c.actions,
  });

/**
 * 你不在 actors 里。引擎这时**只**给 U6/U7 那两条（补喊 / 抓漏喊，不被窗口挡），
 * 窗口里的动作一条都不给；`dealing` 阶段连这两条也没有。
 */
const spectatorSnap = (c: WindowCase) =>
  makeSnapshot({
    currentSeat: 1,
    ...c.extra,
    pendingWindow: windowOf(c, [1]),
    windowId: wid(c.type),
    legalActions: c.type === "skillDraft" ? [] : [{ type: "callUno", seat: 0 }],
  });

const slotsOf = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".dock__row > .dock__slot")];
const actionButton = (slot: HTMLElement) => slot.querySelector("button:not(.skillbadge)") as HTMLButtonElement;
const tickline = (root: HTMLElement) => root.querySelector(".tickline");

/** 有动作 = 可点的按钮、原地没有理由；没动作 = 置灰保位 + 原地写理由（**不消失、不换位**）。 */
const expectSlot = (slot: HTMLElement, want: SlotWant) => {
  const btn = actionButton(slot);
  if ("label" in want) {
    expect(btn.disabled).toBe(false);
    // 中槽的按钮里还有倒计时环的秒数（`.ring__secs`），所以按包含判
    expect(btn.textContent).toContain(want.label);
  } else {
    expect(btn.disabled).toBe(true);
  }
};

const wantedLabels = (c: WindowCase) =>
  [c.skill, c.main, c.yield].flatMap((w) => ("label" in w ? [w.label] : []));

describe("每种反应窗口 × 当事人", () => {
  it.each(CASES)("$name：三槽各就各位，手牌高亮来自 legalActions", (c) => {
    const { container } = renderGame(actorSnap(c));
    const [skill, main, yieldSlot] = slotsOf(container);
    expectSlot(skill, c.skill);
    expectSlot(main, c.main);
    expectSlot(yieldSlot, c.yield);
    expect(cardNames(container)).toEqual(c.hand);
  });

  it.each(CASES)("$name：坞顶读条与警戒档只在坞真的等你操作时出现", (c) => {
    const { container } = renderGame(actorSnap(c));
    // 抽技能由全屏模态接管，坞歇着 → 没有读条、也不进警戒档
    const draft = c.type === "skillDraft";
    expect(tickline(container) === null).toBe(draft);
    expect(container.querySelector(".ring__secs") === null).toBe(draft);
    expect(document.body.dataset.turn).toBe(draft ? "idle" : "alert");
  });

  it("skillDraft：候选是面板的活，坞里不许长出技能 id 按钮", () => {
    const draft = CASES.find((c) => c.type === "skillDraft")!;
    const { container } = renderGame(actorSnap(draft));
    const labels = buttonLabels(container).join("|");
    for (const id of ["spade-1", "diamond-3", "club-3"]) expect(labels).not.toContain(id);
  });
});

describe("每种反应窗口 × 旁观者", () => {
  it.each(CASES)("$name：三槽全灰，写的都是那句人话", (c) => {
    const { container } = renderGame(spectatorSnap(c));
    expect(container.querySelector(".dock__say")!.textContent).toBeTruthy();
    for (const slot of slotsOf(container)) expect(actionButton(slot).disabled).toBe(true);
    expect(document.body.dataset.turn).toBe("idle");
  });

  it.each(CASES)("$name：当事人的按钮一个都拿不到，手牌也一张都点不动", (c) => {
    const { container } = renderGame(spectatorSnap(c));
    const labels = buttonLabels(container).join("|");
    for (const label of wantedLabels(c)) expect(labels).not.toContain(label);
    expect(cardNames(container)).toEqual([]);
  });

  // spec §7：一个 AFK 的当事人不该锁死全桌，所以倒计时对旁观者也是可见的
  it.each(CASES)("$name：倒计时照样看得见（skillDraft 除外，坞歇着）", (c) => {
    const { container } = renderGame(spectatorSnap(c));
    expect(tickline(container) === null).toBe(c.type === "skillDraft");
  });
});

/**
 * spec §7：「任意成员在 deadline 过后调用 claimTimeout」。
 * 旧实现把倒计时挂在 `window && youAreActor` 的横幅上，旁观者连读条都看不到，更催不了。
 */
describe("旁观者也能催超时（spec §7）", () => {
  afterEach(() => vi.useRealTimers());

  it.each(CASES.filter((c) => c.type !== "skillDraft"))("$name：到点自动催一次，且只催一次", async (c) => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    // 快照在假时钟启用之后才造，deadline 与假时钟同源
    renderGame(spectatorSnap(c), { onExpire });
    await act(async () => {
      vi.advanceTimersByTime(WINDOW_MS + 2_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});

/**
 * 三条「从手牌里挑牌交上去」的流程（spec §3.4 的头号命题）。
 * `hand.test.tsx` 逐条钉了 payload；这里钉的是三条共有的边界：
 * 不弹面板、牌 id 不许漏进按钮文字、退路只给提交前的本地选择。
 *
 * 「挑一张」的（司夜②/恒心）点了就交，所以一张牌都不该带 `aria-pressed`；
 * 摸 N 弃 N 挑的是**一组**，多选态是它的正常形态（`multi`）。
 */
describe("从手牌里挑牌交上去：三条流程的共同边界", () => {
  const noop = () => {};
  const FLOWS = [
    {
      name: "司夜②还牌",
      render: () => renderGame(actorSnap(CASES.find((c) => c.type === "swapReturn")!)),
      /** 窗口开着时没有退路：要么挑，要么等超时按 defaultChoice 结算。 */
      cancelable: false,
      multi: false,
    },
    {
      name: "摸 N 弃 N 的弃牌",
      render: () => renderGame(actorSnap(CASES.find((c) => c.type === "drawDiscard")!)),
      cancelable: false,
      multi: true,
    },
    {
      name: "近卫♥6 交牌给链首",
      render: () => renderGame(actorSnap(CASES.find((c) => c.type === "handOver")!)),
      // 「不交」是右槽那条 respond，不是坞里的取消键，所以这条流程本身没有退路
      cancelable: false,
      multi: true,
    },
    {
      name: "恒心♠1 弃 1 代价",
      // 提交前的本地选择，所以随时能反悔
      render: () => renderGame(makeSnapshot(), {}, null, { onPick: noop, onCancel: noop }),
      cancelable: true,
      multi: false,
    },
  ];

  it.each(FLOWS)("$name：手牌全程可见，页面上没有任何浮层", ({ render }) => {
    const { container } = render();
    for (const sel of [".overlay", ".scrim", ".sheet", "dialog"]) {
      expect(container.querySelector(sel)).toBeNull();
    }
    expect(cardNames(container)).toEqual(ALL_CARDS);
  });

  it.each(FLOWS)("$name：挑一张的不进多选态、挑一组的进（但一开始一张没选）", ({ render, multi }) => {
    const { container } = render();
    expect(container.querySelectorAll(".hand [aria-pressed]")).toHaveLength(multi ? ALL_CARDS.length : 0);
    expect(pickedCardNames(container)).toEqual([]);
  });

  // 司夜②的 choice 就是牌 id：漏进按钮就会出现一个写着 "R3#0" 的按钮
  it.each(FLOWS)("$name：牌 id 不许出现在任何按钮上", ({ render }) => {
    const { container } = render();
    expect(buttonLabels(container).join("|")).not.toContain("#");
  });

  it.each(FLOWS)("$name：退路只给提交前的本地选择", ({ render, cancelable }) => {
    const { container } = render();
    expect(buttonLabels(container).includes("先不发动")).toBe(cancelable);
  });
});

/**
 * 并列♥4 的多选态（spec §3.3 + §4）。
 * `skills.test.tsx` 钉了入口与一次正序点选；这里钉的是三条容易回归的细节：
 * 点选顺序 ≠ 排序顺序时 payload 按**点选顺序**、选中不重排、取消能回常态。
 */
describe("并列多选", () => {
  const multi = makeSnapshot({
    canPlayMultiple: true,
    legalActions: [
      { type: "playCards", seat: 0, cardIds: [R3.id] },
      { type: "playCards", seat: 0, cardIds: [R7.id] },
      { type: "playCards", seat: 0, cardIds: [B7.id] },
      { type: "drawCard", seat: 0 },
    ],
  });
  const click = (root: HTMLElement, name: string) =>
    userEvent.click(within(root).getByRole("button", { name }));

  it("payload 按点选顺序给，手牌位置全程照恒定排序不动", async () => {
    const onPlayMany = vi.fn();
    const { container } = renderGame(multi, { onPlayMany });
    await click(container, "多张一起打");

    // 多选态下每张牌都可点：合不合形状由服务端判
    expect(cardNames(container)).toEqual(ALL_CARDS);
    // 倒着点：蓝 7 在排序里排第三，红 3 排第一
    await click(container, "蓝 7");
    await click(container, "红 3");
    // 选中不重排——DOM 顺序还是恒定排序，手指不追着牌跑
    expect(cardNames(container)).toEqual(ALL_CARDS);
    expect(pickedCardNames(container)).toEqual(["红 3", "蓝 7"]);
    // 槽位不因为多了一个提交按钮就换位
    expect(slotsOf(container)).toHaveLength(3);
    expect(slotsOf(container)[1].className).toContain("dock__slot--main");

    await click(container, "打出 2 张");
    expect(onPlayMany).toHaveBeenCalledWith([B7, R3]);
  });

  it("aria-pressed 逐张都对：选中 true、没选 false（读屏与测试都靠它认）", async () => {
    const { container } = renderGame(multi);
    await click(container, "多张一起打");
    await click(container, "绿 0");

    const pressed = [...container.querySelectorAll(".hand .card")].map((el) => [
      el.getAttribute("aria-label"),
      el.getAttribute("aria-pressed"),
    ]);
    expect(pressed).toHaveLength(HAND.length);
    expect(pressed.filter(([, p]) => p === "true")).toEqual([["绿 0", "true"]]);
    expect(pressed.filter(([, p]) => p === "false")).toHaveLength(HAND.length - 1);
  });

  it("一张都没选时只有「取消多打」；取消之后回到常态", async () => {
    const { container } = renderGame(multi);
    const normal = cardNames(container);
    await click(container, "多张一起打");
    expect(buttonLabels(container)).toContain("取消多打");
    expect(buttonLabels(container).some((l) => l.startsWith("打出"))).toBe(false);

    await click(container, "绿 0");
    await click(container, "取消多打");
    // 常态：aria-pressed 整个没了，可点的牌回到 legalActions 那几张，入口按钮回来
    expect(container.querySelectorAll(".hand [aria-pressed]")).toHaveLength(0);
    expect(cardNames(container)).toEqual(normal);
    expect(buttonLabels(container)).toContain("多张一起打");
  });
});

/**
 * 定色（spec §2 bug 3 + §3.4）：中槽整个换成四个色块，**页面上零遮罩**。
 * `dock.test.tsx` 钉了 `data-color` 与文字一一对应；这里钉的是「换掉的是哪一块、能不能反悔」。
 */
describe("定色", () => {
  const pick = (over: Partial<{ onPick: () => void; onCancel: () => void }> = {}) => ({
    card: WILD,
    onPick: over.onPick ?? (() => {}),
    onCancel: over.onCancel ?? (() => {}),
  });

  // 锁色时坞里就只画得出那一个色块。**组件不认识来源**：专精♥9 的专属色 / 五彩 /
  // 行进曲三条在引擎里已经合成 `wildColorLock` 一个值，这里给什么色就画什么色。
  it("锁了色就只给那一块，且 aria-label 不点名来源", () => {
    const { container } = renderGame(makeSnapshot({ activeColor: "B" }), {}, { ...pick(), lockedTo: "B" as const });
    const [, main] = slotsOf(container);
    expect([...main.querySelectorAll(".colors button")].map((b) => b.textContent)).toEqual(["蓝"]);
    const label = main.querySelector(".colors")!.getAttribute("aria-label")!;
    expect(label).toContain("颜色被锁住");
    // 三个来源说法各不相同，点名了就有三分之二的场合在说谎
    for (const source of ["五彩", "行进曲", "专精"]) expect(label).not.toContain(source);
  });

  // 锁到的色**不一定是跟色**：专精♥9 锁的是他亮出时定死的专属色。
  // 从前客户端把锁定色写死成 activeColor，这条就是钉住「组件照快照给的色画」。
  it("锁到的色与当前跟色无关（专精♥9 那一档）", () => {
    const { container } = renderGame(makeSnapshot({ activeColor: "B" }), {}, { ...pick(), lockedTo: "G" as const });
    const [, main] = slotsOf(container);
    expect([...main.querySelectorAll(".colors button")].map((b) => b.textContent)).toEqual(["绿"]);
  });

  it("中槽整块换成四色块 + 一条退路，别的槽一动不动", () => {
    const { container } = renderGame(makeSnapshot(), {}, pick());
    const [skill, main, yieldSlot] = slotsOf(container);
    expect(main.querySelector(".colors")).not.toBeNull();
    expect([...main.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "红",
      "蓝",
      "黄",
      "绿",
      "先不打这张",
    ]);
    // 左槽与右槽照旧在原位（定色只换中槽）
    expect(actionButton(skill)).not.toBeNull();
    expect(actionButton(yieldSlot).textContent).toBe("摸牌");
  });

  it("页面上一层遮罩都没有，手牌与常态一模一样", () => {
    const plain = renderGame(makeSnapshot());
    const before = cardNames(plain.container);
    plain.unmount();

    const { container } = renderGame(makeSnapshot(), {}, pick());
    for (const sel of [".overlay", ".scrim", ".sheet", "dialog"]) {
      expect(container.querySelector(sel)).toBeNull();
    }
    expect(cardNames(container)).toEqual(before);
  });

  it("反悔：「先不打这张」通到 onCancel（这一手还没提交）", async () => {
    const onCancel = vi.fn();
    const { container } = renderGame(makeSnapshot(), {}, pick({ onCancel }));
    await userEvent.click(within(container).getByRole("button", { name: "先不打这张" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("定色是提交前的一步，不发任何动作", async () => {
    const onAction = vi.fn();
    const onPlay = vi.fn();
    const onPick = vi.fn();
    const { container } = renderGame(makeSnapshot(), { onAction, onPlay }, pick({ onPick }));
    await userEvent.click(within(container).getByRole("button", { name: "绿" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
    expect(onPlay).not.toHaveBeenCalled();
  });

  /**
   * 「锁到哪个色」这一句纯函数（`page.tsx` 唯一的调用方）。它是 S1 的核心：
   * 客户端不再自己认技能与状态，只读快照的 `wildColorLock` + 一条「只管无色牌」的契约。
   */
  describe("wildColorLockFor（快照 → 锁到哪个色）", () => {
    const numbered = { id: "R5#x", color: "R", face: "5" } as const;

    it("无色牌 + 快照锁了色 → 就是那个色", () => {
      expect(wildColorLockFor(makeSnapshot({ wildColorLock: "G" }), WILD)).toBe("G");
    });

    it("快照没锁 → null（四色随便选）", () => {
      expect(wildColorLockFor(makeSnapshot(), WILD)).toBeNull();
    });

    /*
      反向断言：**并列♥4 的 4 张同数也要定色，但那不是「使用变色牌」**。
      引擎那边同样不锁（`play-cards.ts` 的 `isWild(card) &&` 那道门），
      所以带着五彩/行进曲的人打并列时照样四色可选——锁错了会让一手合法的牌打不出去。
    */
    it("有色牌（并列 4 张同数）不吃这个锁，哪怕快照锁着色", () => {
      expect(wildColorLockFor(makeSnapshot({ wildColorLock: "B" }), numbered)).toBeNull();
    });

    it("没有牌（还没进定色态）→ null", () => {
      expect(wildColorLockFor(makeSnapshot({ wildColorLock: "B" }), null)).toBeNull();
    });
  });
});
