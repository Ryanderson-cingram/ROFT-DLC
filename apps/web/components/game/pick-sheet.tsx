"use client";

import type { Card } from "@roft/engine";
import { useId } from "react";
import { COLORS } from "@/lib/cards";
import { CardFace } from "./card-face";

/**
 * 「从一排牌里挑一张」的全屏面板。四处共用它，原先是 page 里四段逐字重复的 overlay：
 *
 * - 服务端窗口：司夜♣3②还牌、洗牌②弃牌（可选的是哪几张来自 `legalActions`，没有取消键）
 * - 提交前的本地选择：恒心♠1 弃 1、影歌♦3①宣言（能反悔，所以有取消键）
 *
 * 挑哪张、挑完发什么一律由调用方决定：组件不判合法性、不发请求，只把选中的那张交回去。
 */
export function PickSheet({
  eyebrow,
  title,
  lead,
  cards,
  layout = "hand",
  onPick,
  onCancel,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  cards: Card[];
  /** `declare` = 影歌①那 40 张的密排网格；默认是手牌那一排。 */
  layout?: "hand" | "declare";
  onPick: (card: Card) => void;
  /** 只有「提交前的本地选择」能反悔；服务端窗口开着的时候没有退出键。 */
  onCancel?: () => void;
}) {
  const titleId = useId();
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="sheet">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
        <p className="lead">{lead}</p>
        <div className={layout}>
          {cards.map((card) => (
            <CardFace key={card.id} card={card} legal onClick={() => onPick(card)} />
          ))}
        </div>
        {onCancel && (
          <button className="btn btn--ghost btn--block" onClick={onCancel}>
            先不发动
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 可以被宣言的牌面：四色 × 0–9（影歌①限数字牌）。只是给面板画的假牌，不进任何请求——
 * 提交时取的是选中那张的 `color` + `face`（= 动作里的 `declared`）。
 */
export const DECLARABLE: Card[] = COLORS.flatMap(({ value }) =>
  Array.from(
    { length: 10 },
    (_, n): Card => ({ id: `declare-${value}${n}`, color: value, face: String(n) as Card["face"] }),
  ),
);
