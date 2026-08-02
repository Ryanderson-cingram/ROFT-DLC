import type { Action, ClientSnapshot } from "@roft/engine";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_NAMES, HAND, PLAYERS, makeSnapshot } from "@/test-support/snapshot";
import { renderGame } from "@/test-support/render-game";
import { cardLabel } from "@/lib/cards";
import { sortHand } from "@/lib/hand-sort";
import { Dock } from "./dock";
import { LogDrawer } from "./log-drawer";
import { Sheet } from "./sheet";
import { SkillModal } from "./skill-modal";
import { GameTable } from "./table";

/**
 * P5：动效接线 · 可访问性（spec §7）· 移动端结构。
 *
 * 分工照旧——这里只钉「结构与属性」，规则一条不判。
 * 三件事在 jsdom 里测不了，各自的验证方式写在断言旁边：
 * 焦点框（纯 CSS，读 CSS 源文件钉住选择器）、真实布局（无排版引擎）、播报本身（无读屏）。
 */

const noop = () => {};
const nameOf = (seat: number) => FIXTURE_NAMES[PLAYERS[seat]?.userId ?? ""] ?? `座位 ${seat + 1}`;

/** 只挂命令坞，且能原地换快照——动效要看的是「同一棵树上，内容变了之后」。 */
function renderDock(s: ClientSnapshot) {
  const ui = (snap: ClientSnapshot) => (
    <Dock
      snapshot={snap}
      nameOf={nameOf}
      onPlay={noop}
      onPlayMany={noop}
      onAction={noop}
      picked={null}
      onPicked={noop}
    />
  );
  const r = render(ui(s));
  return { ...r, update: (snap: ClientSnapshot) => r.rerender(ui(snap)) };
}

/** 牌桌壳同上（堆张数 / 惩罚累计 / 标记数都长在这一半）。 */
function renderTable(s: ClientSnapshot) {
  const ui = (snap: ClientSnapshot) => (
    <GameTable snapshot={snap} nameOf={nameOf} names={FIXTURE_NAMES} />
  );
  const r = render(ui(s));
  return { ...r, update: (snap: ClientSnapshot) => r.rerender(ui(snap)) };
}

const punishWindow = (ms: number) => ({
  type: "punishStack",
  actors: [0],
  deadline: new Date(Date.now() + ms).toISOString(),
  defaultChoice: "accept",
  resume: "play" as const,
});

// ============================================================
// 可访问性（spec §7）
// ============================================================

describe("§7.1–7.2 浮层：原生 <dialog> + 零硬编码 id", () => {
  it("四处浮层里没有任何手写遮罩（`.overlay` 全仓零命中的运行时对照）", () => {
    const { container } = render(
      <>
        <SkillModal skillId="diamond-3" revealed activatedThisTurn={false} marks={{}} onClose={noop} />
        <Sheet title="当众指定一张牌" />
      </>,
    );
    expect(container.querySelector(".overlay")).toBeNull();
    // 全屏的那一层是原生 dialog（focus trap / Esc / 背景 inert 全是浏览器给的）；
    // 升起面板故意不是——决定在盘里做、提交在坞上按，坞必须一直可聚焦。
    expect(container.querySelector("dialog.modal")).not.toBeNull();
    expect(container.querySelector(".sheet")?.getAttribute("aria-modal")).toBe("false");
  });

  it("同一个组件渲染两次，aria-labelledby 指向各自的标题（useId，不是硬编码 id）", () => {
    render(
      <>
        <Sheet title="第一块" />
        <Sheet title="第二块" />
      </>,
    );
    const [a, b] = screen.getAllByRole("dialog");
    const idA = a.getAttribute("aria-labelledby")!;
    const idB = b.getAttribute("aria-labelledby")!;
    expect(idA).not.toBe(idB);
    expect(document.getElementById(idA)?.textContent).toBe("第一块");
    expect(document.getElementById(idB)?.textContent).toBe("第二块");
  });
});

