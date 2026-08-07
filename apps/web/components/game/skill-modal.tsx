"use client";

import { useId, useState } from "react";
import { CREED, CREED_FOOTNOTE, skillById } from "@/lib/skills";
import { Emphasis } from "../emphasis";
import { Modal } from "./modal";

/** 发动按钮：0–2 条，全部由调用方从 `legalActions` 算好递进来——弹窗不判合法性。 */
export type SkillAction = {
  key: string;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onActivate: () => void;
};

type Props = {
  /** 引擎 id（"diamond-3"）。null = 这局没技能。 */
  skillId: string | null;
  revealed: boolean;
  /** 快照的 `players[].activatedThisTurn`：写「本回合主动 0/1」。 */
  activatedThisTurn: boolean;
  /** 快照的 `players[].marks`：标记名 → 当前余额。 */
  marks: Record<string, number>;
  /** 快照的 `players[].marksSpent`：标记名 → 累计已花。 */
  marksSpent?: Record<string, number>;
  /** 顶层 `marksCap`：**缺席 = 无上限**，不显示上限那一段，更不能显示成 0。 */
  marksCap?: Record<string, number>;
  /** 快照的 `players[].sealedBy`：被谁的血棘封的（null = 没被封）。 */
  sealedBy?: number | null;
  nameOf?: (seat: number) => string;
  /** L2：此刻不可用的原因（一句话，来自调用方）。 */
  reason?: string;
  actions?: SkillAction[];
  onClose: () => void;
};

/** 单个标记：`魂 3/6 ●●●○○○ · 已花 2`。上限缺席时只有当前值与已花，绝不写成 `/0`。 */
function Marks({ name, n, cap, spent }: { name: string; n: number; cap?: number; spent?: number }) {
  return (
    <span className="marks">
      {name}
      <span className="marks__n">{n}</span>
      {/* marksCap 里没有这个标记 = 无上限（司夜的「盗」）——整段不出现 */}
      {cap !== undefined && <span className="marks__cap">{`/${cap}`}</span>}
      <span className="pips">
        {Array.from({ length: cap ?? n }, (_, i) => (
          <i key={i} className={i < n ? "pip" : "pip pip--empty"} />
        ))}
      </span>
      {!!spent && <span className="marks__spent">{`· 已花 ${spent}`}</span>}
    </span>
  );
}

/**
 * 技能详情弹窗：座位卡上的技能徽与坞左槽点的都是它（`design/mockups/game-status.html`）。
 * 一个壳装四份内容——主动带标记 / 被动带标记 / 纯被动无按钮 / 主动但发动入口在坞里。
 *
 * 挂载即打开（`<Modal>` 的约定：focus trap / Esc / 背景 inert 都由原生 `<dialog>` 给），
 * 关闭由父组件卸载它。
 */
export function SkillModal({
  skillId,
  revealed,
  activatedThisTurn,
  marks,
  marksSpent,
  marksCap,
  sealedBy,
  nameOf = (seat) => `座位 ${seat + 1}`,
  reason,
  actions = [],
  onClose,
}: Props) {
  const [tab, setTab] = useState<"skill" | "creed">("skill");
  const titleId = useId();
  const skillPanelId = useId();
  const creedPanelId = useId();
  const skill = skillById(skillId);

  // 标记有过就该露面（余额 0 但花过 2 仍要写「0 · 已花 2」），所以两张表取并集
  const markNames = Object.keys({ ...marks, ...marksSpent });
  const status =
    sealedBy != null
      ? `被${nameOf(sealedBy)}的血棘封印了 · 解封条件：${nameOf(sealedBy)}改封别人`
      : revealed
        ? "正常 · 未被封印"
        : "未亮出 · 亮出来才会生效";

  return (
    <Modal className="modal--skill" labelledBy={titleId} eyebrow="技能" onClose={onClose}>
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "skill"}
          aria-controls={skillPanelId}
          onClick={() => setTab("skill")}
        >
          技能
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "creed"}
          aria-controls={creedPanelId}
          onClick={() => setTab("creed")}
        >
          四句总则
        </button>
      </div>

      <div className="tabpanel" id={skillPanelId} role="tabpanel" hidden={tab !== "skill"}>
        <div className="sk__head">
          <span className="sk__sigil">{skill?.sigil}</span>
          <h2 id={titleId}>{skill?.name ?? "没有技能"}</h2>
          {/* 「主动 ×2」的计数来自**引擎定义**的 `effects[]` 条数（`skillById` 已经数好），
              不是 lib/skills.ts 那张按钮文案表——那张只写「多条主动分别叫什么」。
              只有一条子效果时不写 ×1（设计稿 game-status.html 的恩惠/精英两张卡）。 */}
          {skill && (
            <span className="badge">{skill.effectCount > 1 ? `${skill.kind} ×${skill.effectCount}` : skill.kind}</span>
          )}
          <span className="badge" data-tone={revealed ? "ok" : undefined}>
            {revealed ? "已亮出" : "未亮出"}
          </span>
        </div>
        <p className="sk__l0">{skill ? <Emphasis text={skill.l0} /> : "这局你没有技能。"}</p>
        {skill && (
          <p className="sk__l1">
            <Emphasis text={skill.l1} />
          </p>
        )}

        <div className="sk__meta">
          <div>
            <span>本回合主动</span>
            <span className="num">{`${activatedThisTurn ? 1 : 0} / 1`}</span>
          </div>
          <div>
            <span>标记</span>
            {markNames.length === 0 ? (
              <span className="muted">此技能没有标记</span>
            ) : (
              markNames.map((name) => (
                <Marks key={name} name={name} n={marks[name] ?? 0} cap={marksCap?.[name]} spent={marksSpent?.[name]} />
              ))
            )}
          </div>
          <div>
            <span>状态</span>
            <span className="muted">{status}</span>
          </div>
        </div>

        {actions.length > 0 ? (
          <div className="sk__acts">
            {actions.map((a) => (
              <button
                key={a.key}
                type="button"
                className={a.primary ? "btn btn--primary btn--block" : "btn btn--block"}
                disabled={a.disabled}
                onClick={a.onActivate}
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : (
          skill?.kind === "被动" && (
            <p className="hint" style={{ marginTop: "var(--sp-3)" }}>
              被动技能：不用手动发动
            </p>
          )
        )}
        {reason && <p className="sk__l2">{reason}</p>}
      </div>

      <div className="tabpanel" id={creedPanelId} role="tabpanel" hidden={tab !== "creed"}>
        <ol className="creed">
          {CREED.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        <p>
          {CREED_FOOTNOTE.text}
          <span className="muted">{CREED_FOOTNOTE.aside}</span>
        </p>
        {/* 二十个技能的全表在百科页（与这里同一份 `lib/skills.ts`，不会说两套话）。
            **另开一页**：牌桌是活的，导航走了就把这一桌的实时连接一起带走了。
            落在「总则」这一页而不是技能那一页：那边下半截是发动按钮，多一条出口会抢手。 */}
        <p className="hint">
          <a href="/encyclopedia" target="_blank" rel="noopener noreferrer">
            查看全部技能与规则（新开一页）→
          </a>
        </p>
      </div>
    </Modal>
  );
}
