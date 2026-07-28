"use client";

import type { Action, Card, ClientSnapshot } from "@roft/engine";
import { CardFace } from "./card-face";
import { AlertBar } from "./alert-bar";
import { colorLabel } from "@/lib/cards";
import { CREED, skillById } from "@/lib/skills";

type Props = {
  snapshot: ClientSnapshot;
  /** 快照只带 userId，昵称由调用方从 room_seats join profiles 映射。 */
  names: Record<string, string>;
  onPlay: (card: Card) => void;
  onAction: (action: Action) => void;
  onExpire?: () => void;
};

const PHASES = ["回合开始\n用技能", "出牌 / 摸牌", "结算", "回合结束"];
const PHASE_STEP: Record<ClientSnapshot["phase"], number> = {
  lobby: 0, dealing: 0, turnStart: 0, play: 1, afterPlay: 2, finished: 3,
};

/** 窗口选项的人话。查不到就把 choice 原样显示，总比空按钮强。 */
const CHOICE_LABEL: Record<string, string> = {
  stack: "接着叠",
  accept: "吃下",
  interrupt: "劫营打断",
  pass: "放弃",
};

export function Hud({ snapshot, names, onPlay, onAction, onExpire }: Props) {
  const s = snapshot;
  const nameOf = (seat: number) => names[s.players[seat]?.userId ?? ""] ?? `座位 ${seat + 1}`;
  const you = s.players.find((p) => p.seat === s.youSeat);
  const yourTurn = s.currentSeat === s.youSeat;
  const window = s.pendingWindow;
  const youAreActor = !!window?.actors.includes(s.youSeat);

  // 可打高亮一律来自 legalActions —— 组件内不做任何合法性判断。
  const playable = new Set(s.legalActions.flatMap((a) => (a.type === "playCards" ? a.cardIds : [])));
  const buttons = s.legalActions.filter((a) => a.type !== "playCards");
  const skill = skillById(you?.skillId ?? null);

  const say = (() => {
    if (s.winner != null) return `${nameOf(s.winner)}赢了这一局。`;
    if (window && youAreActor)
      return window.type === "punishStack"
        ? `被 +2/+4 了：接着叠，或者吃下 ${s.punish?.total ?? 0} 张`
        : `等待你响应：${nameOf(s.currentSeat ?? 0)}打出了牌，这一轮只等你要不要打断`;
    if (window) return `等${window.actors.map(nameOf).join("、")}响应，其他操作先停下`;
    if (!yourTurn) return `${nameOf(s.currentSeat ?? 0)}的回合，等一等`;
    if (s.drawnPlayable) return "刚摸到的这张能打：打它，或者结束回合";
    return "你的回合：挑一张能打的牌，或者摸牌";
  })();

  return (
    <>
      {window && youAreActor && (
        <AlertBar
          tone={window.type === "punishStack" ? "punish" : "react"}
          deadline={window.deadline}
          text={say}
          onExpire={onExpire}
        />
      )}

      <main className="table">
        <section className="opponents">
          {s.players
            .filter((p) => p.seat !== s.youSeat)
            .map((p) => (
              <div className={`opp${p.seat === s.currentSeat ? " opp--acting" : ""}`} key={p.seat}>
                <span className="who">{nameOf(p.seat)}</span>
                <span className="hand-count">
                  手牌 <b>{p.handCount}</b>
                </span>
                <span className={`skillchip${p.skillId ? "" : " skillchip--hidden"}`}>
                  <span className="sigil">{skillById(p.skillId)?.sigil ?? "?"}</span>
                  {p.skillId ?? "未亮出"}
                </span>
                <span className="tags">
                  {p.saidUno && (
                    <span className="badge" data-tone="ok">
                      已喊 UNO
                    </span>
                  )}
                  {p.ascensions > 0 && (
                    <span className="badge">
                      神化{" "}
                      <span className="pips">
                        {Array.from({ length: p.ascensions }, (_, i) => <i className="pip" key={i} />)}
                      </span>
                    </span>
                  )}
                </span>
              </div>
            ))}
        </section>

        <section className="center">
          <div className="slot">
            <CardFace />
            <span>牌堆 {s.drawPileCount}</span>
          </div>
          <div className="dirs" title="出牌方向">
            {s.direction === 1 ? "↻" : "↺"}
          </div>
          <div className="slot">
            {s.discardTop ? <CardFace card={s.discardTop} /> : <CardFace />}
            <span>
              牌顶
              {s.activeColor && s.activeColor !== s.discardTop?.color && ` · 当前色 ${colorLabel(s.activeColor)}`}
            </span>
          </div>
        </section>

        {s.punish && (
          <div className="chain">
            {s.punish.segments.map((seg, i) => (
              <span className="seg" key={i}>
                {i > 0 && <span className="arrow">→</span>}
                {nameOf(seg.seat)} <b>{seg.face}</b>
              </span>
            ))}
            <span className="total">累计 {s.punish.total} 张</span>
          </div>
        )}

        <section>
          <div className="turnline">
            <span className="owner">{yourTurn ? "你的回合" : `${nameOf(s.currentSeat ?? 0)}的回合`}</span>
            <span className="hint">v{s.version}</span>
          </div>
          <ol className="phase">
            {PHASES.map((p, i) => (
              <li key={p} className={i === PHASE_STEP[s.phase] ? "phase--now" : undefined}>
                {p.split("\n").map((line, j) => (
                  <span key={j}>
                    {j > 0 && <br />}
                    {line}
                  </span>
                ))}
              </li>
            ))}
          </ol>
          <p className="hudsay">{say}</p>
        </section>

        <details className="rules panel">
          <summary>四句总则</summary>
          <ol>
            {CREED.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </details>

        <section className="mine">
          {skill && (
            <div className="skillcard">
              <div className="sc-head">
                <span className="sigil">{skill.sigil}</span>
                <h3>{skill.name}</h3>
                <span className="badge" data-tone="ok">
                  已亮出
                </span>
              </div>
              <p className="l0">{skill.l0}</p>
              <details className="l1">
                <summary>细则</summary>
                <p>{skill.l1}</p>
              </details>
              {window?.type === "punishStack" && youAreActor && <p className="l2">惩罚回合不能用主动技能</p>}
            </div>
          )}

          <div className="hand-wrap">
            <div className="hand-meta">
              <span>
                你的手牌 <b className="count">{s.yourHand.length}</b>
              </span>
              <span>{playable.size > 0 ? "高亮 = 现在能打" : "这一轮没有能打的牌"}</span>
            </div>
            <div className="hand">
              {s.yourHand.map((card) => {
                const legal = playable.has(card.id);
                return (
                  <CardFace
                    key={card.id}
                    card={card}
                    legal={legal}
                    dim={!legal}
                    pulse={legal && !!window}
                    onClick={legal ? () => onPlay(card) : undefined}
                  />
                );
              })}
            </div>
          </div>

          <div className="actions">
            {buttons.map((a) => (
              <button
                key={a.type + ("choice" in a ? a.choice : "")}
                className={buttonClass(a)}
                onClick={() => onAction(a)}
              >
                {buttonLabel(a, s)}
              </button>
            ))}
            {s.disabledReasons.callUno && (
              <>
                <button className="btn" disabled>
                  喊 UNO
                </button>
                <p className="uno-note hint">{s.disabledReasons.callUno}</p>
              </>
            )}
          </div>
        </section>
      </main>
    </>
  );
}

function buttonLabel(a: Action, s: ClientSnapshot): string {
  switch (a.type) {
    case "drawCard":
      return "摸牌";
    case "endTurn":
      return "结束回合";
    case "claimTimeout":
      return "催促超时";
    case "respond":
      return a.choice === "accept"
        ? `吃下 ${s.punish?.total ?? 0} 张`
        : (CHOICE_LABEL[a.choice] ?? a.choice);
    default:
      return a.type;
  }
}

function buttonClass(a: Action): string {
  if (a.type === "respond" && a.choice === "accept") return "btn btn--danger";
  if (a.type === "respond" && a.choice === "pass") return "btn btn--ghost";
  if (a.type === "respond") return "btn btn--primary";
  return "btn";
}
