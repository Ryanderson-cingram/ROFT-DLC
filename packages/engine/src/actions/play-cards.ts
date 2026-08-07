import { colorLocked, commit, isNumberCard, isWild, passTurn, playableFor, reject } from "../legal.ts";
// 环：play-cards（打出功能牌）→ alliance（开「要不要」窗口）→ play-cards（结完接着跑收尾）。同下面几处。
import { notePlayedFunction, offerPicksFor } from "../skills/alliance.ts";
import { SKILL_DATA } from "../skills/draw-passives.ts";
import { gainDissentMark } from "../skills/dissent.ts";
import { multiPlayAllowed, valueOverrideFor } from "../skills/primitives/playability.ts";
import { liftSeal } from "./bloodthorn.ts";
import { punishDiceFor, rollWithTakeover } from "./dice.ts";
import { drawCards, drawEvents, giveTo } from "./draw.ts";
// 环：play-cards（打出功能牌 / 打出洗牌）→ draw-discard（开窗口）→ play-cards（窗口结完接着跑收尾）
import { openDrawOffer } from "./draw-discard.ts";
import { finalCardCost, payFinalCard, stealDiceFor } from "./nightlord.ts";
import { canStack, extendChain, openPunishWindow, punishFace } from "./punish.ts";
// 环：play-cards → raid（摆完一张要问「有没有人能截」）→ play-cards（窗口 pass 后接着摆）。
// 两边点名的都是函数声明，模块实例化时就绑好了，环存在也无害（同 dice ↔ punish）。
import { openRaidWindow, raidActors } from "./raid.ts";
// 环：play-cards（打出洗牌）→ shuffle-card（结算/开窗口）→ play-cards（窗口结完接着跑收尾）。同上。
import { playShuffleCard } from "./shuffle-card.ts";
import type { SkillData } from "../skills/draw-passives.ts";
import type {
  ApplyResult, Board, Card, Color, Ctx, EngineEvent, Face, GameState, ShuffleChoice,
} from "../types.ts";

/** 打完之后下家要跟的目标。`face: null` = 跟牌堆顶那张的牌面（单张出牌一律如此）。 */
interface Follow { color: Color | null; face: Face | null }

