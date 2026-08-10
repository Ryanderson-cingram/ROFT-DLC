"use client";

import type { Card } from "@roft/engine";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { CardFace } from "./card-face";

/** jsdom 没实现 `showModal()`（浏览器都有）——退回 `open` 属性，测试照样查得到内容。 */
const openModal = (d: HTMLDialogElement) => (d.showModal ? d.showModal() : d.setAttribute("open", ""));

/**
 * 全屏弹窗：只给「此刻本来就不需要看手牌」的场合（抽 3 选 1 / 牌堆全貌 / 技能详情）。
 * 要手牌全程可见的用 `<Sheet>`（spec §3.4）。
 *
 * 原生 `<dialog>` + `showModal()`：focus trap、Esc、背景 inert 全是浏览器白送的（spec §7.1）。
 * **挂载即打开**——关闭由父组件卸载它，动效也就跟着重播（spec §6）。
 */
export function Modal({
  label,
  labelledBy,
  className,
  eyebrow,
  role,
  onClose,
  children,
}: {
  /** 弹窗的无障碍名。内容里已有 `<h2>` 的改用 `labelledBy`（id 必须来自 `useId()`）。 */
  label?: string;
  labelledBy?: string;
  /** 设计稿的变体类（`modal--skill` / `modal--pile`），加在 `.modal` 上。 */
  className?: string;
  eyebrow?: ReactNode;
  /**
   * 盖掉原生 `<dialog>` 的隐含 `role="dialog"`。目前只有报错弹窗用得上——
   * `alertdialog` 才是「出事了，读屏该立刻打断去念它」的那个角色。
   */
  role?: "alertdialog";
  /** 不给 = 这个弹窗必须选完才能走（抽 3 选 1），连 Esc 也挡掉。 */
  onClose?: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) openModal(d);
  }, []);

  return (
    <dialog
      ref={ref}
      className={className ? `modal ${className}` : "modal"}
      role={role}
      aria-label={label}
      aria-labelledby={labelledBy}
      // 点遮罩关闭：模态 dialog 上，落在 .modal__box 之外的点击 target 就是 dialog 自己
      onClick={(e) => e.target === ref.current && onClose?.()}
      // Esc 一律转成 onClose，原生的关闭动作挡掉：开合的唯一真相是「挂没挂载」，
      // 否则父组件还挂着、dialog 却自己关了 → 一个看不见的空壳
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
    >
      <div className="modal__box">
        {(eyebrow != null || onClose) && (
          <div className="sk__bar">
            <p className="eyebrow">{eyebrow}</p>
            {onClose && (
              <button type="button" className="btn btn--ghost" style={{ minHeight: 36 }} onClick={onClose}>
                关闭
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </dialog>
  );
}

/**
 * 牌堆全貌：出牌堆与弃牌堆两个页签，**都按「旧 → 新」呈现**。
 * `playedPile[0]` 是牌顶（新 → 旧，与 `discardPile` 方向相反，见 `types.ts`），所以要 `reverse()`。
 *
 * 摸牌堆**没有**这个入口：它是暗信息，牌桌上只给厚度与张数（spec §5 #1）。
 */
export function PileModal({
  playedPile,
  discardPile,
  initial = "play",
  onClose,
}: {
  playedPile: Card[];
  discardPile: Card[];
  /** 从哪一堆的「查看全部」点进来的（两个页签都在，只是先落在这一个上）。 */
  initial?: "play" | "discard";
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"play" | "discard">(initial);
  const playId = useId();
  const discardId = useId();

  const piles = [
    { key: "play" as const, id: playId, label: "出牌堆", cards: [...playedPile].reverse(), tip: "牌顶", tone: "ok" },
    { key: "discard" as const, id: discardId, label: "弃牌堆", cards: discardPile, tip: "最新", tone: undefined },
  ];

  return (
    <Modal label="牌堆完整列表" className="modal--pile" eyebrow="牌堆" onClose={onClose}>
      <div className="tabs" role="tablist" aria-label="切换牌堆">
        {piles.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={tab === p.key}
            aria-controls={p.id}
            onClick={() => setTab(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {piles.map((p) => (
        <div key={p.key} className="tabpanel" id={p.id} role="tabpanel" hidden={tab !== p.key}>
          <h2>{`${p.label} · ${p.cards.length} 张（旧 → 新）`}</h2>
          <div className="picks">
            {p.cards.map((c) => (
              <CardFace key={c.id} card={c} />
            ))}
            {p.cards.length > 0 && (
              <span className="badge" data-tone={p.tone}>
                {p.tip}
              </span>
            )}
          </div>
        </div>
      ))}

    </Modal>
  );
}
