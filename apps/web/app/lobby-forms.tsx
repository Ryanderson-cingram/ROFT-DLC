"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { callEdge, humanReason } from "@/lib/api";

export default function LobbyForms() {
  const router = useRouter();
  // 零硬编码 id（spec §7.2）：这一份表单眼下只渲染一次，但重复 id 是那种
  // 「哪天被复用才炸、炸了还只在读屏上炸」的 bug，一行 useId 就不用再想它。
  const codeId = useId();
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
              诸神包开放（2026-08-01）：`rulePack: "gods"` 今天**只多出 8 张牌**——毒 5 张 + 洗牌 3 张
              （deck.ts::buildDeck），两张的行为与全部窗口都已落地并有引擎测试 + fuzz 覆盖。
              四神与预兆♣9 还没有；技能抽池不看 rulePack（loadSkills 只按「机制齐备」筛），
              所以两个包能抽到的技能**完全一样**。文案必须把这点说死，否则「诸神包」三个字
              本身就是误导——名字来自 KB 的分包，不是「能抽到神」。
            */}
            <label className="opt">
              <input
                type="radio"
                name="pack"
                value="gods"
                checked={rulePack === "gods"}
                onChange={() => setRulePack("gods")}
              />
              <span className="opt-title">诸神包</span>
              <small className="opt-note">
                基础包 + 毒 5 张 / 洗牌 3 张（共 172 张）。技能池与基础包相同——四神与预兆尚未实现。
              </small>
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
          <label htmlFor={codeId} className="hint">
            输入房主给的 6 位房间码
          </label>
          <input
            id={codeId}
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
