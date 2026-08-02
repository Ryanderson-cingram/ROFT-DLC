/**
 * 洗牌牌（05 §2b「洗牌（3 张）」+ 2026-07-31 的四条裁定）。
 *
 * 卡面：**三选一并决定颜色**
 *   ① 洗牌     —— 合并并打乱所有玩家手牌，从下家开始每名玩家依次获得一张牌（03 §6）
 *   ② 摸一弃一 —— 先摸后弃，弃哪张开窗口自选（裁定 洗-1）
 *   ③ 取消     —— 取消一次其他玩家的①，取消者不进回合、从取消者下家继续（裁定 洗-3，照抄劫营 01-G5）
 *
 * ⚠️ **命名**：这里的「洗牌」= 打乱重分**全体手牌**（`redistribute`）；与「摸牌堆见底把牌河洗回
 * 摸牌堆」（01-U8，`draw.ts` 里那段 `reshuffle`）是两回事，两个名字不要混用。
 */
import { shuffle } from "../deck.ts";
import { drawCards, drawEvents, giveTo } from "./draw.ts";
// 环：play-cards（打出洗牌）→ shuffle-card（结算/开窗口）→ play-cards（窗口结完接着跑收尾）。
// 两边点名的都是函数声明，模块实例化时就绑好了，环存在也无害（同 play-cards ↔ raid）。
import { settleAfterFace, settleEmptyHand, settleWin } from "./play-cards.ts";
import { commit, nextSeat, passTurn, reject, windowIdOf } from "../legal.ts";
import { SKILL_DATA } from "../skills/draw-passives.ts";
import type { SkillData } from "../skills/draw-passives.ts";
import type {
  Action, ApplyResult, Board, Card, Color, Ctx, EngineEvent, GameState, ShuffleChoice, ShufflePending,
} from "../types.ts";

const WINDOW_MS = 30_000;

/** 卡面三选一里能从 `playCards` 打出的两个。③是响应，只能从 `shuffleCancel` 窗口打出。 */
export const SHUFFLE_CHOICES: readonly ShuffleChoice[] = ["shuffle", "drawDiscard"];

/** 取消窗口的两个响应。`pass`（含超时）= 让①照常执行。 */
const CANCEL = "cancel";
const PASS = "pass";
/**
 * 弃牌窗口超时弃哪张——**哨兵而不是牌 id**：`PendingWindow` 整个进快照，
 * 写真牌 id 就等于把刚摸到什么当众念出来了（同 `nightlord.ts` 的还牌窗口）。
 */
const DISCARD_DRAWN = "drawn";

const isShuffleCard = (c: Card) => c.face === "shuffle";

/**
 * 开一个反应窗口并把中间态挂上牌桌。
 * `commit` 会清窗口，所以窗口手动接回去（同 `draft.ts::assign`）。回合还没移交——
 * 窗口结完这次出牌才把收尾跑完，所以 `resume` 是那之后该到的相位。
 */
function openWindow(
  state: GameState,
  board: Board,
  pending: ShufflePending,
  w: { type: string; actors: number[]; defaultChoice: string; event: string; hideActors?: boolean },
  ctx: Ctx,
  before: EngineEvent[],
): ApplyResult {
  const deadline = new Date(Date.parse(ctx.now) + WINDOW_MS).toISOString();
  const next: GameState = {
    ...commit(state, { ...board, shufflePending: pending }, "afterPlay"),
    pendingWindow: { type: w.type, actors: w.actors, deadline, defaultChoice: w.defaultChoice, resume: "turnStart" },
  };
  return {
    state: next,
    events: [
      ...before,
      {
        type: w.event,
        // `hideActors`：洗牌③那一串 actors 就是「谁手上有洗牌牌」，而手牌是私有的——
        // 放进 public payload 等于当众念出别人的手牌内容（投影侧的遮罩见 index.ts::projectWindow）
        public: {
          windowId: windowIdOf(next), seat: pending.seat, deadline,
          ...(w.hideActors ? {} : { actors: w.actors }),
        },
      },
    ],
  };
}

/**
 * 打出洗牌牌的入口，由 `play-cards.ts::settlePlay` 在牌已落地之后调用。
 * 选项①有人能取消 → 开窗口先不重分；选项②先摸再开弃牌窗口。
 *
 * 不收 `dice`：`punishFace("shuffle")` 恒为 null，所以强袭①的倍率骰对洗牌永远是 0。
 */