export function playCards(
  state: GameState,
  action: {
    seat: number;
    cardIds: string[];
    chosenColor?: Color;
    shuffleChoice?: ShuffleChoice;
    useSkill?: boolean;
    useAssault?: boolean;
  },
  ctx: Ctx,
  data: SkillData = SKILL_DATA,
): ApplyResult {
  const b = state.board;
  if (!b) return reject(state, "not_started");
  if (state.pendingWindow) return reject(state, "pending_window");
  if (state.phase !== "turnStart" && state.phase !== "play") return reject(state, "wrong_phase");
  if (action.seat !== b.currentSeat) return reject(state, "not_your_turn");

  const hand = b.hands[action.seat];
  const cards = action.cardIds.map((id) => hand.find((c) => c.id === id));
  // 同一张牌报两遍等于报了一张手上没有的牌，去重后张数对不上就是伪造
  if (cards.some((c) => !c) || new Set(action.cardIds).size !== cards.length) return reject(state, "not_in_hand");
  // 三选一是**洗牌牌的特权**（05 §2b）。这一条要排在多张分派之前：并列♥4 限数字牌，
  // 走那条路的动作带上它只可能是伪造，不该被静默忽略。值域校验在 index.ts::malformed。
  if (action.shuffleChoice && !(cards.length === 1 && cards[0]!.face === "shuffle"))
    return reject(state, "shuffle_choice_not_allowed");
  // G2：一次多张只有并列♥4 能开，形状与权利都在下面那条路径上校验
  if (cards.length !== 1) return playParallel(state, b, action, cards as Card[], ctx, data);

  const card = cards[0]!;
  // U1：摸到可打的牌后，本回合只能打那一张，或者结束回合
  if (b.drawnPlayable && b.drawnPlayable.id !== card.id) return reject(state, "must_play_drawn_or_end");
  // P3/P4/P5：惩罚链未结算时，只能接合法的惩罚牌
  if (b.punish && !canStack(card, b.punish)) return reject(state, "must_stack");
  // 定色是**无色牌的特权**：有色牌带上它就等于打红 5 却把跟色改成蓝，牌顶与跟色当场脱钩
  if (!isWild(card) && action.chosenColor) return reject(state, "color_not_allowed");
  if (isWild(card) && !action.chosenColor) return reject(state, "color_required");
  // 03 §4 五彩：变色牌打得出，但改不了颜色（判定在 legal.ts，出牌与洗牌③共用一条）
  if (isWild(card) && colorLocked(b, action.seat, action.chosenColor)) return reject(state, "color_locked");
  // 三选一同理，是**洗牌牌的特权**（05 §2b）。选项③「取消」是响应，只能从 shuffleCancel
  // 窗口打出，所以从 playCards 送上来的三选一只认前两个。
  // 反过来，洗牌牌**必须**带（「非洗牌牌不许带」已在多张分派之前统一拒掉了）
  if (card.face === "shuffle" && !action.shuffleChoice) return reject(state, "shuffle_choice_required");

  // 血棘♦2 的解除条件之二（01-P14）：被封者**链首**（`!b.punish` = 开新链）打出 +2/+4 →
  // **打出即解除**，所以要排在这次出牌的其余结算之前——那条链里他自己的技能已经恢复。
  // 叠链（非链首）不解除。这一步没提交，出牌被拒时整块牌桌一起丢掉。
  const lift = punishFace(card) && !b.punish ? liftSeal(b, action.seat) : null;
  const board = lift?.board ?? b;
  const before = lift?.events ?? [];

  // 强袭①：只有**自己打出的** +2/+4 才谈得上倍率，且要已亮出强袭（V3）。
  // 链首或叠链皆可（04 ♦1）——惩罚回合关的是主动，①不占主动额度（06-Q34）。
  if (action.useAssault && !(punishFace(card) && assaultDice(board, action.seat, data) > 0))
    return reject(state, "assault_unavailable");

  const follow: Follow = { color: action.chosenColor ?? card.color, face: null };
  // 本来就能打的牌不走技能——带不带 useSkill 都不该白吃掉 V7 的额度
  if (playableFor(board, action.seat, card))
    return resolvePlay(state, board, action, card, follow, ctx, before, data);

  const used = action.useSkill ? useValueOverride(board, action.seat, card, data) : null;
  if (!used) return reject(state, "illegal_card");
  if ("rejected" in used) return reject(state, used.rejected);
  return resolvePlay(state, used.board, action, card, follow, ctx, [...before, ...used.events], data);
}

/**
 * 并列♥4：一次打出 2 / 4 / 6 张。06-Q35 裁定它是**改出牌规则**而不是阶段 1 的主动，
 * 所以既不占 V7 额度、也不发 skillActivated——只是出牌路径上多出来的一条分支。
 */
function playParallel(
  state: GameState,
  b: Board,
  action: { seat: number; chosenColor?: Color },
  cards: Card[],
  ctx: Ctx,
  data: SkillData,
): ApplyResult {
  // U1：摸到可打的牌后只剩「打那一张」和「结束回合」
  if (b.drawnPlayable) return reject(state, "must_play_drawn_or_end");
  // P3/P4/P5：惩罚轮只认叠链的单张
  if (b.punish) return reject(state, "must_stack");
  const id = b.skills[action.seat];
  // V3：没亮出并列（或压根没有）就只能一张一张打
  if (!multiPlayAllowed(b, action.seat, id ? data.byId.get(id) : undefined))
    return reject(state, "single_card_only");
  // 三形状里只有 4 张同数要打出者定色（另两种的色由牌本身定死），别处带定色一律拒
  if (action.chosenColor && cards.length !== 4) return reject(state, "color_not_allowed");

  const follow = parallelShape(cards, action.chosenColor);
  if (!follow) return reject(state, "bad_shape");
  if (!follow.color) return reject(state, "color_required");
  // 04 ♥4：「三种合法多打，**首张**都必须按常规接得上牌顶」。逐张摆之后哪张先落地是
  // 可观察事实，所以校验的是 cards[0]——4 张/6 张形状里组内并不一致，别的牌接得上不算数。
  if (!playableFor(b, action.seat, cards[0]))
    return reject(state, "illegal_card");
  // 形状**一次校验**（不成形状整组拒，一张都不摆），然后整组一次落地
  return placeParallel(state, b, action.seat, cards, follow, ctx, action.chosenColor, data);
}

