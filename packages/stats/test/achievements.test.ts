import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, evaluate, mergePrior } from "../src/achievements.ts";
import { emptyStats } from "../src/types.ts";
import type { GameFlags, PlayerStats, SeatDelta, Tier } from "../src/index.ts";

const NO_FLAGS: GameFlags = {
  won: false, colorSweep: false, bigDeflect: false, bareHandedWin: false, swiftWin: false,
  facelessWin: false, loneWolfWin: false, nightWatch: false, defiantWin: false,
  spotlessWin: false, abyssWin: false,
};

const emptyDelta = (): SeatDelta => ({
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

/** 从 prior 出发打一局，返回本局解锁。`owned` 默认为空。 */
const play = (
  prior: PlayerStats,
  delta: Partial<SeatDelta>,
  flags: Partial<GameFlags> = {},
  owned: string[] = [],
) => {
  const d = { ...emptyDelta(), games: 1, ...delta };
  const f = { ...NO_FLAGS, ...flags };
  const next = mergePrior(prior, d, f.won);
  return { unlocked: evaluate(next, f, new Set(owned)), next };
};

describe("成就定义表", () => {
  it("id 唯一、24 条、四品齐全", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS).toHaveLength(24);
    const byTier = (t: Tier) => ACHIEVEMENTS.filter((a) => a.tier === t).length;
    expect([byTier("凡"), byTier("玄"), byTier("天"), byTier("神")]).toEqual([4, 6, 8, 6]);
  });

  it("每条恰好走一条判定路——stat / flag / derive 三选一", () => {
    for (const a of ACHIEVEMENTS) {
      const paths = [a.stat, a.flag, a.derive].filter(Boolean).length;
      expect(paths, `${a.id} 有 ${paths} 条判定路`).toBe(1);
    }
  });
});

describe("evaluate · 计数型", () => {
  it("够了就解锁；再打一局靠 owned 去重，不会重发", () => {
    const prior = { ...emptyStats(), unoCaught: 23 };
    // 第 24 次：还差一次
    const first = play(prior, { unoCaught: 1 });
    expect(first.unlocked).not.toContain("catch-hunter");

    // 第 25 次：够了
    const second = play(first.next, { unoCaught: 1 });
    expect(second.unlocked).toContain("catch-hunter");

    // 第 26 次：已经写进 player_achievements 了，owned 挡住
    const third = play(second.next, { unoCaught: 1 }, {}, ["catch-hunter"]);
    expect(third.unlocked).not.toContain("catch-hunter");
  });

  /* 判定与写库不在一个原子步里，中间漏一次不能变成**永久**错过。 */
  it("自愈：上一局漏判了，下一局自己补上", () => {
    const overdue = { ...emptyStats(), unoCaught: 40 };  // 早就够 25 了，却没写进 owned
    expect(play(overdue, {}).unlocked).toContain("catch-hunter");
  });

  it("已经拥有的一律跳过（owned 是唯一的去重口径）", () => {
    const { unlocked } = play(emptyStats(), { games: 1 }, {}, ["first-game"]);
    expect(unlocked).not.toContain("first-game");
  });

  it("一局跨过多个阈值时全部一起解锁", () => {
    const { unlocked } = play(emptyStats(), { games: 1, unoCalled: 1, skillsRevealed: 1, godsPlayed: 1 });
    expect(unlocked).toEqual(expect.arrayContaining(["first-game", "first-uno", "first-reveal", "first-god"]));
  });

  it("清算取的是极值不是累加：两局各 8 张凑不出 16", () => {
    const a = play(emptyStats(), { punishMax: 8 });
    const b = play(a.next, { punishMax: 8 });
    expect(b.unlocked).not.toContain("reckoning");
    expect(b.next.punishMax).toBe(8);

    const c = play(b.next, { punishMax: 16 });
    expect(c.unlocked).toContain("reckoning");
  });

  it("三连认的是连胜，输一局就断", () => {
    let s = emptyStats();
    for (const won of [true, true]) s = play(s, {}, { won }).next;
    expect(s.streakCur).toBe(2);

    const broke = play(s, {}, { won: false });
    expect(broke.unlocked).not.toContain("streak-3");
    expect(broke.next.streakCur).toBe(0);
    expect(broke.next.streakBest).toBe(2);

    let again = broke.next;
    for (const _ of [1, 2]) again = play(again, {}, { won: true }).next;
    const third = play(again, {}, { won: true });
    expect(third.unlocked).toContain("streak-3");
  });
});

