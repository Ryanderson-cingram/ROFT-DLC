import { applySeal } from "./bloodthorn.ts";
import { drawCards, drawEvents, giveTo } from "./draw.ts";
import { damnationModifier } from "../skills/damnation.ts";
import {
  acceptDiscardCount, DISSENT, dissentEffect, dissentMarksAvailable, isAccept, payDissent,
} from "../skills/dissent.ts";
import { markUsedOnce } from "./skill.ts";
import { settleDraftPick, settleDraftTimeout } from "./draft.ts";
// 环：dice → punish（强袭①的续跑要用链与惩罚窗口）→ dice。两边点名的都是函数声明，
// 模块实例化时就绑好了，环存在也无害（同 draw-passives 的惰性说明）。
import { sealedOff, settleTakeover } from "./dice.ts";
import { settleSwapReturn } from "./nightlord.ts";
import { settleRaid } from "./raid.ts";
import { settleShuffleCancel } from "./shuffle-card.ts";
import { openDrawDiscard, settleDrawDiscard, settleDrawOffer } from "./draw-discard.ts";
import { settleAlliance } from "../skills/alliance.ts";
import { handOverPlan, openHandOver, settleHandOver } from "../skills/guard.ts";
import { punishBase } from "../skills/specialty.ts";
import { settleHarvest } from "./soul-harvest.ts";
import { WINDOW_MS, commit, nextSeat, passTurn, reject, windowIdOf } from "../legal.ts";
import { SKILL_DATA } from "../skills/draw-passives.ts";
import { spendSouls } from "../skills/handlers.ts";
import { paramsOfEffect } from "../skills/params.ts";
import { DRAW_THEN_DISCARD } from "../skills/primitives/draw-modifier.ts";
import { suppressesEffect } from "../skills/primitives/suppression.ts";
import type { DrawProcedure } from "../skills/primitives/draw-modifier.ts";
import type { SkillData } from "../skills/draw-passives.ts";
import type { SkillEffect } from "../skills/types.ts";
import type { Action, ApplyResult, Board, Card, Color, Ctx, GameState, PunishChain } from "../types.ts";

export { windowIdOf };

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
 * `color` = 这一段在牌桌上呈现的颜色，**必传**：远星♦J 的「视为打出」不进牌河，UI 回推不出来，
 * 所以只有进链的那一刻知道，见 `PunishSegment.color`。
 */
