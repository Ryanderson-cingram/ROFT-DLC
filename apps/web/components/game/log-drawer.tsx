"use client";

import type { ClientSnapshot } from "@roft/engine";
import { useEffect, useId, useRef } from "react";
import { useRoomLog } from "@/lib/room-log";

/**
 * 行动记录抽屉：右缘把手 + offcanvas + backdrop（`design/mockups/game.html`）。
 * 桌面与手机同一套——旧的 300px 右栏整个消失（spec §2 bug 2）。
 *
 * 开关不自持：`open` 由页面给，把手点开 (`onOpen`)、遮罩/关闭/Esc 收起 (`onClose`)。
 * 内容走 `useRoomLog()`——跑马灯与抽屉共用同一份真相，两处永远说同一句话。
 */
export function LogDrawer({
  open,
  onOpen,
  onClose,
  roomId,
  snapshot,
  names,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  roomId: string | null;
  snapshot: ClientSnapshot;
  names: Record<string, string>;
}) {
  const drawerId = useId();
  const lines = useRoomLog(roomId, snapshot, names);
  const handleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // 遮罩的可见性由 body[data-drawer] 驱动（globals.css 的 .drawer-scrim 规则）
  useEffect(() => {
    document.body.dataset.drawer = open ? "open" : "closed";
  }, [open]);

  // 打开时焦点进抽屉，关闭时还给把手（首次挂载不抢焦点）
  useEffect(() => {
    if (open) closeRef.current?.focus();
    else if (wasOpen.current) handleRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // Esc 关闭。抽屉不是 <dialog>（它不遮全屏、也不该 inert 掉牌桌），所以这条要自己接
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <button
        ref={handleRef}
        type="button"
        className="drawer__handle"
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={onOpen}
      >
        记录
      </button>
      {/* 纯压暗热区：AT 与键盘走 Esc 或抽屉里的「关闭」，所以它 aria-hidden 且不接键盘 */}
      <div className="drawer-scrim" aria-hidden="true" onClick={onClose} />
      {/* 收起时整块 inert：屏幕外的抽屉不该还能被 Tab 走到（spec §7） */}
      <aside className="drawer" id={drawerId} aria-label="行动记录" data-open={open || undefined} inert={!open}>
        <div className="drawer__head">
          <h2>行动记录</h2>
          <span className="hint">最新在上 · 只含公开信息</span>
          <button ref={closeRef} type="button" className="drawer__close" aria-label="关闭记录" onClick={onClose}>
            ×
          </button>
        </div>
        <ol className="log">
          {lines.map(({ id, line }) => (
            <li key={id} data-kind={line.kind}>
              <span className="who">{line.who}</span>
              <span className="what">{line.what}</span>
            </li>
          ))}
          {lines.length === 0 && (
            <li data-kind="system">
              <span className="what">还没有动静。</span>
            </li>
          )}
        </ol>
      </aside>
    </>
  );
}
