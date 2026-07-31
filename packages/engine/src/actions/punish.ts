import { applySeal } from "./bloodthorn.ts";
import { drawCards, drawEvents, giveTo } from "./draw.ts";
import { settleDraftPick, settleDraftTimeout } from "./draft.ts";
// 环：dice → punish（强袭①的续跑要用链与惩罚窗口）→ dice。两边点名的都是函数声明，
// 模块实例化时就绑好了，环存在也无害（同 draw-passives 的惰性说明）。
import { sealedOff, settleTakeover } from "./dice.ts";
import { settleSwapReturn } from "./nightlord.ts";
import { settleRaid } from "./raid.ts";
import { settleShuffleCancel, settleShuffleDiscard } from "./shuffle-card.ts";
import { settleHarvest } from "./soul-harvest.ts";
import { commit, nextSeat, passTurn, reject, windowIdOf } from "../legal.ts";
import { SKILL_DATA } from "../skills/draw-passives.ts";
import { spendSouls } from "../skills/handlers.ts";
import { paramsOfEffect } from "../skills/params.ts";
import { suppressesEffect } from "../skills/primitives/suppression.ts";
import type { SkillData } from "../skills/draw-passives.ts";
import type { SkillEffect } from "../skills/types.ts";
import type { Action, ApplyResult, Board, Card, Color, Ctx, GameState, PunishChain } from "../types.ts";

export { windowIdOf };

const WINDOW_MS = 30_000;
/** P1：惩罚 = 仅因 +2 / +4 的摸牌。 */
export const PUNISH_DRAW = { "+2": 2, "+4": 4 } as const;
export type PunishFace = keyof typeof PUNISH_DRAW;
export const punishFace = (c: Card): PunishFace | null =>
  c.face === "+2" || c.face === "+4" ? c.face : null;

/** P4：顶为 +2 可接 +2 或 +4；P5：顶为 +4 只能接 +4。 */
export function canStack(card: Card, chain: PunishChain): boolean {
  const face = punishFace(card);
  if (!face) return false;
  return chain.segments[chain.segments.length - 1].face === "+2" || face === "+4";
}

/**
 * P6：贡献在打出进链时结算，只作用于自己那一张，所以逐段累加而不是 `2 * count`。
 * P11：受罚侧要「先加总各段贡献再套用」，`total` 就是那个加总。
 * `draw` 缺席 = 按面值；强袭①掷骰改倍率时由调用方算好传进来（02 §7：这类修正计入 L0，不走层级）。
 */
export function extendChain(
  chain: PunishChain | undefined,
  seat: number,
  face: PunishFace,
  draw: number = PUNISH_DRAW[face],
): PunishChain {
  const segments = [...(chain?.segments ?? []), { seat, face, draw }];
  return {
    initiator: chain?.initiator ?? seat,
    segments,
    total: segments.reduce((n, s) => n + s.draw, 0),
  };
}

/** 打出 +2/+4 后开反应窗口，等下家决定叠还是吃。 */
export function openPunishWindow(state: GameState, board: Board, seat: number, ctx: Ctx): ApplyResult {
  const victim = nextSeat(board, seat);
  const next = commit(state, board, "afterPlay");
  const deadline = new Date(Date.parse(ctx.now) + WINDOW_MS).toISOString();
  const withWindow: GameState = {
    ...next,
    pendingWindow: { type: "punishStack", actors: [victim], deadline, defaultChoice: "accept", resume: "play" },
  };
  return {
    state: withWindow,
    events: [{
      type: "punishWindowOpened",
      public: { windowId: windowIdOf(withWindow), actors: [victim], total: board.punish!.total, deadline },
    }],
  };
}

/**
 * 强袭①的续跑（`ResumeSpec.kind === "assault"`）：骰子定了才知道这一段贡献几张——
 * 面值 × 点数（+2 → 0/2/4，+4 → 0/4/8）。**掷 0 贡献就是 0**，链照样成立：
 * 面子上打了 +2/+4，P4/P5 的接法只看牌面（04 ♦1，2026-07-30 补齐）。
 */
export function resumeAssault(
  state: GameState,
  board: Board,
  spec: { seat: number; face: PunishFace },
  values: number[],
  ctx: Ctx,
): ApplyResult {
  const chain = extendChain(board.punish, spec.seat, spec.face, PUNISH_DRAW[spec.face] * values[0]);
  return openPunishWindow(state, { ...board, punish: chain }, spec.seat, ctx);
}

