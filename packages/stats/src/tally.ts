// 相对路径而不是 `@roft/engine`：边缘函数在 Deno 下跑，那边没有 import map
// （`deno.json` 只关掉了 node_modules 解析），裸标识符解析不了。
// 既有的 `supabase/functions/*/index.ts` 也都是这么 import 引擎的，跟着走。
import type { Card, EngineEvent, GameState } from "../../engine/src/index.ts";
import type { GameFlags, SeatDelta, Tally } from "./types.ts";

/** 04 «神 四神»：四神的技能 id。见神 / 万神殿都认这四个。 */
export const GOD_SKILLS = ["god-ricin", "god-omorph", "god-fade", "god-tindra"] as const;

/** 满堂彩：单局内某一色打出到这个数才算「铺满」。 */
const SWEEP_PER_COLOR = 8;
/** 速通：赢下这一局用掉的回合数不超过它。 */
const SWIFT_TURNS = 12;
/** 反手：链的总量到这个数才算「大链」。 */
const BIG_CHAIN = 12;
/** U8：牌堆最多洗回几次（与引擎的 MAX_RESHUFFLES 同源，归墟要它）。 */
const MAX_RESHUFFLES = 2;

const zero = (): SeatDelta => ({
  games: 0, wins: 0, draws: 0, gamesFirst: 0, winsFirst: 0, turns: 0,
  cardsPlayed: 0, cardsDrawn: 0, punishTaken: 0, punishMax: 0,
  punishDeflectedMax: 0, punishDeflected: 0, mostCardsOneTurn: 0,
  unoCalled: 0, unoCaught: 0, unoGotCaught: 0, unoMiscalled: 0,
  skillsRevealed: 0, skillsActivated: 0, godsPlayed: 0,
  diceRolled: 0, diceHist: [0, 0, 0],
  alliancesFormed: 0, alliancesRefused: 0, raidsStarted: 0, marksGained: 0, sealedCount: 0,
  fastestWinTurns: null, longestGameTurns: 0,
  bySkill: {}, byCard: {}, vsPlayer: {}, withAlly: {},
});

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
/** 牌面 key：`R+2` / `W变色`。无色牌一律归到 `W`。 */
export const cardKey = (c: Card) => `${c.color ?? "W"}${c.face}`;

const bump = (m: Record<string, Tally>, key: string, won: boolean) => {
  const t = (m[key] ??= { n: 0, w: 0 });
  t.n += 1;
  if (won) t.w += 1;
};

/**
 * 把**一局**的事件流碾成每个座位的增量与特判标记。
 *
 * ⚠️ `events` 必须只含这一局：`room_events` 是按房间存的，一个房间重开多局会一直累积，
 * 调用方要按最后一次 `gameStarted` 的 seq 切一刀（见 `sliceCurrentGame`）。
 *
 * `finishedAt` 单独传而不是读 `Date.now()`——这个包是纯函数，时间是输入不是环境。
 * 守夜人那条成就是唯一用到它的地方。
 *
 * 读不到的东西一律不猜：手牌峰值要重放每一次换手/交牌才算得准，
 * 公开事件流给不出，所以**没有这一列**，而不是给一个八九不离十的数。
 */
