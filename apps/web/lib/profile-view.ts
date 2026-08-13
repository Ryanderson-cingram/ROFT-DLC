/**
 * 「三张表 → 命盘上的每一格」的投影层。
 *
 * 与 `room-log.ts` 同性质：它是翻译，不是视图，所以住在 `lib/` 并且**整份可测**。
 * 页面组件只管摆，一个 `?.` 都不该出现在 JSX 里。
 *
 * 输入的 `stats` 是 `player_stats.stats` 那一整块 jsonb——**可能残缺**
 * （老行、或者这个人一局都没打过）。所以这里的每一格都要能面对 `{}`：
 * 除数为 0 一律给 null 而不是 NaN，缺席的分布一律当作空对象。
 */

import type { PlayerStats, Tally, Tier } from "@roft/stats";
import { faceLabel } from "./cards";
import { loadedSkills, type Color, type Face } from "@roft/engine";

/**
 * 技能名与沿印一律读**引擎的定义**，不走 `lib/skills.ts` 的 `skillById`——
 * 那份表只覆盖有玩家版文案的 20 个技能，四神与其余 36 个查它一律 undefined，
 * 命盘上就会露出 `god-fade` 这样的裸 id。名字与花色的唯一来源本来就是引擎（skills.ts 的注释也这么写）。
 */
const skillDef = (id: string) => loadedSkills.byId.get(id);

/** 本命神职至少要打过几局才上榜——3 局 100% 不该压着 34 局 71%。 */
const MASTERY_MIN_GAMES = 8;
/** 命盘外圈的齿数 = 技能总数（04 catalog：★4 + 四花色各 13 + 神 4）。 */
export const PLATE_TICKS = 60;

export interface Rate {
  /** 0–100，一位小数。分母为 0 时是 null——「还没打过」不等于「0%」。 */
  pct: number | null;
  n: number;
}

export interface MasteryRow {
  id: string;
  name: string;
  sigil: string;
  games: number;
  winPct: number;
}

export interface AchievementView {
  id: string;
  tier: Tier;
  mark: string;
  name: string;
  descr: string;
  owned: boolean;
  /** 计数型且未解锁时才有：[已完成, 目标]。 */
  progress: [number, number] | null;
  /** 全服解锁比例，`achievement_defs.unlock_rate`；作业还没跑过就是 null。 */
  rate: number | null;
}

