import { applyAction } from "@roft/engine";
import type { Board, Card, Color, EngineEvent, Face, GameState } from "@roft/engine";
import { describe, expect, it } from "vitest";
import { GAME_TIMEZONE, hourIn, sliceCurrentGame, tallyGame } from "../src/tally.ts";

/* ------------------------------------------------------------------ 夹具 */

let uid = 0;
const card = (color: Color | null, face: Face): Card => ({ id: `${color ?? "W"}${face}#${uid++}`, color, face });

/** 摆一个最小牌桌。字段照 `Board` 的必填项来，缺一个引擎就会读到 undefined。 */
function table(hands: Card[][], board: Partial<Board> = {}): GameState {
  const n = hands.length;
  return {
    version: 10,
    phase: "turnStart",
    seats: Array.from({ length: n }, (_, i) => ({ userId: `u${i}` })),
    board: {
      rulePack: "base",
      drawPile: Array.from({ length: 20 }, () => card("B", "7")),
      playedPile: [card("R", "7")],
      discardPile: [],
      hands,
      activeColor: "R",
      currentSeat: 0,
      direction: 1,
      saidUno: Array(n).fill(false),
      skills: Array(n).fill(null),
      revealed: Array(n).fill(false),
      activatedThisTurn: Array(n).fill(false),
      marks: Array.from({ length: n }, () => ({})),
      statuses: Array.from({ length: n }, () => []),
      ...board,
    },
  };
}

const NOON = 12;  // 终局钟点（玩家本地），守夜人之外没人读它
const NOW = "2026-08-10T12:00:00.000Z";  // 喂给引擎的 ctx.now，与上面那个钟点无关
const ev = (type: string, pub: Record<string, unknown>): EngineEvent => ({ type, public: pub });

/* ------------------------------------------------------ 与真引擎对齐的那一半 */

/**
 * 这一组用的是**引擎真的发出来的事件**，不是手写的。
 * 它守的是这个包最脆弱的地方：payload 的键名。写错一个键不会报错，
 * 只会让某个计数永远是 0——只有跟真事件对一次才发现得了。
 */
