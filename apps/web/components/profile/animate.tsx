"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 命盘上唯一需要 JS 的两件事：进视口才演、数字滚上去。
 *
 * **没有引入 GSAP**（+70KB）——弧线、60 齿依次点亮、封泥盖章全部是 CSS 动画，
 * 靠 `animation-delay` 排队，这里只负责「什么时候开始」。
 * 要更复杂的编排（时间轴反转、滚动擦洗）再上库，那一天会自己到来。
 *
 * 关掉动效的人（prefers-reduced-motion）走的是同一条路：
 * CSS 那边把 animation 全关掉，`data-in` 照写不误，所以内容一定是可见的
 * ——动画只负责「怎么出现」，从来不负责「出不出现」。
 */

/** 进视口一次就够，之后不再观察。`rootMargin` 让它在露头之前就起跑，滚到位时正好演完。 */
function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    // 没有 IntersectionObserver（很老的浏览器 / jsdom）就直接当作已经看见了：
    // 宁可不演，也不能把内容永远藏起来
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        setSeen(true);
        io.disconnect();
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, seen };
}

/** 进视口时给自己挂上 `data-in`，CSS 拿它当动画的起跑枪。 */
export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const { ref, seen } = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={className} data-in={seen || undefined}>
      {children}
    </div>
  );
}

const fmt = (v: number, dec: number) =>
  v.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * 滚表。`value` 为 null 时显示 `—`——「还没打过」不是「0」，
 * 这条口径在 `profile-view.ts` 里定的，这里只是不把它弄丢。
 *
 * 服务端渲染出的就是**最终值**：JS 没跑起来（或还没水合）时页面是对的，
 * 水合之后才从 0 滚上去。反过来写（先渲染 0）会让禁用 JS 的人看到一屏 0。
 */
export function Count({ value, dec = 0, suffix }: { value: number | null; dec?: number; suffix?: string }) {
  const { ref, seen } = useInView<HTMLSpanElement>();
  const [shown, setShown] = useState<number | null>(value);

  useEffect(() => {
    if (value === null || !seen) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setShown(value);

    let raf = 0;
    const t0 = performance.now();
    const DURATION = 900;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION);
      // easeOutCubic：起步快、收尾稳，数字停下来的那一下才看得清
      setShown(value * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, seen]);

  return (
    <span ref={ref} className="num">
      {shown === null ? "—" : fmt(shown, dec)}
      {shown !== null && suffix ? <i className="unit">{suffix}</i> : null}
    </span>
  );
}
