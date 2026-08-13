/**
 * 跨局统计与成就的类型。
 *
 * 这个包是**纯函数**：输入一局的事件流 + 终局 state，输出每个座位的增量与本局解锁。
 * 不碰 IO、不认识数据库、不 import 引擎的运行时——只 import 它的类型。
 * 于是 24 条成就的判定可以整份离线单测，那是这套系统里唯一真正复杂的部分。
 */

/** 分布类计数的形状：n = 局数 / 次数，w = 其中赢了几局。 */
export interface Tally {
  n: number;
  w: number;
}

/**
 * 一局打完给一个座位攒下的增量。
 *
 * 与 `PlayerStats` 是**同一套列**（合并规则见 `mergePrior`）——只有两处措辞不同：
 * `turns` 是这一局的回合数（累计成 `turnsTotal`），`fastestWinTurns` 输了就是 null。
 */
export interface SeatDelta {
  // ---- 战绩 ----
  games: number;
  wins: number;
  draws: number;
  /** 这一局我是不是先手（`gameStarted.starter`）。先手胜率的分母。 */
  gamesFirst: number;
  winsFirst: number;
  /** 这一局一共走了几个回合（`turnEnded` 的条数，全场共享同一个数）。 */
  turns: number;

  // ---- 牌与惩罚 ----
  cardsPlayed: number;
  cardsDrawn: number;
  /** 因惩罚链吃掉的张数（`punishAccepted.total` 之和）。 */
  punishTaken: number;
  /** 单条链吃下的最大总量。 */
  punishMax: number;
  /** 指向过我、又被我转给别人的链里最大的那一条。 */
  punishDeflectedMax: number;
  /** 把指向自己的链转出去的次数。 */
  punishDeflected: number;
  /** 单个回合里打出的最多张数。 */
  mostCardsOneTurn: number;

  // ---- UNO ----
  unoCalled: number;
  /** 我抓到别人漏喊。 */
  unoCaught: number;
  /** 我被别人抓到。 */
  unoGotCaught: number;
  unoMiscalled: number;

  // ---- 技能与盘外 ----
  skillsRevealed: number;
  skillsActivated: number;
  /** 这一局我拿的是不是四神之一。 */
  godsPlayed: number;
  diceRolled: number;
  /** 强袭三面骰的分布：下标即点数 0 / 1 / 2。 */
  diceHist: [number, number, number];
  alliancesFormed: number;
  alliancesRefused: number;
  raidsStarted: number;
  marksGained: number;
  sealedCount: number;

  // ---- 纪录（合并时取极值，不累加）----
  /** 只有赢了才有值。 */
  fastestWinTurns: number | null;
  longestGameTurns: number;

  // ---- 分布 ----
  /** 技能 id → {n, w}。这一局只可能有一个键（一人一技能）。 */
  bySkill: Record<string, Tally>;
  /** 牌面 key（`R+2` / `Wwild`）→ 打出次数。 */
  byCard: Record<string, number>;
  /** 对手 userId → {n, w}（w = 我赢了他几局）。 */
  vsPlayer: Record<string, Tally>;
  /** 结过盟的人 userId → {n, w}。 */
  withAlly: Record<string, Tally>;
}

/**
 * 这一局之内的**形态**标记，不是累计量——所以它们不进 `player_stats`，
 * 只在终局那一次判定里活着。10 条特判成就各读其中一格。
 */
