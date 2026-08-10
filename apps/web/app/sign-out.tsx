"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * 退出登录。不弹二次确认——退出不丢任何东西（座位在离开房间时就交还了），
 * 再登回来还是同一个账号同一个名字。
 *
 * `refresh()` 是必须的：大厅是 Server Component，它的「有没有会话」是服务端
 * 从 cookie 读的；不刷新的话 replace 过去可能吃到缓存的那一份 RSC payload。
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      className="btn btn--ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await createClient().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      {busy ? "退出中…" : "退出登录"}
    </button>
  );
}
