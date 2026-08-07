/**
 * 随机对局跑测器（属性测试）。
 *
 * 从 `legalActions` 里随机挑动作跑完整局，每一步之后断言全局不变式：
 * 牌不增不减、id 不重、version 每次 +1、挂起态互斥、非终局不卡死、applyAction 不抛不改输入。
 *
 * 完全确定：rng 是 `helpers.ts` 的 `lcg(seed)`，动作选择用同一族 lcg。任何一条失败都会
 * 打印 seed + 完整动作序列，可以照着重放。
 *
 * 跑法：`pnpm --filter @roft/engine test fuzz`
 *       环境变量 `FUZZ_GAMES=2000 FUZZ_SEED0=1` 可调局数与起始 seed。
 */
import { describe, expect, it } from "vitest";
import { applyAction, isPlayable, legalActions, projectView } from "../src/index.ts";
import { stalemate } from "../src/legal.ts";
import { multiPlayAllowed } from "../src/skills/primitives/playability.ts";
import { SKILL_DATA } from "../src/skills/draw-passives.ts";
import { lcg, lobby } from "./helpers.ts";
import type { Action, Card, Color, GameState, RulePack } from "../src/types.ts";

const COLORS: Color[] = ["R", "G", "B", "Y"];
const MAX_STEPS = 20_000;

interface Violation {
  seed: number;
  step: number;
  kind: string;
  detail: string;
  trace: string[];
}

/** 牌的总数：所有可见位置之和。挂起态不藏牌（swap/parallel 的牌都还在手上）。 */
function allCards(s: GameState): Card[] {
  const b = s.board!;
  return [...b.drawPile, ...b.playedPile, ...b.discardPile, ...b.hands.flat()];
}

/** legalActions 给出的动作有些缺「提交前的客户端选择」（定色 / 三选一 / 代价牌 / 宣言），这里补上。 */
function enrich(state: GameState, a: Action, rand: () => number): Action {
  const b = state.board!;
  if (a.type === "playCards") {
    const cards = a.cardIds.map((id) => b.hands[a.seat].find((c) => c.id === id)!).filter(Boolean);
    const needColor = cards.some((c) => c && c.color === null) || a.cardIds.length === 4;
    // 03 §4 五彩：变色牌的色只能维持现状，随便挑一个只会被拒（那条路由单测钉，这里要跑通）
    const locked = cards.some((c) => c?.color === null) && b.statuses[a.seat]?.includes("五彩")
      ? b.activeColor : null;
    const out: Action = needColor
      ? { ...a, chosenColor: locked ?? COLORS[Math.floor(rand() * 4)] }
      : { ...a };
    // 洗牌牌的卡面三选一（05 §2b）。选项③是响应，不从 playCards 走
    if (out.type === "playCards" && cards.some((c) => c?.face === "shuffle"))
      out.shuffleChoice = rand() < 0.5 ? "shuffle" : "drawDiscard";
    return out;
  }
  // 洗牌③的取消牌同样要定色
  if (a.type === "respond" && a.choice === "cancel")
    return { ...a, chosenColor: COLORS[Math.floor(rand() * 4)] };
  // 近卫♥6 的交牌：同样只给一条模板，交哪几张（1 ‥ max）由跑测器现挑
  if (a.type === "respond" && a.choice === "give" && b.handOver) {
    const hand = b.hands[a.seat];
    const n = 1 + Math.floor(rand() * b.handOver.max);
    return { ...a, cardIds: hand.slice(0, n).map((c) => c.id) };
  }
  // 摸 N 弃 N：legalActions 只给一条模板（组合会爆炸），要弃哪 N 张由跑测器现挑
  if (a.type === "respond" && a.choice === "discard" && b.drawDiscard) {
    const hand = b.hands[a.seat];
    const start = Math.floor(rand() * hand.length);
    return {
      ...a,
      cardIds: Array.from({ length: b.drawDiscard.picks }, (_x, i) => hand[(start + i) % hand.length].id),
    };
  }
  if (a.type === "activateSkill") {
    const def = SKILL_DATA.byId.get(b.skills[a.seat]!);
    const e = def?.effects?.find((x) => x.key === a.effectKey);
    const discard = e?.values?.discard ?? 0;
    const out: Action = { ...a };
    if (discard > 0) out.cardIds = b.hands[a.seat].slice(0, discard).map((c) => c.id);
    // 影歌① 要求当众宣言一张「色 + 数」
    if (def?.id === "diamond-3" && a.effectKey === "1")
      out.declared = { color: COLORS[Math.floor(rand() * 4)], face: String(Math.floor(rand() * 10)) as Card["face"] };
    return out;
  }
  return a;
}