/**
 * 并列整组落地（04 ♥4 的 2026-08-02 改判，取代原来的逐张模型）。
 *
 * 三步，顺序就是裁定的顺序：
 * 1. **整组一次落地**，中途不给任何窗口——摆的过程不再是可观察的中间态
 * 2. 打空手牌 → **当场获胜**（U5c：收官判在末牌离手那一刻），劫营窗口根本不开。
 *    这是明知的取舍：并列由此成为不可拦截的收官手段
 * 3. 否则开**一次**劫营窗口，触发面是**组内任意一张**——劫营者手上有牌与这一组里
 *    任何一张同色同数即可截。一回合最多截一次并列
 *
 * ⚠️ 神化连出（一回合出多张）**不走这条**：那是多轮出牌，仍逐张、每张都可被打断（01-G5）。
 * 本批未实现；实现时另起一条路径，别把这里改回逐张。
 */
export function placeParallel(
  state: GameState,
  b: Board,
  seat: number,
  cards: Card[],
  follow: Follow,
  ctx: Ctx,
  chosenColor?: Color,
  data: SkillData = SKILL_DATA,
): ApplyResult {
  const ids = new Set(cards.map((c) => c.id));
  const board: Board = {
    ...b,
    hands: b.hands.map((h, i) => (i === seat ? h.filter((c) => !ids.has(c.id)) : h)),
    // `playedPile[0]` 是牌顶：整组按提交顺序压上去，最后一张在最上面
    playedPile: [...[...cards].reverse(), ...b.playedPile],
    // 跟牌目标按形状表定（被截的话 settleRaid 会改成劫营那张）
    activeColor: follow.color,
    activeFace: follow.face,
    drawnPlayable: null,
  };
  const events: EngineEvent[] = [playedEvent(seat, cards, chosenColor)];

  // U2：多张收官直接获胜，且无需喊 UNO；U5「末牌必须数字牌」天然满足（并列全是数字牌）。
  // 2026-08-02：收官这一步**排在劫营窗口之前**，所以整组打空手牌截不了
  if (board.hands[seat].length === 0)
    return { state: commit(state, { ...board, winner: seat }, "finished"), events };

  const actors = raidActors(board, seat, cards, data);
  if (actors.length > 0)
    return openRaidWindow(
      state, { ...board, parallelPending: { seat, cards } }, seat, actors, cards, ctx, events,
    );

  return { state: commit(state, { ...board, ...passTurn(board, ctx.now, seat) }, "turnStart"), events };
}

/** `cardPlayed` 带的是这一组整个（并列已是原子的，不会再出现「只发前半截」）。 */
const playedEvent = (seat: number, cards: Card[], chosenColor?: Color): EngineEvent => ({
  type: "cardPlayed",
  public: { seat, cards, chosenColor: chosenColor ?? null },
});

/**
 * 并列的三种合法形状（04 ♥4，2026-07-30 补齐）：2 张同色同数 / 4 张同数 / 6 张同色，
 * 全部限数字牌。返回打完之后的跟牌目标；不成形状 = null。
 * 4 张的跟色由打出者选（同变色牌的 chosenColor），没带就是 null → 调用方要 color_required。
 */
function parallelShape(cards: Card[], chosenColor?: Color): Follow | null {
  if (!cards.every(isNumberCard)) return null;
  const sameFace = cards.every((c) => c.face === cards[0].face);
  const sameColor = cards.every((c) => c.color === cards[0].color);
  if (cards.length === 2 && sameFace && sameColor) return { color: cards[0].color, face: cards[0].face };
  if (cards.length === 4 && sameFace) return { color: chosenColor ?? null, face: cards[0].face };
  // 六张同色、数字任意：跟的是其中**最大**的那个数（面值比较，"9" > "2"）
  if (cards.length === 6 && sameColor)
    return { color: cards[0].color, face: cards.reduce((m, c) => (Number(c.face) > Number(m.face) ? c : m)).face };
  return null;
}