describe("§7.3 live region", () => {
  afterEach(() => vi.useRealTimers());

  it("一句人话在 live region 里，且 aria-live 挂在**常驻外壳**上（重挂的只是里面那句）", () => {
    const { container, update } = renderDock(makeSnapshot());
    const region = container.querySelector('[aria-live="polite"]')!;
    const say = container.querySelector(".dock__say")!;
    // aria-live 若挂在 .dock__say 自己身上，`key={say}` 一重挂就是「新的 live region」，多数读屏不播
    expect(say.getAttribute("aria-live")).toBeNull();
    expect(region.contains(say)).toBe(true);

    update(makeSnapshot({ currentSeat: 1, legalActions: [] }));
    // 外壳是同一个节点，换的只是它的子节点 → 读屏听得见，动效也重播
    expect(container.querySelector('[aria-live="polite"]')).toBe(region);
    expect(container.querySelector(".dock__say")).not.toBe(say);
  });

  it("倒计时**只在进入最后 10 秒时播一次**，不是每秒念一遍", async () => {
    vi.useFakeTimers();
    const { container } = renderDock(
      makeSnapshot({ pendingWindow: punishWindow(12_000), windowId: "w:punishStack", legalActions: [] }),
    );
    const live = container.querySelector(".sr-only")!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("");

    await act(async () => void vi.advanceTimersByTime(2_000));
    expect(live.textContent).toBe("还剩 10 秒");

    // 再走 3 秒：秒数还在跳（.ring__secs 给眼睛看），但播报一个字都不再变
    await act(async () => void vi.advanceTimersByTime(3_000));
    expect(container.querySelector(".ring__secs")?.textContent).toBe("7s");
    expect(live.textContent).toBe("还剩 10 秒");
  });

  it("行动记录的新条目不播报（一局下来几十条，播了等于把读屏刷屏）", () => {
    const { container } = render(
      <LogDrawer open onOpen={noop} onClose={noop} roomId={null} snapshot={makeSnapshot()} names={FIXTURE_NAMES} />,
    );
    expect(container.querySelector(".log")?.closest("[aria-live]")).toBeNull();
  });
});

/**
 * `<Sheet>` 是**非模态**的（手牌与坞必须一直可点），所以浏览器不会替它 inert 掉背景。
 * `.scrim--table` 只是视觉上盖住牌桌——键盘照样 Tab 得到座位卡的技能徽与抓漏喊按钮，
 * 那正是 spec §7 开头骂旧代码那个毛病的镜像版。
 *
 * 与 `page.tsx` 同一套装配：宣言盘 / 洗牌三选一开着的那一刻。
 */
function renderWithSheet() {
  const s = makeSnapshot();
  return render(
    <>
      <GameTable snapshot={s} nameOf={nameOf} names={FIXTURE_NAMES} inert />
      <Dock
        snapshot={s}
        nameOf={nameOf}
        onPlay={noop}
        onPlayMany={noop}
        onAction={noop}
        picked={null}
        onPicked={noop}
      />
      <Sheet eyebrow="发动技能" title="当众指定一张牌" onCancel={noop} />
    </>,
  );
}

describe("升起面板：只关牌桌那一半", () => {
  it("面板开着 → 轮转轨与牌河整块 inert，里面一个可聚焦元素都跑不掉", () => {
    const { container } = renderWithSheet();
    for (const sel of [".dial", ".table"]) expect(container.querySelector(sel)!.hasAttribute("inert")).toBe(true);
    // 座位卡的技能徽是最容易漏的那个——它长在轨上，被 .scrim--table 盖着却照样能 Tab 到
    const behind = [...container.querySelectorAll(".dial button, .table button, .table a")];
    expect(behind.length).toBeGreaterThan(0);
    for (const el of behind) expect(el.closest("[inert]")).not.toBeNull();
  });

  it("**底坞照旧可点**（这才是 Sheet 非模态的全部理由，防的是以后有人顺手把整页 inert 掉）", () => {
    const { container } = renderWithSheet();
    expect(container.querySelector(".dockwrap")!.closest("[inert]")).toBeNull();
    // 手牌 + 三槽：一个都不许被关掉
    const live = [
      ...container.querySelectorAll(".hand button"),
      ...container.querySelectorAll(".dock__row button"),
    ];
    expect(live.length).toBeGreaterThan(3);
    for (const el of live) expect(el.closest("[inert]")).toBeNull();
    // 面板自己当然也得能用
    expect(container.querySelector(".sheet")!.closest("[inert]")).toBeNull();
  });
});