/** legalActions 不枚举并列♥4 的多张组合（会爆炸），跑测器自己搭，否则劫营那条路永远盖不到。 */
function multiPlays(state: GameState, seat: number): Action[] {
  const b = state.board!;
  if (state.pendingWindow || state.phase !== "turnStart" && state.phase !== "play") return [];
  if (seat !== b.currentSeat || b.punish || b.drawnPlayable) return [];
  const def = b.skills[seat] ? SKILL_DATA.byId.get(b.skills[seat]!) : undefined;
  if (!multiPlayAllowed(b, seat, def)) return [];
  const hand = b.hands[seat];
  const out: string[][] = [];
  const byFace = new Map<string, Card[]>();
  const byColor = new Map<string, Card[]>();
  for (const c of hand) {
    if (c.color === null) continue;
    byFace.set(c.face, [...(byFace.get(c.face) ?? []), c]);
    byColor.set(c.color, [...(byColor.get(c.color) ?? []), c]);
  }
  for (const [, cs] of byFace) {
    const byCol = new Map<string, Card[]>();
    for (const c of cs) byCol.set(c.color!, [...(byCol.get(c.color!) ?? []), c]);
    for (const [, pair] of byCol) if (pair.length >= 2) out.push(pair.slice(0, 2).map((c) => c.id));
    if (cs.length >= 4) out.push(cs.slice(0, 4).map((c) => c.id));
  }
  for (const [, cs] of byColor) if (cs.length >= 6) out.push(cs.slice(0, 6).map((c) => c.id));
  // 04 ♥4：**首张**要接得上牌顶。组内顺序是提交者的自由，所以把能接的那张挪到组首；
  // 一张都接不上的组连提交的价值都没有（纯粹刷 reject）。
  return out.flatMap((ids): Action[] => {
    const i = ids.findIndex((id) =>
      isPlayable(hand.find((x) => x.id === id)!, b.playedPile[0], b.activeColor, b.activeFace),
    );
    return i < 0 ? [] : [{ type: "playCards", seat, cardIds: [ids[i], ...ids.filter((_, j) => j !== i)] }];
  });
}

