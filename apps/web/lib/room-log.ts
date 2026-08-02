"use client";

import type { Card, ClientSnapshot, Color } from "@roft/engine";
import { useEffect, useRef, useState } from "react";
import { cardLabel, colorLabel } from "@/lib/cards";
import { skillById } from "@/lib/skills";
import { createClient } from "@/lib/supabase/client";

/** room_events 的成员可读投影（private_payload 列级 grant 已排除，查不到）。 */
interface LogEvent {
  id: number;
  seq: number;
  type: string;
  public_payload: Record<string, unknown>;
}

const asCard = (v: unknown) => cardLabel(v as Card);

/**
 * 事件 → 人话 + 分类（分类只管左缘颜色）。返回 null = 不值得进日志（handDealt 等）。
 * 只消费 public_payload——private 列根本查不到，这里天然只含公开信息。
 */
function humanize(
  e: LogEvent,
  nameOf: (seat: number) => string,
): { who: string; what: string; kind?: "punish" | "skill" | "uno" | "system" } | null {
  const p = e.public_payload;
  const seat = p.seat as number;
  const skillName = (id: unknown) => skillById(String(id))?.name ?? String(id);
  switch (e.type) {
    case "gameStarted":
      return { who: "牌桌", what: `开局：每人 ${p.handSize} 张`, kind: "system" };
    case "draftStarted":
      return { who: "牌桌", what: "抽 3 选 1：各自挑技能", kind: "system" };
    case "skillChosen":
      return { who: nameOf(seat), what: p.byTimeout ? "超时，技能已代选" : "选好了技能", kind: "skill" };
    case "draftFinished":
      return { who: "牌桌", what: "全员选完技能，开打", kind: "system" };
    case "cardPlayed": {
      const color = p.chosenColor ? `，定色${{ R: "红", B: "蓝", Y: "黄", G: "绿" }[p.chosenColor as string] ?? ""}` : "";
      // 并列♥4 起改成了整组 `cards`；`card` 是它之前的单张写法，老事件还留在库里
      const cards = (p.cards as Card[] | undefined) ?? [p.card as Card];
      return { who: nameOf(seat), what: `打出 ${cards.map(asCard).join("、")}${color}` };
    }
    case "cardsDrawn":
      return { who: nameOf(seat), what: `摸了 ${p.count} 张` };
    case "turnEnded":
      return { who: nameOf(seat), what: "结束回合" };
    case "deckReshuffled":
      return { who: "牌桌", what: `洗回 ${p.count} 张进摸牌堆`, kind: "system" };
    // U8：牌堆洗满两次后又见底，无人打完 → 平局收场
    case "gameDrawn":
      return { who: "牌桌", what: "牌堆用尽，本局平局", kind: "system" };
    case "punishWindowOpened":
      return { who: nameOf((p.actors as number[])[0]), what: `被惩罚指向（累计 ${p.total} 张）：叠或吃`, kind: "punish" };
    case "punishStackChosen":
      return { who: nameOf(seat), what: "选择接着叠", kind: "punish" };
    case "punishAccepted":
      return { who: nameOf(seat), what: `吃下惩罚 ${p.total} 张`, kind: "punish" };
    case "skillRevealed":
      return { who: nameOf(seat), what: `亮出技能 ${skillName(p.skillId)}`, kind: "skill" };
    case "skillActivated":
      return { who: nameOf(seat), what: `发动 ${skillName(p.skillId)}`, kind: "skill" };
    case "cardsDiscarded":
      return { who: nameOf(seat), what: `弃了 ${(p.cards as Card[]).map(cardLabel).join("、")}`, kind: "skill" };
    // 影歌♦3：宣言是当众的，所以它只在日志里露面（快照不需要它——可点性由 legalActions 给）
    case "soulHarvestStarted":
      return { who: nameOf(seat), what: `指定 ${asCard(p.declared)}：其他人依次亮牌或摸牌`, kind: "skill" };
    case "soulHarvestResponse":
      return {
        who: nameOf(seat),
        what: p.card ? `亮出 ${asCard(p.card)}` : "不亮牌，摸 3 张",
        kind: "skill",
      };
    case "soulHarvestEnded":
      return { who: nameOf(seat), what: `攒到 ${p.gained} 个魂（共 ${p.souls} 个）`, kind: "skill" };
    // 强袭♦1：骰子是当众掷的，两次（原掷 + 接管重掷）都在日志里看得见
    case "diceRolled":
      return {
        who: nameOf(seat),
        what: `${String(p.reason).endsWith("-takeover") ? "重掷" : "掷骰"} ${(p.values as number[]).join("、")}`,
        kind: "skill",
      };
    case "diceTakeoverOpened":
      return { who: nameOf((p.actors as number[])[0]), what: "可以重掷这次骰子", kind: "skill" };
    // 血棘♦2：封印与解封都是公开状态（03 §4）
    case "sealed":
      return { who: nameOf(seat), what: `被${nameOf(p.by as number)}封印了技能`, kind: "skill" };
    case "sealLifted":
      return {
        who: nameOf(seat),
        what: p.reason === "replaced" ? "解封了（血棘改封了别人）" : "解封了（自己发起了惩罚）",
        kind: "skill",
      };
    // 司夜♣3：标记的获得与花费是公开计数（03 §5）；换牌只公开「谁与谁换了 1 张」
    case "marksGained":
      return { who: nameOf(seat), what: `获得 ${p.n} 个「${p.mark}」（共 ${p.total} 个）`, kind: "skill" };
    case "marksSpent":
      return { who: nameOf(seat), what: `花掉 ${p.n} 个「${p.mark}」（还剩 ${p.total} 个）`, kind: "skill" };
    case "stealSwapDrawn":
      return { who: nameOf(seat), what: `从${nameOf(p.target as number)}手里盲抽了 1 张`, kind: "skill" };
    case "stealSwapReturned":
      return { who: nameOf(seat), what: `还了${nameOf(p.target as number)} 1 张`, kind: "skill" };
    // 抽到/还了哪张只有双方知道：那两条事件只有 private，公开侧没有内容可写
    case "stealSwapPeek":
      return null;
    // 劫营♦10：并列是一张张摆的，每张落地都可能给出一次打断机会（01-G5）
    case "raidWindowOpened":
      return { who: nameOf((p.actors as number[])[0]), what: `可以用同色同数的牌打断${asCard(p.card)}`, kind: "skill" };
    case "raided":
      return {
        who: nameOf(p.by as number),
        what: `打出 ${asCard(p.card)} 打断了${nameOf(p.target as number)}：对方摸 1 张，从劫营者的下家继续`,
        kind: "skill",
      };
    // 洗牌（05 §2b）：谁拿到哪张只有本人知道，公开的只有每人的**张数**
    case "handsShuffled":
      return {
        who: nameOf(seat),
        what: `洗牌：全体手牌打乱重分（${(p.counts as number[]).map((n, i) => `${nameOf(i)} ${n} 张`).join("、")}）`,
      };
    case "shuffleDiscardOpened":
      return { who: nameOf(seat), what: "洗牌·摸一弃一：摸完了，正在挑要弃的牌" };
    case "shuffleCancelWindowOpened":
      return {
        who: nameOf(seat),
        what: `打出洗牌：${(p.actors as number[]).map(nameOf).join("、")}手上有洗牌牌，可以取消`,
      };
    case "shuffleCancelled":
      return {
        who: nameOf(p.by as number),
        what: `打出 ${asCard(p.card)}（定色${colorLabel(p.color as Color)}）取消了${nameOf(
          p.target as number,
        )}的洗牌：手牌一张没动，从取消者的下家继续`,
      };
    case "turnSkipped":
      return { who: nameOf(seat), what: "花魂跳过本回合", kind: "skill" };
    case "unoCalled":
      return { who: nameOf(seat), what: "喊了 UNO！", kind: "uno" };
    // U6：按钮常亮、引擎按下那一刻才判，所以「喊早了」是一条正常事件，不是拒因
    case "unoMiscalled":
      return { who: nameOf(seat), what: "虚喊 UNO（手牌不是 1 张）——罚摸 2 张", kind: "uno" };
    case "unoCaught":
      return { who: nameOf(seat), what: `抓了${nameOf(p.target as number)}没喊 UNO——摸 2 张`, kind: "uno" };
    // 发牌/候选细节要么是暗信息、要么是纯噪音
    case "handDealt":
    case "draftOptionsDealt":
      return null;
    default:
      return { who: "牌桌", what: e.type, kind: "system" };
  }
}

