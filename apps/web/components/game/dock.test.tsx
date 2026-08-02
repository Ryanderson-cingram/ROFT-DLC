import type { ClientSnapshot } from "@roft/engine";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HAND, PLAYERS, makeSnapshot } from "@/test-support/snapshot";
import { buttonLabels, renderGame } from "@/test-support/render-game";
import { engineChoices } from "@/test-support/engine-vocab";
import { CHOICE_LABEL } from "@/lib/hud-copy";

/**
 * 命令坞：UNO 三态（U6/U7 2026-08-01 改判）、倒计时（进度环 + 坞顶读条）、三个固定槽位、定色色块。
 * 十个技能各自的 UI 路径在 `skills.test.tsx`；牌桌壳在 `table.test.tsx`。
 *
 * 一条纪律：这里只断言「入口在不在 + 交上去的 payload 对不对」。
 * 「该不该给这条动作」是引擎测试的活，前端不重判规则。
 */

// 没装 jest-dom（多一个依赖只为几个 matcher 不值），直接看 DOM 属性
const unoButton = () => screen.getByRole("button", { name: /喊 UNO/ }) as HTMLButtonElement;
const catchButtons = () => screen.queryAllByRole("button", { name: /没喊 UNO/ });
const slots = (root: HTMLElement) => [...root.querySelectorAll(".dock__row > .dock__slot")];

/** 惩罚窗口，`ms` 毫秒后到点。默认 actors 是阿柴（= 不等你），要等你的用例自己覆盖。 */
const punishWindow = (ms: number) => ({
  type: "punishStack",
  actors: [1],
  deadline: new Date(Date.now() + ms).toISOString(),
  defaultChoice: "accept",
  resume: "play" as const,
});

describe("UNO 定点（U6 2026-08-01 二次澄清：常亮 + 代价提示，坞右上角常驻）", () => {
  // 引擎不做资格拦截，未喊就一直给 callUno；按下那一刻才判，手牌 ≠1 张就是虚喊罚摸 2
  // 「罚 2」那行小字 2026-08-02 从按钮上撤了（挤在定点上太吵），代价只留在 aria-label 里
  it.each([3, 2])("手牌 %i 张 → 按钮照样可点，但标成 risky，代价在 aria-label 里", (n) => {
    renderGame(
      makeSnapshot({
        yourHand: HAND.slice(0, n),
        legalActions: [{ type: "callUno", seat: 0 }],
      }),
    );
    expect(unoButton().disabled).toBe(false);
    expect(unoButton().dataset.state).toBe("risky");
    expect(unoButton().getAttribute("aria-label")).toContain("罚摸 2 张");
  });

  it("手牌 1 张 → 可点、不标 risky，点击发 { type: callUno, seat }", async () => {
    const onAction = vi.fn();
    renderGame(
      makeSnapshot({
        yourHand: HAND.slice(0, 1),
        legalActions: [{ type: "callUno", seat: 0 }],
      }),
      { onAction },
    );
    expect(unoButton().disabled).toBe(false);
    expect(unoButton().dataset.state).toBeUndefined();
    await userEvent.click(unoButton());
    expect(onAction).toHaveBeenCalledWith({ type: "callUno", seat: 0 });
  });

  it("已喊 → 静态徽记，没有可点的按钮（组件不数手牌，只看快照）", () => {
    const { container } = renderGame(
      makeSnapshot({
        yourHand: HAND.slice(0, 1),
        players: PLAYERS.map((p) => (p.seat === 0 ? { ...p, saidUno: true, handCount: 1 } : p)),
        // 引擎在已喊之后不再给 callUno，前端也就不该有按钮
        legalActions: [],
      }),
    );
    expect(screen.queryByRole("button", { name: /喊 UNO/ })).toBeNull();
    // 徽记在坞右上角那个定点上（轨上每个人的座位卡也有同名徽记，所以按位置查）
    const uno = container.querySelector(".dockwrap .uno")!;
    expect(uno.textContent).toBe("已喊 UNO");
    expect(uno.getAttribute("data-state")).toBe("said");
  });
});

