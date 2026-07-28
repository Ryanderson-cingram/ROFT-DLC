"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "./login.css";

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const username = name.trim();
    // profiles.username 的 check 约束是 2–24 字；先在这里拦，别让「凛」撞 500。
    if (username.length < 2 || username.length > 24) {
      setError("昵称要 2–24 个字。单字太短了，加一个字吧。");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInAnonymously();
    if (authError || !data.user) {
      setBusy(false);
      setError("登录没成功，稍后再试一次。");
      return;
    }
    const { error: profileError } = await supabase
      .from("profiles")
      .upsert({ id: data.user.id, username });
    if (profileError) {
      setBusy(false);
      setError("这个昵称存不下来：" + profileError.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="wrap login">
      <div className="fan" aria-hidden="true">
        <span className="card" data-color="green" data-face="7" />
        <span className="card" data-color="yellow" data-face="+2" />
        <span className="card" data-color="wild" data-face="+4" />
      </div>
      <p className="eyebrow">ROFT-DLC · 诸神降临 4.1</p>
      <h1>先取个名字</h1>
      <p className="hint">同桌的人靠这个认出你。不用注册，也不用邮箱。</p>

      <form className="panel" onSubmit={submit}>
        <label htmlFor="nickname" className="hint">
          昵称（2–24 个字）
        </label>
        <input
          id="nickname"
          className="name-input"
          type="text"
          maxLength={24}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：阿柴"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        {error && (
          <p className="hint" role="alert" style={{ color: "var(--danger-text)" }}>
            {error}
          </p>
        )}
        <button className="btn btn--primary btn--block" disabled={busy}>
          {busy ? "进桌中…" : "进入大厅"}
        </button>
      </form>
    </main>
  );
}