/** P1：惩罚窗口里只有「叠」和「吃下」——除非某条技能声明了豁免（06-Q39，见 `soulSkipEffect`）。 */
const CHOICES = ["stack", "accept"];
/** 惩罚窗口里发动豁免技能的那个选项（影歌②：花魂跳过）。 */
export const SOUL_SKIP = "soul-skip";

/**
 * 这个受罚者此刻能不能在惩罚窗口里发动技能：他亮出的技能有一条主动，
 * 声明了豁免惩罚回合的压制（02 §1 `suppression_exempt`），且代价付得起（06-Q54）。
 * 一条也没有 = 老规矩，惩罚回合不能用主动技能（P1/T3）。
 */
export function soulSkipEffect(b: Board, seat: number, data: SkillData = SKILL_DATA): SkillEffect | undefined {
  const id = b.skills[seat];
  if (!id || !b.revealed[seat]) return undefined;
  return data.byId.get(id)?.effects?.find(
    (e) =>
      e.kind === "active" &&
      (e.suppression_exempt?.length ?? 0) > 0 &&
      // 窗口挂着时 currentSeat 还停在打出惩罚牌的人身上，所以按「他正处在自己的惩罚回合」来问：
      // 豁免了 punish_turn 才放行，同时被封印的照样发不了（01-P9：封印不可例外）
      !suppressesEffect({ ...b, currentSeat: seat }, seat, e) &&
      spendSouls(b, seat, paramsOfEffect(e).counts.marks ?? 0) !== null,
  );
}

/** 远星♦J 在惩罚窗口里的那个响应选项。 */
export const FARSTAR = "farstar";

/**
 * 远星♦J（04 ♦J / 01-P7 / 06-Q34 / 06-Q54 / 06-Q55）：被惩罚指向时的第三个选项。
 * 按定义找：`kind: response` + `modifies` 含 `color_rule`（「视为的 +4 用所弃 +2 的颜色」），不认技能 id。
 *
 * 只查封印一个压制源（01-P9）：它**不是**主动发动——不走 activateSkill、不占 V7，
 * 所以「惩罚回合关主动」（P1/T3）压不到它（06-Q34），与 `draw-passives` 同一条理由。
 */
function farstarEffect(b: Board, seat: number, data: SkillData): SkillEffect | undefined {
  const id = b.skills[seat];
  const def = id && b.revealed[seat] ? data.byId.get(id) : undefined;
  if (!def || sealedOff(b, seat, def)) return undefined;
  return def.effects?.find((e) => e.kind === "response" && !!e.modifies?.includes("color_rule"));
}

/** 看**链尾那段**（上家打进链的那张）：视为叠出去的那张与它同面（+2 → +2，+4 → +4）。 */
const tailFace = (chain: PunishChain): PunishFace => chain.segments[chain.segments.length - 1].face;

/**
 * 合法代价牌（04 ♦J）：尾段是 +2 → 一张**同色**的停/转；尾段是 +4 → 一张 +2（颜色任意）。
 * 尾段那张 +2 的颜色就是 `activeColor`：打出 +2 时跟色即被设成它，远星视为的 +2 也同色，两者恒等。
 */
const isCost = (c: Card, b: Board, tail: PunishFace) =>
  tail === "+2" ? (c.face === "skip" || c.face === "rev") && c.color === b.activeColor : c.face === "+2";

/**
 * 弃代价牌，视为自己也叠了一张进链，链传给下家。
 * 由 `respond` 在通用校验（窗口/actor）之后转来。
 */
export function settleFarstar(
  state: GameState,
  seat: number,
  cardIds: string[],
  ctx: Ctx,
  data: SkillData = SKILL_DATA,
): ApplyResult {
  const b = state.board!;
  const chain = b.punish;
  if (!chain) return reject(state, "no_punish");
  const e = farstarEffect(b, seat, data);
  if (!e) return reject(state, "skill_unavailable");
  const face = tailFace(chain);
  const p = paramsOfEffect(e);
  const cost = cardIds.map((id) => b.hands[seat].find((c) => c.id === id));
  // 06-Q54：代价付不起（张数不对、牌不在手上、颜色/牌面对不上尾段）就发不了
  if (cost.length !== (p.counts.discard ?? 0) || cost.some((c) => !c || !isCost(c, b, face)))
    return reject(state, "cost_unpayable");
  const paid = cost as Card[];

  const ids = new Set(cardIds);
  const discarded: Board = {
    ...b,
    hands: b.hands.map((h, i) => (i === seat ? h.filter((c) => !ids.has(c.id)) : h)),
    // 06-Q55：代价牌进**弃牌堆**；「视为打出」的那张是虚拟的，playedPile 一动不动
    discardPile: [...b.discardPile, ...paid],
    // 04 ♦J：视为的 +4 用所弃 +2 的颜色（不能另选定色）。尾段是 +2 时代价本就同色，等于没变
    activeColor: paid[0].color,
  };
  // 01-P7：这 2 张是**代价**，不计惩罚。发起者是自己，所以恩惠不减（06-Q56）
  const r = drawCards(discarded, { kind: "skill", base: p.counts.draws ?? 0, seat, initiator: seat }, ctx.rng);
  const board: Board = {
    ...r.board,
    hands: giveTo(r.board, seat, r.drawn),
    punish: extendChain(chain, seat, face),
    drawnPlayable: null,
  };
  const opened = openPunishWindow(state, board, seat, ctx);
  return {
    ...opened,
    events: [
      // 弃牌堆全公开（02 §5），所以代价牌与视为的那一段整个进 public；摸的 2 张走 private
      { type: "farstarUsed", public: { seat, discarded: paid, as: face, color: paid[0].color } },
      ...drawEvents(seat, r.drawn, r.reshuffledOrder),
      ...opened.events,
    ],
  };
}

