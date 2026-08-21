"use client";

import type { ClientSnapshot } from "@roft/engine";
import { useEffect, useRef, useState } from "react";
import { globalPicks } from "@/lib/skills";

/**
 * 背景音乐：场上唱哪一支歌声就放哪一曲（spec `2026-08-19-bard-bgm`）。
 *
 * **零规则**：要的东西快照里已经有了——歌声选中的那一支存在 `ClientSnapshot.chosen`，
 * 牌桌上那枚歌声徽（`<GlobalPick>`）读的也是它，所以这里与那枚徽是**同一份真相的两种渲染**，
 * 永远同步。这个文件里唯一有判断的地方是 `bgmFor()`，它是纯的。
 *
 * 一颗 `<audio>` 换 `src`，不是四颗：iOS 的「首次手势解锁」是**按元素**记的，
 * 四颗元素得解锁四次，改唱必然哑一次。
 */

/**
 * 四支歌声各自的曲子。key 逐字等于 `Board.chosen` 里的选项名（04 ♣5 的卡面原文）。
 *
 * 这张表同时是**白名单**：`Board.chosen` 那个槽既装色也装选项名（专精♥9 亮出时写的是
 * 颜色码），所以「查得到曲子」才是放不放的判据——不认技能 id，与 `<GlobalPick>` 同口径。
 */
const TRACKS: Record<string, string> = {
  活泼板: "/bgm/huopoban.mp3",
  战争序: "/bgm/zhanzhengxu.mp3",
  樱时雨: "/bgm/yingshiyu.mp3",
  行进曲: "/bgm/xingjinqu.mp3",
};

/** 没有歌声时的常驻曲（无歌声是初始态，多数局全程如此）。 */
const LOBBY = "/bgm/lobby.mp3";

/** 开关偏好。默认「静」——首次进牌桌不出声，点了才响。 */
const PREF = "roft:bgm";

/*
  偏好的读写各包一层：浏览器设成「拦截所有 cookie」时，`localStorage` 一碰就抛 SecurityError。
  整张牌桌不该因为一个音乐偏好白屏——读不到就当没开过，写不进就只是记不住。
*/
const readPref = () => {
  try {
    return localStorage.getItem(PREF) === "on";
  } catch {
    return false;
  }
};
const writePref = (on: boolean) => {
  try {
    localStorage.setItem(PREF, on ? "on" : "off");
  } catch {
    // 记不住而已，音乐照放
  }
};

/** 背景音乐压在人声/音效之下的常规响度。iOS 上 `volume` 只读，那边由素材本身的响度决定。 */
const VOLUME = 0.35;

export type BgmTrack = { src: string; paused: boolean; name: string | null };

/**
 * 此刻该放哪一支、要不要停。**本模块唯一的判断**，所以它是纯函数、单测直打。
 *
 * 封印（06-Q65 只压制不清值）→ 暂停而不是换曲：`src` 不变 ⇒ 解封时从原处续上，
 * 与牌桌上那枚歌声徽「退成灰但不撤」同一个口径。
 */
export function bgmFor(s: ClientSnapshot): BgmTrack {
  const pick = globalPicks(s).find((p) => p.key in TRACKS);
  if (!pick) return { src: LOBBY, paused: false, name: null };
  const sealed = !!s.players.find((p) => p.seat === pick.seat)?.statuses.includes("封印");
  return { src: TRACKS[pick.key], paused: sealed, name: pick.key };
}

export function Bgm({ snapshot }: { snapshot: ClientSnapshot }) {
  // 首帧一律「静」：偏好读的是 localStorage，写进 useState 初值会让 SSR 与首帧对不上
  const [on, setOn] = useState(false);
  const ref = useRef<HTMLAudioElement>(null);
  // `a.src` 读回来是解析过的绝对地址，拿它跟相对路径比永远不相等 → 每次副作用都会重设 src（= 重头放）
  const cur = useRef("");
  const { src, paused, name } = bgmFor(snapshot);

  useEffect(() => setOn(readPref()), []);

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    a.volume = VOLUME;
    // 关掉/被封印都只 pause：`src` 与播放位置留着，再开是从原处续上，也不重下
    if (!on || paused) {
      a.pause();
      return;
    }
    /*
      刷新页面或重进牌桌时，偏好是「开」但这一页还没有过任何手势 → `play()` 必被拒。
      挂一次性 pointerdown 补播：牌桌上一秒内必然有一次点击。
      两种拒绝（没手势 / 素材不到）都不该弹错——按钮的按下态已经把用户的意图表达完了。
    */
    const ac = new AbortController();
    const retry = () => void a.play().catch(() => {});
    void start(a, src, cur).catch(() =>
      // signal 而不是 removeEventListener：`play()` 的拒绝是异步的，可能落在卸载**之后**——
      // 那时候挂上去的监听没人摘得掉。已 abort 的 signal 让 addEventListener 直接成为空操作。
      document.addEventListener("pointerdown", retry, { once: true, signal: ac.signal }),
    );
    return () => ac.abort();
  }, [on, src, paused]);

  const toggle = () => {
    const a = ref.current;
    // iOS 要求 `play()` 发生在手势那一拍，等不到副作用，所以开的那一下这里也调一次（幂等）
    if (a && !on) void start(a, src, cur).catch(() => {});
    setOn(!on);
    writePref(!on);
  };

  return (
    <>
      {/* 不预加载：关着音乐的人一个字节都不下（五支曲共 ~17MB），`src` 到开的那一下才赋 */}
      <audio ref={ref} loop preload="none" />
      <button
        type="button"
        className="drawer__handle handle--bgm"
        aria-pressed={on}
        aria-label={on ? `关掉背景音乐（正在放：${name ?? "大厅曲"}）` : "打开背景音乐"}
        onClick={toggle}
      >
        {/* 名字由 aria-label 给（同 `.drawer__close`），图标本身不进 a11y 树 */}
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 9.5h3.2L11.5 6v12L7.2 14.5H4z" />
          {on ? <path d="M14.8 9.2a4 4 0 0 1 0 5.6" /> : <path d="M15 9.5l5 5m0-5l-5 5" />}
        </svg>
      </button>
    </>
  );
}

/** 换曲（同一支就不动，免得重头放）并起播。返回 `play()` 那个 promise，两个调用点都要接它的拒绝。 */
function start(a: HTMLAudioElement, src: string, cur: { current: string }) {
  if (cur.current !== src) {
    cur.current = src;
    a.src = src;
  }
  return a.play();
}