describe("§7.5 牌面：不可点的是 role=img，可点的是 button", () => {
  it("手牌里不可点的那几张有 role=img + aria-label（裸 span 上的 label 多数 AT 会忽略）", () => {
    const { container } = renderGame(makeSnapshot());
    const hand = screen.getByRole("group", { name: "你的手牌" });
    const dim = [...hand.querySelectorAll(".card--dim")];
    expect(dim.length).toBeGreaterThan(0);
    for (const el of dim) {
      expect(el.tagName).toBe("SPAN");
      expect(el.getAttribute("role")).toBe("img");
      expect(el.getAttribute("aria-label")).toBeTruthy();
    }
    // 可点的仍然是真按钮，不是加了 role 的 span
    for (const el of hand.querySelectorAll(".card--legal")) expect(el.tagName).toBe("BUTTON");
  });

  it("牌背不带信息（张数与堆名都在 <Pile> 的 aria-label 上），所以对 AT 隐藏", () => {
    const { container } = renderGame(makeSnapshot());
    const back = container.querySelector('.card[data-color="back"]')!;
    expect(back.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector('[aria-label="摸牌堆 38 张"]')).not.toBeNull();
  });
});

describe("§7.4 aria-expanded / aria-controls", () => {
  it("牌堆的扇形：aria-expanded 随开合变，aria-controls 指向真实的 .fan", async () => {
    const { container } = renderGame(makeSnapshot());
    const pile = [...container.querySelectorAll<HTMLButtonElement>("button.pile")].find((b) =>
      b.textContent?.includes("出牌堆"),
    )!;
    expect(pile.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(pile.getAttribute("aria-controls")!)).toBe(pile.querySelector(".fan"));

    await userEvent.click(pile);
    expect(pile.getAttribute("aria-expanded")).toBe("true");
  });

  it("摸牌堆是暗信息：它连展开入口都没有（不是 button、无 aria-expanded）", () => {
    const { container } = renderGame(makeSnapshot());
    const draw = container.querySelector('[aria-label="摸牌堆 38 张"]')!;
    expect(draw.tagName).toBe("DIV");
    expect(draw.getAttribute("aria-expanded")).toBeNull();
    expect(draw.querySelector(".fan")).toBeNull();
  });
});

describe("§7.6–7.7 焦点指示与文本替代", () => {
  it("抽 3 选 1 的单选框：焦点框画在看得见的那一块上（纯 CSS，钉住选择器）", async () => {
    // opacity:0 的绝对定位 input 才是真正拿到焦点的元素，:focus-visible 画在它身上等于没画
    const { readFile } = await import("node:fs/promises");
    // vitest 的 cwd 就是 apps/web
    const css = await readFile("app/game/[code]/game.css", "utf8");
    expect(css).toContain(".draft-opt:has(input:focus-visible)");
    expect(css).toMatch(/\.draft-opt:has\(input:focus-visible\)\s*\{[^}]*outline:/);
  });

  // 轨下那条「↻ 顺时针」2026-08-02 撤了（一整行只说一个词）。方向的文本替代改由
  // `.dial` 的可及名承担——雪佛龙照旧 aria-hidden，AT 拿到的仍是「顺时针 / 逆时针」四个字。
  it("出牌方向有文本替代，箭头只是装饰（触屏与 AT 都拿不到 title）", () => {
    const dial = (root: HTMLElement) => root.querySelector(".dial")!;
    const cw = renderGame(makeSnapshot());
    expect(dial(cw.container).getAttribute("aria-label")).toContain("顺时针");
    expect(cw.container.querySelector(".dial__chev")?.getAttribute("aria-hidden")).toBe("true");
    expect(cw.container.querySelector("[title]")).toBeNull();

    const ccw = renderGame(makeSnapshot({ direction: -1 }));
    expect(dial(ccw.container).getAttribute("aria-label")).toContain("逆时针");
  });
});