describe("抓漏喊（U7）", () => {
  it("legalActions 里有 catchUno → 出现「抓小满：没喊 UNO」，点击 payload 带正确 target", async () => {
    const onAction = vi.fn();
    renderGame(
      makeSnapshot({
        currentSeat: 1,
        players: PLAYERS.map((p) => (p.seat === 2 ? { ...p, handCount: 1 } : p)),
        legalActions: [{ type: "catchUno", seat: 0, target: 2 }],
      }),
      { onAction },
    );
    const btn = screen.getByRole("button", { name: "抓小满：没喊 UNO" });
    await userEvent.click(btn);
    expect(onAction).toHaveBeenCalledWith({ type: "catchUno", seat: 0, target: 2 });
    expect(catchButtons()).toHaveLength(1);
  });

  it("多个目标时每人一条，并排在 UNO 旁边（按钮上写着抓谁）", async () => {
    const onAction = vi.fn();
    const { container } = renderGame(
      makeSnapshot({
        currentSeat: 1,
        legalActions: [
          { type: "catchUno", seat: 0, target: 2 },
          { type: "catchUno", seat: 0, target: 3 },
        ],
      }),
      { onAction },
    );
    const catches = catchButtons();
    expect(catches.map((b) => b.textContent)).toEqual(["抓小满：没喊 UNO", "抓老白：没喊 UNO"]);
    // 定点在坞的右上角那一排，不在轨上、也不进三槽
    expect(catches.every((b) => b.closest(".unobar"))).toBe(true);
    expect(container.querySelectorAll(".seat .btn")).toHaveLength(0);
    await userEvent.click(catches[1]);
    expect(onAction).toHaveBeenCalledWith({ type: "catchUno", seat: 0, target: 3 });
  });

  it("宽限期：自己回合内持 1 张未喊 → 一个抓按钮都没有（引擎不给，前端不许照手牌数自己造）", () => {
    renderGame(
      makeSnapshot({
        yourHand: HAND.slice(0, 1),
        currentSeat: 0,
        players: PLAYERS.map((p) =>
          // 自己 1 张未喊（自己的回合，抓不得），小满也 1 张未喊（引擎这一帧没给动作）
          p.seat === 0 || p.seat === 2 ? { ...p, handCount: 1, saidUno: false } : p,
        ),
        legalActions: [{ type: "callUno", seat: 0 }, { type: "drawCard", seat: 0 }],
      }),
    );
    expect(catchButtons()).toHaveLength(0);
  });
});

/**
 * 倒计时（spec §2 bug 1 + §4.2「任意成员都能催超时」）。
 * 旧实现是顶栏一条 `.alertbar`，读条被 `@keyframes drain 12s` 压着，跟真实 deadline 无关；
 * 现在是主按钮外圈的环（`--p`）+ 坞顶那条线（`--w`），两个数都由 deadline 现算。
 */
describe("倒计时：进度环 + 坞顶读条", () => {
  afterEach(() => vi.useRealTimers());

  const tick = (root: HTMLElement) => root.querySelector(".tickline") as HTMLElement | null;

  it("非 actor 也看得见倒计时，用旁观文案，到点自动发 claimTimeout（每个窗口只发一次）", async () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const { container } = renderGame(
      makeSnapshot({
        currentSeat: 1,
        pendingWindow: punishWindow(3_000), // 等阿柴响应，不等你
        windowId: "w12:punishStack",
        legalActions: [],
      }),
      { onExpire },
    );

    // 旧实现是 `window && youAreActor`：非 actor 连横幅都看不到，一个 AFK 玩家锁死全桌
    expect(tick(container)).not.toBeNull();
    expect(container.querySelector(".dock__say")?.textContent).toContain("等阿柴响应");
    expect(container.querySelector(".ring__secs")?.textContent).toBe("3s");
    // 剩 ≤5 秒：环进朱砂档
    expect(container.querySelector(".ring")?.getAttribute("data-urgent")).toBe("");

    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    // 每个窗口只催一次（useCountdown 的 fired ref，去重键是 deadline）
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("没有窗口就没有读条、也没有环", () => {
    const { container } = renderGame(makeSnapshot());
    expect(tick(container)).toBeNull();
    expect(container.querySelector(".ring__secs")).toBeNull();
  });

  // bug 1 的回归钉子：同样过了 4 秒，10 秒窗口与 5 秒窗口必须给出不同的宽度。
  // 旧实现两条都是 `animation: drain 12s`，这条断言会红。
  it("读条宽度由 deadline 现算：不同 deadline → 不同 --w", async () => {
    vi.useFakeTimers();
    const snap = (ms: number) =>
      makeSnapshot({ currentSeat: 1, pendingWindow: punishWindow(ms), windowId: "w:x", legalActions: [] });
    const long = renderGame(snap(10_000));
    const short = renderGame(snap(5_000));

    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });

    const widthOf = (r: { container: HTMLElement }) => tick(r.container)!.style.getPropertyValue("--w");
    expect(parseFloat(widthOf(long))).toBeCloseTo(60, 5);
    expect(parseFloat(widthOf(short))).toBeCloseTo(20, 5);
    expect(widthOf(long)).not.toBe(widthOf(short));
  });
});