describe("tallyGame · 对着真引擎的事件流", () => {
  it("打完最后一张：games/wins/回合数/出牌数/本命神职全部对上", () => {
    const s = table([[card("R", "5")], [card("B", "3")], [card("G", "9")]], {
      skills: ["club-3", "heart-1", null],
    });
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [s.board!.hands[0][0].id] }, {
      rng: () => 0.5,
      now: NOW,
    });
    expect(r.state.board!.winner).toBe(0);

    const t = tallyGame(r.events, r.state, NOON);
    const me = t.get(0)!.delta;
    const loser = t.get(1)!.delta;

    expect(me.games).toBe(1);
    expect(me.wins).toBe(1);
    expect(me.cardsPlayed).toBe(1);
    expect(me.mostCardsOneTurn).toBe(1);
    expect(me.byCard).toEqual({ R5: 1 });
    // 技能只能从终局 state 读——`skillChosen` 的 payload 里没有 skillId
    expect(me.bySkill).toEqual({ "club-3": { n: 1, w: 1 } });
    expect(me.vsPlayer).toEqual({ u1: { n: 1, w: 1 }, u2: { n: 1, w: 1 } });

    expect(loser.wins).toBe(0);
    expect(loser.games).toBe(1);
    expect(loser.vsPlayer).toEqual({ u0: { n: 1, w: 0 }, u2: { n: 1, w: 0 } });
  });

  it("摸牌 → cardsDrawn 按张数累加，且破掉零封", () => {
    const s = table([[card("Y", "9")], [card("B", "3")], [card("G", "9")]]);
    const r = applyAction(s, { type: "drawCard", seat: 0 }, { rng: () => 0.5, now: NOW });
    expect(r.rejected).toBeUndefined();

    const me = tallyGame(r.events, r.state, NOON).get(0)!.delta;
    expect(me.cardsDrawn).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------ 计数与标记 */

describe("tallyGame · 计数", () => {
  const base = table([[card("R", "1")], [card("B", "1")], [card("G", "1")]]);
  const finished = (winner?: number, board: Partial<Board> = {}): GameState => ({
    ...base,
    phase: "finished",
    board: { ...base.board!, ...board, ...(winner === undefined ? {} : { winner }) },
  });

  it("UNO 的四个数各归各位", () => {
    const events = [
      ev("unoCalled", { seat: 0 }),
      ev("unoCaught", { seat: 0, target: 1 }),
      ev("unoCaught", { seat: 2, target: 0 }),
      ev("unoMiscalled", { seat: 0 }),
    ];
    const t = tallyGame(events, finished(0), NOON);
    expect(t.get(0)!.delta.unoCalled).toBe(1);
    expect(t.get(0)!.delta.unoCaught).toBe(1);   // 我抓别人
    expect(t.get(0)!.delta.unoGotCaught).toBe(1); // 别人抓我
    expect(t.get(0)!.delta.unoMiscalled).toBe(1);
    expect(t.get(1)!.delta.unoGotCaught).toBe(1);
    expect(t.get(2)!.delta.unoCaught).toBe(1);
  });

  it("惩罚链：吃下的算 taken，转出去的算 deflected", () => {
    const events = [
      ev("punishWindowOpened", { actors: [1], total: 4 }),
      ev("punishWindowOpened", { actors: [2], total: 14 }), // 1 号转给了 2 号
      ev("punishAccepted", { seat: 2, total: 14 }),
    ];
    const t = tallyGame(events, finished(0), NOON);
    expect(t.get(1)!.delta.punishDeflected).toBe(1);
    expect(t.get(1)!.delta.punishDeflectedMax).toBe(4); // 转走时链上是 4 张
    expect(t.get(2)!.delta.punishTaken).toBe(14);
    expect(t.get(2)!.delta.punishMax).toBe(14);
    expect(t.get(2)!.delta.punishDeflected).toBe(0);
  });

  /* 一次多张只有并列♥4 打得出来（基础包是 single_card_only），
     所以这里直接喂那条事件——`cardPlayed.cards` 本来就是数组，形状与引擎发的一致。 */
  it("一次多张：cardsPlayed 按张数算，一口气记的是单回合峰值", () => {
    const events = [
      ev("cardPlayed", { seat: 0, cards: [card("R", "5"), card("B", "5"), card("G", "5")] }),
      ev("cardPlayed", { seat: 0, cards: [card("Y", "9")] }),
    ];
    const me = tallyGame(events, finished(0), NOON).get(0)!.delta;
    expect(me.cardsPlayed).toBe(4);
    expect(me.mostCardsOneTurn).toBe(3); // 峰值不是最后一次
    expect(me.byCard).toEqual({ R5: 1, B5: 1, G5: 1, Y9: 1 });
  });

  it("无色牌归到 W 这一格", () => {
    const events = [ev("cardPlayed", { seat: 0, cards: [card(null, "wild"), card(null, "+4")] })];
    expect(tallyGame(events, finished(0), NOON).get(0)!.delta.byCard).toEqual({ Wwild: 1, "W+4": 1 });
  });

  it("掷骰分布按点数落格", () => {
    const events = [ev("diceRolled", { seat: 0, reason: "assault", values: [2, 0, 2] })];
    const me = tallyGame(events, finished(0), NOON).get(0)!.delta;
    expect(me.diceRolled).toBe(3);
    expect(me.diceHist).toEqual([1, 0, 2]);
  });

  it("结盟：allianceFormed 的两个座位各记一次，结盟双方进 withAlly", () => {
    const events = [ev("allianceFormed", { seats: [0, 2] }), ev("allianceRefused", { seat: 1 })];
    const t = tallyGame(events, finished(0), NOON);
    expect(t.get(0)!.delta.alliancesFormed).toBe(1);
    expect(t.get(2)!.delta.alliancesFormed).toBe(1);
    expect(t.get(1)!.delta.alliancesRefused).toBe(1);
    expect(t.get(0)!.delta.withAlly).toEqual({ u2: { n: 1, w: 1 } });
    expect(t.get(1)!.delta.withAlly).toEqual({});
  });

  it("先手只认 gameStarted.starter", () => {
    const events = [ev("gameStarted", { seats: 3, handSize: 7, starter: 1, drawPile: 60 })];
    const t = tallyGame(events, finished(1), NOON);
    expect(t.get(1)!.delta.gamesFirst).toBe(1);
    expect(t.get(1)!.delta.winsFirst).toBe(1);
    expect(t.get(0)!.delta.gamesFirst).toBe(0);
  });

  it("平局：三个人都记 draws，谁都不记 wins", () => {
    const t = tallyGame([], finished(undefined), NOON);
    for (const seat of [0, 1, 2]) {
      expect(t.get(seat)!.delta.draws).toBe(1);
      expect(t.get(seat)!.delta.wins).toBe(0);
      expect(t.get(seat)!.flags.won).toBe(false);
    }
  });

  it("回合数全场共享，最快取胜只有赢家有", () => {
    const events = [ev("turnEnded", { seat: 0 }), ev("turnEnded", { seat: 1 }), ev("turnEnded", { seat: 2 })];
    const t = tallyGame(events, finished(0), NOON);
    expect(t.get(0)!.delta.turns).toBe(3);
    expect(t.get(0)!.delta.fastestWinTurns).toBe(3);
    expect(t.get(1)!.delta.turns).toBe(3);
    expect(t.get(1)!.delta.fastestWinTurns).toBeNull();
  });

  it("四神：拿到的人才记 godsPlayed", () => {
    const t = tallyGame([], finished(0, { skills: ["god-fade", "heart-1", null] }), NOON);
    expect(t.get(0)!.delta.godsPlayed).toBe(1);
    expect(t.get(1)!.delta.godsPlayed).toBe(0);
  });
});

/* -------------------------------------------------------------- 特判标记 */

describe("tallyGame · 特判标记", () => {
  const base = table([[card("R", "1")], [card("B", "1")], [card("G", "1")]]);
  const finished = (winner?: number, board: Partial<Board> = {}): GameState => ({
    ...base,
    phase: "finished",
    board: { ...base.board!, ...board, ...(winner === undefined ? {} : { winner }) },
  });
  const flagsOf = (events: EngineEvent[], winner = 0, board: Partial<Board> = {}, hour = NOON) =>
    tallyGame(events, finished(winner, board), hour).get(0)!.flags;

  it("满堂彩：四色各 8 张才算，差一张就不算", () => {
    const sweep = (perColor: number) =>
      (["R", "G", "B", "Y"] as const).flatMap((c) =>
        Array.from({ length: perColor }, () => ev("cardPlayed", { seat: 0, cards: [card(c, "5")] })));
    expect(flagsOf(sweep(8)).colorSweep).toBe(true);
    expect(flagsOf(sweep(7)).colorSweep).toBe(false);
  });

  it("反手：转出去的链要 ≥ 12 张", () => {
    const deflect = (total: number) => [
      ev("punishWindowOpened", { actors: [0], total }),
      ev("punishWindowOpened", { actors: [1], total }),
    ];
    expect(flagsOf(deflect(12)).bigDeflect).toBe(true);
    expect(flagsOf(deflect(11)).bigDeflect).toBe(false);
  });

  it("空手接白刃：没喊、没被抓、且赢了", () => {
    expect(flagsOf([]).bareHandedWin).toBe(true);
    // 喊了就有 U7 的保护，不算「空手」
    expect(flagsOf([ev("unoCalled", { seat: 0 })]).bareHandedWin).toBe(false);
    // 被抓着了
    expect(flagsOf([ev("unoCaught", { seat: 1, target: 0 })]).bareHandedWin).toBe(false);
    // 没赢
    expect(flagsOf([], 1).bareHandedWin).toBe(false);
    // 别人喊、别人被抓，都不关我的事
    expect(flagsOf([
      ev("unoCalled", { seat: 1 }),
      ev("unoCaught", { seat: 0, target: 2 }),
    ]).bareHandedWin).toBe(true);
  });

  it("速通：12 回合是上限，第 13 回合就不算", () => {
    const turns = (n: number) => Array.from({ length: n }, () => ev("turnEnded", { seat: 0 }));
    expect(flagsOf(turns(12)).swiftWin).toBe(true);
    expect(flagsOf(turns(13)).swiftWin).toBe(false);
  });

  it("无相胜：赢了且一次都没亮过", () => {
    expect(flagsOf([]).facelessWin).toBe(true);
    expect(flagsOf([ev("skillRevealed", { seat: 0, skillId: "club-3" })]).facelessWin).toBe(false);
    // 别人亮了不影响我
    expect(flagsOf([ev("skillRevealed", { seat: 1, skillId: "club-3" })]).facelessWin).toBe(true);
  });

  it("独狼：拒过、且一次都没结成", () => {
    const refused = [ev("allianceRefused", { seat: 0 })];
    expect(flagsOf(refused).loneWolfWin).toBe(true);
    expect(flagsOf([...refused, ev("allianceFormed", { seats: [0, 1] })]).loneWolfWin).toBe(false);
    expect(flagsOf([]).loneWolfWin).toBe(false); // 没人邀请过也不算
  });

  /* 钟点是**入参**，不是环境——从前它读 `new Date().getHours()`，
     于是跑在 UTC 容器里的边缘函数把「深夜」判成了悉尼的上午 10 点。 */
  it("守夜人只看传进来的钟点，0–3 点算，4 点不算", () => {
    for (const h of [0, 1, 2, 3]) expect(flagsOf([], 0, {}, h).nightWatch, `${h} 点该算`).toBe(true);
    for (const h of [4, 12, 23]) expect(flagsOf([], 0, {}, h).nightWatch, `${h} 点不该算`).toBe(false);
  });

  it("逆流：被封印过还赢了", () => {
    expect(flagsOf([ev("sealed", { seat: 0, by: 1 })]).defiantWin).toBe(true);
    expect(flagsOf([ev("sealed", { seat: 1, by: 0 })]).defiantWin).toBe(false);
  });

  it("零封：没摸过牌、没吃过惩罚、且赢了", () => {
    expect(flagsOf([]).spotlessWin).toBe(true);
    expect(flagsOf([ev("cardsDrawn", { seat: 0, count: 1 })]).spotlessWin).toBe(false);
    expect(flagsOf([ev("punishAccepted", { seat: 0, total: 2, segments: [] })]).spotlessWin).toBe(false);
    // 摸了 0 张（牌堆枯竭）不破零封
    expect(flagsOf([ev("cardsDrawn", { seat: 0, count: 0 })]).spotlessWin).toBe(true);
  });

  it("归墟：洗满两次之后赢的", () => {
    expect(flagsOf([], 0, { reshuffles: 2 }).abyssWin).toBe(true);
    expect(flagsOf([], 0, { reshuffles: 1 }).abyssWin).toBe(false);
  });
});

/* ---------------------------------------------------------------- 切一局 */

describe("sliceCurrentGame", () => {
  it("重开过的房间只算最后一局", () => {
    const all = [
      ev("gameStarted", { starter: 0 }), ev("cardPlayed", { seat: 0, cards: [card("R", "1")] }),
      ev("gameStarted", { starter: 1 }), ev("cardPlayed", { seat: 0, cards: [card("R", "2")] }),
    ];
    const cut = sliceCurrentGame(all);
    expect(cut).toHaveLength(2);
    expect(cut[0].public.starter).toBe(1);
  });

  it("没有 gameStarted（老房间）就整份返回——宁可算宽，也不静默丢掉一整局", () => {
    const all = [ev("cardPlayed", { seat: 0, cards: [card("R", "1")] })];
    expect(sliceCurrentGame(all)).toEqual(all);
  });
});

/* ------------------------------------------------------------ 统一时区 */

/**
 * 「守夜人」按牌局的统一时区（悉尼）判，不看玩家当地时间也不看服务器时区。
 *
 * 这一组守的是**夏令时**：悉尼在 AEST(+10) 与 AEDT(+11) 之间来回切，
 * 写死偏移量的话每年有小半年是错的。切换日期年年由政府定，只有时区数据库知道，
 * 所以 `hourIn` 必须走 Intl —— 这几条用例就是在钉「它真的走了 Intl」。
 */
describe("hourIn · 统一时区与夏令时", () => {
  it("悉尼的冬天是 UTC+10（AEST）", () => {
    // 2026-07-01 02:00 UTC → 悉尼 12:00
    expect(hourIn(new Date("2026-07-01T02:00:00Z"))).toBe(12);
  });

  it("悉尼的夏天是 UTC+11（AEDT）——同一个 UTC 钟点，结果差一小时", () => {
    // 2026-01-01 02:00 UTC → 悉尼 13:00
    expect(hourIn(new Date("2026-01-01T02:00:00Z"))).toBe(13);
  });

  it("午夜给 0 不给 24", () => {
    // 2026-07-01 14:00 UTC → 悉尼次日 00:00
    expect(hourIn(new Date("2026-07-01T14:00:00Z"))).toBe(0);
  });

  it("守夜人的窗口按悉尼算：UTC 的下午正是悉尼的深夜", () => {
    const at = (iso: string) => hourIn(new Date(iso));
    expect(at("2026-07-01T15:30:00Z")).toBe(1);   // 悉尼 01:30 → 算深夜
    expect(at("2026-07-01T18:30:00Z")).toBe(4);   // 悉尼 04:30 → 不算
  });

  it("时区名可以覆盖，默认是 GAME_TIMEZONE", () => {
    expect(GAME_TIMEZONE).toBe("Australia/Sydney");
    expect(hourIn(new Date("2026-07-01T02:00:00Z"), "UTC")).toBe(2);
  });
});
