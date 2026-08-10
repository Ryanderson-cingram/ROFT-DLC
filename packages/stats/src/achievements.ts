import type { GameFlags, PriorStats, SeatDelta, Tally } from "./types.ts";
import { GOD_SKILLS } from "./tally.ts";

/** 全部技能数（04 catalog：★4 + 四花色各 13 + 神 4）。博物志要凑齐它。 */
export const ALL_SKILLS = 60;

export type Tier = "凡" | "玄" | "天" | "神";

/**
 * `PriorStats` 里**是数字**的那些列。阈值判定只能指向它们——
 * 少了这一层，`key` 可以写成 `bySkill`（一个 Record），比大小就成了运行时的谜。
 */
type NumericStatKey = { [K in keyof PriorStats]: PriorStats[K] extends number ? K : never }[keyof PriorStats];

export interface AchievementDef {
  id: string;
  tier: Tier;
  /** 封泥上刻的那一个字。 */
  mark: string;
  name: string;
  descr: string;
  /**
   * 判定的三条路，互斥：
   * - `stat`：某个累计量跨过 `goal`。11 条走这条，一个循环全覆盖。
   * - `flag`：这一局之内的形态（`GameFlags` 的某一格）。10 条。
   * - `derive`：要同时读多个累计量的派生条件。3 条。
   */
  stat?: { key: NumericStatKey; goal: number };
  flag?: keyof GameFlags;
  derive?: (s: PriorStats) => boolean;
}

const godsWon = (bySkill: Record<string, Tally>) =>
  GOD_SKILLS.every((id) => (bySkill[id]?.w ?? 0) > 0);

/**
 * 24 条封泥的**唯一来源**。`achievement_defs` 表的 seed 由它生成
 * （`pnpm --filter @roft/stats gen:achievements`），CI 用 `git diff --exit-code` 卡双源漂移。
 *
 * 表里只存**描述**（名字、字、描述、品级、进度目标），不存**规则**——
 * 判定逻辑留在这里，因为它要读引擎的类型，而且改判定本来就该发版。
 */
export const ACHIEVEMENTS: AchievementDef[] = [
  // ---------- 凡：进门就有，用来确认「系统是通的」 ----------
  { id: "first-game", tier: "凡", mark: "初", name: "初登盘", descr: "打完你的第一局。", stat: { key: "games", goal: 1 } },
  { id: "first-uno", tier: "凡", mark: "唤", name: "开口", descr: "第一次喊出 UNO。", stat: { key: "unoCalled", goal: 1 } },
  { id: "first-reveal", tier: "凡", mark: "露", name: "亮相", descr: "第一次亮出技能。", stat: { key: "skillsRevealed", goal: 1 } },
  { id: "first-god", tier: "凡", mark: "神", name: "见神", descr: "拿到四神中的任意一位。", stat: { key: "godsPlayed", goal: 1 } },

  // ---------- 玄：攒出来的 ----------
  { id: "catch-hunter", tier: "玄", mark: "捕", name: "抓漏喊猎人", descr: "抓到别人漏喊 25 次。", stat: { key: "unoCaught", goal: 25 } },
  { id: "streak-3", tier: "玄", mark: "叁", name: "三连", descr: "连胜 3 局。", stat: { key: "streakBest", goal: 3 } },
  { id: "dice-addict", tier: "玄", mark: "骰", name: "骰徒", descr: "累计掷骰 100 次。", stat: { key: "diceRolled", goal: 100 } },
  { id: "allies", tier: "玄", mark: "盟", name: "合纵连横", descr: "达成结盟 10 次。", stat: { key: "alliancesFormed", goal: 10 } },
  { id: "soul-reaper", tier: "玄", mark: "魂", name: "收魂人", descr: "生涯累计获得 100 枚标记。", stat: { key: "marksGained", goal: 100 } },
  { id: "color-sweep", tier: "玄", mark: "彩", name: "满堂彩", descr: "单局内四色各打出 8 张以上。", flag: "colorSweep" },

  // ---------- 天：要打出特定的一局 ----------
  { id: "deflect", tier: "天", mark: "反", name: "反手", descr: "把总量 12 张以上的惩罚链整条转给别人。", flag: "bigDeflect" },
  { id: "bare-blade", tier: "天", mark: "刃", name: "空手接白刃", descr: "喊出 UNO 之后全程没被抓到，并赢下这一局。", flag: "unoCleanWin" },
  { id: "swift", tier: "天", mark: "速", name: "速通", descr: "12 回合之内取胜。", flag: "swiftWin" },
  { id: "faceless", tier: "天", mark: "无", name: "无相胜", descr: "全程不亮技能取胜。", flag: "facelessWin" },
  { id: "lone-wolf", tier: "天", mark: "狼", name: "独狼", descr: "拒绝掉结盟邀请、一次都没结成，并取胜。", flag: "loneWolfWin" },
  { id: "reckoning", tier: "天", mark: "算", name: "清算", descr: "独自吃下总量 16 张的惩罚链。", stat: { key: "punishMax", goal: 16 } },
  { id: "night-watch", tier: "天", mark: "夜", name: "守夜人", descr: "在 00:00–04:00 之间打完一局。", flag: "nightWatch" },
  { id: "one-breath", tier: "天", mark: "气", name: "一口气", descr: "单回合打出 6 张以上的牌。", stat: { key: "mostCardsOneTurn", goal: 6 } },

  // ---------- 神：极稀 ----------
  {
    id: "pantheon", tier: "神", mark: "殿", name: "万神殿",
    descr: "用四神各赢下至少一局。",
    derive: (s) => godsWon(s.bySkill),
  },
  {
    id: "bestiary", tier: "神", mark: "志", name: "博物志",
    descr: "60 个技能全部至少用过一局。",
    derive: (s) => Object.keys(s.bySkill).length >= ALL_SKILLS,
  },
  {
    id: "flawless", tier: "神", mark: "漏", name: "无漏",
    descr: "累计喊出 UNO 100 次，且一次都没被抓到过。",
    derive: (s) => s.unoCalled >= 100 && s.unoGotCaught === 0,
  },
  { id: "defiant", tier: "神", mark: "逆", name: "逆流", descr: "在被封印过的一局里取胜。", flag: "defiantWin" },
  { id: "spotless", tier: "神", mark: "净", name: "零封之局", descr: "一局内没摸过一张牌、也没吃过惩罚，并取胜。", flag: "spotlessWin" },
  { id: "abyss", tier: "神", mark: "墟", name: "归墟", descr: "牌堆洗满两次之后仍然取胜。", flag: "abyssWin" },
];