// ============================================================
// 动效（spec §6）：React 里靠**重新挂载**重播，只换文本的地方用 key
// ============================================================

describe("重挂重播：只换文本的地方用 key", () => {
  it("一句人话换了 → 换一个 DOM 节点（`.dock__say` 的 rise 才会重播）", () => {
    const { container, update } = renderDock(makeSnapshot());
    const before = container.querySelector(".dock__say")!;
    const text = before.textContent;

    // 同一份快照重渲染：文本没变就不该重挂（否则每次拉快照都闪一下）
    update(makeSnapshot());
    expect(container.querySelector(".dock__say")).toBe(before);

    update(makeSnapshot({ currentSeat: 1, legalActions: [] }));
    const after = container.querySelector(".dock__say")!;
    expect(after.textContent).not.toBe(text);
    expect(after).not.toBe(before);
  });

  // 槽下面那行「为什么灰」（`.dock__note`）2026-08-02 撤了，跟着它的重挂动效也一起没了。
  // 坞里只剩「一句人话」这一处会随快照换文本，上面那条已经盯着它。

  it("手牌的 DOM 顺序 = sortHand 的顺序（CSS 的 nth-child 逐张错开对得上）", () => {
    const { container } = renderGame(makeSnapshot());
    const dom = [...container.querySelectorAll(".hand > .card")].map((el) => el.getAttribute("aria-label"));
    // 逐张 30ms 的 deal 延迟按 :nth-child 给，所以「第几张」必须就是排序后的第几张
    expect(dom).toEqual(sortHand(HAND).map(cardLabel));
  });
});

describe("`.is-bump`：数字变了闪一下，首渲染不闪", () => {
  afterEach(() => vi.useRealTimers());

  it("首渲染满屏数字，一个 .is-bump 都没有（没有「上一次」就没有变化）", () => {
    const { container } = renderGame(makeSnapshot());
    expect(container.querySelectorAll(".is-bump")).toHaveLength(0);
  });

  it("手牌数变了 → `.hand-meta b` 闪一下，闪完把类摘掉", async () => {
    vi.useFakeTimers();
    const { container, update } = renderDock(makeSnapshot());
    const n = () => container.querySelector(".hand-meta b")!;
    expect(n().className).toBe("");

    update(makeSnapshot({ yourHand: HAND.slice(0, 5) }));
    expect(n().className).toContain("is-bump");

    // 摘不掉的话下一次变化就没得重播了。用定时器而不是 animationend：
    // reduced-motion 下动画整个不跑，那个事件永远不来。
    await act(async () => void vi.advanceTimersByTime(500));
    expect(n().className).not.toContain("is-bump");
  });

  it("堆张数 / 惩罚累计 / 标记数各自变化时也闪，互不牵连", () => {
    const withChain = (total: number, draw: number) =>
      makeSnapshot({
        drawPileCount: draw,
        punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2 }], total },
        players: PLAYERS.map((p) => (p.seat === 3 ? { ...p, marks: { 魂: 3 } } : p)),
      });
    const { container, update } = renderTable(withChain(2, 38));
    const drawCount = () => container.querySelector(".pile__count")!;
    const chainTotal = () => container.querySelector(".chain .total")!;
    const mark = () => container.querySelector(".seat__tags .badge > span")!;

    update(withChain(2, 36));
    expect(drawCount().className).toContain("is-bump");
    expect(chainTotal().className).not.toContain("is-bump");

    update(withChain(4, 36));
    expect(chainTotal().className).toContain("is-bump");

    // 标记的类挂在 .badge **里面**：`.is-bump` 带 display:inline-block，
    // 直接盖在 .badge 的 inline-flex 上会把那颗 ::before 的圆点挤歪
    expect(mark().className).not.toContain("is-bump");
    const bumped = { ...withChain(4, 36) };
    update({ ...bumped, players: PLAYERS.map((p) => (p.seat === 3 ? { ...p, marks: { 魂: 4 } } : p)) });
    expect(mark().className).toContain("is-bump");
    expect(mark().parentElement?.className).toBe("badge");
  });
});

