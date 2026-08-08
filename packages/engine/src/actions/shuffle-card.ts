/**
 * 洗牌牌（05 §2b「洗牌（3 张）」+ 2026-07-31 的四条裁定）。
 *
 * 卡面：**三选一并决定颜色**
 *   ① 洗牌     —— 合并并打乱所有玩家手牌，从下家开始每名玩家依次获得一张牌（03 §6）
 *   ② 摸一弃一 —— 先摸后弃，弃哪张开窗口自选（裁定 洗-1）。它是 03 §2「摸 N 弃 N」
 *                 的 N = 1 特例，流程整个在 `draw-discard.ts`，这里只负责起头
 *   ③ 取消     —— 取消一次其他玩家的①，取消者不进回合、从取消者下家继续（裁定 洗-3，照抄劫营 01-G5）
 *
 * ⚠️ **命名**：这里的「洗牌」= 打乱重分**全体手牌**（`redistribute`）；与「摸牌堆见底把牌河洗回
 * 摸牌堆」（01-U8，`draw.ts` 里那段 `reshuffle`）是两回事，两个名字不要混用。
 */
import { shuffle } from "../deck.ts";
import { openDrawDiscard } from "./draw-discard.ts";
// 环：play-cards（打出洗牌）→ shuffle-card（结算/开窗口）→ play-cards（窗口结完接着跑收尾）。
// 两边点名的都是函数声明，模块实例化时就绑好了，环存在也无害（同 play-cards ↔ raid）。
import { settleAfterFace, settleEmptyHand, settleWin } from "./play-cards.ts";
import { WINDOW_MS, calledThisTurn, colorLocked, commit, nextSeat, passTurn, reject, windowIdOf } from "../legal.ts";
import { SKILL_DATA } from "../skills/draw-passives.ts";
import type { SkillData } from "../skills/draw-passives.ts";
import type {
  Action, ApplyResult, Board, Card, Color, Ctx, EngineEvent, GameState, ShuffleChoice, ShufflePending,
} from "../types.ts";

/** 卡面三选一里能从 `playCards` 打出的两个。③是响应，只能从 `shuffleCancel` 窗口打出。 */
export const SHUFFLE_CHOICES: readonly ShuffleChoice[] = ["shuffle", "drawDiscard"];

/** 取消窗口的两个响应。`pass`（含超时）= 让①照常执行。 */
const CANCEL = "cancel";
const PASS = "pass";

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
  // 选项②的「摸一弃一」是 03 §2「摸 N 弃 N」的 N = 1 特例，整条流程都在 draw-discard.ts。
  // `choice` 到这里已经用完，中间态换成那边的 `drawDiscard`（摸到哪张是暗信息，它替我们收着）
  if (b.shufflePending?.choice === "drawDiscard") {
    const { shufflePending: _used, ...rest } = b;
    return openDrawDiscard(
      state, rest, seat, { kind: "rule", base: 1, seat }, { kind: "afterFace" }, ctx, before, data,
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
    // 他的声明留到交回合时由 passTurn 结算——但只限**本回合按过按钮**的那一份，
    // 结转来的声明跟别人一样，手牌一离开 1 张就作废（2026-08-08 澄清）。
    saidUno: b.saidUno.map((v, i) => v && i === seat && calledThisTurn(b, i)),
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
  // 03 §4 五彩：取消牌也是无色牌，同样改不了颜色（与 playCards 同一条判定）
  if (colorLocked(b, action.seat, action.chosenColor)) return reject(state, "color_locked");

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
 * 弃牌窗口那侧的动作在 `draw-discard.ts::drawDiscardActions`（组合不枚举，只给一条模板）。
 */
export const shuffleCancelActions = (b: Board, seat: number, windowId: string): Action[] => [
  ...b.hands[seat]
    .filter(isShuffleCard)
    .map((c): Action => ({ type: "respond", seat, windowId, choice: CANCEL, cardIds: [c.id] })),
  { type: "respond", seat, windowId, choice: PASS },
];