function invariants(
  before: GameState,
  after: GameState,
  total: number,
  accepted: boolean,
): string | null {
  const b = after.board;
  if (!b) return "board 消失";
  if (accepted && after.version !== before.version + 1)
    return `version 应 +1，实际 ${before.version} → ${after.version}`;
  if (!accepted && after.version !== before.version)
    return `被拒的动作改了 version：${before.version} → ${after.version}`;

  const cards = allCards(after);
  if (cards.length !== total) return `牌总数 ${cards.length} ≠ ${total}`;
  const ids = new Set(cards.map((c) => c.id));
  if (ids.size !== cards.length) return `牌 id 重复（${cards.length} 张只有 ${ids.size} 个 id）`;
  if (b.playedPile.length === 0) return "playedPile 空了（牌顶不存在）";

  const n = b.hands.length;
  if (b.currentSeat < 0 || b.currentSeat >= n) return `currentSeat 越界：${b.currentSeat}`;
  if (b.hands.some((h) => h.length < 0)) return "手牌数为负";

  // 挂起态互斥 / 配套
  const w = after.pendingWindow;
  if (after.pendingDice && w?.type !== "diceTakeover")
    return `pendingDice 挂着但窗口是 ${w?.type ?? "无"}`;
  if (w?.type === "diceTakeover" && !after.pendingDice) return "diceTakeover 窗口没有 pendingDice";
  if (b.swap && w?.type !== "swapReturn") return `board.swap 挂着但窗口是 ${w?.type ?? "无"}`;
  if (w?.type === "swapReturn" && !b.swap) return "swapReturn 窗口没有 board.swap";
  if (b.soulHarvest && w?.type !== "soulHarvest") return `soulHarvest 挂着但窗口是 ${w?.type ?? "无"}`;
  if (w?.type === "soulHarvest" && !b.soulHarvest) return "soulHarvest 窗口没有上下文";
  if (b.parallelPending && w?.type !== "interrupt")
    return `parallelPending 挂着但窗口是 ${w?.type ?? "无"}`;
  if (b.playPending && w?.type !== "interrupt") return `playPending 挂着但窗口是 ${w?.type ?? "无"}`;
  if (b.parallelPending && b.playPending) return "并列与单张的中间态同时挂着";
  // 洗牌牌的取消窗口（05 §2b）：中间态与窗口同生共死。选项②摸完就换成 drawDiscard 那个中间态了
  if (b.shufflePending && w?.type !== "shuffleCancel")
    return `shufflePending 挂着但窗口是 ${w?.type ?? "无"}`;
  if (w?.type === "shuffleCancel" && !b.shufflePending) return "shuffleCancel 窗口没有 shufflePending";
  // 摸 N 弃 N（03 §2）：同上，且必须记得住刚摸的那几张（超时无从默认）
  if (b.drawDiscard && w?.type !== "drawDiscard") return `drawDiscard 挂着但窗口是 ${w?.type ?? "无"}`;
  if (w?.type === "drawDiscard" && !b.drawDiscard) return "drawDiscard 窗口没有中间态";
  if (b.drawDiscard) {
    const { picks, drawnIds, seat } = b.drawDiscard;
    // 弃不了那么多就不该开这个窗口（03 §2：摸到手里的不能少于弃的）
    if (picks <= 0 || picks > drawnIds.length) return `drawDiscard 的 picks=${picks} 与摸到的 ${drawnIds.length} 张对不上`;
    if (b.hands[seat].length < picks) return "drawDiscard 要弃的比手上的还多";
  }
  // 合纵/连横②的「要不要摸 N 弃 N」：同上，中间态与窗口同生共死
  if (b.drawOffer && w?.type !== "drawOffer") return `drawOffer 挂着但窗口是 ${w?.type ?? "无"}`;
  if (w?.type === "drawOffer" && !b.drawOffer) return "drawOffer 窗口没有中间态";
  if (b.drawOffer && b.drawOffer.req.base <= 0) return `drawOffer 的 picks=${b.drawOffer.req.base}`;
  // 近卫♥6 的交牌窗口：中间态与窗口同生共死，且上限不能超过他手上有的
  if (b.handOver && w?.type !== "handOver") return `handOver 挂着但窗口是 ${w?.type ?? "无"}`;
  if (w?.type === "handOver" && !b.handOver) return "handOver 窗口没有中间态";
  if (b.handOver && (b.handOver.max <= 0 || b.handOver.max > b.hands[b.handOver.seat].length))
    return `handOver 的 max=${b.handOver.max} 与手牌 ${b.hands[b.handOver.seat].length} 张对不上`;
  // 结盟（S13）：一锤定音——`alliance` 一旦写上就不该再被改动，窗口也只开在它还缺席的时候
  if (w?.type === "alliance" && b.alliance) return "结盟窗口挂着，但 alliance 已经写死了";
  // 打断窗口总要有一个中间态：并列摆到一半，或单张落地待结算
  if (w?.type === "interrupt" && !b.parallelPending && !b.playPending) return "interrupt 窗口没有中间态";
  if (w?.type === "punishStack" && !b.punish) return "punishStack 窗口没有惩罚链";
  if (w && w.actors.length === 0) return `窗口 ${w.type} 的 actors 为空`;
  if (w && w.actors.some((a) => a < 0 || a >= n)) return `窗口 ${w.type} 的 actor 越界`;

  // U6（2026-08-01 改判）：已喊的作用域是「你的这个回合」——回合内手牌怎么波动都不清，
  // 回合外则必须恰 1 张。所以不变式从「与手牌数一致」放宽到这一条，不能再严
  if (b.saidUno.some((v, i) => v && i !== b.currentSeat && b.hands[i].length !== 1))
    return "回合外的 saidUno 与手牌数不一致";
  // 标记不为负
  if (b.marks.some((m) => Object.values(m).some((v) => v < 0))) return "标记计数为负";
  // 状态不叠层
  if (b.statuses.some((ss) => new Set(ss).size !== ss.length)) return "状态叠了多层";

  // 终局一致性。终局有两种：有赢家（手上摆空），或 U8 平局（洗满 2 次后牌堆再见底）
  if (after.phase === "finished") {
    if (b.winner === undefined) {
      if (!stalemate(b)) return "finished 却既没有 winner 也不满足 U8 的平局条件";
    } else if (b.hands[b.winner].length !== 0) return `winner ${b.winner} 手上还有牌`;
  } else if (b.winner !== undefined) {
    return `winner 已定但 phase 是 ${after.phase}`;
  }
  // U8：牌堆枯竭必须收场。审查报告里那个「洗完两次后无限转圈」的死局钉在这里——
  // 回合交接是判定时点，所以任何一个 turnStart 的局面都不该还满足平局条件。
  if (after.phase === "turnStart" && !after.pendingWindow && stalemate(b))
    return "牌堆已枯竭却没有判平局（U8）";
  // 非终局：手牌为 0 的人只能是 winner。
  // 例外：司夜②盲抽走对手仅剩的那张时，`swapReturn` 窗口挂着期间对手确实是 0 张（还牌即恢复）；
  // 洗牌当末牌打出时，`shuffleCancel` 窗口挂着期间打出者也是 0 张（重分或 U5 补摸即恢复）。
  if (
    after.phase !== "finished" && w?.type !== "swapReturn" && w?.type !== "shuffleCancel" &&
    b.hands.some((h) => h.length === 0)
  )
    return `非终局却有座位手牌为 0（${b.hands.map((h) => h.length).join("/")}）`;

  // 不卡死：有窗口时至少一个 actor 有动作；没窗口时至少一个座位有动作
  if (after.phase !== "finished") {
    const seats = w ? w.actors : b.hands.map((_, i) => i);
    const any = seats.some((s) => legalActions(after, s).length > 0);
    if (!any) return `卡死：phase=${after.phase} window=${w?.type ?? "无"}，没有座位有合法动作`;
  }
  return null;
}

