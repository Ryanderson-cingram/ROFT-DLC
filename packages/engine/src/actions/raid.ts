/**
 * 劫营♦10（04 ♦10 / 01-G5 / 03 glossary / 06-Q34 / 06-Q56）。
 *
 * **2026-07-31 裁定：触发面是「任何人打出任何一张牌」**——不再限于并列/神化的多打。
 * 每有一张牌落地就给劫营者一次机会：打出一张与它同色同数的牌就打断这一轮——已打的留在
 * 牌河、并列没摆的留在他手上、被打断者摸 1、剩余神化轮作废、从**打断者的下家**继续（G5）。
 *
 * 「可响应并列任意一张」（03 glossary）在逐张模型下的含义就是：每张落地都会给他一次机会，
 * 他挑哪张就是挑哪张。窗口只针对**刚打出的那张**，所以打断牌必须与它同色同数——
 * 「同数」只有数字牌成立，所以功能牌/无色牌（含惩罚链上的叠链牌）天然不在触发面内。
 *
 * 窗口语义是 `punishStack` 那种**先到先得**：一人响应，窗口即关。
 */
import { sealedOff } from "./dice.ts";
import { drawCards, drawEvents, giveTo } from "./draw.ts";
import { placeParallel, settlePlay } from "./play-cards.ts";
import { commit, isNumberCard, passTurn, reject, windowIdOf } from "../legal.ts";
import { SKILL_DATA } from "../skills/draw-passives.ts";
import { paramsOfEffect } from "../skills/params.ts";
import type { SkillData } from "../skills/draw-passives.ts";
import type { SkillEffect } from "../skills/types.ts";
import type { Action, ApplyResult, Board, Card, Ctx, EngineEvent, GameState } from "../types.ts";

const WINDOW_MS = 30_000;
/** 打断（要带那张牌）与放弃。后者也是超时的默认。 */
export const RAID = "raid";
export const PASS = "pass";

/**
 * 04 ♦10 那条子效果：`kind: response` + `window: interrupt` + `modifies: turn_flow`。
 * 按定义找，不认技能 id——远星♦J 同样是 interrupt 的 response，靠它点名的
 * `play_legality` / `color_rule`（而不是 `turn_flow`）区分开。
 */
const isRaid = (e: SkillEffect) =>
  e.kind === "response" && e.window === "interrupt" && !!e.modifies?.includes("turn_flow");

/**
 * 这个座位此刻能不能劫营。只查封印一个压制源（01-P9）：窗口开着时打断者不是 `currentSeat`，
 * 而惩罚链挂着时并列压根打不出来，`punishTurn` 那一源不可能命中——同 `farstarEffect`。
 */
function raidEffect(b: Board, seat: number, data: SkillData): SkillEffect | undefined {
  const id = b.skills[seat];
  // V3：没亮出的技能对局面毫无影响
  const def = id && b.revealed[seat] ? data.byId.get(id) : undefined;
  if (!def || sealedOff(b, seat, def)) return undefined;
  return (def.effects ?? []).find(isRaid);
}

/**
 * 能截「刚打出的那张」的牌：同色**且**同数（04 ♦10「同色同数同时打出」）。
 * 「同数」只有数字牌谈得上，所以功能牌与无色牌两边都截不了、也不可被截——
 * 04 的 2026-07-31 裁定「劫营要同色同数，本来就只可能是数字牌」正是这个意思。
 */
export const canRaid = (c: Card, top: Card) =>
  isNumberCard(c) && c.color === top.color && c.face === top.face;

/** 刚摆出 `top` 之后，此刻能打断的座位（其他座位、亮着劫营、手里有得截）。 */
export function raidActors(b: Board, seat: number, top: Card, data: SkillData = SKILL_DATA): number[] {
  return b.hands.flatMap((h, i) =>
    i !== seat && raidEffect(b, i, data) && h.some((c) => canRaid(c, top)) ? [i] : [],
  );
}

/** 由出牌路径在一张牌落地、且确实有人截得动时调用（单张 `resolvePlay` 与并列 `placeParallel`）。 */
export function openRaidWindow(
  state: GameState,
  board: Board,
  seat: number,
  actors: number[],
  card: Card,
  ctx: Ctx,
  before: EngineEvent[],
): ApplyResult {
  const deadline = new Date(Date.parse(ctx.now) + WINDOW_MS).toISOString();
  // commit 会清窗口，所以窗口手动接回去（同 draft.ts::assign）。回合还没移交——
  // pass 之后出牌者接着摆下一张 / 把这次出牌结算完，所以 `resume` 是那之后该到的相位。
  const next: GameState = {
    ...commit(state, board, "afterPlay"),
    pendingWindow: { type: "interrupt", actors, deadline, defaultChoice: PASS, resume: "turnStart" },
  };
  return {
    state: next,
    events: [
      ...before,
      // 刚打出的那张本来就在牌顶，是公开信息；窗口针对的正是它
      { type: "raidWindowOpened", public: { windowId: windowIdOf(next), actors, seat, card, deadline } },
    ],
  };
}

/**
 * 窗口结算。由 punish.ts 的 respond / claimTimeout 在通用校验（窗口存在/未过期/是 actor）之后转来。
 * `pass`（含超时）= 并列者接着摆下一张；`raid` = 打断。先到先得，两者都当场关窗口。
 */