export function playShuffleCard(
  state: GameState,
  b: Board,
  seat: number,
  ctx: Ctx,
  before: EngineEvent[],
  data: SkillData,
): ApplyResult {
  const card = b.playedPile[0];

  if (b.shufflePending?.choice === "drawDiscard") {
    const r = drawCards(b, { kind: "rule", base: 1, seat }, ctx.rng);
    const drawn = { ...r.board, hands: giveTo(r.board, seat, r.drawn) };
    const events = [...before, ...drawEvents(seat, r.drawn, r.reshuffledOrder)];
    // 牌堆枯竭摸到 0 张 → 没得弃（03 §2：摸到手里的牌不能少于弃牌数），不开窗口
    if (r.drawn.length === 0) {
      const { shufflePending: _none, ...cleared } = drawn;
      return settleAfterFace(state, cleared, seat, card, 0, ctx, events, data);
    }
    return openWindow(
      // `choice` 到这里已用完，只留超时要弃的那张
      state, drawn, { seat, drawnId: r.drawn[0].id },
      { type: "shuffleDiscard", actors: [seat], defaultChoice: DISCARD_DRAWN, event: "shuffleDiscardOpened" },
      ctx, events,
    );
  }

  // 裁定 洗-3：窗口开给所有手上有洗牌牌的其他玩家，先到先得。没人能取消就直接重分
  const actors = b.hands.flatMap((h, i) => (i !== seat && h.some(isShuffleCard) ? [i] : []));
  if (actors.length > 0)
    return openWindow(
      state, b, { seat },
      { type: "shuffleCancel", actors, defaultChoice: PASS, event: "shuffleCancelWindowOpened", hideActors: true },
      ctx, before,
    );
  return redistribute(state, b, seat, ctx, before, data);
}

/**
 * 选项①的重分（03 §6）：合并全体手牌 → 打乱 → **从打出者的下家开始**逐张轮流发，直到发完。
 * 人数除不尽时靠前的人多一张——那是轮流发牌的自然结果，不写取整公式。
 */
function redistribute(
  state: GameState,
  b: Board,
  seat: number,
  ctx: Ctx,
  before: EngineEvent[],
  data: SkillData,
): ApplyResult {
  // 按座位序拼接再打乱：合并顺序确定，随机只来自注入的 rng
  const pool = shuffle(b.hands.flat(), ctx.rng);
  const hands: Card[][] = b.hands.map(() => []);
  const start = nextSeat(b, seat);
  pool.forEach((c, i) => hands[nextSeat(b, start, i)].push(c));

  const { shufflePending: _done, ...rest } = b;
  const board: Board = {
    ...rest,
    hands,
    // U6：合并的那一刻人人手牌为 0，**回合外**的「手牌一离开 1 张即作废」当场成立——
    // 分到 1 张的人须重喊，他人可抓。打出者本人在自己的回合内不作废（2026-08-01 改判），
    // 他的声明留到交回合时由 passTurn 结算。
    saidUno: b.saidUno.map((v, i) => v && i === seat),
  };
  const event: EngineEvent = {
    type: "handsShuffled",
    // 手牌**张数**本来就是公开的（快照有 handCount）；牌序与谁拿到哪张是暗信息，只进 audit。
    // 重放靠 audit.deal 就够，所以不再逐座位发一条私有事件——手牌本身走快照的 yourHand。
    public: { seat, counts: hands.map((h) => h.length) },
    audit: { order: pool.map((c) => c.id), deal: hands.map((h) => h.map((c) => c.id)) },
  };
  // U5b：重分**分到** 0 张不判胜——收官早在末牌离手那一刻就判过了（2026-08-01 裁定），
  // 走到这里说明当时没收成，所以 `settleAfterFace` 只会给他补摸 1 张。
  return settleAfterFace(state, board, seat, b.playedPile[0], 0, ctx, [...before, event], data);
}

/**
 * `shuffleDiscard` 窗口的结算。由 `punish.ts` 的 respond / claimTimeout 在通用校验之后转来。
 * `choice` 是要弃的那张牌的 id；哨兵 `DISCARD_DRAWN`（超时）= 弃刚摸的那张。
 */
export function settleShuffleDiscard(state: GameState, action: { choice: string }, ctx: Ctx): ApplyResult {
  const b = state.board!;
  const pend = b.shufflePending;
  if (!pend) return reject(state, "no_window");
  const { seat } = pend;
  const id = action.choice === DISCARD_DRAWN ? pend.drawnId : action.choice;
  // 窗口只开给打出者自己，所以只在**他**的手牌里找——别人的牌 id 送上来一样是 not_in_hand
  const card = b.hands[seat].find((c) => c.id === id);
  if (!card) return reject(state, "not_in_hand");

  const { shufflePending: _done, ...rest } = b;
  const hands = rest.hands.map((h, i) => (i === seat ? h.filter((c) => c.id !== card.id) : h));
  // U6：摸 1 弃 1 会让打出者的手牌穿过 2 张，但声明在他自己的回合内不作废（2026-08-01 改判），
  // 所以这里什么都不用补——牌桌上那个 true 从出牌那一刻起一直在。
  const discarded: Board = {
    ...rest,
    hands,
    // 06-Q55 三堆模型：弃牌进**弃牌堆**，不改牌顶也不改跟色
    discardPile: [...rest.discardPile, card],
  };
  return settleAfterFace(
    state, discarded, seat, b.playedPile[0], 0, ctx,
    [{ type: "cardsDiscarded", public: { seat, cards: [card] } }], SKILL_DATA,
  );
}