export interface GameFlags {
  won: boolean;
  /** 单局内四色各打出 ≥ 8 张（满堂彩）。 */
  colorSweep: boolean;
  /** 把总量 ≥ 12 的链整条转给了别人（反手）。 */
  bigDeflect: boolean;
  /**
   * 全程**没喊过** UNO、也没被任何人抓到，并且赢了（空手接白刃）。
   *
   * 关键是「没喊」：喊了就享受 U7 的保护（`catchable` 要求「持 1 张**且未喊**」），
   * 等于没有风险。没喊 = 手上剩最后一张的那一整轮都是敞着的，谁都能点一下罚你摸 2。
   * 熬过去还赢了，才叫空手接白刃。
   *
   * 顺带把虚喊那个口子关死了：`unoMiscalled` 只在「本回合喊过」时才触发，
   * 从没喊过就不可能虚喊，不需要再单列一条判断。
   */
  bareHandedWin: boolean;
  /** 12 回合之内取胜（速通）。 */
  swiftWin: boolean;
  /** 赢了且全程没亮过技能（无相胜）。 */
  facelessWin: boolean;
  /** 赢了、拒过结盟、且一次都没结成（独狼）。 */
  loneWolfWin: boolean;
  /** 终局的本地时间落在 00:00–04:00（守夜人）。 */
  nightWatch: boolean;
  /** 赢了且中途被封印过（逆流）。 */
  defiantWin: boolean;
  /** 赢了、没摸过一张牌、也没吃过惩罚（零封之局）。 */
  spotlessWin: boolean;
  /** 赢了且牌堆已经洗满两次（归墟）。 */
  abyssWin: boolean;
}

/**
 * 一个人的**全部**累计量——`player_stats.stats` 那一列存的就是它。
 *
 * ⚠️ 它必须装下 `SeatDelta` 的每一列，不能只装「判定用得上的那些」。
 * 初版只列了判定要读的十来个字段，于是 `mergePrior` 把出牌数、摸牌数、骰子分布、
 * 宿敌这些**一路丢掉**，profile 页拿到一屏 undefined——端到端跑第一次才看见。
 * 加新统计时两处一起加，`tally.ts::zero()` 与这里的字段是一一对应的。
 */
export interface PlayerStats {
  // ---- 累加 ----
  games: number;
  wins: number;
  draws: number;
  gamesFirst: number;
  winsFirst: number;
  /** 生涯总回合数。÷ games = 场均回合。 */
  turnsTotal: number;
  cardsPlayed: number;
  cardsDrawn: number;
  punishTaken: number;
  punishDeflected: number;
  unoCalled: number;
  unoCaught: number;
  unoGotCaught: number;
  unoMiscalled: number;
  skillsRevealed: number;
  skillsActivated: number;
  godsPlayed: number;
  diceRolled: number;
  alliancesFormed: number;
  alliancesRefused: number;
  raidsStarted: number;
  marksGained: number;
  sealedCount: number;

  // ---- 取极值 ----
  punishMax: number;
  punishDeflectedMax: number;
  mostCardsOneTurn: number;
  longestGameTurns: number;
  /** 取**最小**值；从没赢过是 null。 */
  fastestWinTurns: number | null;

  // ---- 连胜（唯一一个不能靠逐列合并得出的，要知道这一局赢没赢）----
  streakCur: number;
  streakBest: number;

  // ---- 逐元素相加 ----
  diceHist: [number, number, number];

  // ---- 逐键合并 ----
  bySkill: Record<string, Tally>;
  byCard: Record<string, number>;
  vsPlayer: Record<string, Tally>;
  withAlly: Record<string, Tally>;
}

export const emptyStats = (): PlayerStats => ({
  games: 0, wins: 0, draws: 0, gamesFirst: 0, winsFirst: 0, turnsTotal: 0,
  cardsPlayed: 0, cardsDrawn: 0, punishTaken: 0, punishDeflected: 0,
  unoCalled: 0, unoCaught: 0, unoGotCaught: 0, unoMiscalled: 0,
  skillsRevealed: 0, skillsActivated: 0, godsPlayed: 0, diceRolled: 0,
  alliancesFormed: 0, alliancesRefused: 0, raidsStarted: 0, marksGained: 0, sealedCount: 0,
  punishMax: 0, punishDeflectedMax: 0, mostCardsOneTurn: 0, longestGameTurns: 0,
  fastestWinTurns: null,
  streakCur: 0, streakBest: 0,
  diceHist: [0, 0, 0],
  bySkill: {}, byCard: {}, vsPlayer: {}, withAlly: {},
});