/**
 * 远星的可点性：每张合法代价牌各给一条动作，UI 直接渲染成可点的牌。
 * ponytail: 代价恒为 1 张（04 的 `values.discard`），所以逐张给就够；出现弃 N 的版本再枚举组合。
 */
export function farstarActions(b: Board, seat: number, windowId: string, data: SkillData = SKILL_DATA): Action[] {
  if (!b.punish || !farstarEffect(b, seat, data)) return [];
  const face = tailFace(b.punish);
  return b.hands[seat]
    .filter((c) => isCost(c, b, face))
    .map((c): Action => ({ type: "respond", seat, windowId, choice: FARSTAR, cardIds: [c.id] }));
}

export function respond(
  state: GameState,
  // `chosenColor`：响应里打出的无色牌要定色（洗牌③的取消牌）。少了它 settleShuffleCancel
  // 会读到 undefined，`color_required` 静默恒成立——所以它必须留在这个类型里
  action: { seat: number; windowId: string; choice: string; cardIds?: string[]; chosenColor?: Color },
  ctx: Ctx,
): ApplyResult {
  const w = state.pendingWindow;
  if (!w) return reject(state, "no_window");
  if (action.windowId !== windowIdOf(state)) return reject(state, "stale_window");
  if (!w.actors.includes(action.seat)) return reject(state, "not_your_window");
  if (w.type === "skillDraft") return settleDraftPick(state, action.seat, action.choice);
  if (w.type === "soulHarvest") return settleHarvest(state, action, ctx, SKILL_DATA);
  if (w.type === "diceTakeover") return settleTakeover(state, action.seat, action.choice, ctx);
  // 司夜②的还牌：单人窗口，`choice` 就是要还哪张的牌 id
  if (w.type === "swapReturn") return settleSwapReturn(state, action);
  // 劫营♦10 的打断：先到先得，`raid` 要带那张牌
  if (w.type === "interrupt") return settleRaid(state, action, ctx);
  // 洗牌②的弃牌：单人窗口，`choice` 就是要弃哪张的牌 id
  if (w.type === "shuffleDiscard") return settleShuffleDiscard(state, action, ctx);
  // 洗牌③的取消：先到先得，`cancel` 要带那张洗牌牌与定色
  if (w.type === "shuffleCancel") return settleShuffleCancel(state, action, ctx);
  if (w.type !== "punishStack") return reject(state, "unknown_window");
  // 远星♦J 单独一支：只有它要带牌（代价），而 settle 的另一个入口（超时）没有牌可带
  if (action.choice === FARSTAR) return settleFarstar(state, action.seat, action.cardIds ?? [], ctx);
  if (!CHOICES.includes(action.choice) && action.choice !== SOUL_SKIP) return reject(state, "bad_choice");
  return settle(state, action.seat, action.choice, ctx);
}

