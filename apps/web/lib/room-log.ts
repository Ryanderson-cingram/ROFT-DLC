"use client";

/**
 * 行动记录的数据与文案（原 `components/game/log-panel.tsx`）。
 * 它们是「引擎事件 → 玩家语言」的翻译层，不是视图——所以住在 `lib/`。
 * 消费者：`<LogDrawer>`（整份）与 `<Ticker>`（最近一条），两处永远说同一句话。
 */

import type { Card, ClientSnapshot, Color } from "@roft/engine";
import { useEffect, useRef, useState } from "react";
import { cardLabel, colorLabel, faceLabel } from "./cards";
import { skillById } from "./skills";
import { createClient } from "./supabase/client";

/** room_events 的成员可读投影（private_payload 列级 grant 已排除，查不到）。 */
export interface LogEvent {
  id: number;
  seq: number;
  type: string;
  public_payload: Record<string, unknown>;
}

/**
 * 一整条日志的渲染共用它。**缺字段时给一句占位、绝不抛**：`humanize` 在 `<LogDrawer>` 与
 * `<Ticker>` 的 render 里跑，抛一次就是整页白屏（引擎把 `raidWindowOpened` 的 `card`
 * 改名成 `cards` 那次正是这样炸的，服务端一条错都不会有）。
 */
const asCard = (v: unknown) => (v ? cardLabel(v as Card) : "某张牌");
/** 同上：payload 里那一格不是数组（改名了、老事件没有）也不许把 `.map` 抛到 render 里。 */
const asList = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * 事件 → 人话 + 分类（分类只管左缘颜色）。返回 null = 不值得进日志（handDealt 等）。
 * 只消费 public_payload——private 列根本查不到，这里天然只含公开信息。
 */
