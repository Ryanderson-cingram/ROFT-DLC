/**
 * 喊 UNO 与抓漏喊（01-U6/U7，原 Q26）。
 *
 * 两个动作都**不走 commit**：commit 会顺手关掉反应窗口，而补喊与抓明文不限回合、
 * 窗口期间也可以（U7）。这里手动 version+1、保留 pendingWindow。
 * 声明的存续（回合内不清、回合外离开 1 张即作废）由 legal.ts 的 syncUno 统一执行。
 */
import { calledThisTurn, syncUno, windowIdOf } from "../legal.ts";
import { reject } from "../legal.ts";
import { drawCards, drawEvents, giveTo } from "./draw.ts";
import type { ApplyResult, Board, Ctx, GameState } from "../types.ts";

const CATCH_DRAW = 2; // U7

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
 * U6（2026-08-02 再改判）：**按钮常亮，按下只记录「这回合喊过」**——当场不判手牌数、不罚。
 *
 * 唯一的结算在**交回合那一刻**（`legal.ts::settleUnoOnPass`）：恰 1 张则成立并存续，
 * 不是 1 张则作废 + 罚摸 2。所以「先喊了再打」不再有即时代价，代价在回合末统一算。
 *
 * 回合外的补喊没有「你的回合末」可等——`syncUno` 会当场把它兜住（回合外手牌一离开 1 张
 * 即作废），所以拿着 3 张在别人回合点一下等于白点：既不成立、也不罚。
 * 与抓先到先得，由乐观锁串行化。
 */
export function callUno(state: GameState, seat: number, ctx: Ctx): ApplyResult {
  const b = state.board;
  if (!b) return reject(state, "not_started");
  if (state.phase === "finished") return reject(state, "wrong_phase");
  // 已喊再按没有代价：UI 那时显示的是徽记而不是按钮
  if (b.saidUno[seat]) return reject(state, "already_said");
  return {
    state: bump(state, {
      ...b,
      saidUno: b.saidUno.map((v, i) => (i === seat ? true : v)),
      // 「本回合按过」——回合内的豁免与交回合的虚喊结算都只认这一格，不认结转来的声明
      unoThisTurn: b.saidUno.map((_, i) => (i === seat ? true : calledThisTurn(b, i))),
    }),
    events: [{ type: "unoCalled", public: { seat } }],
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

/**
 * U7b：目标还在交回合后的补喊宽限里（1 秒）。
 *
 * **不并进 `catchable`**：`catchable` 喂的是 `legalActions`，那里拿不到 `now`
 * （快照也不会因为时间流逝而重推）。所以分工是——引擎在这里把关（宽限内一律拒收），
 * 宽限的截止时刻随快照下发，UI 到点自己把按钮画出来。跟倒计时环同一套。
 */
const inUnoGrace = (b: Board, target: number, now: string) =>
  b.unoGrace?.seat === target && Date.parse(now) < Date.parse(b.unoGrace.until);

/** U7 抓漏喊：目标持 1 张且未喊即可抓；摸的 2 张是规则摸牌，不是惩罚（P1），恩惠/同命不响应。 */
export function catchUno(state: GameState, action: { seat: number; target: number }, ctx: Ctx): ApplyResult {
  const { seat, target } = action;
  const b = state.board;
  if (!b) return reject(state, "not_started");
  if (state.phase === "finished") return reject(state, "wrong_phase");
  if (target < 0 || target >= b.hands.length || target === seat) return reject(state, "bad_target");
  if (!catchable(b, target)) return reject(state, "not_catchable");
  // U7b：交回合后的 1 秒是他的补喊时间，谁都抓不得（防秒抓）
  if (inUnoGrace(b, target, ctx.now)) return reject(state, "uno_grace");

  // 01-S17b ⑤：只剩最后一张没喊 UNO 被抓 → 这 2 张一定要摸，神授也免不掉
  const { board, drawn, reshuffledOrder } =
    drawCards(b, { kind: "rule", base: CATCH_DRAW, seat: target, reason: "unoPenalty" }, ctx.rng);
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
