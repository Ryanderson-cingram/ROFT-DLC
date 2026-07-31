/**
 * 喊 UNO 与抓漏喊（01-U6/U7，原 Q26）。
 *
 * 两个动作都**不走 commit**：commit 会顺手关掉反应窗口，而补喊与抓明文不限回合、
 * 窗口期间也可以（U7）。这里手动 version+1、保留 pendingWindow。
 * 声明的存续（回合内不清、回合外离开 1 张即作废）由 legal.ts 的 syncUno 统一执行。
 */
import { syncUno, windowIdOf } from "../legal.ts";
import { reject } from "../legal.ts";
import { drawCards, drawEvents, giveTo } from "./draw.ts";
import type { ApplyResult, Board, Ctx, GameState } from "../types.ts";

const CATCH_DRAW = 2; // U7
const MISCALL_DRAW = 2; // U6：虚喊的罚摸，与 U7 的抓同一条口径（规则摸牌，非惩罚）

/**
 * version+1 但保留窗口。窗口 id 默认由 version 派生，所以涨版本前先把当下的 id
 * **冻进窗口**——不然抓一次漏喊就会让全场正在响应的人拿到 `stale_window`，
 * 与 U7「反应窗口期间也可抓」直接打架。
 */
const bump = (state: GameState, board: Board): GameState => ({
  ...state,
  version: state.version + 1,
  board: syncUno(board),
  pendingWindow: state.pendingWindow && { ...state.pendingWindow, id: windowIdOf(state) },
});

/**
 * U6（2026-08-01 二次澄清）：**按钮常亮，判在按下那一刻**。资格一概不拦——
 * 手牌恰 1 张则声明成立；**不是 1 张就是虚喊，罚摸 2 张**且声明不成立（「如果先喊，
 * 喊的时候还有两张手牌也需要罚」）。所以不存在预喊：喊与出牌互不影响，正常打法是
 * 打完牌、手牌变 1 之后再点；忘喊了在别人回合里补点也成立（那时恰 1 张，不罚）。
 * 与抓先到先得，由乐观锁串行化。
 */
export function callUno(state: GameState, seat: number, ctx: Ctx): ApplyResult {
  const b = state.board;
  if (!b) return reject(state, "not_started");
  if (state.phase === "finished") return reject(state, "wrong_phase");
  // 已喊再按没有代价：UI 那时显示的是徽记而不是按钮
  if (b.saidUno[seat]) return reject(state, "already_said");
  if (b.hands[seat].length !== 1) return miscall(state, b, seat, ctx);
  return {
    state: bump(state, { ...b, saidUno: b.saidUno.map((v, i) => (i === seat ? true : v)) }),
    events: [{ type: "unoCalled", public: { seat } }],
  };
}

/** U6 虚喊：罚摸 2 张，声明**不置位**。摸牌口径与 U7 的抓逐字相同，所以恩惠/同命不响应。 */
function miscall(state: GameState, b: Board, seat: number, ctx: Ctx): ApplyResult {
  const { board, drawn, reshuffledOrder } = drawCards(b, { kind: "rule", base: MISCALL_DRAW, seat }, ctx.rng);
  // 罚不到就不受理（同 catchUno）：局面纹丝不动却涨 version 的动作可以无限重复
  if (drawn.length === 0) return reject(state, "deck_empty");
  return {
    state: bump(state, { ...board, hands: giveTo(board, seat, drawn) }),
    events: [{ type: "unoMiscalled", public: { seat } }, ...drawEvents(seat, drawn, reshuffledOrder)],
  };
}

/**
 * U7：目标此刻抓不抓得着。持 1 张且未喊即可抓，但有两条门闩：
 * - **本人回合内是宽限期**（抓窗口「自其回合结束开启」）：他在自己回合里持 1 张未喊也抓不得，
 *   回合一交出去立刻可抓。反过来在别人回合里被顶到 1 张（劫营打断、被交牌）没有宽限期。
 * - 司夜②的换牌窗口挂着期间，被盲抽走一张的那个人手上是**假象**的 1 张（还没还牌）：
 *   他既不在回合结束、也从未真正持有 1 张。
 */
export const catchable = (b: Board, target: number) =>
  b.hands[target].length === 1 && !b.saidUno[target] &&
  target !== b.currentSeat && b.swap?.target !== target;

/** U7 抓漏喊：目标持 1 张且未喊即可抓；摸的 2 张是规则摸牌，不是惩罚（P1），恩惠/同命不响应。 */
export function catchUno(state: GameState, action: { seat: number; target: number }, ctx: Ctx): ApplyResult {
  const { seat, target } = action;
  const b = state.board;
  if (!b) return reject(state, "not_started");
  if (state.phase === "finished") return reject(state, "wrong_phase");
  if (target < 0 || target >= b.hands.length || target === seat) return reject(state, "bad_target");
  if (!catchable(b, target)) return reject(state, "not_catchable");

  const { board, drawn, reshuffledOrder } = drawCards(b, { kind: "rule", base: CATCH_DRAW, seat: target }, ctx.rng);
  // 一张都摸不到时局面纹丝不动，而目标仍然「持 1 张未喊」——放行等于给了一条可以无限
  // 重复、每次都涨 version 的动作。罚不到就不受理（牌堆枯竭本身会走 U8 的平局收场）。
  if (drawn.length === 0) return reject(state, "deck_empty");
  return {
    state: bump(state, { ...board, hands: giveTo(board, target, drawn) }),
    events: [
      { type: "unoCaught", public: { seat, target } },
      ...drawEvents(target, drawn, reshuffledOrder),
    ],
  };
}