/** 强袭①此刻能掷几颗骰子改倍率（0 = 没这项能力）。查的是定义，不认技能 id。 */
const assaultDice = (b: Board, seat: number, data: SkillData) => {
  const id = b.skills[seat];
  return punishDiceFor(b, seat, id ? data.byId.get(id) : undefined);
};

/**
 * 精英式的点数改写（原语 `playability`）：只在牌本来打不出去时才动用。
 * 改的是判定不是牌——牌照常按牌面进牌顶，所以这里只回答「算不算合法」。
 */
function useValueOverride(
  b: Board,
  seat: number,
  card: Card,
  data: SkillData,
): { board: Board; events: EngineEvent[] } | { rejected: string } | null {
  const id = b.skills[seat];
  const ov = valueOverrideFor(b, seat, card, id ? data.byId.get(id) : undefined);
  // 加点后要能跟上当前要跟的**点数**（颜色对不上正是精英的用武之地）
  if (!ov || String(ov.value) !== (b.activeFace ?? b.playedPile[0].face)) return null;

  // V7：精英占额度（2026-07-29 裁定，原 Q45）。今天只有神化能让一回合出多张，
  // 所以这条账在基础包里看不出差别；照裁定记上，神化到了就是对的。
  if (!ov.effect.stacks_with_turn_limit) return { board: b, events: [] };
  if (b.activatedThisTurn[seat]) return { rejected: "already_activated" };
  return {
    board: { ...b, activatedThisTurn: b.activatedThisTurn.map((x, i) => (i === seat ? true : x)) },
    events: [{ type: "skillActivated", public: { seat, skillId: id, effectKey: ov.effect.key } }],
  };
}

/** 单张出牌的结算。并列走 `placeParallel`——它逐张摆、可被中途截断，共用不了这条路。 */
function resolvePlay(
  state: GameState,
  b: Board,
  action: { seat: number; chosenColor?: Color; shuffleChoice?: ShuffleChoice; useAssault?: boolean },
  card: Card,
  follow: Follow,
  ctx: Ctx,
  before: EngineEvent[] = [],
  data: SkillData = SKILL_DATA,
): ApplyResult {
  const { seat, chosenColor } = action;
  const hands = b.hands.map((h, i) => (i === seat ? h.filter((c) => c.id !== card.id) : h));
  const face = punishFace(card);
  // 强袭①：这一段贡献几张要等骰子（还可能被别人接管重掷）才定，所以链留到 resume 里再延长
  const dice = face && action.useAssault ? assaultDice(b, seat, data) : 0;
  // 异议♥8②（04 ♥8）：打出「转」获 1 枚异。没有异议 / 不是转 → 标记表原样，事件为空
  const gained = gainDissentMark(b, seat, card.face, data);
  // U6：出牌**碰不到**已喊状态（喊是另一个动作，2026-08-01 二次澄清）——已经喊过的人
  // 再出一张牌不该把自己的声明擦掉，作废与否是交回合时 passTurn 的事。
  const played: Board = {
    ...b,
    hands,
    playedPile: [card, ...b.playedPile],
    activeColor: follow.color,
    activeFace: follow.face,
    direction: card.face === "rev" ? ((b.direction * -1) as 1 | -1) : b.direction,
    marks: gained.marks,
    drawnPlayable: null,
    // 段色 = follow.color：+2 就是牌本身的色，+4 是打出者定的色（无色牌必带 chosenColor）
    punish: face && !dice ? extendChain(b.punish, seat, face, follow.color) : b.punish,
    // 洗牌的三选一随牌桌走到 settlePlay（它拿不到 action）。三条结算路径各自清掉它。
    ...(action.shuffleChoice && { shufflePending: { seat, choice: action.shuffleChoice } }),
  };
  // 01-S14b 的连击账：无条件记一笔「这个回合打出过功能牌」（连横可能中途才亮出来）
  const noted = notePlayedFunction(played, seat, card);
  const events: EngineEvent[] = [...before, playedEvent(seat, [card], chosenColor), ...gained.events];

  // 2026-07-31 裁定：**任何人打出任何一张牌**落地后都给劫营♦10 一次机会（不再限于多打）。
  // 打空手牌那一张不给：要么当场终局，要么走 U5 的代价摸牌，都没有「打断当前轮」可言。
  const actors = noted.hands[seat].length === 0 ? [] : raidActors(noted, seat, [card], data);
  if (actors.length > 0)
    return openRaidWindow(state, { ...noted, playPending: { seat, dice } }, seat, actors, [card], ctx, events);

  return settlePlay(state, noted, seat, card, dice, ctx, events, data);
}

