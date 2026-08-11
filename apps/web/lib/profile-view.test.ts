import type { PlayerStats } from "@roft/stats";
import { describe, expect, it } from "vitest";
import { parseCardKey, projectProfile, type DefRow } from "./profile-view";

const def = (over: Partial<DefRow> = {}): DefRow => ({
  id: "first-game", tier: "凡", mark: "初", name: "初登盘", descr: "打完你的第一局。",
  stat_key: "games", stat_goal: 1, sort: 0, unlock_rate: null, ...over,
});

const stats = (over: Partial<PlayerStats> = {}): Partial<PlayerStats> => ({
  games: 10, wins: 6, draws: 1, gamesFirst: 4, winsFirst: 3, ...over,
});

/**
 * 这一层最要紧的性质是**面对残缺输入不崩、不撒谎**：
 * `player_stats.stats` 是一块 jsonb，老行会缺列，没打过的人压根没有这一行。
 * 除数为 0 时给 null（UI 显示「—」），绝不给一个假的 0%。
 */
describe("projectProfile · 残缺输入", () => {
  it("没有这一行 → 空状态，且每一格都有值不抛", () => {
    const v = projectProfile(null, [], []);
    expect(v.empty).toBe(true);
    expect(v.games).toBe(0);
    expect(v.winRate.pct).toBeNull();
    expect(v.avgTurns).toBeNull();
    expect(v.mastery).toEqual([]);
    expect(v.nemesis).toBeNull();
    expect(v.favCard).toBeNull();
    expect(v.dice.twoPct).toBeNull();
    expect(v.records.fastestWin).toBeNull();
  });

  it("空对象（老行缺列）不会算出 NaN", () => {
    const v = projectProfile({}, [], []);
    const nums = [v.winRate.pct, v.avgTurns, v.avgCardsPlayed, v.streakBest, v.collected];
    expect(nums.filter((n) => typeof n === "number" && Number.isNaN(n))).toEqual([]);
  });

  it("分母为 0 给 null 而不是 0%——「还没打过」不等于「一场没赢」", () => {
    const v = projectProfile(stats({ gamesFirst: 0, winsFirst: 0 }), [], []);
    expect(v.firstRate.pct).toBeNull();
    expect(v.firstRate.n).toBe(0);
    // 后手那一半照常算得出来
    expect(v.laterRate.pct).toBe(60);
  });

  it("分布字段是别的类型（脏数据）时当作空", () => {
    const v = projectProfile({ ...stats(), bySkill: "oops" as never, byCard: null as never }, [], []);
    expect(v.mastery).toEqual([]);
    expect(v.favCard).toBeNull();
    expect(v.collected).toBe(0);
  });
});

describe("projectProfile · 战绩", () => {
  it("胜率一位小数，负场由总局倒推（含平局）", () => {
    const v = projectProfile(stats({ games: 10, wins: 6, draws: 1 }), [], []);
    expect(v.winRate.pct).toBe(60);
    expect(v.losses).toBe(3);
  });

  it("场均量按局数摊，一位小数", () => {
    const v = projectProfile(stats({ games: 10, turnsTotal: 234, cardsPlayed: 256 }), [], []);
    expect(v.avgTurns).toBe(23.4);
    expect(v.avgCardsPlayed).toBe(25.6);
  });
});

describe("projectProfile · 本命神职", () => {
  const bySkill = {
    "club-3": { n: 34, w: 24 },   // 71%
    "club-k": { n: 19, w: 13 },   // 68%
    "spade-1": { n: 12, w: 4 },   // 33%
    "heart-1": { n: 3, w: 3 },    // 100% 但只打过 3 局
  };

  it("按胜率排，局数不足的不上榜", () => {
    const v = projectProfile(stats({ bySkill }), [], []);
    expect(v.mastery.map((m) => m.id)).toEqual(["club-3", "club-k", "spade-1"]);
    expect(v.mastery[0].winPct).toBe(70.6);
  });

  it("收集度数的是**用过**的技能，不管上没上榜", () => {
    const v = projectProfile(stats({ bySkill }), [], []);
    expect(v.collected).toBe(4);
  });

  it("四神单独计数", () => {
    const v = projectProfile(stats({ bySkill: { "god-fade": { n: 2, w: 1 }, "club-3": { n: 9, w: 5 } } }), [], []);
    expect(v.godsCollected).toBe(1);
  });

  it("文案表里没有的技能回落到 id，不抛", () => {
    const v = projectProfile(stats({ bySkill: { "brand-new": { n: 9, w: 5 } } }), [], []);
    expect(v.mastery[0]).toMatchObject({ id: "brand-new", name: "brand-new" });
  });
});