export function tallyGame(
  events: EngineEvent[],
  final: GameState,
  finishedAt: Date,
): Map<number, { delta: SeatDelta; flags: GameFlags }> {
  const seats = final.seats ?? [];
  const board = final.board;
  const winner = board?.winner;
  const out = new Map<number, SeatDelta>();
  for (let i = 0; i < seats.length; i++) out.set(i, zero());
  const at = (s: unknown) => (typeof s === "number" ? out.get(s) : undefined);

  // 特判要用的中间量，按座位攒
  const colorCount = seats.map(() => ({ R: 0, G: 0, B: 0, Y: 0 } as Record<string, number>));
  const revealed = seats.map(() => false);
  const sealed = seats.map(() => false);
  const drewAny = seats.map(() => false);
  const tookPunish = seats.map(() => false);
  const gotCaught = seats.map(() => false);
  const calledUno = seats.map(() => false);
  const refusedAlliance = seats.map(() => false);
  const formedAlliance = seats.map(() => false);
  const bigDeflect = seats.map(() => false);
  /** 链此刻指着谁、总量多少——转嫁靠「窗口重开时受害者换人了」认。 */
  let pointedAt: { seat: number; total: number } | null = null;
  let turns = 0;
  let starter: number | null = null;

  for (const e of events) {
    const p = e.public;
    switch (e.type) {
      case "gameStarted":
        starter = num(p.starter);
        break;
      case "turnEnded":
        turns += 1;
        break;

      case "cardPlayed": {
        const d = at(p.seat);
        const cards = list<Card>(p.cards);
        if (!d) break;
        d.cardsPlayed += cards.length;
        d.mostCardsOneTurn = Math.max(d.mostCardsOneTurn, cards.length);
        for (const c of cards) {
          d.byCard[cardKey(c)] = (d.byCard[cardKey(c)] ?? 0) + 1;
          if (c.color) colorCount[p.seat as number][c.color] += 1;
        }
        break;
      }
      case "cardsDrawn": {
        const d = at(p.seat);
        if (!d) break;
        d.cardsDrawn += num(p.count) ?? 0;
        if ((num(p.count) ?? 0) > 0) drewAny[p.seat as number] = true;
        break;
      }

      // 惩罚链：开窗口 = 指向某人；接受 = 那个人吃了；窗口换人 = 上一个人把它转出去了
      case "punishWindowOpened": {
        const victim = num(list<number>(p.actors)[0]);
        const total = num(p.total) ?? 0;
        if (victim === null) break;
        if (pointedAt && pointedAt.seat !== victim) {
          const d = at(pointedAt.seat);
          if (d) {
            d.punishDeflected += 1;
            d.punishDeflectedMax = Math.max(d.punishDeflectedMax, pointedAt.total);
          }
          if (pointedAt.total >= BIG_CHAIN) bigDeflect[pointedAt.seat] = true;
        }
        pointedAt = { seat: victim, total };
        break;
      }
      case "punishAccepted": {
        const d = at(p.seat);
        const total = num(p.total) ?? 0;
        if (d) {
          d.punishTaken += total;
          d.punishMax = Math.max(d.punishMax, total);
          if (total > 0) tookPunish[p.seat as number] = true;
        }
        pointedAt = null;
        break;
      }

      case "unoCalled": {
        const d = at(p.seat);
        if (d) d.unoCalled += 1;
        if (typeof p.seat === "number") calledUno[p.seat] = true;
        break;
      }
      case "unoCaught": {
        at(p.seat) && (at(p.seat)!.unoCaught += 1);
        const t = at(p.target);
        if (t) t.unoGotCaught += 1;
        if (typeof p.target === "number") gotCaught[p.target] = true;
        break;
      }
      case "unoMiscalled": {
        const d = at(p.seat);
        if (d) d.unoMiscalled += 1;
        break;
      }

      case "skillRevealed": {
        const d = at(p.seat);
        if (d) d.skillsRevealed += 1;
        if (typeof p.seat === "number") revealed[p.seat] = true;
        break;
      }
      case "skillActivated": {
        const d = at(p.seat);
        if (d) d.skillsActivated += 1;
        break;
      }
      case "diceRolled": {
        const d = at(p.seat);
        const values = list<number>(p.values);
        if (!d) break;
        d.diceRolled += values.length;
        for (const v of values) if (v >= 0 && v <= 2) d.diceHist[v] += 1;
        break;
      }
      case "allianceFormed": {
        for (const s of list<number>(p.seats)) {
          const d = at(s);
          if (d) d.alliancesFormed += 1;
          if (typeof s === "number") formedAlliance[s] = true;
        }
        break;
      }
      case "allianceRefused": {
        const d = at(p.seat);
        if (d) d.alliancesRefused += 1;
        if (typeof p.seat === "number") refusedAlliance[p.seat] = true;
        break;
      }
      case "raided": {
        const d = at(p.by);
        if (d) d.raidsStarted += 1;
        break;
      }
      case "marksGained": {
        const d = at(p.seat);
        if (d) d.marksGained += num(p.n) ?? 0;
        break;
      }
      case "sealed": {
        const d = at(p.seat);
        if (d) d.sealedCount += 1;
        if (typeof p.seat === "number") sealed[p.seat] = true;
        break;
      }
    }
  }

  // ---- 收尾：把只有终局才知道的东西补齐 ----
  const hour = finishedAt.getHours();
  const nightWatch = hour < 4;
  const reshuffles = board?.reshuffles ?? 0;
  const result = new Map<number, { delta: SeatDelta; flags: GameFlags }>();

  for (let seat = 0; seat < seats.length; seat++) {
    const d = out.get(seat)!;
    const won = winner === seat;
    const drew = winner === undefined;

    d.games = 1;
    d.wins = won ? 1 : 0;
    d.draws = drew ? 1 : 0;
    d.turns = turns;
    d.longestGameTurns = turns;
    if (won) d.fastestWinTurns = turns;
    if (starter === seat) {
      d.gamesFirst = 1;
      if (won) d.winsFirst = 1;
    }

    // 技能：`skillChosen` 的 payload 里**没有** skillId（抽到什么是暗信息），
    // 所以本命神职只能从终局 state 读——那时候谁拿的什么已经定了
    const skillId = board?.skills?.[seat] ?? null;
    if (skillId) {
      bump(d.bySkill, skillId, won);
      if ((GOD_SKILLS as readonly string[]).includes(skillId)) d.godsPlayed = 1;
    }

    for (let other = 0; other < seats.length; other++) {
      if (other === seat) continue;
      const id = seats[other]?.userId;
      if (!id) continue;
      bump(d.vsPlayer, id, won);
      if (formedAlliance[seat] && formedAlliance[other]) bump(d.withAlly, id, won);
    }

    const colors = colorCount[seat];
    result.set(seat, {
      delta: d,
      flags: {
        won,
        colorSweep: (["R", "G", "B", "Y"] as const).every((c) => colors[c] >= SWEEP_PER_COLOR),
        bigDeflect: bigDeflect[seat],
        bareHandedWin: won && !calledUno[seat] && !gotCaught[seat],
        swiftWin: won && turns <= SWIFT_TURNS,
        facelessWin: won && !revealed[seat],
        loneWolfWin: won && refusedAlliance[seat] && !formedAlliance[seat],
        nightWatch,
        defiantWin: won && sealed[seat],
        spotlessWin: won && !drewAny[seat] && !tookPunish[seat],
        abyssWin: won && reshuffles >= MAX_RESHUFFLES,
      },
    });
  }
  return result;
}

/**
 * 从一个房间的整份事件流里切出**最后一局**。
 *
 * 房间可以重开（`restartGame`），`room_events` 会一直往后追加，所以「这一局」
 * 是从最后一条 `gameStarted` 开始的那一截。切不出来（老房间没有这条事件）就整份返回——
 * 宁可把一局算宽一点，也不要静默丢掉整局的统计。
 */
export function sliceCurrentGame(events: EngineEvent[]): EngineEvent[] {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].type === "gameStarted") return events.slice(i);
  return events;
}