const byId = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
export const achievementById = (id: string) => byId.get(id);

/**
 * 把一局的增量并进累计量。**连胜在这里算**——它是唯一一个不能靠逐列 `+=` 得出的列
 * （要知道这一局赢没赢，而不只是赢了几场）。
 */
export function mergePrior(prior: PriorStats, delta: SeatDelta, won: boolean): PriorStats {
  const streakCur = won ? prior.streakCur + 1 : 0;
  const bySkill: Record<string, Tally> = {};
  for (const [k, v] of Object.entries(prior.bySkill)) bySkill[k] = { ...v };
  for (const [k, v] of Object.entries(delta.bySkill)) {
    const t = (bySkill[k] ??= { n: 0, w: 0 });
    t.n += v.n;
    t.w += v.w;
  }
  return {
    games: prior.games + delta.games,
    wins: prior.wins + delta.wins,
    unoCalled: prior.unoCalled + delta.unoCalled,
    unoCaught: prior.unoCaught + delta.unoCaught,
    unoGotCaught: prior.unoGotCaught + delta.unoGotCaught,
    skillsRevealed: prior.skillsRevealed + delta.skillsRevealed,
    godsPlayed: prior.godsPlayed + delta.godsPlayed,
    diceRolled: prior.diceRolled + delta.diceRolled,
    alliancesFormed: prior.alliancesFormed + delta.alliancesFormed,
    marksGained: prior.marksGained + delta.marksGained,
    // 这两列是**极值**，不是累加
    punishMax: Math.max(prior.punishMax, delta.punishMax),
    mostCardsOneTurn: Math.max(prior.mostCardsOneTurn, delta.mostCardsOneTurn),
    streakCur,
    streakBest: Math.max(prior.streakBest, streakCur),
    bySkill,
  };
}

/**
 * 这一局新解锁了哪几条。
 *
 * 三条判定路各自的口径：
 * - `stat`：**跨过**阈值才算（`prior < goal && next >= goal`），不是「够了就算」——
 *   否则每打完一局都会把所有够格的成就重发一遍。
 * - `flag`：这一局的形态成立即可（成就本身由 `owned` 去重，不会重复解锁）。
 * - `derive`：同 `stat`，比 `prior` 与 `next` 两个时刻。
 *
 * `owned` 是这个人已经有的 id。传进来而不是在这里查库——这个包不碰 IO。
 */
export function evaluate(
  prior: PriorStats,
  next: PriorStats,
  flags: GameFlags,
  owned: ReadonlySet<string>,
): string[] {
  const unlocked: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (owned.has(a.id)) continue;
    if (a.stat) {
      if (prior[a.stat.key] < a.stat.goal && next[a.stat.key] >= a.stat.goal) unlocked.push(a.id);
    } else if (a.flag) {
      if (flags[a.flag]) unlocked.push(a.id);
    } else if (a.derive) {
      if (!a.derive(prior) && a.derive(next)) unlocked.push(a.id);
    }
  }
  return unlocked;
}
