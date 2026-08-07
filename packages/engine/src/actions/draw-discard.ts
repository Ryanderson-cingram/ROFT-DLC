/**
 * 摸 N 弃 N（03 §2，规则制定人 2026-08-02）——**一个窗口**：
 * 一次摸满 N 张，再从**摸完之后的整副手牌**里挑 N 张弃掉，不是 N 个「摸 1 弃 1」。
 * 中途没有可观察的中间态，所以从摸到弃只开这一个窗口。
 *
 * 洗牌牌选项②的「摸一弃一」是 **N = 1 的特例**（03 §2 原话），走的就是这里；
 * 后面吃它的还有忍戒♠J（L6 多摸再弃等量）、八门♠8（摸 8 弃 8）、合纵♠5 / 连横♠6。
 *
 * 摸那 N 张**必须**走 `drawCards`（spec §5.3）：不走就绕开了 02 §7 的层级，
 * 活泼板那类 L2 修正对它就不生效了。
 */
import { drawCards, drawEvents, giveTo } from "./draw.ts";
// 环：play-cards（打出洗牌）→ shuffle-card → draw-discard → play-cards（弃完接着跑收尾）。
// 两边点名的都是函数声明，模块实例化时就绑好了（同 shuffle-card ↔ play-cards）。
import { settleAfterFace } from "./play-cards.ts";
import { WINDOW_MS, commit, passTurn, pickFromHand, reject, windowIdOf } from "../legal.ts";
import { mayDeclineDraw } from "../skills/gift.ts";
import { SKILL_DATA } from "../skills/draw-passives.ts";
import type { SkillData } from "../skills/draw-passives.ts";
import type { DrawModifier, DrawRequest } from "../skills/primitives/draw-modifier.ts";
import type {
  ApplyResult, Board, Ctx, DrawDiscardResume, EngineEvent, GameState,
} from "../types.ts";

/** 正常提交：要弃的那几张走 `cardIds`。 */
export const DISCARD = "discard";
/**
 * 超时弃哪几张——**哨兵而不是牌 id**：`PendingWindow` 整个进快照，
 * 写真牌 id 就等于把刚摸到什么当众念出来了（同 `nightlord.ts` 的还牌窗口）。
 */
const DISCARD_DRAWN = "drawn";

/** 弃完（或决定不摸）之后的收场。 */
export function runResume(
  state: GameState,
  b: Board,
  seat: number,
  resume: DrawDiscardResume,
  ctx: Ctx,
  events: EngineEvent[],
  data: SkillData,
): ApplyResult {
  switch (resume.kind) {
    // 洗牌②：弃完接着把这次出牌的收尾跑完（U5 补摸、交回合）
    case "afterFace":
      return settleAfterFace(state, b, seat, b.playedPile[0], 0, ctx, events, data);
    // 忍戒♠J：吃完惩罚、多摸、弃完，回合就此交出去（P10：吃下之后不能再出牌）。
    // passTurn 读的是**弃完之后**的手牌，U6 的声明按最终张数结算——所以它排在这里，不在开窗口之前
    case "afterPunish":
      return { state: commit(state, { ...b, ...passTurn(b, ctx.now, seat) }, "turnStart"), events };
    // 八门♠8①：阶段 1 的主动，弃完**回合还在自己手上**（还能出牌），所以只回到 turnStart
    case "afterSkill":
      return { state: commit(state, b, "turnStart"), events };
  }
}

/**
 * 摸 N 张、把牌给他、开弃牌窗口。回合还没移交——`resume` 指定弃完之后接着跑哪条流程。
 *
 * `req.base` 就是牌面写的那个 N：**摸几张**由它过一遍层级得出（可能被 L2 改大改小），
 * **弃几张**照牌面走，不吃层级修正——02 §7 那台机器改的是摸，没有哪一层改弃。
 * 牌堆枯竭摸不足时按实际摸到的张数弃（03 §2「摸到手里的牌不能少于弃牌数」），
 * 一张都没摸到就不开窗口、直接收场。
 */
