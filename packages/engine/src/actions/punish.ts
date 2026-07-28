import { drawCards, drawEvents, giveTo } from "./draw.ts";
import { commit, nextSeat, reject } from "../legal.ts";
import type { ApplyResult, Board, Card, Ctx, GameState, PunishChain } from "../types.ts";

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

/** 窗口 id 由版本号派生，所以窗口一被结算（version++）旧 id 立刻失效。 */
export const windowIdOf = (state: GameState): string | undefined =>
  state.pendingWindow && `w${state.version}:${state.pendingWindow.type}`;

/**
 * P6：贡献在打出进链时结算，只作用于自己那一张，所以逐段累加而不是 `2 * count`。
 * P11：受罚侧要「先加总各段贡献再套用」，`total` 就是那个加总。
 */
export function extendChain(chain: PunishChain | undefined, seat: number, face: PunishFace): PunishChain {
  const segments = [...(chain?.segments ?? []), { seat, face, draw: PUNISH_DRAW[face] }];
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

/** P1：惩罚窗口里只有「叠」和「吃下」两个选项——惩罚回合不能用主动技能。 */
const CHOICES = ["stack", "accept"];

export function respond(
  state: GameState,
  action: { seat: number; windowId: string; choice: string },
  ctx: Ctx,
): ApplyResult {
  const w = state.pendingWindow;
  if (!w) return reject(state, "no_window");
  if (action.windowId !== windowIdOf(state)) return reject(state, "stale_window");
  if (!w.actors.includes(action.seat)) return reject(state, "not_your_window");
  if (w.type !== "punishStack") return reject(state, "unknown_window");
  if (!CHOICES.includes(action.choice)) return reject(state, "bad_choice");
  return settle(state, action.seat, action.choice, ctx);
}

/** spec §7：任意成员可在 deadline 之后催促结算，按 defaultChoice 收场，防 AFK 卡死全桌。 */
export function claimTimeout(state: GameState, action: { windowId: string }, ctx: Ctx): ApplyResult {
  const w = state.pendingWindow;
  if (!w) return reject(state, "no_window");
  if (action.windowId !== windowIdOf(state)) return reject(state, "stale_window");
  if (Date.parse(ctx.now) <= Date.parse(w.deadline)) return reject(state, "not_yet_expired");
  return settle(state, w.actors[0], w.defaultChoice, ctx);
}

function settle(state: GameState, seat: number, choice: string, ctx: Ctx): ApplyResult {
  const b = state.board!;
  const chain = b.punish!;
  if (choice === "stack") {
    // 选了叠就必须真的叠得出来，否则窗口一关就没人能推进了
    if (!b.hands[seat].some((c) => canStack(c, chain))) return reject(state, "cannot_stack");
    return {
      state: commit(state, { ...b, currentSeat: seat, drawnPlayable: null }, "play"),
      events: [{ type: "punishStackChosen", public: { seat } }],
    };
  }
  // P10：吃下累计 → 摸完即回合结束，不能再出牌。
  // P11：`chain.total` 就是「先加总各段贡献」的结果，直接作为 L0 基础值；
  // P6 的「只作用于自己那张」在进链时已入各段贡献，02 §7 L0 不得重复计算。
  const { board, drawn, reshuffledOrder } = drawCards(b, { kind: "punish", base: chain.total }, ctx.rng);
  const eaten: Board = {
    ...board,
    hands: giveTo(board, seat, drawn),
    punish: undefined,
    drawnPlayable: null,
    currentSeat: nextSeat(board, seat),
  };
  return {
    state: commit(state, eaten, "turnStart"),
    events: [
      { type: "punishAccepted", public: { seat, total: chain.total, segments: chain.segments } },
      ...drawEvents(seat, drawn, reshuffledOrder),
    ],
  };
}