export function extendChain(
  chain: PunishChain | undefined,
  seat: number,
  face: PunishFace,
  color: Color | null,
  draw: number = PUNISH_DRAW[face],
): PunishChain {
  const segments = [...(chain?.segments ?? []), { seat, face, draw, color }];
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
  // 段色 = 刚打出那张的呈现色。它就是 `activeColor`：这张牌落地时被设成 follow.color，
  // 而接管窗口里只允许重掷/放过（劫营截不了功能牌），中间没人动得了它。
  const chain = extendChain(
    board.punish, spec.seat, spec.face, board.activeColor, PUNISH_DRAW[spec.face] * values[0],
  );
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
    // 04 ♦J：视为的那张用所弃代价牌的颜色（上面 activeColor 也是这么设的），两者恒等
    punish: extendChain(chain, seat, face, paid[0].color),
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

/**
 * 异议♥8 在惩罚窗口里多出来的可点项：
 * ① 整局一次的「反弹给上家」；② 每个弃异档位各一条（`accept:1` ‥ `accept:N`）。
 *
 * 弃 0 不在这里——它就是那个本来就有的 `accept`，不必重复给。
 */
export function dissentActions(b: Board, seat: number, windowId: string, data: SkillData = SKILL_DATA): Action[] {
  const one: Action[] = dissentEffect(b, seat, data)
    ? [{ type: "respond", seat, windowId, choice: DISSENT }]
    : [];
  const n = dissentMarksAvailable(b, seat, data);
  return [
    ...one,
    ...Array.from({ length: n }, (_x, i): Action => ({
      type: "respond", seat, windowId, choice: `accept:${i + 1}`,
    })),
  ];
}

/**
 * 忍戒♠J（04 ♠J / 02 §7 L6）：多摸几张。「按最终值 N 多摸 min(N, 上限)」——
 * N 是**层级算完的那个数**（`resolution.count`，恩惠减过、樱时雨覆盖过之后的），
 * 上限从定义读（`values.L6`，一个规则常数都不写在这里）。
 * 牌堆枯竭摸不足由 `openDrawDiscard` 按实际摸到的张数下调弃牌数（03 §2）。
 */
const extraDraws = (procedures: readonly DrawProcedure[], count: number): number =>
  procedures
    .filter((p) => p.procedure === DRAW_THEN_DISCARD)
    .reduce((n, p) => Math.max(n, Math.min(count, p.values.L6 ?? 0)), 0);

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
  // 摸 N 弃 N（03 §2，洗牌②是 N=1 的特例）：单人窗口，要弃的那几张走 `cardIds`
  if (w.type === "drawDiscard") return settleDrawDiscard(state, action, ctx);
  // 合纵/连横②：打出功能牌后「要不要这次摸弃」（01-S14 每次可选）
  if (w.type === "drawOffer") return settleDrawOffer(state, action, ctx);
  // 合纵/连横①：亮出当下的「相应吗」（S13）
  if (w.type === "alliance") return settleAlliance(state, action, ctx);
  // 近卫♥6：吃完惩罚交几张手牌给链首（P12）
  if (w.type === "handOver") return settleHandOver(state, action, ctx);
  // 洗牌③的取消：先到先得，`cancel` 要带那张洗牌牌与定色
  if (w.type === "shuffleCancel") return settleShuffleCancel(state, action, ctx);
  if (w.type !== "punishStack") return reject(state, "unknown_window");
  // 远星♦J 单独一支：只有它要带牌（代价），而 settle 的另一个入口（超时）没有牌可带
  if (action.choice === FARSTAR) return settleFarstar(state, action.seat, action.cardIds ?? [], ctx);
  // 异议♥8②：吃下时顺带弃 N 枚异（`accept:2`）。档位塞进 choice 而不是另开一个窗口——
  // 「摸之前先弃几枚」没有任何可观察的中间态，多一个窗口就多一个要进快照隐私表的暂存态。
  const ok = CHOICES.includes(action.choice) || isAccept(action.choice) ||
    action.choice === SOUL_SKIP || action.choice === DISSENT;
  if (!ok) return reject(state, "bad_choice");
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
  // 摸 N 弃 N 超时 = 弃刚摸的那几张（defaultChoice 是哨兵，牌 id 不进公开的窗口）
  if (w.type === "drawDiscard") return settleDrawDiscard(state, { choice: w.defaultChoice }, ctx);
  // 「要不要」超时 = 不要（S14：本来就是可选的，默认不打扰牌桌）
  if (w.type === "drawOffer") return settleDrawOffer(state, { choice: w.defaultChoice }, ctx);
  // 「相应吗」超时 = 不相应（S13 原文：不选 = 无人相应）
  if (w.type === "alliance") return settleAlliance(state, { seat: w.actors[0], choice: w.defaultChoice }, ctx);
  // 交牌超时 = 不交（04 ♥6 的「**可**交」）
  if (w.type === "handOver") return settleHandOver(state, { choice: w.defaultChoice }, ctx);
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
  // 异议♥8①（04 ♥8，2026-08-02）：反转方向 + 跳过自己 → 反转后我的下家正是原来的上家，
  // 所以 `openPunishWindow` 拿翻好方向的盘面一算，链就**原样反弹**给他（段与 total 一张不动）。
  // 不占 V7 的主动条（触发在别人的回合里，没有回合可占）；`once: once` 走 usedOnce 限流。
  if (choice === DISSENT) {
    const effect = dissentEffect(b, seat);
    if (!effect) return reject(state, "skill_unavailable");
    const flipped: Board = {
      ...markUsedOnce(b, seat, effect.key),
      direction: (b.direction * -1) as 1 | -1,
      drawnPlayable: null,
    };
    const opened = openPunishWindow(state, flipped, seat, ctx);
    return {
      ...opened,
      events: [
        { type: "dissentUsed", public: { seat, direction: flipped.direction } },
        { type: "turnSkipped", public: { seat } },
        ...opened.events,
      ],
    };
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
  // 异议♥8②（04 ♥8）：吃下时可选弃 N 枚异，每枚 L2 −1。`accept` = 弃 0（超时也走这条）。
  // 排在血棘之后：封印一落地异议整个关掉，这一次就弃不了了（同恩惠，06-Q36 的时点）。
  const dissent = payDissent(sealing.board, seat, acceptDiscardCount(choice));
  if (!dissent) return reject(state, "cost_unpayable");
  // P10：吃下累计 → 摸完即回合结束，不能再出牌。
  // P11：`chain.total` 就是「先加总各段贡献」的结果，直接作为 L0 基础值；
  // P6 的「只作用于自己那张」在进链时已入各段贡献，02 §7 L0 不得重复计算。
  // 伤逝♥10（01-P13 / 02 §7 L1）：把「按链上张数掷骰」的结果先算好再交给层级机器。
  // 随机不能进 `resolveDrawCount`（那是纯函数），所以走 `mods` 这条口子——
  // L1 一命中就直接得最终值并跳到 L5，恩惠与吟游的修正全都不作数。
  const damnation = damnationModifier(dissent.board, seat, chain, ctx.rng);
  // 专精♥9（06-Q67/Q68）：**逐段**免掉自己专精色的那几张 +2，改的是喂给 L0 的数，
  // L0–L6 一行不动；全免则**整个摸牌事件跳过**（同狂欢和4 / 06-Q27），不是「摸 0 张」。
  // 链上贡献一张不减——下家读到的仍是 `chain.total`（Q68 的两条推论）。
  const { base, skip } = punishBase(dissent.board, seat, chain);
  const { board, drawn, reshuffledOrder, resolution } = skip
    ? { board: dissent.board, drawn: [], reshuffledOrder: null, resolution: { count: 0, procedures: [] } }
    : drawCards(
      dissent.board,
      { kind: "punish", base, seat },
      ctx.rng,
      // 伤逝的 L1 与异议的 L2 同时在场是造不出来的（S2b 技能全场唯一），摊在一起无害
      [...damnation, ...dissent.mods],
    );
  const eaten: Board = {
    ...board,
    hands: giveTo(board, seat, drawn),
    punish: undefined,
    drawnPlayable: null,
  };
  const events = [
    { type: "punishAccepted", public: { seat, total: chain.total, segments: chain.segments } },
    ...sealing.events,
    ...dissent.events,
    // 全免时连摸牌事件都不发（事件根本没发生）
    ...(skip ? [] : drawEvents(seat, drawn, reshuffledOrder, resolution.replacedBy)),
  ];
  // 02 §7 的 L6 后置程序在这里落地——**惩罚结算之后**，不改上面那个数，只多跑一段。
  // 忍戒♠J：按最终值 N 多摸 min(N, 上限) 张再弃等量。多摸走 `kind: "skill"` 而不是 punish：
  // 那几张不是惩罚（01-P1），否则恩惠那类「因惩罚的摸牌 −2」会去减它。
  const extra = extraDraws(resolution.procedures, resolution.count);
  if (extra > 0) {
    return openDrawDiscard(state, eaten, seat, { kind: "skill", base: extra, seat }, { kind: "afterPunish" }, ctx, events);
  }
  // 近卫♥6：受 ≥ 门槛的惩罚时，每张 +2/+4 可交 1 张手牌给链首（P12）。同为 L6，
  // 与忍戒不可能同时在一个人身上（S2b 技能全场唯一），所以两支各占一条分支就够
  const plan = handOverPlan(resolution.procedures, chain, eaten, seat);
  if (plan) return openHandOver(state, eaten, seat, plan, ctx, events);
  return {
    // passTurn 读**摸完之后**的手牌（U6 的声明结算按最终张数判），所以传 eaten 而不是 board
    state: commit(state, { ...eaten, ...passTurn(eaten, ctx.now, seat) }, "turnStart"),
    events,
  };
}
