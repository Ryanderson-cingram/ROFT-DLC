"use client";

import type { ReactNode } from "react";
import { useId } from "react";

/**
 * 不遮手牌的升起面板（spec §3.4 第 4 行）：宣言盘 / 洗牌三选一。
 *
 * **头号命题**：遮罩是 `.scrim--table`（`bottom: var(--dock-h)`），只盖牌桌区；
 * 面板从坞**上方**升起，手牌与命令坞在它下面完整露出。要全屏遮罩的场合用 `<Modal>`。
 * 类名逐字对照 `design/mockups/game-choose.html` 的 J / L 两态。
 *
 * 非模态（`aria-modal="false"`）是故意的：决定在盘里做、提交在坞上按，
 * 坞必须一直可点可聚焦，所以这里不能用原生 `<dialog>` 的 `showModal()`。
 */
export function Sheet({
  eyebrow,
  title,
  lead,
  onCancel,
  children,
}: {
  eyebrow?: ReactNode;
  title: string;
  lead?: ReactNode;
  /** 点遮罩（牌桌区）取消。不给 = 这个面板只能靠坞上的按钮收场。 */
  onCancel?: () => void;
  children?: ReactNode;
}) {
  const titleId = useId();
  return (
    <>
      <section className="sheet" role="dialog" aria-modal="false" aria-labelledby={titleId}>
        <div className="sheet__in">
          {/* 眉标 + 标题 + 关闭键是**不滚动的那一截**：内容长起来（宣言盘 36 张牌）时，
              收场的出口不能跟着滚出视野——底部那个「先不发动」在手机上正好在折线以下。 */}
          <div className="sheet__head">
            <div>
              {eyebrow != null && <p className="eyebrow">{eyebrow}</p>}
              <h2 id={titleId}>{title}</h2>
            </div>
            {onCancel && (
              <button type="button" className="sheet__close" aria-label="关闭" onClick={onCancel}>
                ×
              </button>
            )}
          </div>
          {lead != null && <p className="lead">{lead}</p>}
          <div className="sheet__body">{children}</div>
        </div>
      </section>
      {/* aria-hidden 的取消热区：AT 用户走坞上的按钮，不靠点遮罩（设计稿同款） */}
      <div className="scrim scrim--table" aria-hidden="true" onClick={onCancel} />
    </>
  );
}
