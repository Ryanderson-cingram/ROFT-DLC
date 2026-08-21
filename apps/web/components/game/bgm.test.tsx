import type { ClientSnapshot } from "@roft/engine";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYERS, makeSnapshot } from "@/test-support/snapshot";
import { Bgm, bgmFor } from "./bgm";

/**
 * 背景音乐（spec `2026-08-19-bard-bgm`）。分工与仓库其余测试一致：
 * 判断全在纯函数 `bgmFor()` 里，组件那一层只钉「结构、属性、副作用的调用」。
 *
 * jsdom 没实现 `HTMLMediaElement` 的 play/pause（调用会抛 Not implemented），
 * 所以下面把这两个连同 `src` 的 setter 一起接管——「有没有真的出声」只能手测，
 * 但「什么时候该 play / 该 pause / 该换曲」是逻辑，逻辑在这里全钉住。
 */

const LOBBY = "/bgm/lobby.mp3";
const SONGS = {
  活泼板: "/bgm/huopoban.mp3",
  战争序: "/bgm/zhanzhengxu.mp3",
  樱时雨: "/bgm/yingshiyu.mp3",
  行进曲: "/bgm/xingjinqu.mp3",
} as const;

/** 座位 1（阿柴）没被封印、座位 2（小满）在基准 fixture 里就被血棘封印着。 */
const singing = (key: string, seat = 1) => makeSnapshot({ chosen: { "club-5": { key, seat } } });

describe("bgmFor：快照 → 此刻该放哪一支", () => {
  it("没有歌声就放大厅曲（无歌声是初始态，多数局全程如此）", () => {
    expect(bgmFor(makeSnapshot())).toEqual({ src: LOBBY, paused: false, name: null });
  });

  it("chosen 是空对象也一样（没选过 ≠ 字段缺席）", () => {
    expect(bgmFor(makeSnapshot({ chosen: {} }))).toEqual({ src: LOBBY, paused: false, name: null });
  });

  it.each(Object.entries(SONGS))("唱「%s」就放 %s", (key, src) => {
    expect(bgmFor(singing(key))).toEqual({ src, paused: false, name: key });
  });

  it("四支歌各有各的曲子，且都在 /bgm/ 下", () => {
    const files = Object.values(SONGS);
    expect(new Set(files).size).toBe(files.length);
    expect(new Set([...files, LOBBY]).size).toBe(files.length + 1);
    for (const f of [...files, LOBBY]) expect(f).toMatch(/^\/bgm\/[a-z]+\.mp3$/);
  });

  it("改唱就换曲（后唱覆盖先唱，06-Q66：全场只有一个槽）", () => {
    expect(bgmFor(singing("战争序")).src).toBe(SONGS.战争序);
    expect(bgmFor(singing("行进曲")).src).toBe(SONGS.行进曲);
  });

  it("唱歌的人被封印：暂停，但不换曲——解封要从原处续上（06-Q65 只压制不清值）", () => {
    expect(bgmFor(singing("战争序", 2))).toEqual({ src: SONGS.战争序, paused: true, name: "战争序" });
  });

  it("被封印的是别人时照唱不误", () => {
    // 基准 fixture 里座位 2 带着「封印」，唱歌的是座位 1
    expect(PLAYERS[2].statuses).toContain("封印");
    expect(bgmFor(singing("战争序", 1)).paused).toBe(false);
  });

  it("专精♥9 的定色也住在 chosen 里，但它不是歌声（那个槽既装色也装选项名）", () => {
    expect(bgmFor(makeSnapshot({ chosen: { "heart-9": { key: "R", seat: 1 } } })).src).toBe(LOBBY);
  });

  it("认不出的 key 一律不放（第一道闸：它压根不是哪条子效果）", () => {
    expect(bgmFor(makeSnapshot({ chosen: { "club-5": { key: "安魂曲", seat: 1 } } })).src).toBe(LOBBY);
  });

  /*
    下面两条盯的是**第二道闸**（`key in TRACKS`）。它不是防御性摆设：吟游①自己
    （`club-5` 的 key "1"）也是 `targeting: global` 的**可发动**效果，而写 `chosen` 的
    `chooseOption` 记的就是发动时报的那个 key——报「①」而不是某一支歌时，第一道闸放行，
    只有这张表拦得住（拦不住就是 `TRACKS["1"] === undefined` → `<audio src="undefined">`）。
  */
  it("吟游①本身也是全场生效的，但它不是一支歌：不放（第二道闸）", () => {
    expect(bgmFor(makeSnapshot({ chosen: { "club-5": { key: "1", seat: 1 } } })).src).toBe(LOBBY);
  });

  it("别的技能的全局效果（强袭♦1②）落进这个槽也不放（第二道闸）", () => {
    expect(bgmFor(makeSnapshot({ chosen: { "diamond-1": { key: "2", seat: 1 } } })).src).toBe(LOBBY);
  });

  it("歌声与专精的色并存时，放的是歌声", () => {
    const s = makeSnapshot({
      chosen: { "heart-9": { key: "R", seat: 3 }, "club-5": { key: "樱时雨", seat: 1 } },
    });
    expect(bgmFor(s)).toEqual({ src: SONGS.樱时雨, paused: false, name: "樱时雨" });
  });

  it("seat 指向一个不在场的座位也不炸（快照口径漂移时退成「不暂停」）", () => {
    expect(bgmFor(singing("战争序", 9))).toEqual({ src: SONGS.战争序, paused: false, name: "战争序" });
  });
});