/** spec §7：任意成员可在 deadline 之后催促结算，按 defaultChoice 收场，防 AFK 卡死全桌。 */
export function claimTimeout(state: GameState, action: { windowId: string }, ctx: Ctx): ApplyResult {
  const w = state.pendingWindow;
  if (!w) return reject(state, "no_window");
  if (action.windowId !== windowIdOf(state)) return reject(state, "stale_window");
  if (Date.parse(ctx.now) <= Date.parse(w.deadline)) return reject(state, "not_yet_expired");
  if (w.type === "skillDraft") return settleDraftTimeout(state);
  // 接管窗口超时 = 没人重掷，按原结果续跑
  if (w.type === "diceTakeover") return settleTakeover(state, w.actors[0], w.defaultChoice, ctx);
  // 还牌窗口超时 = 还刚抽到的那张（defaultChoice 是哨兵，牌 id 不进公开的窗口）
  if (w.type === "swapReturn") return settleSwapReturn(state, { choice: w.defaultChoice });
  // 打断窗口超时 = 没人截，并列者接着摆下一张
  if (w.type === "interrupt") return settleRaid(state, { seat: w.actors[0], choice: w.defaultChoice }, ctx);
  // 洗牌②弃牌窗口超时 = 弃刚摸的那张（defaultChoice 是哨兵，牌 id 不进公开的窗口）
  if (w.type === "shuffleDiscard") return settleShuffleDiscard(state, { choice: w.defaultChoice }, ctx);
  // 洗牌③取消窗口超时 = 没人取消，①照常重分
  if (w.type === "shuffleCancel")
    return settleShuffleCancel(state, { seat: w.actors[0], choice: w.defaultChoice }, ctx);
  // 攒魂窗口只结**当前** actor（默认摸 3），然后轮到下一个，不是整窗关闭
  if (w.type === "soulHarvest")
    return settleHarvest(state, { seat: w.actors[0], choice: w.defaultChoice }, ctx, SKILL_DATA);
  return settle(state, w.actors[0], w.defaultChoice, ctx);
}

function settle(state: GameState, seat: number, choice: string, ctx: Ctx): ApplyResult {
  const b = state.board!;
  const chain = b.punish!;
  // 06-Q10/S15：花魂跳过。跳过 = 本回合结束，但惩罚链**不消失**——窗口顺延给下家，
  // 链上的段与总数一张不动，等着下一个人叠或吃。
  if (choice === SOUL_SKIP) {
    // ponytail: 这里不记 V7 的额度。S15 说②占主动条，但受罚者此刻并不是 currentSeat，
    // 而链走完总会经过一次 passTurn 把额度清零——记了也没有哪条路径读得到。
    const effect = soulSkipEffect(b, seat);
    if (!effect) return reject(state, "suppressed");
    const paid = spendSouls(b, seat, paramsOfEffect(effect).counts.marks ?? 0);
    if (!paid) return reject(state, "cost_unpayable");
    const opened = openPunishWindow(state, { ...paid, drawnPlayable: null }, seat, ctx);
    return { ...opened, events: [{ type: "turnSkipped", public: { seat } }, ...opened.events] };
  }
  if (choice === "stack") {
    // 选了叠就必须真的叠得出来，否则窗口一关就没人能推进了
    if (!b.hands[seat].some((c) => canStack(c, chain))) return reject(state, "cannot_stack");
    // 这是**接管**回合而不是交回合，所以不走 passTurn（额度那本账在链走完的 passTurn 里清）。
    // U6 的结算不受影响：叠链者恒是 currentSeat 的下家，原 currentSeat 一离开就归 syncUno 管。
    return {
      state: commit(state, { ...b, currentSeat: seat, drawnPlayable: null }, "play"),
      events: [{ type: "punishStackChosen", public: { seat } }],
    };
  }
  // 血棘♦2（01-P8/P14 / 06-Q36）：链首亮着血棘 → 吃下者被封印，且**先于这次的摸牌数计算**
  // 落地——他的恩惠这一次就已经失效（摸 2 不是 1）。所以这一步必须排在 drawCards 之前。
  const sealing = applySeal(b, chain.initiator, seat);
  // P10：吃下累计 → 摸完即回合结束，不能再出牌。
  // P11：`chain.total` 就是「先加总各段贡献」的结果，直接作为 L0 基础值；
  // P6 的「只作用于自己那张」在进链时已入各段贡献，02 §7 L0 不得重复计算。
  const { board, drawn, reshuffledOrder } = drawCards(sealing.board, { kind: "punish", base: chain.total, seat }, ctx.rng);
  const eaten: Board = {
    ...board,
    hands: giveTo(board, seat, drawn),
    punish: undefined,
    drawnPlayable: null,
  };
  return {
    // passTurn 读**摸完之后**的手牌（U6 的声明结算按最终张数判），所以传 eaten 而不是 board
    state: commit(state, { ...eaten, ...passTurn(eaten, seat) }, "turnStart"),
    events: [
      { type: "punishAccepted", public: { seat, total: chain.total, segments: chain.segments } },
      ...sealing.events,
      ...drawEvents(seat, drawn, reshuffledOrder),
    ],
  };
}
