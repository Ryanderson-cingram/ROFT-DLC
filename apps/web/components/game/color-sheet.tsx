"use client";

import type { Card, Color } from "@roft/engine";
import { COLORS, cardFaceLabel } from "@/lib/cards";

/**
 * 定色是**提交前的客户端模态**：chosenColor 随 playCards 一起提交，
 * 契约里没有为它开服务端窗口，所以这里一个请求都不发。
 */
export function ColorSheet({
  card,
  onPick,
  onCancel,
}: {
  card: Card;
  onPick: (color: Color) => void;
  onCancel: () => void;
}) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="color-title">
      <div className="sheet">
        <p className="eyebrow">选颜色</p>
        <h2 id="color-title">你打出了 {cardFaceLabel(card)}，选择颜色</h2>
        <p className="lead">选完之后，下家要按这个颜色接牌。</p>
        <div className="colors">
          {COLORS.map((c) => (
            <button key={c.value} onClick={() => onPick(c.value)}>
              {c.label}
            </button>
          ))}
        </div>
        <button className="btn btn--ghost btn--block" onClick={onCancel}>
          先不打这张
        </button>
      </div>
    </div>
  );
}
