"use client";

import type { Card } from "@roft/engine";
import { type ReactNode, useId } from "react";
import { CardFace } from "./card-face";
import { useBump } from "@/lib/use-bump";

type Props = {
  /** 堆名（「摸牌堆」/「出牌堆」/「弃牌堆」）。画在堆下面那行，也用来拼 aria-label。 */
  label: string;
  /** 堆名后面那一小截（出牌堆的顶牌：「出牌堆 · **红 7**」）。 */
  sub?: string;
  count: number;
  /** 顶牌。缺席 = 画牌背（摸牌堆）；`null` = 空堆（虚线框）。 */
  top?: Card | null;
  /** 顶牌放大一档（`.pile--top`）。 */
  big?: boolean;
  /**
   * 展开时浮出的最近几张，**按「旧 → 新」给**。
   * 缺席 = 这堆**没有**展开入口——摸牌堆是暗信息，它不是 `<button>`、没有 `.fan`、
   * 也没有 `.fan__more`（spec §5 #1 的口径）。
   */
  fan?: Card[];
  /**
   * 扇形开着没有。**开关不自持**：窄屏的 `.fan` 是 `position: fixed` 的定点，
   * 两堆各持一个 `open` 就会同时浮出来、在同一处叠成两层（第 5 条 UI 反馈）。
   * 由 `<CardRiver>` 统一持一个「哪一堆开着」，天然互斥。
   */
  open?: boolean;
  onToggle?: () => void;
  /** 展开面板右端那个放大图标；P3 接「牌堆全貌」弹窗。 */
  onOpen?: () => void;
  /** 堆下面额外的一行（出牌堆的跟色跟数）。 */
  children?: ReactNode;
};

/** 厚度封顶 6 层：再厚也画不出区别，`--depth` 只是「厚不厚」的示意。 */
const DEPTH_CAP = 6;

/**
 * 一堆牌（design/mockups/game.html 的 `.pile`）。三堆同构：厚度 + 张数徽 + 顶牌。
 * 桌面 hover / 触屏点击都能浮出 `.fan`（CSS 管 hover，`data-open` 管点击）。
 */
export function Pile({ label, sub, count, top, big, fan, open = false, onToggle, onOpen, children }: Props) {
  const fanId = useId();
  const className = ["pile", big && "pile--top", count === 0 && "pile--empty"].filter(Boolean).join(" ");
  const depth = { "--depth": Math.min(count, DEPTH_CAP) } as React.CSSProperties;
  // 张数变了闪一下（`.is-bump`）：厚度封顶 6 层之后，「堆变薄了」只有这个数字看得出来
  const countBump = useBump(count, "pile__count");

  const inner = (
    <>
      <span className="pile__stack">
        {/* `key={top.id}`：换顶牌 = 换元素，CSS 的 rise 才会重播。同一个 <CardFace> 换 props
            只是更新，动画一次都不会跑——那正是「出牌了但牌河一点动静都没有」的成因。 */}
        {count > 0 && (top === undefined ? <CardFace /> : top && <CardFace card={top} key={top.id} />)}
        {count > 0 && <span {...countBump}>{count}</span>}
      </span>
      <span className="pile__label">
        {label}
        {sub && (
          <>
            {" · "}
            <b>{sub}</b>
          </>
        )}
      </span>
      {children}
    </>
  );

  if (!fan)
    return (
      <div className={className} style={depth} aria-label={`${label} ${count} 张`}>
        {inner}
      </div>
    );

  return (
    <button
      type="button"
      className={className}
      style={depth}
      data-fan
      data-open={open || undefined}
      aria-expanded={open}
      aria-controls={fanId}
      onClick={onToggle}
    >
      {inner}
      <span className="fan" id={fanId} role="group" aria-label={`${label}最近 ${fan.length} 张（旧 → 新）`}>
        {fan.map((c) => (
          <CardFace card={c} key={c.id} />
        ))}
        {onOpen && (
          /* 堆本身已经是 `<button>`，这里不能再嵌一个（设计稿也是 role=button 的 span） */
          <span
            className="fan__more"
            role="button"
            tabIndex={0}
            aria-label={`查看全部 ${count} 张`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              onOpen();
            }}
          />
        )}
      </span>
    </button>
  );
}