export function openDrawDiscard(
  state: GameState,
  b: Board,
  seat: number,
  req: DrawRequest,
  resume: DrawDiscardResume,
  ctx: Ctx,
  before: EngineEvent[] = [],
  data: SkillData = SKILL_DATA,
  mods: readonly DrawModifier[] = [],
): ApplyResult {
  // 神授♥5（01-S17b）：不在那五种「一定要摸」的情形里 → 先问一句要不要。
  // 判据在 `skills/gift.ts`，所以每一条摸 N 弃 N 的路径（洗牌②/八门/忍戒/合纵）都自动被覆盖，
  // 一处都不用单写。合纵/连横②自己那句「可选」走的也是同一个窗口。
  if (mayDeclineDraw(b, seat, req, data)) return openDrawOffer(state, b, seat, req, resume, ctx, before);
  return drawAndDiscard(state, b, seat, req, resume, ctx, before, data, mods);
}

/** 真的摸、真的开弃牌窗口。「要不要」那一步已经问过（或不必问）才走到这里。 */
export function drawAndDiscard(
  state: GameState,
  b: Board,
  seat: number,
  req: DrawRequest,
  resume: DrawDiscardResume,
  ctx: Ctx,
  before: EngineEvent[] = [],
  data: SkillData = SKILL_DATA,
  mods: readonly DrawModifier[] = [],
): ApplyResult {
  const r = drawCards(b, req, ctx.rng, mods);
  const drawn: Board = { ...r.board, hands: giveTo(r.board, seat, r.drawn) };
  const events = [...before, ...drawEvents(seat, r.drawn, r.reshuffledOrder, r.resolution.replacedBy)];

  const picks = Math.min(req.base, r.drawn.length);
  if (picks === 0) return runResume(state, drawn, seat, resume, ctx, events, data);

  const deadline = new Date(Date.parse(ctx.now) + WINDOW_MS).toISOString();
  // `commit` 会清窗口，所以窗口手动接回去（同 `draft.ts::assign`）
  const next: GameState = {
    ...commit(state, { ...drawn, drawDiscard: { seat, picks, drawnIds: r.drawn.map((c) => c.id), resume } }, "afterPlay"),
    pendingWindow: {
      type: "drawDiscard", actors: [seat], deadline, defaultChoice: DISCARD_DRAWN, resume: "turnStart",
    },
  };
  return {
    state: next,
    events: [
      ...events,
      // `picks` 公开：UI 要画「挑 8 张弃掉」，而摸了几张本来就有公开的 cardsDrawn
      { type: "drawDiscardOpened", public: { windowId: windowIdOf(next), seat, picks, deadline } },
    ],
  };
}

/**
 * 弃牌窗口的结算。由 `punish.ts` 的 respond / claimTimeout 在通用校验之后转来。
 * 正常提交：`choice: "discard"` + `cardIds` 恰好 `picks` 张；超时：哨兵 `"drawn"`。
 *
 * 组合不进 `legalActions`（八门弃 8 张就是 C(手牌, 8) 上千条），所以「几张、在不在手上、
 * 有没有重复」这三条全靠这里硬校验——客户端凑什么上来都不作数。
 */
export function settleDrawDiscard(
  state: GameState,
  action: { choice: string; cardIds?: string[] },
  ctx: Ctx,
): ApplyResult {
  const b = state.board!;
  const pend = b.drawDiscard;
  if (!pend) return reject(state, "no_window");
  const { seat, picks } = pend;
  if (action.choice !== DISCARD && action.choice !== DISCARD_DRAWN) return reject(state, "bad_choice");

  const ids = action.choice === DISCARD_DRAWN ? pend.drawnIds.slice(0, picks) : (action.cardIds ?? []);
  // 恰好 `picks` 张、都在**他自己**手上、不重复（三条硬校验共用 `pickFromHand`）
  const picked = pickFromHand(b, seat, ids, picks, picks);
  if (typeof picked === "string") return reject(state, picked);
  const cards = picked;

  const gone = new Set(ids);
  // U6：摸 N 弃 N 会让他的手牌先涨后落、穿过 1 张，但声明在他自己的回合内不作废
  // （2026-08-01 改判，由 `passTurn` 在交回合那一刻统一结算），所以这里什么都不用补
  const { drawDiscard: _done, ...rest } = b;
  const discarded: Board = {
    ...rest,
    hands: rest.hands.map((h, i) => (i === seat ? h.filter((c) => !gone.has(c.id)) : h)),
    // 06-Q55 三堆模型：弃的牌进**弃牌堆**，不改牌顶也不改跟色
    discardPile: [...rest.discardPile, ...cards],
  };
  return runResume(
    state, discarded, seat, pend.resume, ctx,
    [{ type: "cardsDiscarded", public: { seat, cards } }], SKILL_DATA,
  );
}