describe("projectProfile · 宿敌与盟友", () => {
  it("宿敌 = 输给他最多的那个", () => {
    const v = projectProfile(stats({ vsPlayer: { a: { n: 26, w: 7 }, b: { n: 30, w: 25 } } }), [], []);
    expect(v.nemesis).toEqual({ userId: "a", n: 26, lost: 19 });
  });

  it("没交过手 → null，不是一个空壳", () => {
    expect(projectProfile(stats({ vsPlayer: {} }), [], []).nemesis).toBeNull();
  });

  it("盟友按结盟局的胜率排", () => {
    const v = projectProfile(stats({ withAlly: { a: { n: 16, w: 13 }, b: { n: 4, w: 4 } } }), [], []);
    expect(v.ally).toMatchObject({ userId: "b", winPct: 100 });
  });
});

describe("projectProfile · 最爱的一张牌", () => {
  it("取打得最多的那张，键拆回颜色与牌面", () => {
    const v = projectProfile(stats({ byCard: { "R+2": 96, B5: 40, Wwild: 12 } }), [], []);
    expect(v.favCard).toMatchObject({ color: "R", face: "+2", n: 96 });
  });

  it("无色牌的 W 不是颜色", () => {
    expect(parseCardKey("Wwild")).toEqual({ color: null, face: "wild" });
    expect(parseCardKey("R+2")).toEqual({ color: "R", face: "+2" });
    // 牌面文案走既有的 faceLabel，不另起一套
    expect(projectProfile(stats({ byCard: { Wwild: 3 } }), [], []).favCard?.label).toBe("变色");
  });
});

describe("projectProfile · 成就", () => {
  const defs = [
    def(),
    def({ id: "catch-hunter", name: "抓漏喊猎人", stat_key: "unoCaught", stat_goal: 25, sort: 1, unlock_rate: 0.226 }),
    def({ id: "swift", name: "速通", stat_key: null, stat_goal: null, sort: 2 }),
  ];

  it("按 sort 排，已解锁的标出来", () => {
    const v = projectProfile(stats(), ["first-game"], defs);
    expect(v.achievements.map((a) => a.id)).toEqual(["first-game", "catch-hunter", "swift"]);
    expect(v.achievements[0].owned).toBe(true);
    expect(v.achievementsOwned).toBe(1);
  });

  it("进度条只给「计数型且还没拿到」的", () => {
    const v = projectProfile(stats({ unoCaught: 18 }), ["first-game"], defs);
    const byId = Object.fromEntries(v.achievements.map((a) => [a.id, a]));
    expect(byId["first-game"].progress).toBeNull();  // 已拿到
    expect(byId["catch-hunter"].progress).toEqual([18, 25]);
    expect(byId["swift"].progress).toBeNull();       // 形态型，没有进度可言
  });

  it("进度不超过目标——统计涨过头了也不显示 40/25", () => {
    const v = projectProfile(stats({ unoCaught: 40 }), [], defs);
    expect(v.achievements.find((a) => a.id === "catch-hunter")!.progress).toEqual([25, 25]);
  });

  it("「下一枚」取完成比例最高的，且必须已经起步", () => {
    const v = projectProfile(stats({ unoCaught: 20 }), ["first-game"], defs);
    expect(v.nextUp?.id).toBe("catch-hunter");
    // 一点没起步 → 不推荐，免得永远推同一个 0/100
    expect(projectProfile(stats({ unoCaught: 0 }), ["first-game"], defs).nextUp).toBeNull();
  });

  it("作业还没跑过时稀有度是 null，不是 0%", () => {
    const v = projectProfile(stats(), [], defs);
    expect(v.achievements[0].rate).toBeNull();
    expect(v.achievements[1].rate).toBe(0.226);
  });
});

describe("projectProfile · 掷骰", () => {
  it("×2 占比按总数算", () => {
    const v = projectProfile(stats({ diceHist: [34, 52, 100] }), [], []);
    expect(v.dice.total).toBe(186);
    expect(v.dice.twoPct).toBe(53.8);
  });

  it("没掷过 → null 而不是 0%", () => {
    expect(projectProfile(stats(), [], []).dice.twoPct).toBeNull();
  });
});