export interface ProfileView {
  empty: boolean;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: Rate;
  firstRate: Rate;
  laterRate: Rate;
  streakCur: number;
  streakBest: number;
  avgTurns: number | null;
  avgCardsPlayed: number | null;
  avgPunishTaken: number | null;
  avgActivations: number | null;
  /** 命盘外圈：用过的技能数 / 总数。 */
  collected: number;
  godsCollected: number;
  mastery: MasteryRow[];
  nemesis: { userId: string; n: number; lost: number } | null;
  ally: { userId: string; n: number; winPct: number } | null;
  favCard: { color: Color | null; face: Face; label: string; n: number } | null;
  dice: { hist: [number, number, number]; total: number; twoPct: number | null };
  uno: { called: number; caught: number; gotCaught: number; miscalled: number };
  punish: { taken: number; max: number; deflected: number; deflectedMax: number };
  misc: { alliancesFormed: number; alliancesRefused: number; raids: number; marks: number; sealed: number };
  records: { fastestWin: number | null; longestGame: number; mostCardsOneTurn: number; cardsDrawn: number };
  achievements: AchievementView[];
  achievementsOwned: number;
  /** 离解锁最近的一枚未解锁成就（有进度的才算）。 */
  nextUp: AchievementView | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const tallies = (v: unknown): Record<string, Tally> =>
  v && typeof v === "object" ? (v as Record<string, Tally>) : {};
const counts = (v: unknown): Record<string, number> =>
  v && typeof v === "object" ? (v as Record<string, number>) : {};

/** 分子 / 分母 → 百分比。**分母为 0 给 null**，让 UI 显示「—」而不是一个假的 0%。 */
const rate = (hit: number, of: number): Rate =>
  ({ pct: of > 0 ? Math.round((hit / of) * 1000) / 10 : null, n: of });

const per = (total: number, games: number) =>
  games > 0 ? Math.round((total / games) * 10) / 10 : null;

/** `byCard` 的键（`R+2` / `Wwild`）拆回颜色与牌面。 */
export function parseCardKey(key: string): { color: Color | null; face: Face } {
  const head = key[0];
  const isColor = head === "R" || head === "G" || head === "B" || head === "Y";
  return { color: isColor ? (head as Color) : null, face: key.slice(1) as Face };
}

// ---------------------------------------------------------------- 近 20 场

/** `player_recent` 的一行（迁移 0009）。`won === null` = 平局。 */
export interface RecentRow {
  finished_at: string;
  won: boolean | null;
  skill_id: string | null;
  turns: number;
  hand_left: number;
}

export interface RunView {
  /** 胜 / 负 / 平。点上印的就是这个字母。 */
  result: "W" | "L" | "D";
  /** 悬停那一行摘要（纯文本，不带标记）。 */
  tip: string;
}

export interface RecentView {
  /** **旧 → 新**：曲线从左往右读，最右边那个点是最近一场。 */
  runs: RunView[];
  wins: number;
  /** 滚动胜率的折线（`viewBox="0 0 560 108"`）。 */
  line: string;
  /** 同一条线收口成的面积块。 */
  area: string;
}

const SPARK_W = 560;
/** 纵轴铺满 0–100%（54 = 50% 那条基准虚线）。压缩量程的话，第一场之后必然是 0% 或 100%，会冲出画布。 */
const SPARK_Y = (p: number) => 104 - p * 100;

/**
 * 近 20 场 → 一排结果点 + 滚动胜率曲线。
 *
 * 入参是 PostgREST 直接给的那一截：**新 → 旧**（`order=finished_at.desc&limit=20`）。
 * 翻转在这儿做，不在页面里——「哪一头是最近一场」搞反了画出来的曲线是反的，
 * 而反的曲线一样很像真的，肉眼查不出来。
 *
 * 滚动胜率 = 从这 20 场里最旧的那一场起的**累计**胜率（第 i 个点 = 前 i+1 场的胜率）。
 * 平局按「没赢」算进分母——它确实不是一场胜。
 *
 * 一行都没有 → null（页面走空状态，不画一条 0% 的直线）。
 */
export function projectRecent(rows: readonly RecentRow[]): RecentView | null {
  if (rows.length === 0) return null;

  const oldestFirst = [...rows].reverse();
  const runs: RunView[] = oldestFirst.map((r) => {
    const skill = r.skill_id ? (skillDef(r.skill_id)?.name ?? r.skill_id) : "没有技能";
    const tail = r.won ? "打完收工" : `收场还剩 ${r.hand_left} 张`;
    return {
      result: r.won === null ? "D" : r.won ? "W" : "L",
      tip: `${skill} · ${r.turns} 回合 · ${tail}`,
    };
  });

  let won = 0;
  const pts = runs.map((r, i) => {
    if (r.result === "W") won++;
    return won / (i + 1);
  });
  // 只有一场时两端各放一个点：单点的 `M…` 什么都画不出来，一条横线才看得见
  const xs = pts.length > 1 ? pts.map((_, i) => (i / (pts.length - 1)) * SPARK_W) : [0, SPARK_W];
  const ys = pts.length > 1 ? pts : [pts[0], pts[0]];
  const line = xs
    .map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${SPARK_Y(ys[i]).toFixed(1)}`)
    .join(" ");

  return { runs, wins: won, line, area: `${line} L${SPARK_W} 108 L0 108 Z` };
}

/** `achievement_defs` 的一行（只取页面用得上的列）。 */
export interface DefRow {
  id: string;
  tier: Tier;
  mark: string;
  name: string;
  descr: string;
  stat_key: string | null;
  stat_goal: number | null;
  sort: number;
  unlock_rate: number | null;
}

export function projectProfile(
  raw: Partial<PlayerStats> | null | undefined,
  ownedIds: readonly string[],
  defs: readonly DefRow[],
): ProfileView {
  const s = raw ?? {};
  const games = num(s.games);
  const wins = num(s.wins);
  const draws = num(s.draws);
  const gamesFirst = num(s.gamesFirst);

  const bySkill = tallies(s.bySkill);
  const vsPlayer = tallies(s.vsPlayer);
  const withAlly = tallies(s.withAlly);
  const byCard = counts(s.byCard);

  const owned = new Set(ownedIds);
  const achievements: AchievementView[] = [...defs]
    .sort((a, b) => a.sort - b.sort)
    .map((d) => {
      const has = owned.has(d.id);
      // 进度条只给「计数型且还没拿到」的——拿到了就不必再显示 25/25
      const done = d.stat_key ? num((s as Record<string, unknown>)[d.stat_key]) : 0;
      return {
        id: d.id, tier: d.tier, mark: d.mark, name: d.name, descr: d.descr,
        owned: has,
        progress: !has && d.stat_key && d.stat_goal ? [Math.min(done, d.stat_goal), d.stat_goal] : null,
        rate: d.unlock_rate ?? null,
      };
    });

  // 「下一枚」= 完成比例最高的那个未解锁项。差一点点是最强的回访钩子
  const nextUp = achievements
    .filter((a) => a.progress && a.progress[0] > 0)
    .sort((a, b) => b.progress![0] / b.progress![1] - a.progress![0] / a.progress![1])[0] ?? null;

  const mastery: MasteryRow[] = Object.entries(bySkill)
    .filter(([, t]) => num(t?.n) >= MASTERY_MIN_GAMES)
    .map(([id, t]) => {
      const def = skillDef(id);
      return {
        id,
        name: def?.name ?? id,
        sigil: def?.suit_rank ?? "?",
        games: num(t.n),
        winPct: Math.round((num(t.w) / num(t.n)) * 1000) / 10,
      };
    })
    .sort((a, b) => b.winPct - a.winPct || b.games - a.games);

  // 宿敌 = 输给他最多的那个人；只在真交手过时才有
  const nemesis = Object.entries(vsPlayer)
    .map(([userId, t]) => ({ userId, n: num(t.n), lost: num(t.n) - num(t.w) }))
    .sort((a, b) => b.lost - a.lost || b.n - a.n)[0] ?? null;

  const ally = Object.entries(withAlly)
    .map(([userId, t]) => ({ userId, n: num(t.n), winPct: Math.round((num(t.w) / num(t.n)) * 1000) / 10 }))
    .sort((a, b) => b.winPct - a.winPct || b.n - a.n)[0] ?? null;

  const favEntry = Object.entries(byCard).sort((a, b) => b[1] - a[1])[0];
  const favCard = favEntry
    ? { ...parseCardKey(favEntry[0]), label: faceLabel(parseCardKey(favEntry[0]).face), n: favEntry[1] }
    : null;

  const hist = (Array.isArray(s.diceHist) ? s.diceHist : [0, 0, 0]) as [number, number, number];
  const diceTotal = hist[0] + hist[1] + hist[2];

  return {
    // 一局都没打过 → 页面走空状态，而不是铺一屏 0
    empty: games === 0,
    games,
    wins,
    losses: Math.max(0, games - wins - draws),
    draws,
    winRate: rate(wins, games),
    firstRate: rate(num(s.winsFirst), gamesFirst),
    laterRate: rate(wins - num(s.winsFirst), games - gamesFirst),
    streakCur: num(s.streakCur),
    streakBest: num(s.streakBest),
    avgTurns: per(num(s.turnsTotal), games),
    avgCardsPlayed: per(num(s.cardsPlayed), games),
    avgPunishTaken: per(num(s.punishTaken), games),
    avgActivations: per(num(s.skillsActivated), games),
    collected: Object.keys(bySkill).length,
    godsCollected: Object.keys(bySkill).filter((id) => id.startsWith("god-")).length,
    mastery,
    nemesis: nemesis && nemesis.n > 0 ? nemesis : null,
    ally: ally && ally.n > 0 ? ally : null,
    favCard,
    dice: { hist, total: diceTotal, twoPct: diceTotal > 0 ? Math.round((hist[2] / diceTotal) * 1000) / 10 : null },
    uno: {
      called: num(s.unoCalled), caught: num(s.unoCaught),
      gotCaught: num(s.unoGotCaught), miscalled: num(s.unoMiscalled),
    },
    punish: {
      taken: num(s.punishTaken), max: num(s.punishMax),
      deflected: num(s.punishDeflected), deflectedMax: num(s.punishDeflectedMax),
    },
    misc: {
      alliancesFormed: num(s.alliancesFormed), alliancesRefused: num(s.alliancesRefused),
      raids: num(s.raidsStarted), marks: num(s.marksGained), sealed: num(s.sealedCount),
    },
    records: {
      fastestWin: typeof s.fastestWinTurns === "number" ? s.fastestWinTurns : null,
      longestGame: num(s.longestGameTurns),
      mostCardsOneTurn: num(s.mostCardsOneTurn),
      cardsDrawn: num(s.cardsDrawn),
    },
    achievements,
    achievementsOwned: achievements.filter((a) => a.owned).length,
    nextUp,
  };
}