/**
 * 窗口里的合法动作：**一条模板**。
 * 组合不枚举（八门摸 8 弃 8，手上 12 张就是 C(12,8) = 495 条，每次快照都背着它），
 * 客户端自己凑齐 `picks` 张填进 `cardIds` 再提交，合法性由 `settleDrawDiscard` 说了算。
 * 要弃几张走快照的 `drawDiscard.picks`。
 */
export const drawDiscardActions = (seat: number, windowId: string) => [
  { type: "respond" as const, seat, windowId, choice: DISCARD, cardIds: [] },
];

// ────────────────────────────────────── 「要不要这次摸 N 弃 N」的窗口

/**
 * 两个来源共用这一个窗口，因为它们问的是同一句话：
 *
 * - **合纵♠5 / 连横♠6②**（01-S14）：每打出一张功能牌可以摸 N 弃 N，**每次都是可选**
 * - **神授♥5**（01-S17b）：不在那五种「一定要摸」的情形里的摸牌，都要先问一句
 *
 * 所以它不长在某个技能的模块里，而是长在摸 N 弃 N 的共用入口旁边。
 */
export const TAKE = "take";
/** 不要。超时也走它——两条规则的默认都是「不打扰牌桌」。 */
export const DECLINE = "decline";

export function openDrawOffer(
  state: GameState,
  b: Board,
  seat: number,
  req: DrawRequest,
  resume: DrawDiscardResume,
  ctx: Ctx,
  before: EngineEvent[] = [],
): ApplyResult {
  const deadline = new Date(Date.parse(ctx.now) + WINDOW_MS).toISOString();
  // `commit` 会清窗口，所以窗口手动接回去（同 `openDrawDiscard`）
  const next: GameState = {
    ...commit(state, { ...b, drawOffer: { seat, req, resume } }, "afterPlay"),
    pendingWindow: { type: "drawOffer", actors: [seat], deadline, defaultChoice: DECLINE, resume: "play" },
  };
  return {
    state: next,
    // 里面没有暗信息：几张是牌面/技能写死的，触发的那张牌人人都看见了
    events: [
      ...before,
      { type: "drawOfferOpened", public: { windowId: windowIdOf(next), seat, picks: req.base, deadline } },
    ],
  };
}

/**
 * 结算「要不要」。要 → 照常摸 N 弃 N；不要 → 一张不摸，直接跑收场。
 * 由 `punish.ts` 的 respond / claimTimeout 在通用校验之后转来。
 */
export function settleDrawOffer(state: GameState, action: { choice: string }, ctx: Ctx): ApplyResult {
  const b = state.board!;
  const pend = b.drawOffer;
  if (!pend) return reject(state, "no_window");
  if (action.choice !== TAKE && action.choice !== DECLINE) return reject(state, "bad_choice");
  const { seat, req, resume } = pend;
  const { drawOffer: _done, ...rest } = b;

  if (action.choice === DECLINE) {
    return runResume(state, rest, seat, resume, ctx, [{ type: "drawOfferDeclined", public: { seat } }], SKILL_DATA);
  }
  // 走**下面那一层**而不是 `openDrawDiscard`：那一层还会再问一次，问出个死循环来
  return drawAndDiscard(state, rest, seat, req, resume, ctx, [], SKILL_DATA);
}

/** 窗口里的两条动作：要 / 不要。 */
export const drawOfferActions = (seat: number, windowId: string) => [
  { type: "respond" as const, seat, windowId, choice: TAKE },
  { type: "respond" as const, seat, windowId, choice: DECLINE },
];
