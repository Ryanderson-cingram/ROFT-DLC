"use client";

import { useId, useState } from "react";
import type { ChannelError } from "@/lib/game-channel";
import { Modal } from "./modal";

/**
 * 服务端报错（2026-08-10）。从前它是 `.game-page` 最后一行小字，而底坞是
 * `position: sticky; bottom: 0`、牌桌 `flex: 1 0 auto` 不压缩——那行字于是落在
 * 粘性底坞**下方**，手机上在折线以外，不一路滚到页面最底根本看不见。
 *
 * 壳是 `<Modal>`：原生 `<dialog>` 的 focus trap / Esc / 背景 inert 全是浏览器给的。
 * `role="alertdialog"` 盖掉隐含的 `dialog`——这是出事了，不是普通对话框。
 *
 * **两档出口按错误来源分**（`ChannelError.kind`）：
 * - `action`：你那一步被拒，牌面是新的 → 只需要「知道了」。
 * - `sync`：拉快照失败或撞上 409，**屏幕上的牌面可能是陈的** → 多给一条重载出口，
 *   不能只让人关掉了事（关掉之后页面还在骗他）。
 *
 * 不自动关闭：报错要玩家确认过。倒计时窗口挂着时它会挡住操作一瞬——可接受，
 * 错误只在玩家刚点过之后出现，而 `claimTimeout` 由定时器发，模态挡不住它。
 */
export function ErrorModal({
  error,
  onClose,
  onReload,
}: {
  error: ChannelError;
  onClose: () => void;
  /** `sync` 那一档的「重新载入牌面」。异步失败照旧由 `error` 自己再报一次。 */
  onReload?: () => void | Promise<void>;
}) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const stale = error.kind === "sync";

  return (
    <Modal className="modal--error" labelledBy={titleId} role="alertdialog" eyebrow="出错了" onClose={onClose}>
      <div className="errbox">
        {/* 标题说的是**这次出错意味着什么**，正文才是服务端那句人话。
            两档分开写：「没成功」与「你看到的可能不是现在的牌面」要采取的行动不一样。 */}
        <h2 id={titleId}>{stale ? "牌面可能不是最新的" : "这一步没成功"}</h2>
        <p>{error.text}</p>
        {stale && onReload && (
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onReload();
              onClose();
            }}
          >
            重新载入牌面
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
          知道了
        </button>
      </div>
    </Modal>
  );
}
