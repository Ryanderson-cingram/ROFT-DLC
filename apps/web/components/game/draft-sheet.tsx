"use client";

import { useEffect, useState } from "react";
import { skillById } from "@/lib/skills";

/**
 * 开局抽 3 选 1（S1）。候选与截止时间来自快照；选定即发 respond，
 * 到点自动 claimTimeout（服务端会给没选的人代选第一个候选）。
 */
export function DraftSheet({
  options,
  picked,
  deadline,
  onPick,
  onExpire,
}: {
  /** 自己的候选（引擎技能 id）。空数组 = 这局池子不够，你无技能开局。 */
  options: string[];
  /** 自己已经交卷（不在窗口 actors 里了）。 */
  picked: boolean;
  deadline?: string;
  onPick: (skillId: string) => void;
  onExpire?: () => void;
}) {
  const skills = options.map((id) => ({ id, s: skillById(id) }));
  const [choice, setChoice] = useState(options[0] ?? "");
  const [sent, setSent] = useState(false);

  // 客户端催促（spec §7）：窗口到点自动发 claimTimeout，谁先到谁生效
  useEffect(() => {
    if (!deadline || !onExpire) return;
    const ms = Date.parse(deadline) - Date.now();
    const t = setTimeout(onExpire, Math.max(ms, 0) + 500);
    return () => clearTimeout(t);
  }, [deadline, onExpire]);

  const waiting = picked || options.length === 0;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="draft-title">
      <div className="sheet">
        <div className="sheet-top">
          <p className="eyebrow">开局 · 抽 3 选 1</p>
          <span className="hint">{waiting ? "等其他玩家选完" : "超时会自动选第一个"}</span>
        </div>
        {waiting ? (
          <>
            <h2 id="draft-title">{picked ? "选好了" : "这局没有技能给你"}</h2>
            <p className="lead">
              {picked
                ? "你的技能已到手——先不亮出，别人看不到。等全员选完就开打。"
                : "可抽的技能不够分，这局你没有技能。规则照常，等全员选完就开打。"}
            </p>
          </>
        ) : (
          <>
            <h2 id="draft-title">挑一个技能带上桌</h2>
            <p className="lead">整局只有这一个技能，亮出来才生效。</p>
            <div className="draft">
              {skills.map(({ id, s }) => (
                <label className="draft-opt" key={id}>
                  <input
                    type="radio"
                    name="draft"
                    checked={choice === id}
                    onChange={() => setChoice(id)}
                  />
                  <span className="sigil">{s?.sigil ?? "?"}</span>
                  <h3>{s?.name ?? id}</h3>
                  <p>{s?.l0}</p>
                </label>
              ))}
            </div>
            <div className="draft-foot">
              <span className="hint">已选：{skillById(choice)?.name ?? "—"}</span>
              <button
                className="btn btn--primary"
                disabled={!choice || sent}
                onClick={() => {
                  setSent(true);
                  onPick(choice);
                }}
              >
                确认
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