describe("<Bgm />", () => {
  let play: ReturnType<typeof vi.spyOn>;
  let pause: ReturnType<typeof vi.spyOn>;
  let setSrc: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    setSrc = vi.spyOn(HTMLMediaElement.prototype, "src", "set");
  });
  afterEach(() => vi.restoreAllMocks());

  /** 渲染并留一个原地换快照的口子——「改唱之后」要看的是同一棵树上的变化。 */
  const mount = (s: ClientSnapshot = makeSnapshot()) => {
    const r = render(<Bgm snapshot={s} />);
    const audio = () => r.container.querySelector("audio") as HTMLAudioElement;
    return { ...r, audio, update: (next: ClientSnapshot) => r.rerender(<Bgm snapshot={next} />) };
  };

  const button = () => screen.getByRole("button");
  /** 可及名是**算**出来的（label + 内容），所以用 role+name 查而不是读属性。 */
  const named = (name: string) => screen.getByRole("button", { name });
  /** 把微任务队列排空：`play()` 的拒绝（以及它挂上的补播监听）是异步的。 */
  const flush = () => act(async () => {});

  const click = async (el: HTMLElement) => {
    await act(async () => {
      fireEvent.click(el);
    });
  };

  it("默认静音：不出声、不设 src、按钮是抬起的", async () => {
    const { audio } = mount();
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(named("打开背景音乐")).toBe(button());
    expect(play).not.toHaveBeenCalled();
    expect(audio().getAttribute("src")).toBeNull();
  });

  it("不预加载、循环放（五支曲共 ~17MB，关着音乐的人一个字节都不下）", () => {
    const { audio } = mount();
    expect(audio().preload).toBe("none");
    expect(audio().loop).toBe(true);
  });

  it("点一下就放大厅曲，并把偏好记下来", async () => {
    const { audio } = mount();
    await click(button());
    expect(audio().getAttribute("src")).toBe(LOBBY);
    expect(play).toHaveBeenCalled();
    expect(localStorage.getItem("roft:bgm")).toBe("on");
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(named("关掉背景音乐（正在放：大厅曲）")).toBe(button());
  });

  it("再点一下就停，偏好跟着改", async () => {
    mount();
    await click(button());
    pause.mockClear();
    await click(button());
    expect(pause).toHaveBeenCalled();
    expect(localStorage.getItem("roft:bgm")).toBe("off");
    expect(button().getAttribute("aria-pressed")).toBe("false");
  });

  it("关掉再打开是**续播**：src 不重设（重设等于从头放）", async () => {
    mount();
    await click(button());
    setSrc.mockClear();
    await click(button()); // 关
    await click(button()); // 再开
    expect(setSrc).not.toHaveBeenCalled();
    // 每次「开」都调两次 play：点击那一拍一次（iOS 要的）、副作用里一次。`play()` 幂等，
    // 对着正在放的元素再调一次什么也不会发生——所以这里钉的是「开了两次 = 4」，不是漏调。
    expect(play).toHaveBeenCalledTimes(4);
  });

  it("上次开着：进牌桌自动接上，不用再点一次", async () => {
    localStorage.setItem("roft:bgm", "on");
    const { audio } = mount();
    expect(play).toHaveBeenCalled();
    expect(audio().getAttribute("src")).toBe(LOBBY);
    expect(button().getAttribute("aria-pressed")).toBe("true");
  });

  it("上次关着：进牌桌仍然是静的", () => {
    localStorage.setItem("roft:bgm", "off");
    mount();
    expect(play).not.toHaveBeenCalled();
  });

  it("唱起歌声就换曲，曲名进按钮的可及名", async () => {
    localStorage.setItem("roft:bgm", "on");
    const { audio, update } = mount();
    play.mockClear();
    await act(async () => update(singing("战争序")));
    expect(audio().getAttribute("src")).toBe(SONGS.战争序);
    expect(play).toHaveBeenCalledTimes(1);
    expect(named("关掉背景音乐（正在放：战争序）")).toBe(button());
  });

  it("改唱一支就再换一次", async () => {
    localStorage.setItem("roft:bgm", "on");
    const { audio, update } = mount(singing("战争序"));
    await act(async () => update(singing("樱时雨")));
    expect(audio().getAttribute("src")).toBe(SONGS.樱时雨);
  });

  it("快照变了但该放的没变：不重设 src、不重复 play（不然每收一条快照就从头放）", async () => {
    localStorage.setItem("roft:bgm", "on");
    const s = singing("战争序");
    const { update } = mount(s);
    play.mockClear();
    setSrc.mockClear();
    await act(async () => update({ ...s, version: s.version + 1, drawPileCount: 12 }));
    expect(play).not.toHaveBeenCalled();
    expect(setSrc).not.toHaveBeenCalled();
  });

  it("唱歌的人被封印就暂停；解封从原处续上（src 全程不动）", async () => {
    localStorage.setItem("roft:bgm", "on");
    const { audio, update } = mount(singing("战争序", 1));
    pause.mockClear();
    play.mockClear();
    setSrc.mockClear();

    // 座位 1 被封印
    const sealed = makeSnapshot({
      chosen: { "club-5": { key: "战争序", seat: 1 } },
      players: PLAYERS.map((p) => (p.seat === 1 ? { ...p, statuses: ["封印"], sealedBy: 3 } : p)),
    });
    await act(async () => update(sealed));
    expect(pause).toHaveBeenCalled();
    expect(audio().getAttribute("src")).toBe(SONGS.战争序);

    // 解封
    await act(async () => update(singing("战争序", 1)));
    expect(play).toHaveBeenCalledTimes(1);
    expect(setSrc).not.toHaveBeenCalled();
  });

  it("歌声没了（吟游出局/引擎清了 chosen）就回大厅曲", async () => {
    localStorage.setItem("roft:bgm", "on");
    const { audio, update } = mount(singing("战争序"));
    await act(async () => update(makeSnapshot()));
    expect(audio().getAttribute("src")).toBe(LOBBY);
  });

  it("封印期间打开音乐：开着的是按钮，声音仍然停着", async () => {
    const sealed = makeSnapshot({ chosen: { "club-5": { key: "战争序", seat: 2 } } });
    mount(sealed);
    pause.mockClear();
    await click(button());
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(pause).toHaveBeenCalled();
  });

  it("音乐关着时唱歌：什么都不做，连 src 都不设（不预加载）", async () => {
    const { audio, update } = mount();
    await act(async () => update(singing("战争序")));
    expect(play).not.toHaveBeenCalled();
    expect(audio().getAttribute("src")).toBeNull();
  });

  it("被浏览器的自动播放策略挡住时，第一次点击页面补上", async () => {
    localStorage.setItem("roft:bgm", "on");
    play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    mount();
    await flush();
    expect(play).toHaveBeenCalledTimes(1); // 被拒了

    await act(async () => {
      fireEvent.pointerDown(document);
    });
    expect(play).toHaveBeenCalledTimes(2); // 手势来了，补播
  });

  it("补播只挂一次：后面的点击不再重复调 play", async () => {
    localStorage.setItem("roft:bgm", "on");
    play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    mount();
    await flush();
    await act(async () => {
      fireEvent.pointerDown(document);
      fireEvent.pointerDown(document);
      fireEvent.pointerDown(document);
    });
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("离开牌桌后不再补播（监听跟着组件走）", async () => {
    localStorage.setItem("roft:bgm", "on");
    play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    const { unmount } = mount();
    // 卸载先于 `play()` 的拒绝落地：补播监听是在那之后才挂的，得靠 signal 拦住
    unmount();
    await flush();
    await act(async () => {
      fireEvent.pointerDown(document);
    });
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("play 被拒不弹错、不改按钮状态（用户的意图没变）", async () => {
    play.mockRejectedValue(new DOMException("no source", "NotSupportedError"));
    mount();
    await click(button());
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("roft:bgm")).toBe("on");
  });

  it("音量压在背景档（iOS 上这个赋值会被静默忽略，那边由素材响度决定）", async () => {
    const { audio } = mount();
    await click(button());
    expect(audio().volume).toBeCloseTo(0.35);
  });

  it("服务端渲染的首帧一律是「静」的（偏好不能写进 useState 初值，否则 hydration 对不上）", () => {
    localStorage.setItem("roft:bgm", "on");
    const html = renderToStaticMarkup(<Bgm snapshot={singing("战争序")} />);
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain("src=");
  });

  it("StrictMode 下挂两次也不出事（副作用幂等）", async () => {
    localStorage.setItem("roft:bgm", "on");
    const { container } = render(
      <StrictMode>
        <Bgm snapshot={singing("战争序")} />
      </StrictMode>,
    );
    await flush();
    expect(container.querySelector("audio")?.getAttribute("src")).toBe(SONGS.战争序);
    expect(play).toHaveBeenCalled();
  });

  it("localStorage 被浏览器锁死时（拦截所有 cookie）：不白屏，音乐照开，只是记不住", async () => {
    const boom = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    const { audio } = mount();
    await click(button());
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(audio().getAttribute("src")).toBe(LOBBY);
    expect(get).toHaveBeenCalled();
    expect(set).toHaveBeenCalled();
  });

  it("图标不进 a11y 树：可及名只由 aria-label 给", () => {
    const { container } = mount();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(named("打开背景音乐")).toBe(button());
  });

  it("与「记录」把手同一套边缘样式（.drawer__handle 复用，不另开一处视觉）", () => {
    mount();
    expect(button().className.split(" ")).toEqual(["drawer__handle", "handle--bgm"]);
  });
});
