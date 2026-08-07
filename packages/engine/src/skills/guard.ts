/**
 * 近卫♥6（04 ♥6 / 01-P11/P12 / 02 §7 L6）。
 *
 * 「受 ≥4 惩罚时，每张 +2/+4 可交 1 张手牌给**链首**。」
 *
 * 它是**第二支 L6 后置程序**——02 §7 那一行原文就写着「近卫：逐张交牌」，所以整条路
 * 复用第 4 步给忍戒建的执行面：定义里 `modifies: [draw_procedure]` + `procedure: hand_over`，
 * 采集走 `drawModifiersFor`，消费在 `punish.ts` 吃牌路径的**摸完之后**（01-P2）。
 * 这个文件里没有一行是「摸牌数」的事——L6 不改数字。
 *
 * 三条边界都在数据或已定条款里：
 * 1. 门槛与张数全从 `values` 读（`L6` = 门槛 4、`give` = 每段 1 张），引擎不写规则常数
 * 2. 交的是**自己手牌**、给**链首发起者**（P12）；链绕回自己时不成立（同 P8「不封自己」）
 * 3. 「**可**交」= 每次都能不交（同 S14 的口径），所以给的是一个窗口而不是自动执行；
 *    超时按不交。挑 0 ‥ N 张一次交清——中途没有可观察的中间态，同 03 §2 收窗口的理由
 */
import { WINDOW_MS, commit, passTurn, pickFromHand, reject, windowIdOf } from "../legal.ts";
import { HAND_OVER } from "./primitives/draw-modifier.ts";
import type { DrawProcedure } from "./primitives/draw-modifier.ts";
import type { ApplyResult, Board, Ctx, EngineEvent, GameState, PunishChain } from "../types.ts";

/** 交牌：要交的那几张走 `cardIds`。 */
export const GIVE = "give";
/** 不交（04 ♥6 的「**可**交」）。超时也走它。 */
export const KEEP = "keep";

/**
 * 这次惩罚结算完之后，近卫要不要开窗口：交给谁、最多交几张。
 * `null` = 不开（没有这支程序 / 没到门槛 / 链首是自己 / 手上没牌）。
 */
export function handOverPlan(
  procedures: readonly DrawProcedure[],
  chain: PunishChain,
  b: Board,
  seat: number,
): { target: number; max: number } | null {
  const p = procedures.find((x) => x.procedure === HAND_OVER);
  if (!p) return null;
  // 门槛按**链上贡献总和**（01-P11 的那个数，与喂给 L0 的基数同源）
  if (chain.total < (p.values.L6 ?? 0)) return null;
  // P12：交给链首发起者。链绕回自己时不成立——交给自己没有意义（同 P8 血棘不封自己）
  const target = chain.initiator;
  if (target === seat) return null;
  // 每张 +2/+4 交 `give` 张，手上不够就按手上有的算
  const max = Math.min(chain.segments.length * (p.values.give ?? 0), b.hands[seat].length);
  return max > 0 ? { target, max } : null;
}

/** 开交牌窗口。回合还没交出去——交完（或不交）由 `settleHandOver` 收场。 */
export function openHandOver(
  state: GameState,
  b: Board,
  seat: number,
  plan: { target: number; max: number },
  ctx: Ctx,
  before: EngineEvent[] = [],
): ApplyResult {
  const deadline = new Date(Date.parse(ctx.now) + WINDOW_MS).toISOString();
  const next: GameState = {
    // `commit` 会清窗口，所以窗口手动接回去（同 `draw-discard.ts::openDrawDiscard`）
    ...commit(state, { ...b, handOver: { seat, ...plan } }, "afterPlay"),
    pendingWindow: { type: "handOver", actors: [seat], deadline, defaultChoice: KEEP, resume: "turnStart" },
  };
  return {
    state: next,
    // 里面没有暗信息：交给谁、最多几张都由公开的链算得出来
    events: [
      ...before,
      { type: "handOverOpened", public: { windowId: windowIdOf(next), seat, target: plan.target, max: plan.max, deadline } },
    ],
  };
}

/**
 * 交牌窗口的结算。由 `punish.ts` 的 respond / claimTimeout 在通用校验之后转来。
 * 交 → `cardIds` 1 ‥ max 张进链首手里；不交 → 什么都不动。两条都接着把回合交出去（P10）。
 */
export function settleHandOver(
  state: GameState,
  action: { choice: string; cardIds?: string[] },
  ctx: Ctx,
): ApplyResult {
  const b = state.board!;
  const pend = b.handOver;
  if (!pend) return reject(state, "no_window");
  if (action.choice !== GIVE && action.choice !== KEEP) return reject(state, "bad_choice");
  const { seat, target, max } = pend;
  const { handOver: _done, ...rest } = b;

  if (action.choice === KEEP) return finish(state, rest, seat, ctx, [{ type: "handOverKept", public: { seat } }]);

  // 「可交」= 至少交 1 张才叫交；一张不交请走 `keep`
  const picked = pickFromHand(b, seat, action.cardIds ?? [], 1, max);
  if (typeof picked === "string") return reject(state, picked);
  const gone = new Set(picked.map((c) => c.id));
  const moved: Board = {
    ...rest,
    hands: rest.hands.map((h, i) =>
      i === seat ? h.filter((c) => !gone.has(c.id)) : i === target ? [...h, ...picked] : h,
    ),
  };
  // 公开的只有**张数**：交出去的那几张进的是链首的手牌，内容只有他们两个知道（02 §8）
  return finish(state, moved, seat, ctx, [
    { type: "cardsHandedOver", public: { seat, target, count: picked.length } },
  ]);
}

/**
 * P10：吃下累计之后摸完即回合结束。交牌排在摸牌之后（P2）、交回合之前——
 * `passTurn` 读的是**交完之后**的手牌，U6 的声明按最终张数结算。
 */
const finish = (state: GameState, b: Board, seat: number, ctx: Ctx, events: EngineEvent[]): ApplyResult => ({
  state: commit(state, { ...b, ...passTurn(b, ctx.now, seat) }, "turnStart"),
  events,
});

/**
 * 窗口里的合法动作：**一条模板 + 一条不交**。
 * 组合不枚举（交 1 ‥ N 张就是 Σ C(手牌, k) 条），客户端自己凑好 `cardIds` 再提交，
 * 张数/在不在手上/有没有重复由 `settleHandOver` 硬校验。上限走快照的 `handOver.max`。
 */
export const handOverActions = (seat: number, windowId: string) => [
  { type: "respond" as const, seat, windowId, choice: GIVE, cardIds: [] },
  { type: "respond" as const, seat, windowId, choice: KEEP },
];
