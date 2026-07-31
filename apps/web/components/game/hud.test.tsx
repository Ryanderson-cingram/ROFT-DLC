import type { ClientSnapshot } from "@roft/engine";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HAND, PLAYERS, makeSnapshot } from "@/fixtures/snapshot";
import { buttonLabels, renderHud } from "@/test-support/render-hud";
import { engineChoices } from "@/test-support/engine-vocab";
import { CHOICE_LABEL } from "./hud";

/**
 * HUD 的 UNO 三态（U6/U7 2026-08-01 改判）、反应窗口的倒计时与人话。
 * 十个技能各自的 UI 路径在 `skills.test.tsx`；全屏面板在 `pick-sheet.test.tsx` / `draft-sheet.test.tsx`。
 *
 * 一条纪律：这里只断言「入口在不在 + 交上去的 payload 对不对」。
 * 「该不该给这条动作」是引擎测试的活，前端不重判规则。
 */

// 没装 jest-dom（多一个依赖只为几个 matcher 不值），直接看 DOM 属性
const unoButton = () => screen.getByRole("button", { name: "喊 UNO！" }) as HTMLButtonElement;
const catchButtons = () => screen.queryAllByRole("button", { name: /没喊 UNO/ });
const costNote = () => screen.queryByText("现在喊要罚摸 2 张");

describe("UNO 按钮（U6 2026-08-01 二次澄清：常亮 + 代价提示）", () => {
  // 引擎不做资格拦截，未喊就一直给 callUno；按下那一刻才判，手牌 ≠1 张就是虚喊罚摸 2
  it.each([3, 2])("手牌 %i 张 → 按钮照样可点，但必须写明「现在喊要罚摸 2 张」", (n) => {
    renderHud(
      makeSnapshot({
        yourHand: HAND.slice(0, n),
        legalActions: [{ type: "callUno", seat: 0 }],
      }),
    );
    expect(unoButton().disabled).toBe(false);
    expect(costNote()).not.toBeNull();
  });

  it("手牌 1 张 → 可点、不显示代价提示，点击发 { type: callUno, seat }", async () => {
    const onAction = vi.fn();
    renderHud(
      makeSnapshot({
        yourHand: HAND.slice(0, 1),
        legalActions: [{ type: "callUno", seat: 0 }],
      }),
      { onAction },
    );
    expect(unoButton().disabled).toBe(false);
    expect(costNote()).toBeNull();
    await userEvent.click(unoButton());
    expect(onAction).toHaveBeenCalledWith({ type: "callUno", seat: 0 });
  });

  it("已喊 → 静态徽记，没有可点的按钮（组件不数手牌，只看快照）", () => {
    const { container } = renderHud(
      makeSnapshot({
        yourHand: HAND.slice(0, 1),
        players: PLAYERS.map((p) => (p.seat === 0 ? { ...p, saidUno: true, handCount: 1 } : p)),
        // 引擎在已喊之后不再给 callUno，前端也就不该有按钮
        legalActions: [],
      }),
    );
    expect(screen.queryByRole("button", { name: /喊 UNO/ })).toBeNull();
    // 徽记要在自己的操作区（对手区也有同名徽记，所以按位置查）
    expect(container.querySelector(".actions .badge")?.textContent).toBe("已喊 UNO");
  });
});

describe("抓漏喊（U7）", () => {
  it("legalActions 里有 catchUno → 出现「抓小满：没喊 UNO」，点击 payload 带正确 target", async () => {
    const onAction = vi.fn();
    renderHud(
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

  it("宽限期：自己回合内持 1 张未喊 → 一个抓按钮都没有（引擎不给，前端不许照手牌数自己造）", () => {
    renderHud(
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

describe("反应窗口的倒计时（spec §4.2：任意成员都能催超时）", () => {
  afterEach(() => vi.useRealTimers());

  it("非 actor 也看得见倒计时，用旁观文案，到点自动发 claimTimeout", async () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const { container } = renderHud(
      makeSnapshot({
        currentSeat: 1,
        pendingWindow: {
          type: "punishStack",
          actors: [1], // 等阿柴响应，不等你
          deadline: new Date(Date.now() + 3_000).toISOString(),
          defaultChoice: "accept",
          resume: "play",
        },
        windowId: "w12:punishStack",
        legalActions: [],
      }),
      { onExpire },
    );

    // 旧实现是 `window && youAreActor`：非 actor 连横幅都看不到，一个 AFK 玩家锁死全桌
    const bar = container.querySelector(".alertbar");
    expect(bar).not.toBeNull();
    expect(bar!.textContent).toContain("等阿柴响应");
    expect(container.querySelector(".secs")?.textContent).toBe("3s");

    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    // 每个窗口只催一次（AlertBar 的 fired ref）
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("没有窗口就没有倒计时条", () => {
    const { container } = renderHud(makeSnapshot());
    expect(container.querySelector(".alertbar")).toBeNull();
  });
});

/**
 * spec §5.3 第 13 条：每种窗口都得有一句人话，按钮不许是原始 choice 字符串。
 * 全集从引擎源码 grep（`engineChoices`），加了新 choice 而没写人话就红。
 */
describe("窗口选项的人话（CHOICE_LABEL 覆盖率）", () => {
  /**
   * 不进这张表的 choice，逐条有理由：
   * - `drawn` / `stolen`：只是 `defaultChoice` 的占位，真实动作的 choice 是牌 id（面板点牌，不出按钮）
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
    const { container } = renderHud(
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
    expect(container.querySelector(".hudsay")?.textContent).toBeTruthy();
    const labels = buttonLabels(container);
    for (const choice of choices) {
      expect(labels).not.toContain(choice);
      expect(labels.some((l) => l.includes(CHOICE_LABEL[choice]))).toBe(true);
    }
  });
});