/**
 * `shuffleCancel` 窗口的结算。先到先得：一人取消，窗口即关。
 * `pass`（含超时）= ①照常执行；`cancel` = 整个①作废，照抄劫营 01-G5 的收场。
 */
export function settleShuffleCancel(
  state: GameState,
  action: { seat: number; choice: string; cardIds?: string[]; chosenColor?: Color },
  ctx: Ctx,
): ApplyResult {
  const b = state.board!;
  const pend = b.shufflePending;
  if (!pend) return reject(state, "no_window");
  const victim = pend.seat;

  if (action.choice === PASS) return redistribute(state, b, victim, ctx, [], SKILL_DATA);
  if (action.choice !== CANCEL) return reject(state, "bad_choice");

  const cancelCard = action.cardIds?.length === 1
    ? b.hands[action.seat].find((c) => c.id === action.cardIds![0])
    : undefined;
  if (!cancelCard) return reject(state, "not_in_hand");
  // 只有洗牌牌能取消洗牌（卡面选项③）
  if (!isShuffleCard(cancelCard)) return reject(state, "bad_choice");
  // 三个选项都要定色（卡面「三选一并决定颜色」），取消牌也不例外
  if (!action.chosenColor) return reject(state, "color_required");

  const { shufflePending: _cancelled, ...rest } = b;
  // 裁定 洗-3：取消牌压牌顶，跟色 = **取消者**定的色（照抄劫营的「打断牌成为跟牌目标」）。
  // 不重分——选项①的效果整个作废，全体手牌一张没动。
  const placed: Board = {
    ...rest,
    hands: rest.hands.map((h, i) => (i === action.seat ? h.filter((c) => c.id !== cancelCard.id) : h)),
    playedPile: [cancelCard, ...rest.playedPile],
    activeColor: action.chosenColor,
    activeFace: null,
    drawnPlayable: null,
  };
  const events: EngineEvent[] = [{
    type: "shuffleCancelled",
    public: { by: action.seat, target: victim, card: cancelCard, color: action.chosenColor },
  }];

  // 被取消者的回合就此结束。他若把洗牌当末牌打出 → 此刻手牌为 0 → 01-U5 补摸 1。
  // **收官在这里已经不可能发生**：2026-08-01 裁定把胜负判在末牌离手那一刻，所以持够盗的
  // 司夜早在 `settlePlay` 入口就赢了、取消窗口根本不会开——取消夺不走已经到手的胜利。
  //
  // ponytail: 这里**不跑**他的司夜①获盗（打出无色牌掷骰）——那会开掷骰接管窗口，而它的续跑
  // 写死了「从掷骰者交回合」，与取消的「从取消者的下家继续」直接冲突。取消者自己那张洗牌
  // 同样不获盗，两边一致。极罕见路径，留档见 06-Q59。
  const v = settleEmptyHand(placed, victim, ctx);

  // 取消者自己**确实打出了一张末牌**，所以他照常适用收官判定（数字牌不可能，但持够 5 盗的
  // 司夜可以拿洗牌收官——与从 playCards 打出同一口径）
  const win = settleWin(v.board, action.seat, cancelCard);
  if (win)
    return {
      state: commit(state, { ...win.board, punish: undefined, winner: action.seat }, "finished"),
      events: [...events, ...v.events, ...win.events],
    };
  const c = settleEmptyHand(v.board, action.seat, ctx);
  const all = [...events, ...v.events, ...c.events];

  // 01-G5：取消者**不进入自己的回合**，从他的下家继续出牌
  return { state: commit(state, { ...c.board, ...passTurn(c.board, ctx.now, action.seat) }, "turnStart"), events: all };
}

/**
 * 取消窗口里的合法动作：每张洗牌牌各一条 + 放弃。
 * `chosenColor` 不带——定色是提交前的客户端模态，不是服务端窗口（同 playCards 的无色牌）。
 *
 * 弃牌窗口那侧没有对应函数：它的动作与司夜②还牌逐字相同（每张手牌一条 `respond`），
 * 在 `index.ts::legalActions` 里与 `swapReturn` 并作一条分支。
 */
export const shuffleCancelActions = (b: Board, seat: number, windowId: string): Action[] => [
  ...b.hands[seat]
    .filter(isShuffleCard)
    .map((c): Action => ({ type: "respond", seat, windowId, choice: CANCEL, cardIds: [c.id] })),
  { type: "respond", seat, windowId, choice: PASS },
];