describe("evaluate · 特判型", () => {
  const cases: [keyof GameFlags, string][] = [
    ["colorSweep", "color-sweep"],
    ["bigDeflect", "deflect"],
    ["bareHandedWin", "bare-blade"],
    ["swiftWin", "swift"],
    ["facelessWin", "faceless"],
    ["loneWolfWin", "lone-wolf"],
    ["nightWatch", "night-watch"],
    ["defiantWin", "defiant"],
    ["spotlessWin", "spotless"],
    ["abyssWin", "abyss"],
  ];

  it.each(cases)("标记 %s 立起来就解 %s，不立就不解", (flag, id) => {
    expect(play(emptyStats(), {}, { [flag]: true }).unlocked).toContain(id);
    expect(play(emptyStats(), {}, { [flag]: false }).unlocked).not.toContain(id);
  });

  it("十条特判各管各的，一个标记不会带出别人", () => {
    const { unlocked } = play(emptyStats(), {}, { swiftWin: true, won: true });
    const specials = cases.map(([, id]) => id);
    expect(unlocked.filter((id) => specials.includes(id))).toEqual(["swift"]);
  });
});

describe("evaluate · 派生型", () => {
  it("万神殿：四神各赢一局才算，赢三个不算", () => {
    const withGods = (...ids: string[]): PlayerStats => ({
      ...emptyStats(),
      bySkill: Object.fromEntries(ids.map((id) => [id, { n: 1, w: 1 }])),
    });
    const three = withGods("god-ricin", "god-omorph", "god-fade");
    const afterThird = play(three, {}, { won: true });
    expect(afterThird.unlocked).not.toContain("pantheon");

    const fourth = play(three, { bySkill: { "god-tindra": { n: 1, w: 1 } } }, { won: true });
    expect(fourth.unlocked).toContain("pantheon");
  });

  it("万神殿只认**赢过**：用四神各打了一局但没赢不算", () => {
    const played: PlayerStats = {
      ...emptyStats(),
      bySkill: Object.fromEntries(
        ["god-ricin", "god-omorph", "god-fade", "god-tindra"].map((id) => [id, { n: 3, w: 0 }])),
    };
    expect(play(played, {}, { won: false }).unlocked).not.toContain("pantheon");
  });

  it("博物志：第 60 个技能落地那一局解锁", () => {
    const key = (i: number) => `skill-${i}`;
    const fifty9: PlayerStats = {
      ...emptyStats(),
      bySkill: Object.fromEntries(Array.from({ length: 59 }, (_, i) => [key(i), { n: 1, w: 0 }])),
    };
    expect(play(fifty9, { bySkill: { [key(58)]: { n: 1, w: 0 } } }).unlocked).not.toContain("bestiary");
    expect(play(fifty9, { bySkill: { [key(59)]: { n: 1, w: 0 } } }).unlocked).toContain("bestiary");
  });

  it("无漏：喊满 100 次且从没被抓过；被抓过一次就永远拿不到", () => {
    const clean: PlayerStats = { ...emptyStats(), unoCalled: 99, unoGotCaught: 0 };
    expect(play(clean, { unoCalled: 1 }).unlocked).toContain("flawless");

    const dirty: PlayerStats = { ...emptyStats(), unoCalled: 99, unoGotCaught: 1 };
    expect(play(dirty, { unoCalled: 1 }).unlocked).not.toContain("flawless");
  });
});

/**
 * 这一组守的是「合并不丢列」。
 *
 * 之前 `mergePrior` 只并了判定用得上的那十来列，出牌数 / 摸牌数 / 骰子分布 / 宿敌
 * 一路被丢掉——单测全绿，端到端跑第一次才看见 profile 页拿到一屏 undefined。
 * 加统计时忘了改 `mergePrior`，这里会红。
 */
