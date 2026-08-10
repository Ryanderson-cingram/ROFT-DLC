/**
 * 合纵♠5 / 连横♠6 的**②「无相应」那半条**（01-S14）：
 * 之后你**每打出一张功能牌**，可以摸 N 弃 N——合纵 2/2，连横 1/1，连横连击时 3/3。
 *
 * 三条要害都来自已裁定的条款，一条都不是这里发明的：
 *
 * 1. **每次都是可选**（S14：Excel 原文「可以」）。那个「要不要」的窗口与神授♥5 用的是**同一个**
 *    （`actions/draw-discard.ts::openDrawOffer`）——两边问的是同一句话，不该有两套
 * 2. **「功能牌」= +2 / 转 / 停**（03 §1）。+4 / 变色 / 毒 / 洗牌是**变色牌**，不触发
 * 3. **连横的连击档看「上一个自己的回合」**（01-S14b，2026-08-03 裁定）：
 *    连击是你自己接连打出，不看别人打了什么。账记在 `Board.funcPlay`——
 *    出牌时置 `thisTurn`，交回合时由 `settleTurnEnd` 轮转成 `lastTurn`
 *
 * ①（相应 → 换牌）也在这里，语义见 **06-Q70 / 01-S13b**：任一方先亮出时问另一方一次
 * （**一锤定音**，`Board.alliance` 缺席才问），相应即亮出并**整副手牌互换**；
 * 此后双方各自回合开始都能再换一次（占 V7 的主动条），而②对**双方**关闭——卡面那两条互斥。
 */
import { WINDOW_MS, commit, reject, windowIdOf } from "../legal.ts";
import { SKILL_DATA } from "./draw-passives.ts";
import { paramsOfEffect } from "./params.ts";
import { suppressionOf } from "./primitives/suppression.ts";
import type { SkillData } from "./draw-passives.ts";
import type { SkillEffect } from "./types.ts";
import type { ApplyResult, Board, Card, Ctx, EngineEvent, Face, GameState } from "../types.ts";

/** 03 §1 的**功能牌**：+2 / 转 / 停。变色牌（变色 / +4 / 毒 / 洗牌）不在其列。 */
const FUNCTION_FACES: ReadonlySet<Face> = new Set<Face>(["+2", "skip", "rev"]);
const isFunctionCard = (c: Card) => FUNCTION_FACES.has(c.face);

/**
 * `seat` 身上那条「打出功能牌后可摸弃」的被动。**按定义找，不认技能 id**：
 * `kind: passive` + `window: after_play` + `values.draws`。
 * V3 没亮出不算数；被封印时整支关掉（01-P9）。惩罚回合**照常**——它是被动不是主动（V8/P1）。
 */
function offerEffect(b: Board, seat: number, data: SkillData): SkillEffect | undefined {
  // 06-Q70：结盟与②互斥（卡面「相应则换牌…；**无响应**则每张功能牌后摸弃」）
  if (b.alliance?.allied === true) return undefined;
  const id = b.skills[seat];
  if (!id || !b.revealed[seat]) return undefined;
  const def = data.byId.get(id);
  if (!def || def.structured !== true) return undefined;
  if (def.sealable !== false && suppressionOf(b, seat).includes("sealed")) return undefined;
  return (def.effects ?? []).find(
    (e) => e.kind === "passive" && e.window === "after_play" && e.values?.draws !== undefined,
  );
}

/**
 * 这次打出的牌该给几张摸弃（0 = 不触发）。
 * 连击档（连横的 `draws_combo`）按 01-S14b 看**上一个自己的回合**有没有打出过功能牌；
 * 没有连击档的（合纵）不受影响，两种情况都是 `draws`。
 */
export function offerPicksFor(b: Board, seat: number, card: Card, data: SkillData = SKILL_DATA): number {
  if (!isFunctionCard(card)) return 0;
  const e = offerEffect(b, seat, data);
  if (!e) return 0;
  const { counts } = paramsOfEffect(e);
  const combo = b.funcPlay?.[seat]?.lastTurn === true;
  return (combo ? counts.draws_combo ?? counts.draws : counts.draws) ?? 0;
}

/**
 * 记一笔「这个回合打出过功能牌」（01-S14b 的连击账）。
 * **无条件记**，与谁亮着什么技能无关——连横可能是中途才亮出来的，那时上一个回合早过去了。
 */
export const notePlayedFunction = (b: Board, seat: number, card: Card): Board =>
  isFunctionCard(card)
    ? { ...b, funcPlay: bookOf(b).map((x, i) => (i === seat ? { ...x, thisTurn: true } : x)) }
    : b;

/** 交回合：这个座位的「这回合」变成「上回合」。由 `settleTurnEnd` 在回合交接那一刻调。 */
export const rotateFuncPlay = (b: Board, seat: number): Board => ({
  ...b,
  funcPlay: bookOf(b).map((x, i) => (i === seat ? { thisTurn: false, lastTurn: x.thisTurn } : x)),
});

const bookOf = (b: Board) => b.funcPlay ?? b.hands.map(() => ({ thisTurn: false, lastTurn: false }));

// ─────────────────────────────────────────────────────────────── ①：结盟

/** 相应（= 亮出并换手牌）。 */
const ALLY = "ally";
/** 不相应。超时也走它（S13：不选 = 无人相应）。 */
const REFUSE = "refuse";