export function settleRaid(
  state: GameState,
  action: { seat: number; choice: string; cardIds?: string[] },
  ctx: Ctx,
  data: SkillData = SKILL_DATA,
): ApplyResult {
  const b = state.board!;
  const pend = b.parallelPending;
  const single = b.playPending;
  // 被打断者：并列摆到一半的那个人，或刚打出单张的那个人
  const victim = pend?.seat ?? single?.seat;
  if (victim === undefined) return reject(state, "no_window");

  if (action.choice === PASS) {
    // `shufflePending` 也一并摘掉：今天到不了（劫营要同色同数，无色的洗牌牌截不了，
    // 所以「洗牌中间态 + 打断窗口」并存的牌桌走不到这里），但触发面一旦再放宽就会留下
    // 一个没有窗口的孤儿中间态——正是 fuzz 那条「中间态与窗口同生共死」要抓的东西
    const { parallelPending: _resumed, playPending: _done, shufflePending: _shuffle, ...cleared } = b;
    // 并列：接着摆下一张（声明时的 chosenColor 随 pending 一起透传）
    if (pend) return placeParallel(state, cleared, pend, ctx, data);
    // 单张：把这次出牌余下的结算跑完（收官 / 获盗 / 惩罚链 / 交回合）
    return settlePlay(state, cleared, single!.seat, b.playedPile[0], single!.dice, ctx, [], data);
  }
  if (action.choice !== RAID) return reject(state, "bad_choice");

  const e = raidEffect(b, action.seat, data);
  if (!e) return reject(state, "skill_unavailable");
  const played = action.cardIds?.length === 1
    ? b.hands[action.seat].find((c) => c.id === action.cardIds![0])
    : undefined;
  if (!played) return reject(state, "not_in_hand");
  // 窗口只针对**刚摆的那张**（= 牌顶）：异色同数、同色异数都截不了
  if (!canRaid(played, b.playedPile[0])) return reject(state, "bad_choice");

  const { parallelPending: _interrupted, playPending: _stopped, shufflePending: _voided, ...rest } = b;
  // 打断牌压牌顶，跟牌目标变成它（用户原话「从劫营的人的下家按黄 2 继续」）。
  // 已摆出的牌留在牌河不回滚（G5 打断的是剩余轮次与行动权，不是没收已打的牌）；
  // `remaining` 本来就没离手，清掉 `parallelPending` 它们就留在手上了。
  const interrupted: Board = {
    ...rest,
    hands: rest.hands.map((h, i) => (i === action.seat ? h.filter((c) => c.id !== played.id) : h)),
    playedPile: [played, ...rest.playedPile],
    activeColor: played.color,
    activeFace: null,
    drawnPlayable: null,
  };
  // 2026-07-31 裁定：打断牌是自己最后一张手牌 → **算赢**。
  // 打断牌确实打进了牌河，U5 只要求末牌是数字牌（劫营要同色同数，本来就只可能是数字牌，
  // 但仍照 U5 判一次，将来神化连出的功能牌也走这条路）。胜利优先：被打断者不再摸那 1 张、
  // 回合也不再流转，与「打出末牌获胜」在 play-cards 里的收场一致。
  if (interrupted.hands[action.seat].length === 0 && isNumberCard(played)) {
    return {
      state: commit(state, { ...interrupted, punish: undefined, winner: action.seat }, "finished"),
      events: [{ type: "raided", public: { by: action.seat, target: victim, card: played, voided: 0, won: true } }],
    };
  }
  // G5：被打断者摸 1。这 1 张是**他人技能**造成的，所以 initiator 是打断者——
  // 恩惠♥1 减得到它（06-Q56；−2 至少 1 → 仍摸 1）。张数从定义的 values 读。
  const r = drawCards(
    interrupted,
    { kind: "skill", base: paramsOfEffect(e).counts.draws ?? 0, seat: victim, initiator: action.seat },
    ctx.rng,
  );
  const drawn: Board = { ...r.board, hands: giveTo(r.board, victim, r.drawn) };
  // G5：打断者**不进回合**，从他的下家继续
  const passed = passTurn(drawn, action.seat);
  const board: Board = {
    ...drawn,
    ...passed,
    // 06-Q34：劫营占**打断者自己**的那一条主动。passTurn 刚把全表清零（那是给新回合的），
    // 所以这里补回来。本轮他已经没有回合了，当前没有可观察后果，但 V7 的账要诚实。
    activatedThisTurn: passed.activatedThisTurn.map((v, i) => (i === action.seat ? true : v)),
  };
  return {
    state: commit(state, board, "turnStart"),
    events: [
      // voided = 作废的神化轮数（G5）。神化本批未实现，恒为 0
      { type: "raided", public: { by: action.seat, target: victim, card: played, voided: 0, won: false } },
      ...drawEvents(victim, r.drawn, r.reshuffledOrder),
    ],
  };
}

/**
 * 打断窗口里的合法动作：每张截得动的牌各一条（UI 直接渲染成可点的牌），外加放弃。
 * 客户端不判同色同数——它只把这里给的动作原样渲染。
 */
export function raidActions(b: Board, seat: number, windowId: string): Action[] {
  const top = b.playedPile[0];
  return [
    ...b.hands[seat]
      .filter((c) => canRaid(c, top))
      .map((c): Action => ({ type: "respond", seat, windowId, choice: RAID, cardIds: [c.id] })),
    { type: "respond", seat, windowId, choice: PASS },
  ];
}
