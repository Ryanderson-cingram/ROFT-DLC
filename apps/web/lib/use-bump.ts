"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 数字变了闪一下（globals.css 末尾的 `.is-bump`）。设计稿留了这条规则却没有触发器——
 * 它本来就是「给真实产品用」的那一条，触发只能由客户端在值变化时接。
 *
 * 两条约束：
 * 1. **首渲染不闪**——那时候没有「上一次」，一进牌桌满屏乱闪是噪音不是提示；
 * 2. 闪完把类摘掉，否则下一次变化没得重播。
 *
 * 返回的是可以直接摊到元素上的 props：`<b {...useBump(n)}>{n}</b>`。
 * `base` 是元素本来就有的类名（`useBump(n, "pile__count")`）。
 *
 * ponytail: 0.5 秒内连着变两次只闪一次。手牌数 / 堆张数 / 惩罚累计 / 标记数都跟着快照走，
 * 一秒内连跳两次的场面没有；真出现了再换成 key 重挂。
 */

/** 摘类的时机 = `.is-bump` 的动画长度（globals.css 的 `bump 0.5s`）。 */
const BUMP_MS = 500;

export function useBump(value: number, base?: string) {
  const prev = useRef(value);
  const [bump, setBump] = useState(false);

  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    setBump(true);
    // 定时器而不是 `animationend`：`prefers-reduced-motion` 下动画整个不跑，
    // 那个事件也就永远不来，类会一直挂在元素上。
    const t = setTimeout(() => setBump(false), BUMP_MS);
    return () => clearTimeout(t);
  }, [value]);

  return { className: [base, bump && "is-bump"].filter(Boolean).join(" ") || undefined };
}