/** 跑到过哪些路径。跑完打印，用来判断这轮压测的置信度。 */
const COVER = {
  events: new Map<string, number>(), windows: new Map<string, number>(),
  finished: 0, unfinished: 0, draws: 0,
};
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/**
 * 抽 3 选 1 是随机的，罕见的技能组合（并列 + 劫营同桌之类）很难自然凑齐。
 * `forceSkills` 直接把技能塞给座位并全部亮出，跳过 draft——只动测试里的状态，不碰引擎。
 */
function runGame(
  seed: number,
  seats: number,
  forceSkills?: (string | null)[],
  rulePack: RulePack = "base",
): Violation | null {
  const rng = lcg(seed);
  const pick = lcg(seed * 7919 + 13);
  let t = Date.parse("2026-07-28T12:00:00.000Z");
  const now = () => new Date(t).toISOString();
  const trace: string[] = [];

  let state = lobby(seats, rulePack);
  const fail = (step: number, kind: string, detail: string): Violation => ({ seed, step, kind, detail, trace });

  const step0 = applyAction(state, { type: "startGame", seat: 0 }, { rng, now: now() });
  state = step0.state;
  trace.push(JSON.stringify({ type: "startGame", seat: 0 }));
  if (forceSkills) {
    const { draftOptions: _skip, ...b } = state.board!;
    state = {
      ...state,
      phase: "turnStart",
      pendingWindow: undefined,
      board: { ...b, skills: b.skills.map((_, i) => forceSkills[i] ?? null), revealed: b.skills.map(() => true) },
    };
  }
  const total = allCards(state).length;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (state.phase === "finished") {
      COVER.finished++;
      if (state.board!.winner === undefined) COVER.draws++;
      return null;
    }

    const w = state.pendingWindow;
    if (w) bump(COVER.windows, w.type);
    const candidates: { seat: number; action: Action }[] = [];
    const seatList = state.board!.hands.map((_, i) => i);
    // U6：喊 UNO 的按钮**常亮**，但手牌不是 1 张时按下去要罚摸 2（虚喊）。纯均匀随机的牌手
    // 会一直按它，两轮就把牌堆抽干——实测 920 局全部变成 U8 平局，没有一局有人打到 1 张牌，
    // 出牌/收官那半边的覆盖全没了。理性玩家只在恰 1 张时喊，所以这里照着理性走，
    // 另留 2% 的手滑概率把虚喊那条路也盖到。
    const sane = (a: Action, seat: number) =>
      a.type !== "callUno" || state.board!.hands[seat].length === 1 || pick() < 0.02;
    for (const s of seatList) {
      for (const a of legalActions(state, s)) if (sane(a, s)) candidates.push({ seat: s, action: a });
      for (const a of multiPlays(state, s)) candidates.push({ seat: s, action: a });
    }
    // 超时结算：任何成员在 deadline 之后都能催
    if (w) {
      const wid = projectView(state, w.actors[0]).windowId!;
      candidates.push({ seat: seatList[Math.floor(pick() * seatList.length)], action: { type: "claimTimeout", seat: 0, windowId: wid } });
    }
    if (candidates.length === 0) return fail(step, "卡死", `phase=${state.phase} window=${w?.type ?? "无"}`);

    // 纯均匀随机的牌手摸得比打得多，对局收敛不了。八成的步数优先出牌，剩下两成完全随机
    // ——既跑得完，又不丢掉摸牌 / 亮技能 / 抓漏喊这些分支的覆盖。
    const multi = candidates.filter((c) => c.action.type === "playCards" && c.action.cardIds.length > 1);
    // 并列♥4 + 劫营♦10 的组合天生罕见（同色同数只有 3 张），不偏一下就几乎盖不到 interrupt 窗口
    const pool =
      multi.length > 0 && pick() < 0.5
        ? multi
        : pick() < 0.8 && candidates.some((c) => c.action.type === "playCards")
          ? candidates.filter((c) => c.action.type !== "drawCard")
          : candidates;
    const chosen = pool[Math.floor(pick() * pool.length)];
    let action = enrich(state, chosen.action, pick);
    if (action.type === "claimTimeout") {
      action = { ...action, seat: chosen.seat };
      t += 120_000; // 推过 deadline
    } else {
      t += Math.floor(pick() * 2000);
    }

    const snapshot = JSON.stringify(state);
    let result;
    try {
      result = applyAction(state, action, { rng, now: now() });
    } catch (e) {
      trace.push(JSON.stringify(action));
      return fail(step, "抛异常", `${(e as Error).message}\n  动作 ${JSON.stringify(action)}`);
    }
    if (JSON.stringify(state) !== snapshot) {
      trace.push(JSON.stringify(action));
      return fail(step, "改了输入 state", JSON.stringify(action));
    }
    trace.push(JSON.stringify(action) + (result.rejected ? ` [rejected:${result.rejected.reason}]` : ""));
    for (const e of result.events) bump(COVER.events, e.type);
    if (result.rejected) bump(COVER.events, `rejected:${result.rejected.reason}`);

    const bad = invariants(state, result.state, total, !result.rejected);
    state = result.state;
    if (bad) return fail(step, "不变式", bad);
  }
  COVER.unfinished++;
  return fail(MAX_STEPS, "跑不完", `${MAX_STEPS} 步还没终局（活锁？）phase=${state.phase}`);
}