export type LogLine = { who: string; what: string; kind?: "punish" | "skill" | "uno" | "system" };

/** 纯展示层：设计对照页（/design/game）与真实数据层共用同一份 DOM。 */
export function LogPanelView({ lines }: { lines: { id: number; line: LogLine }[] }) {
  return (
    <aside className="log-panel" aria-label="行动记录">
      <div className="log-head">
        <h2>行动记录</h2>
        <span className="hint">最新在上 · 只含公开信息</span>
      </div>
      <ol className="log-list">
        {lines.map(({ id, line }) => (
          <li key={id} data-kind={line.kind}>
            <span className="who">{line.who}</span>
            <span className="what">{line.what}</span>
          </li>
        ))}
        {lines.length === 0 && <li data-kind="system"><span className="what">还没有动静。</span></li>}
      </ol>
    </aside>
  );
}

export function LogPanel({ roomId, snapshot, names }: {
  roomId: string;
  snapshot: ClientSnapshot;
  names: Record<string, string>;
}) {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const topSeq = useRef(0);

  // 快照 version 一动必有新事件（同一事务写入）——增量拉 seq 更大的那截
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("room_events")
        .select("id, seq, type, public_payload")
        .eq("room_id", roomId)
        .gt("seq", topSeq.current)
        .order("seq", { ascending: true })
        .limit(200);
      if (!data?.length) return;
      // `topSeq.current` 是读改写竞态：查询读它、await 之后才写它，两次 effect 一重叠
      // （StrictMode 二次挂载、或 version 连着跳）就都读到旧值、拉回同一批行。
      // 所以两处都按幂等写：seq 只许涨，合并按 id 去重——重复拉取变成无害的空操作。
      topSeq.current = Math.max(topSeq.current, data[data.length - 1].seq);
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const fresh = data.filter((e) => !seen.has(e.id)).reverse();
        return fresh.length ? [...fresh, ...prev].slice(0, 120) : prev;
      });
    })();
  }, [roomId, snapshot.version]);

  const nameOf = (seat: number) => names[snapshot.players[seat]?.userId ?? ""] ?? `座位 ${seat + 1}`;
  const lines = events
    .map((e) => ({ id: e.id, line: humanize(e, nameOf) }))
    .filter((x): x is { id: number; line: LogLine } => x.line !== null);

  return <LogPanelView lines={lines} />;
}
