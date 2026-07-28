"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callEdge, humanReason } from "@/lib/api";

export default function LobbyForms() {
  const router = useRouter();
  const [rulePack, setRulePack] = useState("base");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy("create");
    setError(null);
    const res = await callEdge<{ code: string }>("create-room", { rulePack });
    if (!res.ok) {
      setBusy(null);
      setError(humanReason(res.reason));
      return;
    }
    router.push(`/room/${res.data.code}`);
  }

  async function join() {
    setBusy("join");
    setError(null);
    const res = await callEdge<{ code: string }>("join-room", { code: code.trim().toUpperCase() });
    if (!res.ok) {
      setBusy(null);
      setError(humanReason(res.reason));
      return;
    }
    router.push(`/room/${res.data.code}`);
  }

  return (
    <>
      <div className="cols">
        <section className="panel">
          <p className="eyebrow">开一桌</p>
          <h2>创建房间</h2>
          <hr className="rail" />

          <fieldset>
            <legend>规则包</legend>
            <label className="opt">
              <input
                type="radio"
                name="pack"
                value="base"
                checked={rulePack === "base"}
                onChange={() => setRulePack("base")}
              />
              <span className="opt-title">基础包</span>
              <small className="opt-note">UNO 牌 + 首批 10 个技能。</small>
            </label>
            {/*
              诸神包禁用中：牌堆里的毒与洗牌引擎还没有任何行为，选了会当普通变色牌打出去，
              规则静默跑错——比报错更糟，牌桌上没人会发现。等这两张牌与四神实现后再开。
            */}
            <label className="opt opt--disabled">
              <input type="radio" name="pack" value="gods" disabled />
              <span className="opt-title">诸神包</span>
              <small className="opt-note">开发中：毒 / 洗牌与四神尚未实现，暂不可选。</small>
            </label>
          </fieldset>

          <fieldset>
            <legend>技能获取</legend>
            <div className="fixed-row">
              <b>抽 3 选 1</b>
              <span className="hint">本版本固定</span>
            </div>
          </fieldset>

          <button className="btn btn--primary btn--block" onClick={create} disabled={busy !== null}>
            {busy === "create" ? "开桌中…" : "创建房间"}
          </button>
        </section>

        <section className="panel">
          <p className="eyebrow">加入一桌</p>
          <h2>加入房间</h2>
          <hr className="rail" />
          <label htmlFor="code" className="hint">
            输入房主给的 6 位房间码
          </label>
          <input
            id="code"
            className="code-input"
            type="text"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="KX7Q2M"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="btn btn--block"
            onClick={join}
            disabled={busy !== null || code.trim().length !== 6}
          >
            {busy === "join" ? "入座中…" : "加入房间"}
          </button>
        </section>
      </div>

      {error && (
        <p className="hint" role="alert" style={{ color: "var(--danger-text)", marginTop: "var(--sp-3)" }}>
          {error}
        </p>
      )}
    </>
  );
}