export function humanize(
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
      const cards = asList<Card>(p.cards ?? [p.card]);
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
      return { who: nameOf(asList<number>(p.actors)[0]), what: `被惩罚指向（累计 ${p.total} 张）：叠或吃`, kind: "punish" };
    case "punishStackChosen":
      return { who: nameOf(seat), what: "选择接着叠", kind: "punish" };
    case "punishAccepted":
      return { who: nameOf(seat), what: `吃下惩罚 ${p.total} 张`, kind: "punish" };
    // 远星♦J：弃代价牌 + 摸 2 张 = 视为跟着叠了一段。摸的那 2 张另有 cardsDrawn 事件，这里不重复写
    case "farstarUsed":
      return {
        who: nameOf(seat),
        what: `远星：弃 ${asList<Card>(p.discarded).map(asCard).join("、")}，视为跟着叠了一张${
          colorLabel(p.color as Color)
        } ${faceLabel(p.as as Card["face"])}`,
        kind: "skill",
      };
    case "skillRevealed":
      return { who: nameOf(seat), what: `亮出技能 ${skillName(p.skillId)}`, kind: "skill" };
    case "skillActivated":
      return { who: nameOf(seat), what: `发动 ${skillName(p.skillId)}`, kind: "skill" };
    case "cardsDiscarded":
      return { who: nameOf(seat), what: `弃了 ${asList<Card>(p.cards).map(asCard).join("、")}`, kind: "skill" };
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
        what: `${String(p.reason).endsWith("-takeover") ? "重掷" : "掷骰"} ${asList<number>(p.values).join("、")}`,
        kind: "skill",
      };
    case "diceTakeoverOpened":
      return { who: nameOf(asList<number>(p.actors)[0]), what: "可以重掷这次骰子", kind: "skill" };
    // 03 §4 的状态是公开的（八门♠8②的五彩、寄生的心盲…）。谁给的走 skillId
    case "statusGranted":
      return { who: nameOf(seat), what: `${skillName(p.skillId)}：获得「${p.status}」`, kind: "skill" };
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
    // 劫营♦10：窗口针对刚落地的**那几张**（并列 = 整组，单张 = 牌顶）。
    // `card` 是 2026-08-02「并列整组落地」之前的单张写法，老事件还留在库里（同 cardPlayed）
    case "raidWindowOpened": {
      const cards = asList<Card>(p.cards ?? [p.card]);
      return {
        who: nameOf(asList<number>(p.actors)[0]),
        what: `可以用同色同数的牌打断${cards.map(asCard).join("、")}`,
        kind: "skill",
      };
    }
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
        what: `洗牌：全体手牌打乱重分（${asList<number>(p.counts).map((n, i) => `${nameOf(i)} ${n} 张`).join("、")}）`,
      };
    // 吟游♣5（04 ♣5 / 01-S20）：选/切换歌声是当众的（全场都吃它的效果）
    case "optionChosen":
      return { who: nameOf(seat), what: `${skillName(p.skillId)}：改唱「${p.key}」`, kind: "skill" };
    // 近卫♥6（01-P12）：交的是自己手牌、给链首。交了几张公开，交的是哪几张只有两人知道
    case "handOverOpened":
      return { who: nameOf(seat), what: `近卫：最多可交 ${p.max} 张手牌给${nameOf(p.target as number)}`, kind: "skill" };
    case "cardsHandedOver":
      return { who: nameOf(seat), what: `交了 ${p.count} 张手牌给${nameOf(p.target as number)}`, kind: "skill" };
    case "handOverKept":
      return { who: nameOf(seat), what: "一张也不交", kind: "skill" };
    // 合纵♠5 / 连横♠6①（01-S13/S13b）：结盟当众成立，换的是**整副手牌**（张数公开、内容不公开）
    case "allianceWindowOpened":
      return { who: nameOf(seat), what: `${nameOf(p.by as number)}亮出了另一半：要不要相应结盟`, kind: "skill" };
    case "allianceFormed":
      return {
        who: asList<number>(p.seats).map(nameOf).join("、"),
        what: "结盟：此后各自回合开始都能互换整副手牌",
        kind: "skill",
      };
    case "allianceRefused":
      return { who: nameOf(seat), what: "不相应（这一桌从此各算各的）", kind: "skill" };
    case "handsSwapped":
      return {
        who: asList<number>(p.seats).map(nameOf).join("、"),
        what: `互换整副手牌（${asList<number>(p.seats).map((x, i) => `${nameOf(x)} ${asList<number>(p.counts)[i]} 张`).join("、")}）`,
        kind: "skill",
      };
    // 「要不要摸 N 弃 N」：合纵/连横②（S14）与神授♥5（S17b）共用同一个窗口，所以不提触发者
    case "drawOfferOpened":
      return { who: nameOf(seat), what: `可以摸 ${p.picks} 张再弃 ${p.picks} 张（也可以不摸）`, kind: "skill" };
    case "drawOfferDeclined":
      return { who: nameOf(seat), what: "这次不摸弃", kind: "skill" };
    // 摸 N 弃 N（03 §2）：摸了几张有自己的 cardsDrawn，这条只说「正在挑弃哪几张」
    case "drawDiscardOpened":
      return { who: nameOf(seat), what: `摸完了：正在挑要弃的 ${p.picks ?? 1} 张牌` };
    case "shuffleCancelWindowOpened":
      return {
        who: nameOf(seat),
        // 谁手上有洗牌牌是暗信息（手牌私有），所以不点名、也不报人数——
        // 引擎那边这条事件的 public payload 从 2026-08-02 起就不带 actors 了
        what: "打出洗牌（全体手牌打乱重分）：等其他人决定要不要取消",
      };
    case "shuffleCancelled":
      return {
        who: nameOf(p.by as number),
        what: `打出 ${asCard(p.card)}（定色${colorLabel(p.color as Color)}）取消了${nameOf(
          p.target as number,
        )}的洗牌：手牌一张没动，从取消者的下家继续`,
      };
    // 异议♥8①：反转方向 + 跳过自己，链一张不动地弹回上家
    case "dissentUsed":
      return { who: nameOf(seat), what: "异议：把这串惩罚原样弹回给上家", kind: "skill" };
    case "turnSkipped":
      return { who: nameOf(seat), what: "花魂跳过本回合", kind: "skill" };
    case "unoCalled":
      return { who: nameOf(seat), what: "喊了 UNO！", kind: "uno" };
    // U6：按钮常亮、引擎按下那一刻才判，所以「喊早了」是一条正常事件，不是拒因
    case "unoMiscalled":
      return { who: nameOf(seat), what: "回合结束时手牌不是 1 张，喊的 UNO 不作数——罚摸 2 张", kind: "uno" };
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

/**
 * 行动记录的**唯一数据源**：记录抽屉与轮转轨下沿的跑马灯都读它，所以两处永远说同一句话。
 * 返回值最新在前（`[0]` 就是跑马灯要的那条）。
 *
 * ponytail: 两个消费者各自跑一份 effect = 每次 version 变动多一次同样的增量查询。
 * P3 把日志态收上 `page.tsx` 之后这里换成一个 provider 即可。
 */
export function useRoomLog(
  roomId: string | null | undefined,
  snapshot: ClientSnapshot,
  names: Record<string, string>,
): { id: number; line: LogLine }[] {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const topSeq = useRef(0);

  // 快照 version 一动必有新事件（同一事务写入）——增量拉 seq 更大的那截
  useEffect(() => {
    if (!roomId) return;
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
  return events
    .map((e) => ({ id: e.id, line: humanize(e, nameOf) }))
    .filter((x): x is { id: number; line: LogLine } => x.line !== null);
}