/** 毒（05 §2b 卡面）：打出时**打出者自己**摸 3 张。牌面常数，不是技能数值，所以不走 04 的 values。 */
const POISON_DRAW = 3;

/**
 * 末牌收官判定（U2 数字牌 / 司夜③ 的放宽）。收不了官 → null。
 *
 * **判定时点是「牌一离手」，排在这张牌自身的效果之前**（规则制定人 2026-08-01，原 06-Q59/Q61）：
 * 原话「如果盗标记够五个，可以打功能牌，**打出后无论选择什么都算胜利并结束**」。
 * 所以毒的摸 3、洗牌的三选一都不再结算，别人也**取消不掉**已经到手的胜利。
 *
 * 与之相对，01-U5 的**补摸 1 张**判在效果结算**之后**（见 `settleEmptyHand`）——
 * 两个判定时点不同，是两条独立的规则，别合并。
 */
export function settleWin(
  b: Board,
  seat: number,
  card: Card,
  data: SkillData = SKILL_DATA,
): { board: Board; events: EngineEvent[] } | null {
  if (b.hands[seat].length !== 0) return null;
  // U2/U5：默认只有数字牌能打完获胜
  if (isNumberCard(card)) return { board: b, events: [] };

  // 司夜♣3③：持够盗则末牌放宽（3 盗 → 功能牌，5 盗 → 变色牌，含毒与洗牌），
  // 自动扣盗收官（01-S16 / 06-Q11 / 06-Q57）
  const cost = finalCardCost(b, seat, card, data);
  if (cost === null) return null;
  const { board, event } = payFinalCard(b, seat, cost);
  return { board, events: [event] };
}

/** 收官的收场：终局、清掉未结算的惩罚链。 */
const finish = (state: GameState, board: Board, seat: number, events: EngineEvent[]): ApplyResult => ({
  state: commit(state, { ...board, punish: undefined, winner: seat }, "finished"),
  events,
});

/**
 * 01-U5：这张牌**自身的效果全部结算完**、手牌仍为 0 → 补摸 1 张，游戏继续。
 *
 * 判定时点是 2026-07-31 澄清的（原话「打完毒之后会摸三张，结束回合时手里仍然有牌所以不需要
 * 额外摸」）。收官判定**不在这里**——它排在牌面效果之前，见 `settleWin`。
 * 摸的这张不是惩罚（01-P1）。
 */
export function settleEmptyHand(b: Board, seat: number, ctx: Ctx): { board: Board; events: EngineEvent[] } {
  if (b.hands[seat].length !== 0) return { board: b, events: [] };
  // 01-S17b ④：打出的最后一张牌是非数字牌 → 这一张是**一定要摸**的，神授也免不掉
  const { board, drawn, reshuffledOrder } = drawCards(b, { kind: "rule", base: 1, seat, reason: "lastCard" }, ctx.rng);
  return {
    board: { ...board, hands: giveTo(board, seat, drawn) },
    events: drawEvents(seat, drawn, reshuffledOrder),
  };
}

/**
 * 单张出牌落地之后的其余结算。
 * 抽出来是因为劫营♦10 的窗口会插在「牌落地」与「结算」之间：窗口 pass 之后
 * `raid.ts::settleRaid` 拿 `board.playPending` 从这里接着跑，两条路径同一段代码。
 *
 * 顺序（01-U5 的判定时点澄清之后）：**牌面自身效果 → 收官/U5 → 获盗 → 惩罚链 → 交回合**。
 */
