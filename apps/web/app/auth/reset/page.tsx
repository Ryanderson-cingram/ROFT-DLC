"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { authMessage } from "@/lib/auth-copy";
import { createClient } from "@/lib/supabase/client";
import "../../login/login.css";

/**
 * 重设密码的落点：邮件里那条链接指到这里。
 *
 * 这一页**不自己兑换 code**——`createBrowserClient` 的 `detectSessionInUrl` 默认开着，
 * 页面一加载它就把 `?code=` 换成会话了；再手动 `exchangeCodeForSession()` 只会撞上
 * 「这个 code 已经用过」。所以这里只问一句「现在有会话吗」，有就让改密码。
 *
 * 于是有会话的人直接打开本页也能改密码——那正是「修改密码」该有的样子，
 * 不必为它再做一页（`secure_password_change = false`，不需要重新验证）。
 *
 * PKCE 的 code_verifier 存在**发起重设的那个浏览器**里，所以换个浏览器点链接会没有会话——
 * 那种情况老老实实说链接用不了，别装作是密码错了。
 */
const MIN_PW = 6;

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const pwId = useId();

  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [caps, setCaps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setReady(Boolean(data.user));
    })();
  }, [supabase]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PW) {
      setError(`密码至少 ${MIN_PW} 位。`);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setBusy(false);
      setError(authMessage(updateError));
      return;
    }
    // 密码改完人已经是登录态了，直接进大厅——再让他登一次是纯摩擦
    router.replace("/");
    router.refresh();
  }

  return (
    <>
      <div className="sky" aria-hidden="true">
        <span className="plate plate--outer" />
        <span className="plate plate--inner" />
      </div>

      <main className="login">
        <div className="login__in">
          <div className="cardfan" aria-hidden="true">
            <span className="card" data-color="green" data-face="7" />
            <span className="card" data-color="yellow" data-face="+2" />
            <span className="card" data-color="wild" data-face="+4" />
            <span className="card" data-color="red" data-face="停" />
            <span className="card" data-color="blue" data-face="3" />
          </div>
          <p className="eyebrow">ROFT-DLC · 诸神降临 4.1</p>

          {ready === null && <p className="hint">正在验证链接…</p>}

          {ready === false && (
            <>
              <h1>这条链接用不了</h1>
              <p className="hint">
                多半是过期了，或者是在另一个浏览器里点开的——重设链接只在发起重设的那个浏览器里有效。
                回登录页重新发一封就好。
              </p>
              <p className="foot">
                <Link href="/login">← 回登录页</Link>
              </p>
            </>
          )}

          {ready === true && (
            <>
              <h1>设个新密码</h1>
              <p className="hint">改完直接进大厅，不用再登一次。</p>

              <form className="panel" onSubmit={submit}>
                <label className="field-label" htmlFor={pwId}>
                  新密码（至少 {MIN_PW} 位）
                </label>
                <div className="field-pw">
                  <input
                    id={pwId}
                    className="field"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={MIN_PW}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))}
                    onBlur={() => setCaps(false)}
                    placeholder={`至少 ${MIN_PW} 位`}
                    autoFocus
                  />
                  <button type="button" aria-pressed={showPw} onClick={() => setShowPw(!showPw)}>
                    {showPw ? "隐藏" : "显示"}
                  </button>
                </div>
                {/* 只有一个框、可以随时亮出来看——比一个「再输一遍」的确认框管用 */}
                {caps && (
                  <p className="warn-line" role="status">
                    大写锁定开着。
                  </p>
                )}
                {error && (
                  <p className="err" role="alert">
                    {error}
                  </p>
                )}
                <button className="btn btn--primary btn--block" disabled={busy}>
                  {busy ? "改密码中…" : "改好了，进大厅"}
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </>
  );
}
