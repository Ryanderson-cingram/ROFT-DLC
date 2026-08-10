"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { authMessage } from "@/lib/auth-copy";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/client";
import "./login.css";

/**
 * 两步：先拿到会话（邮箱 + 密码），再确保有名字。
 *
 * 「取名」是**独立的一步**而不是注册表单里的第三个框：大厅那边
 * 「有会话、没 profile」也会打回这里（`app/page.tsx` 的 `if (!profile) redirect`），
 * 那种人已经登录了，再给他看一遍邮箱密码框是没道理的。所以进门先 `getUser()`
 * 问一句到底在哪一步——这也是注册完直接落到取名的那条路。
 */
type Step = "checking" | "auth" | "name";

/** config.toml 的 `auth.minimum_password_length`。前端先拦一道，省一个来回。 */
const MIN_PW = 6;

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const emailId = useId();
  const pwId = useId();
  const nickId = useId();

  const [step, setStep] = useState<Step>("checking");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [caps, setCaps] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * 登录完该去哪。房间页把人踢回登录时会带上 `?next=/room/KX7Q2M`——不接住的话，
   * 别人发来的房间链接在「没登录」的人手里就退化成一次大厅之旅，房间码得再要一遍。
   *
   * 用 `window.location` 而不是 `useSearchParams()`：后者会把这一页拖出静态预渲染
   * （得整页包一层 <Suspense>），而这里只需要开局读一次，不需要跟着 URL 变。
   */
  const nextRef = useRef("/");

  /** 有会话之后的岔路。有名字就走（busy 不放，页面正在跳）。 */
  const routeByProfile = useCallback(
    async (userId: string) => {
      const { data } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
      if (data) {
        router.replace(nextRef.current);
        router.refresh();
        return;
      }
      setBusy(false);
      setStep("name");
    },
    [router, supabase],
  );

  useEffect(() => {
    nextRef.current = safeNext(new URLSearchParams(window.location.search).get("next"));
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setStep("auth");
        return;
      }
      await routeByProfile(data.user.id);
    })();
  }, [supabase, routeByProfile]);

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault();
    const mail = email.trim();
    if (!mail.includes("@") || password.length < MIN_PW) {
      setError(`邮箱填完整，密码至少 ${MIN_PW} 位。`);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error: authError } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email: mail, password })
        : await supabase.auth.signUp({ email: mail, password });
    if (authError) {
      setBusy(false);
      setError(authMessage(authError));
      return;
    }
    // 开了邮箱确认时 signUp 不发会话（邮箱已被占用时也走这条，故意不告诉你占没占）
    if (!data.session) {
      setBusy(false);
      setMode("signin");
      setPassword("");
      setNotice(`确认邮件发到 ${mail} 了，点完链接回来登录。`);
      return;
    }
    await routeByProfile(data.session.user.id);
  }

  /**
   * 忘记密码：把重设链接发到邮箱，落点是 `/auth/reset`。
   *
   * 无论这个邮箱注册过没有，回话都一样——「发出去了」。Supabase 本身也不报
   * 「查无此人」，前端更不该自己加一条：那等于给外人一个查号台。
   */
  async function sendReset() {
    const mail = email.trim();
    if (!mail.includes("@")) {
      setError("先把邮箱填上，我把重设链接发过去。");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(mail, {
      redirectTo: `${window.location.origin}/auth/reset`,
    });
    setBusy(false);
    if (resetError) {
      setError(authMessage(resetError));
      return;
    }
    setNotice(`重设密码的链接发到 ${mail} 了（这个邮箱注册过的话）。链接要在同一个浏览器里打开。`);
  }

  async function submitName(e: React.FormEvent) {
    e.preventDefault();
    const username = name.trim();
    // profiles.username 的 check 约束是 2–24 字；先在这里拦，别让「凛」撞 500。
    if (username.length < 2 || username.length > 24) {
      setError("昵称要 2–24 个字。单字太短了，加一个字吧。");
      return;
    }
    setBusy(true);
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setBusy(false);
      setStep("auth");
      setError("登录状态过期了，重新登录一次。");
      return;
    }
    const { error: profileError } = await supabase
      .from("profiles")
      .upsert({ id: auth.user.id, username });
    if (profileError) {
      setBusy(false);
      setError("这个昵称存不下来：" + profileError.message);
      return;
    }
    router.replace(nextRef.current);
    router.refresh();
  }

  async function signOut() {
    await supabase.auth.signOut();
    setStep("auth");
    setName("");
    setPassword("");
    setError(null);
    setNotice(null);
  }

  function switchMode(next: "signin" | "signup") {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  const signup = mode === "signup";

  return (
    <>
      {/* 签名母题：两圈反向缓转的式盘，纯装饰 */}
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

          {step === "checking" && <p className="hint">正在确认登录状态…</p>}

          {step === "auth" && (
            <>
              <h1>{signup ? "开个账号" : "回到牌桌"}</h1>
              <p className="hint">
                {signup ? `一个邮箱、一个密码（至少 ${MIN_PW} 位）。` : "邮箱和密码，进门就落座。"}
              </p>

              <form className="panel" onSubmit={submitAuth}>
                <div className="tabs">
                  <button type="button" aria-pressed={!signup} onClick={() => switchMode("signin")}>
                    登录
                  </button>
                  <button type="button" aria-pressed={signup} onClick={() => switchMode("signup")}>
                    注册
                  </button>
                </div>

                <label className="field-label" htmlFor={emailId}>
                  邮箱
                </label>
                <input
                  id={emailId}
                  className="field"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  spellCheck={false}
                  autoFocus
                />

                <div className="field-line">
                  <label className="field-label" htmlFor={pwId}>
                    密码
                  </label>
                  {!signup && (
                    <button type="button" className="linkish" onClick={sendReset} disabled={busy}>
                      忘记密码？
                    </button>
                  )}
                </div>
                <div className="field-pw">
                  <input
                    id={pwId}
                    className="field"
                    type={showPw ? "text" : "password"}
                    autoComplete={signup ? "new-password" : "current-password"}
                    required
                    minLength={MIN_PW}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    // 大写锁定是密码框最常见的一种「我明明没打错」。只在密码框上探，
                    // 键盘事件才拿得到 getModifierState——别处问不出来。
                    onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))}
                    onBlur={() => setCaps(false)}
                    placeholder={`至少 ${MIN_PW} 位`}
                  />
                  <button type="button" aria-pressed={showPw} onClick={() => setShowPw(!showPw)}>
                    {showPw ? "隐藏" : "显示"}
                  </button>
                </div>
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
                {notice && (
                  <p className="hint" role="status">
                    {notice}
                  </p>
                )}

                <button className="btn btn--primary btn--block" disabled={busy}>
                  {busy ? "进桌中…" : signup ? "注册并入席" : "进入大厅"}
                </button>
              </form>
              <p className="foot">私房局。邮箱只用来登录，不会收到任何邮件。</p>
            </>
          )}

          {step === "name" && (
            <>
              <h1>先取个名字</h1>
              <p className="hint">同桌的人靠这个认出你。</p>

              <form className="panel" onSubmit={submitName}>
                <label className="field-label" htmlFor={nickId}>
                  昵称（2–24 个字）
                </label>
                <input
                  id={nickId}
                  className="field field--big"
                  type="text"
                  required
                  minLength={2}
                  maxLength={24}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：阿柴"
                  autoComplete="nickname"
                  spellCheck={false}
                  autoFocus
                />
                {error && (
                  <p className="err" role="alert">
                    {error}
                  </p>
                )}
                <button className="btn btn--primary btn--block" disabled={busy}>
                  {busy ? "进桌中…" : "进入大厅"}
                </button>
              </form>
              <p className="foot">
                不是你的账号？
                <button type="button" className="linkish" onClick={signOut}>
                  退出登录
                </button>
              </p>
            </>
          )}
        </div>
      </main>
    </>
  );
}