const report = (found: Violation[]) =>
  found
    .map(
      (v) =>
        `\n=== seed=${v.seed} step=${v.step} [${v.kind}] ===\n${v.detail}\n  动作序列（最后 30 条）:\n` +
        v.trace.slice(-30).map((l, i) => `    ${Math.max(0, v.trace.length - 30) + i}: ${l}`).join("\n"),
    )
    .join("\n");

const GAMES = Number(process.env.FUZZ_GAMES ?? 200);
const SEED0 = Number(process.env.FUZZ_SEED0 ?? 1);

/** 已接线的技能，用来搭「罕见但合法」的同桌组合。接一个加一个（spec §5.3）。 */
const ALL = [
  "heart-1", "heart-3", "heart-4", "diamond-1", "diamond-2", "diamond-3", "diamond-10", "diamond-j", "spade-1", "club-3",
  // 第二批：伤逝♥10（L1 替换）、异议♥8（弹链 + 弃异）、忍戒♠J（L6 多摸再弃）、八门♠8（摸 8 弃 8 + 五彩）
  "heart-10", "heart-8", "spade-j", "spade-8", "spade-5", "spade-6", "heart-6", "heart-5", "club-5", "heart-9",
];
/** 互相咬得最紧的几桌：并列 × 劫营、强袭 × 掷骰系、血棘 × 恩惠、影歌 × 司夜… */
const COMBOS: string[][] = [
  ["heart-4", "diamond-10", "diamond-1", "diamond-j"],
  ["heart-4", "diamond-10", "diamond-10", "heart-4"],
  ["diamond-1", "diamond-2", "club-3", "heart-1"],
  ["diamond-3", "club-3", "heart-1", "diamond-2"],
  ["diamond-2", "heart-1", "diamond-j", "heart-3"],
  ["heart-4", "diamond-1", "diamond-3", "diamond-10"],
  ["club-3", "diamond-10", "heart-4", "diamond-1"],
  ["spade-1", "diamond-3", "diamond-2", "diamond-j"],
  ["heart-3", "heart-4", "diamond-10", "club-3"],
  ["diamond-j", "diamond-1", "diamond-2", "diamond-3"],
  // 惩罚链上咬得最紧的一桌：忍戒（吃完多摸再弃）× 异议（把链弹回去）× 伤逝（改写摸几张）
  // × 血棘（吃下即封印，把前三支关掉）
  ["spade-j", "heart-8", "heart-10", "diamond-2"],
  ["spade-j", "diamond-1", "heart-1", "diamond-j"],
  // 八门的五彩会把「只靠颜色接上」的牌全锁掉，配并列/精英正好压出牌那条路
  ["spade-8", "heart-4", "heart-3", "diamond-10"],
  // 合纵/连横：打出功能牌就问一次「要不要摸弃」，配惩罚系正好压住「窗口套窗口」那条路
  ["spade-5", "spade-6", "diamond-1", "heart-8"],
  ["spade-6", "spade-6", "spade-5", "diamond-2"],
  // 近卫（吃 ≥4 的惩罚就交牌给链首）配惩罚系：链越长越容易压到它
  ["heart-6", "diamond-1", "diamond-j", "heart-8"],
  // 神授（无牌可出可以不摸）：牌堆见底那一带最容易压到它与 U8 平局的交界
  ["heart-5", "heart-5", "spade-8", "club-3"],
  // 吟游的歌声全场生效：活泼板让人人多摸、战争序把惩罚翻倍，配惩罚系最容易压出极端牌局
  ["club-5", "diamond-1", "heart-1", "heart-10"],
  // 专精：逐段免摸 + 放宽出牌 + 定色三条一起压惩罚链与出牌合法性
  ["heart-9", "diamond-1", "diamond-j", "spade-8"],
];

