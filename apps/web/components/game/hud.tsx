"use client";

import type { Action, Card, ClientSnapshot } from "@roft/engine";
import { useState } from "react";
import { CardFace } from "./card-face";
import { AlertBar } from "./alert-bar";
import { cardLabel, colorLabel, faceLabel } from "@/lib/cards";
import { CREED, effectLabel, skillById } from "@/lib/skills";

type Props = {
  snapshot: ClientSnapshot;
  /** 快照只带 userId，昵称由调用方从 room_seats join profiles 映射。 */
  names: Record<string, string>;
  onPlay: (card: Card, useSkill?: boolean) => void;
  /** 并列♥4：一次多张。合不合形状由服务端判，这里只负责把选中的牌按点选顺序交上去。 */
  onPlayMany: (cards: Card[]) => void;
  onAction: (action: Action) => void;
  onExpire?: () => void;
};

const PHASES = ["回合开始\n用技能", "出牌 / 摸牌", "结算", "回合结束"];
const PHASE_STEP: Record<ClientSnapshot["phase"], number> = {
  lobby: 0, dealing: 0, turnStart: 0, play: 1, afterPlay: 2, finished: 3,
};

/**
 * 窗口选项的人话。查不到就把 choice 原样显示，总比空按钮强。
 *
 * 导出是给覆盖率测试用的：引擎新加一个 choice 而这里没跟上，`hud.test.tsx` 就红
 * （带 `cardIds` 的那几个 choice 走手牌高亮，不出按钮，见测试里的例外表）。
 */
export const CHOICE_LABEL: Record<string, string> = {
  stack: "接着叠",
  accept: "吃下",
  // 劫营♦10 打断的 choice 是 "raid"（`actions/raid.ts::RAID`）；窗口类型才叫 interrupt
  raid: "劫营打断",
  farstar: "远星：弃代价牌，视为跟着叠",
  cancel: "取消这次洗牌",
  pass: "放弃",
  draw3: "不亮牌，摸 3 张",
  "soul-skip": "花魂跳过本回合",
  takeover: "重掷，采用我的结果",
};