describe("三个固定槽位（第 5 条 UI 反馈：按钮别乱跑）", () => {
  const WINDOWS: { name: string; snap: Partial<ClientSnapshot> }[] = [
    { name: "无窗口·你的回合", snap: {} },
    { name: "无窗口·别人的回合", snap: { currentSeat: 1, legalActions: [] } },
    {
      name: "惩罚叠链",
      snap: {
        currentSeat: 1,
        punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2 }], total: 2 },
        pendingWindow: { ...punishWindow(12_000), actors: [0] },
        windowId: "w:punishStack",
        legalActions: [
          { type: "respond", seat: 0, windowId: "w:punishStack", choice: "stack" },
          { type: "respond", seat: 0, windowId: "w:punishStack", choice: "accept" },
        ],
      },
    },
    {
      name: "劫营打断",
      snap: {
        currentSeat: 2,
        pendingWindow: { ...punishWindow(8_000), type: "interrupt", actors: [0], defaultChoice: "pass" },
        windowId: "w:interrupt",
        legalActions: [{ type: "respond", seat: 0, windowId: "w:interrupt", choice: "pass" }],
      },
    },
    {
      name: "司夜还牌（手牌就是操作对象）",
      snap: {
        currentSeat: 1,
        pendingWindow: { ...punishWindow(10_000), type: "swapReturn", actors: [0], defaultChoice: "stolen" },
        windowId: "w:swapReturn",
        legalActions: [{ type: "respond", seat: 0, windowId: "w:swapReturn", choice: HAND[0].id }],
      },
    },
    { name: "开局抽技能（坞整个歇着）", snap: { phase: "dealing", legalActions: [] } },
    { name: "终局", snap: { phase: "finished", winner: 1, legalActions: [] } },
  ];

  it.each(WINDOWS)("$name：三个槽都在，主槽永远在中间", ({ snap }) => {
    const { container } = renderGame(makeSnapshot(snap));
    const row = slots(container);
    expect(row).toHaveLength(3);
    expect(row[1].className).toContain("dock__slot--main");
    // 没有的动作置灰保位——不许消失、不许换位（理由字符串归 lib/dock-slots.test.ts 管）
    for (const s of row) expect(s.querySelector("button:not(.skillbadge)")).not.toBeNull();
  });

  it("一个槽里多条动作 → 一个按钮 + 点开的菜单，槽位位置不变", async () => {
    const onAction = vi.fn();
    const harvest = { type: "activateSkill" as const, seat: 0, effectKey: "1" };
    const skip = { type: "activateSkill" as const, seat: 0, effectKey: "2" };
    const { container } = renderGame(
      makeSnapshot({
        players: PLAYERS.map((p) => (p.seat === 0 ? { ...p, skillId: "diamond-3", revealed: true } : p)),
        legalActions: [harvest, skip, { type: "drawCard", seat: 0 }],
      }),
      { onAction },
    );

    const row = slots(container);
    expect(row).toHaveLength(3);
    expect(row[1].className).toContain("dock__slot--main");
    // 左槽只有一个动作按钮（组标签），不是两个并排把槽撑开
    expect(row[0].querySelectorAll("button:not(.skillbadge)")).toHaveLength(1);
    expect(screen.queryByRole("menu")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "发动技能" }));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "发动技能：攒 1 个魂（最多 6）",
      "发动技能：花 2 魂跳过这一回合",
    ]);
    // 菜单是绝对定位的浮层，槽位数量与顺序照旧
    expect(slots(container)).toHaveLength(3);
    expect(slots(container)[1].className).toContain("dock__slot--main");

    await userEvent.click(items[1]);
    expect(onAction).toHaveBeenCalledWith(skip);
  });

  it("技能徽只在座位卡上，坞里没有；点它开详情弹窗，页面上也没有技能大卡", async () => {
    const onSkillClick = vi.fn();
    const { container } = renderGame(makeSnapshot({ legalActions: [{ type: "drawCard", seat: 0 }] }), {
      onSkillClick,
    });
    // 坞里一枚技能徽都没有——它在轮转轨上自己那张座位卡里，同一件东西不在一屏出现两次
    expect(container.querySelector(".dock__row .skillbadge")).toBeNull();
    const badge = container.querySelector(".seat--you .skillbadge") as HTMLButtonElement;
    expect(badge.textContent).toBe("♠1恒心");
    await userEvent.click(badge);
    expect(onSkillClick).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".skillcard")).toBeNull();
    expect(container.querySelector(".rules")).toBeNull();
  });

  it("坞的真实高度写回 --dock-h（读条与只盖牌桌的遮罩都贴着它）", () => {
    const h = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(248);
    renderGame(makeSnapshot());
    expect(document.documentElement.style.getPropertyValue("--dock-h")).toBe("248px");
    h.mockRestore();
  });
});