describe("随机对局不变式", () => {
  it(`跑 ${GAMES} 局随机合法动作序列（自然 draft）`, () => {
    const found: Violation[] = [];
    for (let i = 0; i < GAMES; i++) {
      const v = runGame(SEED0 + i, 3 + (i % 2));
      if (v) {
        found.push(v);
        if (found.length >= 6) break;
      }
    }
    expect(found.length, report(found)).toBe(0);
  }, 900_000);

  it("跑指定技能组合的对局（全员开局即亮出）", () => {
    const found: Violation[] = [];
    outer: for (let round = 0; round < Math.max(1, Math.floor(GAMES / COMBOS.length / 2)); round++) {
      for (const [ci, combo] of COMBOS.entries()) {
        for (const seats of [3, 4]) {
          const v = runGame(SEED0 + 100_000 + round * 1000 + ci * 10 + seats, seats, combo.slice(0, seats));
          if (v) {
            found.push(v);
            if (found.length >= 6) break outer;
          }
        }
      }
    }
    expect(found.length, report(found)).toBe(0);
  }, 900_000);

  /**
   * 诸神包（05 §2b 的毒 5 张 + 洗牌 3 张）。这两张牌会改动**全体**手牌，所以
   * 「牌不增不减 / id 不重」的不变式在这里才真正被压到——单元测试只盖得到摆好的牌桌。
   */
  it("诸神包对局：毒 / 洗牌进牌堆", () => {
    const found: Violation[] = [];
    for (let i = 0; i < GAMES; i++) {
      const v = runGame(SEED0 + 500_000 + i, 3 + (i % 2), undefined, "gods");
      if (v) {
        found.push(v);
        if (found.length >= 6) break;
      }
    }
    expect(found.length, report(found)).toBe(0);
  }, 900_000);

  it("诸神包 × 咬得最紧的技能组合（全员开局即亮出）", () => {
    const found: Violation[] = [];
    outer: for (let round = 0; round < Math.max(1, Math.floor(GAMES / COMBOS.length / 2)); round++) {
      for (const [ci, combo] of COMBOS.entries()) {
        for (const seats of [3, 4]) {
          const v = runGame(SEED0 + 700_000 + round * 1000 + ci * 10 + seats, seats, combo.slice(0, seats), "gods");
          if (v) {
            found.push(v);
            if (found.length >= 6) break outer;
          }
        }
      }
    }
    expect(found.length, report(found)).toBe(0);
  }, 900_000);

  it("单技能满桌（每个技能各来一桌全亮）", () => {
    const found: Violation[] = [];
    outer: for (let round = 0; round < 6; round++)
      for (const [si, id] of ALL.entries())
        for (const seats of [3, 4]) {
          const v = runGame(SEED0 + 900_000 + round * 500 + si * 10 + seats, seats, Array(seats).fill(id));
          if (v) {
            found.push(v);
            if (found.length >= 6) break outer;
          }
        }
    expect(found.length, report(found)).toBe(0);
  }, 900_000);

  it("覆盖报告", () => {
    const fmt = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ");
    console.log(
      `\n[fuzz 覆盖] 终局 ${COVER.finished} 局（其中 U8 平局 ${COVER.draws} 局） / 未终局 ${COVER.unfinished} 局`,
    );
    console.log(`[fuzz 覆盖] 窗口: ${fmt(COVER.windows)}`);
    console.log(`[fuzz 覆盖] 事件与拒因: ${fmt(COVER.events)}`);
    expect(COVER.finished).toBeGreaterThan(0);

    // 关键路径的下限：只写 `> 0`，不写实测值——随机数一动实测值就飘，假红比没断言更糟。
    // 这几条一旦归零，说明某条分支被改死了而上面那些不变式**根本没跑到**。
    for (const w of ["interrupt", "diceTakeover", "soulHarvest", "swapReturn", "drawDiscard"])
      expect(COVER.windows.get(w) ?? 0, `窗口 ${w} 一次都没开到`).toBeGreaterThan(0);
    // unoMiscalled：跑测器会在任意手牌数下按那颗常亮的按钮，虚喊本来就该大量出现
    for (const e of ["farstarUsed", "sealed", "unoCalled", "unoCaught", "unoMiscalled"])
      expect(COVER.events.get(e) ?? 0, `事件 ${e} 一次都没发生`).toBeGreaterThan(0);
  });
});