/**
 * `seat` 亮出的技能有没有「另一半」在场，以及那一半在谁手上。
 * **按定义找**：`pairs_with` 是数据里的双向配对（02 §6），引擎不认技能 id。
 */
function pairSeatOf(b: Board, seat: number, data: SkillData): number | undefined {
  const id = b.skills[seat];
  const other = id ? data.byId.get(id)?.pairs_with : undefined;
  if (!other) return undefined;
  const at = b.skills.indexOf(other);
  return at >= 0 && at !== seat ? at : undefined;
}

/**
 * 亮出技能之后：要不要问另一半「相应吗」（01-S13）。不问的三种情况都不留后路——
 * **一锤定音**（06-Q70）：问过了（`alliance` 已写）、没有另一半在场、
 * 或那一半此刻被封印亮不出来（01-P14「未亮出也被血棘则不能亮出」）。
 * 后两种当场写死 `allied: false`，此后双方各吃各的②。
 */
export function openAllianceWindow(
  state: GameState,
  b: Board,
  seat: number,
  ctx: Ctx,
  events: EngineEvent[] = [],
  data: SkillData = SKILL_DATA,
): ApplyResult | null {
  if (b.alliance) return null;
  const other = pairSeatOf(b, seat, data);
  if (other === undefined) return null;
  const def = data.byId.get(b.skills[other]!);
  if (!def || def.structured !== true) return null;
  if (def.sealable !== false && suppressionOf(b, other).includes("sealed")) {
    return { state: commit(state, { ...b, alliance: { allied: false } }), events };
  }

  const deadline = new Date(Date.parse(ctx.now) + WINDOW_MS).toISOString();
  const next: GameState = {
    ...commit(state, b),
    pendingWindow: { type: "alliance", actors: [other], deadline, defaultChoice: REFUSE, resume: state.phase },
  };
  return {
    state: next,
    events: [
      ...events,
      // 谁被问、问的是谁亮出的那张，全场都看得见（亮出本身就是公开动作）
      { type: "allianceWindowOpened", public: { windowId: windowIdOf(next), seat: other, by: seat, deadline } },
    ],
  };
}

/**
 * 结算「相应吗」。相应 → **响应即亮出**（S13b）+ 两人**整副手牌互换**（Q70）。
 * 不相应 → 写死 `allied: false`，此后不再问（一锤定音）。
 */
export function settleAlliance(state: GameState, action: { seat: number; choice: string }, ctx: Ctx): ApplyResult {
  const b = state.board!;
  if (b.alliance) return reject(state, "no_window");
  if (action.choice !== ALLY && action.choice !== REFUSE) return reject(state, "bad_choice");
  const other = pairSeatOf(b, action.seat, SKILL_DATA);
  if (other === undefined) return reject(state, "skill_unavailable");

  if (action.choice === REFUSE) {
    return {
      state: commit(state, { ...b, alliance: { allied: false } }),
      events: [{ type: "allianceRefused", public: { seat: action.seat } }],
    };
  }
  const seats: [number, number] = [action.seat, other];
  const allied: Board = {
    ...swapHands(b, action.seat, other),
    // S13b：响应即亮出（01-V2 白名单的又一条例外）
    revealed: b.revealed.map((v, i) => (i === action.seat ? true : v)),
    alliance: { allied: true, seats },
  };
  return {
    state: commit(state, allied),
    events: [
      { type: "skillRevealed", public: { seat: action.seat, skillId: b.skills[action.seat] } },
      { type: "allianceFormed", public: { seats } },
      swapEvent(allied, seats),
    ],
  };
}

/** 窗口里的两条动作：相应 / 不相应。 */
export const allianceActions = (seat: number, windowId: string) => [
  { type: "respond" as const, seat, windowId, choice: ALLY },
  { type: "respond" as const, seat, windowId, choice: REFUSE },
];

/**
 * `seat` 此刻的盟友（没有则 undefined）。**任一方被封印，两人同时失去**
 * （03 §7 + 06-Q70：封印期间失效、解封恢复——值留着，只压制）。
 */
export function allyOf(b: Board, seat: number): number | undefined {
  if (b.alliance?.allied !== true) return undefined;
  const [a, c] = b.alliance.seats;
  if (seat !== a && seat !== c) return undefined;
  if (suppressionOf(b, a).includes("sealed") || suppressionOf(b, c).includes("sealed")) return undefined;
  return seat === a ? c : a;
}

/**
 * ①b：结盟双方各自的回合开始可以再换一次整副手牌（06-Q70：不需对方同意，**占 V7 主动条**）。
 * 由 `activateSkill` 那条脊梁转来——次数账、压制、可点性全在它那边，这里只管换。
 */
export function swapWithAlly(state: GameState, b: Board, seat: number, _ctx: Ctx): ApplyResult {
  const ally = allyOf(b, seat);
  if (ally === undefined) return reject(state, "skill_unavailable");
  const swapped = swapHands(b, seat, ally);
  return { state: commit(state, swapped), events: [swapEvent(swapped, [seat, ally])] };
}

const swapHands = (b: Board, a: number, c: number): Board => ({
  ...b,
  hands: b.hands.map((h, i) => (i === a ? b.hands[c] : i === c ? b.hands[a] : h)),
});

/** 换了几张是公开的（手牌张数本来就全场可见），换到的是哪几张只有当事人知道。 */
const swapEvent = (b: Board, seats: [number, number]): EngineEvent => ({
  type: "handsSwapped",
  public: { seats, counts: seats.map((s) => b.hands[s].length) },
});