export function settlePlay(
  state: GameState,
  b: Board,
  seat: number,
  card: Card,
  dice: number,
  ctx: Ctx,
  before: EngineEvent[] = [],
  data: SkillData = SKILL_DATA,
): ApplyResult {
  // 收官判定排在**牌面效果之前**（2026-08-01 裁定）：末牌打出的那一刻就定胜负，
  // 毒的摸 3 与洗牌的三选一都不再结算——游戏已经结束了。
  const win = settleWin(b, seat, card, data);
  if (win) return finish(state, win.board, seat, [...before, ...win.events]);

  // 合纵♠5 / 连横♠6②（01-S14）：打出功能牌之后可以摸 N 弃 N，**每次都是可选**，
  // 所以先问一句。窗口结完（要或不要）都回到 `settleAfterFace` 接着跑这次出牌的收尾。
  //
  // 手上已经空了就**不问**：那一手是确定性的空转（摸 N 张、再从这 N 张里弃 N 张，
  // 一张也留不下），而 01-U5 的补摸排在牌面效果之后——先开窗口会把牌桌停在
  // 「非终局却有人 0 张」上，`fuzz` 的不变式当场就红。
  const picks = b.hands[seat].length > 0 ? offerPicksFor(b, seat, card, data) : 0;
  if (picks > 0)
    return openDrawOffer(state, b, seat, { kind: "skill", base: picks, seat }, { kind: "afterFace" }, ctx, before);

  // 毒（05 §2b）：打出者自己摸 3 张。`kind: "rule"` ——打出毒不是惩罚（01-P1），也不是技能，
  // 所以同命不响应（P1b）、恩惠不减（它只吃 punish 与他人技能）。这些都是选对 kind 的自动结果。
  if (card.face === "poison") {
    const r = drawCards(b, { kind: "rule", base: POISON_DRAW, seat, reason: "poison" }, ctx.rng);
    // 摸的这几张**不设 drawnPlayable**：U1 的「摸到可打即可打出」只针对无牌可出摸的那一张
    return settleAfterFace(
      state, { ...r.board, hands: giveTo(r.board, seat, r.drawn) }, seat, card, dice, ctx,
      [...before, ...drawEvents(seat, r.drawn, r.reshuffledOrder)], data,
    );
  }
  // 洗牌（05 §2b）：三选一。选项①可能开取消窗口、选项②要开弃牌窗口，两者都从
  // shuffle-card.ts 里回调 settleAfterFace 接着跑。
  if (card.face === "shuffle") return playShuffleCard(state, b, seat, ctx, before, data);

  return settleAfterFace(state, b, seat, card, dice, ctx, before, data);
}

/**
 * 牌面自身效果结算完之后的收尾（收官 / U5 / 获盗 / 惩罚链 / 交回合）。
 * 洗牌的窗口结完之后也回到这里，所以是导出的。
 */
export function settleAfterFace(
  state: GameState,
  b: Board,
  seat: number,
  card: Card,
  dice: number,
  ctx: Ctx,
  before: EngineEvent[] = [],
  data: SkillData = SKILL_DATA,
): ApplyResult {
  const face = punishFace(card);
  // 收官判定已经在 settlePlay 的入口做过了（判在牌面效果之前），这里只剩 U5 的补摸
  const empty = settleEmptyHand(b, seat, ctx);
  const events = [...before, ...empty.events];
  const played = empty.board;

  // 司夜♣3①：打出无色牌就掷骰获盗（04 ♣3①，阶段 3；不是可选的发动，惩罚轮打 +4 照样获）。
  // 获盗要在这次出牌的结算内完成，而窗口只能有一个——所以「接着开惩罚窗口」放进 resume 里。
  const steal = isWild(card) ? stealDiceFor(played, seat, data) : 0;
  if (steal > 0) {
    const opened = rollWithTakeover(
      state, played, seat, "nightlord-steal", steal,
      { kind: "nightlord", seat, face: card.face === "+4" ? "+4" : null }, ctx, data,
    );
    return { ...opened, events: [...events, ...opened.events] };
  }

  if (face) {
    // 掷骰紧跟在 cardPlayed 之后；场上有强袭者时这里会挂起等接管，链在续跑时才成型
    const opened = dice
      ? rollWithTakeover(state, played, seat, "assault-multiplier", dice, { kind: "assault", seat, face }, ctx, data)
      : openPunishWindow(state, played, seat, ctx);
    return { ...opened, events: [...events, ...opened.events] };
  }

  // 「停」跳过下家的回合开始窗口（U3 + 传统 UNO）
  const step = card.face === "skip" ? 2 : 1;
  return {
    state: commit(state, { ...played, ...passTurn(played, ctx.now, seat, step) }, "turnStart"),
    events,
  };
}