describe("三档回合状态：靠 body[data-turn] 分档（动画关掉后仍分得清的挂点）", () => {
  it.each([
    ["you", makeSnapshot()],
    ["idle", makeSnapshot({ currentSeat: 1, legalActions: [] })],
    [
      "alert",
      makeSnapshot({ currentSeat: 1, pendingWindow: punishWindow(9_000), windowId: "w:p", legalActions: [] }),
    ],
  ] as const)("%s", (turn, snap) => {
    renderDock(snap);
    // 三档的边色（--edge / --piao / --zhu）与坞内底色都是**颜色**声明，
    // prefers-reduced-motion 那条规则只关 animation/transition，碰不到它们
    expect(document.body.dataset.turn).toBe(turn);
  });
});

// ============================================================
// 移动端：jsdom 没有排版引擎，能钉的是结构不变量
// ============================================================

describe("移动端结构", () => {
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
    vi.unstubAllGlobals();
  });

  it("`--dock-h` 写回的就是坞的真实高度（读条与扇形都贴着它）", () => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 248 });
    renderDock(makeSnapshot());
    expect(document.documentElement.style.getPropertyValue("--dock-h")).toBe("248px");
  });

  it("坞自己变高也跟得上：`ResizeObserver` 盯着坞（webfont 加载完那种，resize 事件看不见）", () => {
    let fire: (() => void) | undefined;
    const observed: Element[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          fire = cb;
        }
        observe(el: Element) {
          observed.push(el);
        }
        disconnect() {}
      },
    );
    let h = 190;
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => h });

    const { container } = renderDock(makeSnapshot());
    expect(observed).toEqual([container.querySelector(".dockwrap")]);
    expect(document.documentElement.style.getPropertyValue("--dock-h")).toBe("190px");

    h = 232;
    act(() => fire!());
    expect(document.documentElement.style.getPropertyValue("--dock-h")).toBe("232px");
  });

  it("命令坞永远是三槽，顺序恒定：技能 / 主操作 / 退让", () => {
    const STATES: ClientSnapshot[] = [
      makeSnapshot(),
      makeSnapshot({ currentSeat: 1, legalActions: [] }),
      makeSnapshot({ pendingWindow: punishWindow(9_000), windowId: "w:p", legalActions: [] }),
      makeSnapshot({ phase: "dealing", legalActions: [] }),
      makeSnapshot({ phase: "finished", winner: 1, legalActions: [] }),
    ];
    for (const s of STATES) {
      const { container, unmount } = renderDock(s);
      const row = [...container.querySelectorAll(".dock__row > .dock__slot")];
      expect(row).toHaveLength(3);
      // 中槽是主操作 —— 位置不随窗口变；技能徽在座位卡上，坞里没有
      expect(row[1].className).toContain("dock__slot--main");
      expect(container.querySelector(".dock__row .skillbadge")).toBeNull();
      unmount();
    }
  });

  it("手牌横滚：手牌区是一条，不换行、不被裁（`.hand` 里就是那几张牌，没有别的容器）", () => {
    const { container } = renderGame(makeSnapshot());
    const hand = container.querySelector(".hand")!;
    expect([...hand.children].every((el) => el.classList.contains("card"))).toBe(true);
    expect(within(hand as HTMLElement).queryAllByRole("img").length).toBeGreaterThan(0);
  });
});