describe("mergePrior · 一列都不能少", () => {
  /** 每个数字列都给一个**不同**的值，谁没并进去就会露馅。 */
  const loaded = (): SeatDelta => ({
    games: 1, wins: 1, draws: 0, gamesFirst: 1, winsFirst: 1, turns: 17,
    cardsPlayed: 23, cardsDrawn: 11, punishTaken: 8, punishMax: 6,
    punishDeflectedMax: 5, punishDeflected: 2, mostCardsOneTurn: 4,
    unoCalled: 3, unoCaught: 7, unoGotCaught: 1, unoMiscalled: 2,
    skillsRevealed: 1, skillsActivated: 9, godsPlayed: 1,
    diceRolled: 12, diceHist: [2, 4, 6],
    alliancesFormed: 3, alliancesRefused: 1, raidsStarted: 5, marksGained: 31, sealedCount: 2,
    fastestWinTurns: 17, longestGameTurns: 17,
    bySkill: { "club-3": { n: 1, w: 1 } },
    byCard: { "R+2": 4, Wwild: 1 },
    vsPlayer: { u1: { n: 1, w: 1 } },
    withAlly: { u2: { n: 1, w: 1 } },
  });

  it("`PlayerStats` 的每一个键都被写到，没有 undefined", () => {
    const merged = mergePrior({}, loaded(), true);
    const missing = Object.entries(emptyStats())
      .filter(([k]) => merged[k as keyof PlayerStats] === undefined)
      .map(([k]) => k);
    expect(missing, `这些列没被 mergePrior 并进去：${missing.join(", ")}`).toEqual([]);
  });

  it("累加类两局翻倍，取极值类不翻倍", () => {
    const one = mergePrior({}, loaded(), true);
    const two = mergePrior(one, loaded(), true);

    // 累加
    expect(two.cardsPlayed).toBe(46);
    expect(two.cardsDrawn).toBe(22);
    expect(two.turnsTotal).toBe(34);
    expect(two.marksGained).toBe(62);
    expect(two.diceHist).toEqual([4, 8, 12]);
    // 取极值：同样的两局并不出更大的数
    expect(two.punishMax).toBe(6);
    expect(two.mostCardsOneTurn).toBe(4);
    expect(two.longestGameTurns).toBe(17);
  });

  it("分布类逐键合并", () => {
    // 输掉的那一局：胜负写在 delta 自己的 w 里（由 tallyGame 定），
    // `mergePrior` 的 `won` 只管连胜，不会去改 delta 的分布
    const lost: SeatDelta = {
      ...loaded(), wins: 0, winsFirst: 0, fastestWinTurns: null,
      bySkill: { "club-3": { n: 1, w: 0 } },
      vsPlayer: { u1: { n: 1, w: 0 } },
      withAlly: { u2: { n: 1, w: 0 } },
    };
    const two = mergePrior(mergePrior({}, loaded(), true), lost, false);
    expect(two.bySkill).toEqual({ "club-3": { n: 2, w: 1 } });
    expect(two.byCard).toEqual({ "R+2": 8, Wwild: 2 });
    expect(two.vsPlayer).toEqual({ u1: { n: 2, w: 1 } });
    expect(two.withAlly).toEqual({ u2: { n: 2, w: 1 } });
  });

  it("最快取胜取最小值，输掉的那局不参与比较", () => {
    const fast = mergePrior({}, { ...loaded(), fastestWinTurns: 9 }, true);
    expect(fast.fastestWinTurns).toBe(9);
    // 又赢了一局但更慢 → 纪录不动
    expect(mergePrior(fast, { ...loaded(), fastestWinTurns: 30 }, true).fastestWinTurns).toBe(9);
    // 输了（delta 里是 null）→ 纪录不动
    expect(mergePrior(fast, { ...loaded(), fastestWinTurns: null }, false).fastestWinTurns).toBe(9);
    // 从没赢过就是 null
    expect(mergePrior({}, { ...loaded(), fastestWinTurns: null }, false).fastestWinTurns).toBeNull();
  });

  it("残缺的老行不会算出 NaN", () => {
    const merged = mergePrior({ games: 5 } as Partial<PlayerStats>, loaded(), true);
    const nans = Object.entries(merged).filter(([, v]) => typeof v === "number" && Number.isNaN(v));
    expect(nans).toEqual([]);
    expect(merged.games).toBe(6);
    expect(merged.cardsPlayed).toBe(23);
  });
});