/**
 * 定色（spec §2 bug 3 + §3.4）：中槽换成四个色块，**没有任何遮罩**，手牌全程可见。
 * 旧实现用 `.colors button:nth-child(1..4)` 绑死底色、文字来自 `COLORS` 数组——
 * 数组一改顺序就会出现写着「红」的蓝底按钮。
 */
describe("定色：中槽的四个色块", () => {
  const W4 = HAND[6];

  it("底色跟着 data-color 走，与文字一一对应", async () => {
    const onPick = vi.fn();
    const { container } = renderGame(makeSnapshot(), {}, { card: W4, onPick, onCancel: () => {} });
    const swatches = [...container.querySelectorAll(".colors button")];
    expect(swatches.map((b) => [b.getAttribute("data-color"), b.textContent])).toEqual([
      ["R", "红"],
      ["B", "蓝"],
      ["Y", "黄"],
      ["G", "绿"],
    ]);
    await userEvent.click(screen.getByRole("button", { name: "蓝" }));
    expect(onPick).toHaveBeenCalledWith("B");
  });

  it("定色期间没有任何遮罩，手牌完整可见，三个槽位照旧", () => {
    const { container } = renderGame(makeSnapshot(), {}, { card: W4, onPick: () => {}, onCancel: () => {} });
    expect(container.querySelector(".overlay")).toBeNull();
    expect(container.querySelectorAll(".hand .card")).toHaveLength(HAND.length);
    expect(slots(container)).toHaveLength(3);
    expect(slots(container)[1].querySelector(".colors")).not.toBeNull();
  });
});

/**
 * spec §5.3 第 13 条：每种窗口都得有一句人话，按钮不许是原始 choice 字符串。
 * 全集从引擎源码 grep（`engineChoices`），加了新 choice 而没写人话就红。
 */
describe("窗口选项的人话（CHOICE_LABEL 覆盖率）", () => {
  /**
   * 不进这张表的 choice，逐条有理由：
   * - `drawn` / `stolen`：只是 `defaultChoice` 的占位，真实动作的 choice 是牌 id（点手牌，不出按钮）
   * - `show-exact` / `show-partial`：影歌①的亮牌选项自带 cardIds，标签走「亮出红 3（…）」那条分支
   */
  const NOT_A_BUTTON = new Set(["drawn", "stolen", "show-exact", "show-partial"]);

  it("引擎里的每个 choice 都有人话", () => {
    const choices = engineChoices();
    // 正则烂掉会让上面那条假绿，先钉一个下限
    expect(choices.length).toBeGreaterThanOrEqual(13);
    expect(choices.filter((c) => !NOT_A_BUTTON.has(c) && !CHOICE_LABEL[c])).toEqual([]);
  });

  it("人话不为空、也不是原样的 choice 字符串", () => {
    for (const [choice, label] of Object.entries(CHOICE_LABEL)) {
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(choice);
    }
  });

  /** 真渲染一遍：每种窗口的提示句非空，按钮上写的是人话。 */
  const CASES: { name: string; type: string; choices: string[]; extra?: Partial<ClientSnapshot> }[] = [
    { name: "惩罚叠链", type: "punishStack", choices: ["stack", "accept", "soul-skip"],
      extra: { punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2 }], total: 2 } } },
    { name: "劫营打断", type: "interrupt", choices: ["pass"] },
    { name: "洗牌取消", type: "shuffleCancel", choices: ["pass"] },
    { name: "强袭接管", type: "diceTakeover", choices: ["takeover", "pass"],
      extra: { dice: { seat: 1, reason: "punish", values: [2] } } },
    { name: "影歌攒魂", type: "soulHarvest", choices: ["draw3"] },
  ];

  it.each(CASES)("$name 窗口：提示句非空，按钮是人话", ({ type, choices, extra }) => {
    const { container } = renderGame(
      makeSnapshot({
        currentSeat: 1,
        ...extra,
        pendingWindow: {
          type,
          actors: [0],
          deadline: new Date(Date.now() + 10_000).toISOString(),
          defaultChoice: choices[0],
          resume: "play",
        },
        windowId: `w9:${type}`,
        legalActions: choices.map((choice) => ({
          type: "respond" as const,
          seat: 0,
          windowId: `w9:${type}`,
          choice,
        })),
      }),
    );
    // 一句人话现在长在坞里（`.dock__say`），顶栏那条横幅没了
    expect(container.querySelector(".dock__say")?.textContent).toBeTruthy();
    const labels = buttonLabels(container);
    for (const choice of choices) {
      expect(labels).not.toContain(choice);
      expect(labels.some((l) => l.includes(CHOICE_LABEL[choice]))).toBe(true);
    }
  });
});
