"use client";

import { useState } from "react";
import { skillById } from "@/lib/skills";

/**
 * 开局抽 3 选 1。契约里还没有 draft 的表达（没有对应 Action，快照也不带候选），
 * 所以本轮它只是静态 UI：选了不发请求。技能获取流程是下一个计划的事。
 */
// 候选先写死；技能获取流程（S1 抽 3 选 1）落地后由服务端给。
const DEFAULT_OPTIONS = ["精英", "远星", "司夜"];

export function DraftSheet({ options = DEFAULT_OPTIONS }: { options?: string[] }) {
  const skills = options.map(skillById).filter((s) => s !== undefined);
  const [picked, setPicked] = useState(skills[0]?.id ?? "");

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="draft-title">
      <div className="sheet">
        <div className="sheet-top">
          <p className="eyebrow">开局 · 抽 3 选 1</p>
          <span className="hint">其他玩家选择中</span>
        </div>
        <h2 id="draft-title">挑一个技能带上桌</h2>
        <p className="lead">整局只有这一个技能，亮出来才生效。</p>
        <div className="draft">
          {skills.map((s) => (
            <label className="draft-opt" key={s.id}>
              <input
                type="radio"
                name="draft"
                checked={picked === s.id}
                onChange={() => setPicked(s.id)}
              />
              <span className="sigil">{s.sigil}</span>
              <h3>{s.name}</h3>
              <p>{s.l0}</p>
            </label>
          ))}
        </div>
        <div className="draft-foot">
          <span className="hint">已选：{skillById(picked)?.name}</span>
          <button className="btn btn--primary" disabled>
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