export function Hud({ snapshot, names, onPlay, onPlayMany, onAction, onExpire }: Props) {
  const s = snapshot;
  const [discardOpen, setDiscardOpen] = useState(false);
  // 并列多打的本地多选：null = 没在多选。组内有的牌单打并不合法（4 张同数里只有一张接得上牌顶），
  // 所以多选模式下每张牌都可点——合法性由服务端说了算，拒了就显示 humanReason。
  const [picked, setPicked] = useState<string[] | null>(null);
  const nameOf = (seat: number) => names[s.players[seat]?.userId ?? ""] ?? `座位 ${seat + 1}`;
  const you = s.players.find((p) => p.seat === s.youSeat);
  const yourTurn = s.currentSeat === s.youSeat;
  const window = s.pendingWindow;
  const youAreActor = !!window?.actors.includes(s.youSeat);

  // 可打高亮一律来自 legalActions —— 组件内不做任何合法性判断。
  // 同一张牌的合法打法带不带 useSkill（精英把数字牌当大 1 点）由动作本身说了算。
  // 强袭♦1①的「掷骰打」是同一张牌的**另一条**动作，点牌只会按面值打，所以它不进这张表
  const playActions = new Map(
    s.legalActions.flatMap((a) =>
      a.type === "playCards" && !a.useAssault ? a.cardIds.map((id) => [id, a] as const) : [],
    ),
  );
  // 远星♦J（惩罚窗口里弃代价牌）与劫营♦10（打断窗口里打出同色同数的牌）都是按牌给出的
  // respond 动作（cardIds 在动作里），所以它们与可打的牌走同一套高亮：点哪张由 legalActions
  // 说了算，组件照旧不判合法性。
  // 洗牌③（取消别人的洗牌）也是「按牌给出的 respond」，同一套高亮，点了在 page 里先定色再提交。
  const costActions = new Map(
    window?.type === "punishStack" || window?.type === "interrupt" || window?.type === "shuffleCancel"
      ? s.legalActions.flatMap((a) =>
          a.type === "respond" && a.cardIds ? a.cardIds.map((id) => [id, a] as const) : [],
        )
      : [],
  );
  const playable = new Set([...playActions.keys(), ...costActions.keys()]);
  // 抽 3 选 1 与司夜②的还牌都由全屏面板接管，respond 候选不在 HUD 里重复出按钮。
  // 出牌一律点牌，只有强袭那条变体单独出按钮（点牌表达不了「同一张的两种打法」）。
  // U6：喊 UNO 的按钮常驻（见下方 uno 三态），不跟着 legalActions 在按钮堆里冒出来
  const callUno = s.legalActions.find((a) => a.type === "callUno");
  const buttons =
    window?.type === "skillDraft"
      ? []
      : s.legalActions.filter(
          (a) =>
            a.type !== "callUno" &&
            (a.type !== "playCards" || a.useAssault) &&
            // 还牌（司夜②）与洗牌②的弃牌都由全屏面板点牌完成，choice 是牌 id，出成按钮没法看
            !((window?.type === "swapReturn" || window?.type === "shuffleDiscard") && a.type === "respond") &&
            // 远星的代价牌已经在手牌里高亮可点了，不再重复出一排按钮
            !(a.type === "respond" && a.cardIds && costActions.size > 0),
        );
  const skill = skillById(you?.skillId ?? null);
  // 03 §4 的状态是公开的；置灰只是显示，能不能用照旧只看 legalActions
  const sealed = !!you?.statuses.includes("封印");

  const say = (() => {
    if (s.winner != null) return `${nameOf(s.winner)}赢了这一局。`;
    // U8：终局但没有赢家 = 平局（牌堆洗满两次后又见底）
    if (s.phase === "finished") return "牌摸完了，两次重洗之后还是没人打完：本局平局。";
    if (window?.type === "skillDraft") return "开局：每人挑一个技能带上桌";
    if (window && youAreActor) {
      if (window.type === "punishStack")
        return `被 +2/+4 了：接着叠，或者吃下 ${s.punish?.total ?? 0} 张${
          // 远星：合法代价牌在手牌里高亮，点一张就等于跟着叠了一张
          costActions.size > 0 ? "；也可以点高亮的牌当代价弃掉，视为你也叠了一张" : ""
        }`;
      if (window.type === "soulHarvest")
        return "轮到你了：亮一张对得上的牌，或者不亮直接摸牌（对方按此攒魂）";
      if (window.type === "swapReturn") return "盲抽完了：从手牌里挑 1 张还给对方";
      if (window.type === "shuffleDiscard") return "洗牌·摸一弃一：摸完了，从手牌里挑 1 张弃掉";
      // 洗牌①：手上有洗牌牌的人先到先得，一人取消就作废
      if (window.type === "shuffleCancel")
        return `${nameOf(s.currentSeat ?? 0)}打出了洗牌（全体手牌打乱重分）：点高亮的洗牌牌取消，或者放弃`;
      if (window.type === "diceTakeover")
        return `${nameOf(s.dice?.seat ?? 0)}掷出了 ${s.dice?.values.join("、") ?? "?"}：你可以重掷同样数量并采用你的结果`;
      // 劫营♦10：并列是一张张摆的，窗口只针对刚摆下的那张（= 牌顶）
      if (window.type === "interrupt")
        return `${nameOf(s.currentSeat ?? 0)}刚摆下一张：点高亮的牌打断这一轮，或者放弃`;
      return `等待你响应：${nameOf(s.currentSeat ?? 0)}打出了牌，这一轮只等你要不要打断`;
    }
    if (window) return `等${window.actors.map(nameOf).join("、")}响应，其他操作先停下`;
    if (!yourTurn) return `${nameOf(s.currentSeat ?? 0)}的回合，等一等`;
    if (s.drawnPlayable) return "刚摸到的这张能打：打它，或者结束回合";
    // 选了叠就得真叠出来：链没结算前摸牌不合法（P3），别再提示「或者摸牌」。
    if (s.punish) return `接着叠：打一张能接的惩罚牌（累计 ${s.punish.total} 张）`;
    return "你的回合：挑一张能打的牌，或者摸牌";
  })();

  return (
    <>
      {/*
        spec §7「任意成员都能催超时」：非 actor 也要看得见倒计时、也要能发 claimTimeout，
        否则一个 AFK 玩家能锁死全桌。文案由 say 按 youAreActor 分叉（旁观是「等 X 响应」）。
      */}
      {window && window.type !== "skillDraft" && (
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
                  {skillById(p.skillId)?.name ?? p.skillId ?? "未亮出"}
                </span>
                <span className="tags">
                  {statusesOf(p)}
                  {marksOf(p)}
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
            {s.playedTop ? <CardFace card={s.playedTop} /> : <CardFace />}
            <span>
              牌顶
              {s.activeColor && s.activeColor !== s.playedTop?.color && ` · 当前色 ${colorLabel(s.activeColor)}`}
              {/* 并列 6 张打完后要跟的是最大那个数，不是堆顶那张 */}
              {s.playedTop && s.followFace !== s.playedTop.face && ` · 跟 ${faceLabel(s.followFace)}`}
            </span>
          </div>
          <div className="slot discard-slot">
            {s.discardPile.length === 0 ? (
              <>
                <span className="discard-empty" />
                <span>弃牌堆（空）</span>
              </>
            ) : (
              <button
                type="button"
                className="discard-btn"
                title="点击查看弃牌堆（全公开）"
                onClick={() => setDiscardOpen((v) => !v)}
              >
                <span className="stack">
                  <CardFace card={s.discardPile[s.discardPile.length - 1]} />
                  <span className="discard-count">{s.discardPile.length}</span>
                </span>
                <span>弃牌堆</span>
              </button>
            )}
          </div>
        </section>

        {discardOpen && s.discardPile.length > 0 && (
          <div className="discard-open">
            <span className="hint">弃牌堆（旧 → 新）</span>
            {s.discardPile.map((c) => (
              <CardFace key={c.id} card={c} />
            ))}
            <span className="hint">弃牌不改牌顶；摸牌堆见底时洗回</span>
          </div>
        )}

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
            <div className={`skillcard${sealed ? " skillcard--sealed" : ""}`}>
              <div className="sc-head">
                <span className="sigil">{skill.sigil}</span>
                <h3>{skill.name}</h3>
                <span className="badge" data-tone={you?.revealed ? "ok" : undefined}>
                  {you?.revealed ? "已亮出" : "未亮出"}
                </span>
                {you && statusesOf(you)}
                {you && marksOf(you)}
              </div>
              <p className="l0">{skill.l0}</p>
              <details className="l1">
                <summary>细则</summary>
                <p>{skill.l1}</p>
              </details>
              {/* 01-P9：被封印期间这张卡整个是灰的（主动发不了、被动也不生效） */}
              {sealed && <p className="l2">被血棘封印：技能连被动一起关着</p>}
              {/* P1 的置灰文案：能不能用照旧只看 legalActions（影歌②就有豁免） */}
              {!sealed && window?.type === "punishStack" &&
                youAreActor &&
                costActions.size === 0 &&
                !buttons.some((a) => a.type === "respond" && a.choice === "soul-skip") && (
                  <p className="l2">惩罚回合不能用主动技能</p>
                )}
            </div>
          )}

          <div className="hand-wrap">
            <div className="hand-meta">
              <span>
                你的手牌 <b className="count">{s.yourHand.length}</b>
              </span>
              <span>
                {picked
                  ? "多打：点选 2 张同色同数 / 4 张同数 / 6 张同色"
                  : costActions.size > 0
                    ? window?.type === "interrupt"
                      ? "高亮 = 能用来打断（同色同数）"
                      : window?.type === "shuffleCancel"
                        ? "高亮 = 能用来取消这次洗牌（点了先定色）"
                        : "高亮 = 能当代价弃掉"
                    : playable.size > 0
                      ? "高亮 = 现在能打"
                      : "这一轮没有能打的牌"}
              </span>
            </div>
            <div className="hand">
              {s.yourHand.map((card) => {
                const legal = picked ? picked.includes(card.id) : playable.has(card.id);
                return (
                  <CardFace
                    key={card.id}
                    card={card}
                    legal={legal}
                    dim={!legal}
                    pulse={legal && !picked && !!window}
                    onClick={
                      picked
                        ? () =>
                            setPicked((p) =>
                              p!.includes(card.id) ? p!.filter((id) => id !== card.id) : [...p!, card.id],
                            )
                        : !legal
                          ? undefined
                          : costActions.has(card.id)
                            ? () => onAction(costActions.get(card.id)!)
                            : () => onPlay(card, playActions.get(card.id)?.useSkill)
                    }
                  />
                );
              })}
            </div>
          </div>

          <div className="actions">
            {/*
              U6（2026-08-01 二次澄清）：喊 UNO 只有两态——已喊 → 静态徽记；未喊 → **常亮可点**。
              没有「暗着」那一态了：引擎不做资格拦截，按下即受理，手牌恰 1 张则声明成立，
              不是 1 张就是虚喊、罚摸 2 张。所以唯一的防呆是把代价写在按钮旁边。

              `yourHand.length` 在这里只决定**显示不显示这句提示**，不参与任何合法性判断——
              能不能点照旧只看 legalActions 里有没有 callUno，「客户端零规则」那条没破。

              喊与出牌是两个独立动作（引擎已删掉 playCards 的 sayUno 字段）。注意宽限期（U7）**不覆盖
              普通出牌**：出牌一落地就交回合，那一声必然落在别人的回合里，与抓漏喊先到先得——所以打到
              1 张之后这个按钮要抢着点。只有「出牌后仍挂着窗口」的几条路径（并列的第 2 张、洗牌②的
              弃牌窗口、惩罚窗口）回合还没交出去，可以从容点。
            */}
            {you?.saidUno ? (
              <span className="badge" data-tone="ok">
                已喊 UNO
              </span>
            ) : callUno ? (
              <>
                <button className="btn btn--primary" onClick={() => onAction(callUno)}>
                  喊 UNO！
                </button>
                {s.yourHand.length !== 1 && (
                  <span className="badge uno-note" data-tone="warn">
                    现在喊要罚摸 2 张
                  </span>
                )}
              </>
            ) : null}
            {/* 并列多打：legalActions 不枚举组合（会爆炸），能不能多打由引擎的 canPlayMultiple 说了算 */}
            {picked === null && s.canPlayMultiple && playable.size > 0 && (
              <button className="btn" onClick={() => setPicked([])}>
                多张一起打
              </button>
            )}
            {picked !== null && (
              <>
                {picked.length > 0 && (
                  <button
                    className="btn btn--primary"
                    onClick={() => {
                      onPlayMany(picked.map((id) => s.yourHand.find((c) => c.id === id)!));
                      setPicked(null);
                    }}
                  >
                    打出 {picked.length} 张
                  </button>
                )}
                <button className="btn btn--ghost" onClick={() => setPicked(null)}>
                  取消多打
                </button>
              </>
            )}
            {buttons.map((a) => (
              <button
                key={
                a.type +
                ("choice" in a ? a.choice : "") +
                // 同一个技能的两条主动只有 effectKey 不同，不拼它就是重复 key
                ("effectKey" in a ? a.effectKey : "") +
                ("target" in a ? a.target : "") +
                ("cardIds" in a ? a.cardIds?.join() : "")
              }
                className={buttonClass(a)}
                onClick={() => onAction(a)}
              >
                {buttonLabel(a, s, nameOf)}
              </button>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

/** 03 §4 的状态是公开的（血棘的「封印」…）。快照给什么画什么，组件不认识具体状态名。 */
function statusesOf(p: ClientSnapshot["players"][number]) {
  return p.statuses.map((s) => (
    <span className="badge" data-tone="warn" key={s}>
      {s}
    </span>
  ));
}

/** 03 §5 的标记是公开计数（魂 ×3…）。0 的不画。 */
function marksOf(p: ClientSnapshot["players"][number]) {
  return Object.entries(p.marks)
    .filter(([, n]) => n > 0)
    .map(([mark, n]) => (
      <span className="badge" key={mark}>
        {mark} ×{n}
      </span>
    ));
}

function buttonLabel(a: Action, s: ClientSnapshot, nameOf: (seat: number) => string): string {
  switch (a.type) {
    // 强袭♦1①：按面值打就点牌，这个按钮是「改用掷骰定倍率」那一条
    case "playCards": {
      const c = s.yourHand.find((x) => x.id === a.cardIds[0]);
      return `掷骰打${c ? cardLabel(c) : ""}（0 / 1 / 2 倍）`;
    }
    case "drawCard":
      return "摸牌";
    case "endTurn":
      return "结束回合";
    case "claimTimeout":
      return "催促超时";
    case "catchUno":
      return `抓${nameOf(a.target)}：没喊 UNO`;
    case "revealSkill":
      return "亮出技能";
    // 司夜♣3②：花 1 盗与谁换牌是玩家的选择，所以每个目标各一个按钮
    case "stealSwap":
      return `花 1 盗与${nameOf(a.target)}换 1 张`;
    // 影歌①②是同一个技能的两条主动：标签必须按 effectKey 分（否则两个按钮字面一样）
    case "activateSkill":
      return `发动技能：${effectLabel(s.players[a.seat]?.skillId ?? null, a.effectKey)}`;
    case "respond": {
      if (a.choice === "accept") return `吃下 ${s.punish?.total ?? 0} 张`;
      // 影歌①的亮牌选项：动作自带要亮哪张，按钮就写清楚亮的是什么、亮完摸不摸
      const shown = a.cardIds && s.yourHand.find((c) => c.id === a.cardIds![0]);
      if (shown)
        return `亮出${cardLabel(shown)}${a.choice === "show-exact" ? "（同色同数，不摸牌）" : "（半匹配，摸 1 张）"}`;
      return CHOICE_LABEL[a.choice] ?? a.choice;
    }
    default:
      return a.type;
  }
}

function buttonClass(a: Action): string {
  if (a.type === "playCards") return "btn btn--primary";
  if (a.type === "respond" && a.choice === "accept") return "btn btn--danger";
  if (a.type === "respond" && a.choice === "pass") return "btn btn--ghost";
  if (a.type === "respond") return "btn btn--primary";
  if (a.type === "catchUno") return "btn btn--danger";
  return "btn";
}
