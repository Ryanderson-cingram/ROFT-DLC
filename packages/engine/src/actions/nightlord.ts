/**
 * 司夜♣3（04 ♣3 / 01-T2 / 01-S16 / 06-Q11 / 06-Q34 / 06-Q57）。
 *
 * ① 打出无色牌后掷 1 骰，获等量「盗」——不是可选的发动，打出即掷（06-Q34），
 *    惩罚轮里打出 +4 照样获盗。掷骰走 `rollWithTakeover`（强袭②可接管），
 *    所以「获盗之后接着干什么」是一条可序列化的 `ResumeSpec`，不是闭包。
 * ② 阶段 1 花 1 盗与一名玩家盲换 1 张：抽是引擎摇的，还哪张是玩家选的 → 两步，中间开窗口。
 * ③ 持够盗时末牌可以是功能牌 / 无色牌（01-U5 的例外），出末牌时自动扣盗。
 *
 * ②③都**不是「发动」**（06-Q57）：不占 V7 额度、不发 skillActivated，同回合皆可发生。
 * 三条的数值（1 颗骰、1 盗、3/5 盗门槛）全部从定义的 `values` 读，本文件不写规则常数。
 */
import { sealedOff } from "./dice.ts";
import { openPunishWindow } from "./punish.ts";
import { commit, isWild, passTurn, reject, windowIdOf } from "../legal.ts";
import { SKILL_DATA } from "../skills/draw-passives.ts";
import { paramsOfEffect } from "../skills/params.ts";
import { gainMarks, markCount, spendMarks } from "../skills/primitives/marks.ts";
import type { SkillData } from "../skills/draw-passives.ts";
import type { SkillDef, SkillEffect } from "../skills/types.ts";
import type { Action, ApplyResult, Board, Card, Ctx, EngineEvent, GameState } from "../types.ts";

const WINDOW_MS = 30_000;
/**
 * 03 §5 的标记名。司夜攒的是「盗」。
 *
 * 影歌那边的「魂」已经收敛进定义（`mark_cap: { 魂: 6 }`，见 soul-harvest.ts），这里**没有**：
 * 盗**没有上限**，而 `mark_cap` 是「上限表」，键只在有上限时才存在——无上限的标记写进去只能
 * 写成 0，而 0 会被读成「上限是 0」。定义里没有第二个能承载标记名的槽位，所以名字只能留在这里。
 * 升级路径：等 02 §6 给出一个与上限解耦的 `mark`（或 `values.mark_name`）字段，把这行换成从定义读。
 */
const STEAL = "盗";
/**
 * 超时默认还**刚抽到的那张**（最不泄露、最保守）。是个哨兵而不是牌 id：
 * `defaultChoice` 随窗口进快照，写真 id 等于把盲抽的结果当众念出来。
 */
export const RETURN_STOLEN = "stolen";

/** V3：没亮出的技能对局面毫无影响。 */
const defOf = (b: Board, seat: number, data: SkillData): SkillDef | undefined => {
  const id = b.skills[seat];
  return id && b.revealed[seat] ? data.byId.get(id) : undefined;
};

/**
 * 这个座位此刻能用的司夜子效果。三条都只查封印一个压制源（01-P9），不查惩罚回合：
 * ①拿标记不受惩罚轮影响（06-Q34），②③被动触发不占主动（06-Q57）——与 `draw-passives`
 * 同一条理由。`find` 的条件按定义写，不认技能 id。
 */
const effectOf = (b: Board, seat: number, data: SkillData, pick: (e: SkillEffect) => boolean) => {
  const def = defOf(b, seat, data);
  if (!def || sealedOff(b, seat, def)) return undefined;
  return (def.effects ?? []).find(pick);
};

/**
 * 司夜①此刻打出无色牌能掷几颗骰（0 = 没有这项能力）。
 * 按定义找：`kind: on_play` + `modifies` 含 `dice`；强袭①同为 on_play，靠它另外点名的
 * `punish_amount` 区分开。颗数从 `values.dice` 读。
 */
export function stealDiceFor(b: Board, seat: number, data: SkillData = SKILL_DATA): number {
  const e = effectOf(b, seat, data, (x) =>
    x.kind === "on_play" && !!x.modifies?.includes("dice") && !x.modifies.includes("punish_amount"),
  );
  return e ? (paramsOfEffect(e).counts.dice ?? 0) : 0;
}

/**
 * ①的续跑：骰子定了（可能已被强袭②接管重掷）才知道获几个盗。
 * 时序按 04 ♣3①：先结算盗，**再**开惩罚窗口——窗口只能有一个，diceTakeover 与
 * punishStack 不能同时挂。链在出牌时已经延长过了，这里只负责开窗口。
 */
export function resumeNightlord(
  state: GameState,
  board: Board,
  spec: { seat: number; face: "+4" | null },
  values: number[],
  ctx: Ctx,
): ApplyResult {
  // 点数之和：定义给的是 1 颗，写成求和是为了颗数改了这里也不用动
  const n = values.reduce((a, v) => a + v, 0);
  const b = gainMarks(board, spec.seat, STEAL, n);
  // 03 §5：标记是公开计数
  const events: EngineEvent[] = [
    { type: "marksGained", public: { seat: spec.seat, mark: STEAL, n, total: markCount(b, spec.seat, STEAL) } },
  ];
  if (spec.face) {
    const opened = openPunishWindow(state, b, spec.seat, ctx);
    return { ...opened, events: [...events, ...opened.events] };
  }
  // 无色牌里只有 +4 开窗口；变色牌打完就交回合（它不是停/转，所以恒为跨 1 步）
  return { state: commit(state, { ...b, ...passTurn(b, ctx.now, spec.seat) }, "turnStart"), events };
}

/** ②那条子效果：`kind: meta_rule` + `window: turn_start`，一次要花的盗从 `values.marks` 读。 */
const swapEffect = (b: Board, seat: number, data: SkillData) =>
  effectOf(b, seat, data, (e) => e.kind === "meta_rule" && e.window === "turn_start");

/** 只发给一个座位的私牌事件（`EngineEvent.private` 只支持单座位，所以双方各发一条）。 */
const peek = (to: number, payload: Record<string, unknown>): EngineEvent => ({
  type: "stealSwapPeek",
  public: {},
  private: { seat: to, payload },
});

/**
 * ②第一步：花 1 盗，从 `target` 手里盲抽 1 张，然后开 `swapReturn` 窗口让司夜者选还哪张。
 * 隐私：抽到什么只有双方知道（各一条 private 事件），public 只有「谁与谁换了 1 张」；
 * 随机下标只进 audit——重放读它不重摇（调研 §4）。
 */
export function stealSwap(
  state: GameState,
  action: { seat: number; target: number },
  ctx: Ctx,
  data: SkillData = SKILL_DATA,
): ApplyResult {
  const b = state.board;
  if (!b) return reject(state, "not_started");
  if (state.pendingWindow) return reject(state, "pending_window");
  // 01-T2：花盗要在自己的阶段 1
  if (state.phase !== "turnStart") return reject(state, "wrong_phase");
  if (action.seat !== b.currentSeat) return reject(state, "not_your_turn");
  const e = swapEffect(b, action.seat, data);
  if (!e) return reject(state, "skill_unavailable");
  if (action.target === action.seat || !b.hands[action.target]?.length) return reject(state, "bad_target");
  const paid = spendMarks(b, action.seat, STEAL, paramsOfEffect(e).counts.marks ?? 0);
  if (!paid) return reject(state, "cost_unpayable");

  const index = Math.floor(ctx.rng() * b.hands[action.target].length);
  const stolen = b.hands[action.target][index];
  const hands = paid.hands.map((h, i) =>
    i === action.target ? h.filter((c) => c.id !== stolen.id) : i === action.seat ? [...h, stolen] : h,
  );
  const swap = { seat: action.seat, target: action.target, cardId: stolen.id };
  // commit 会清窗口，所以窗口手动接回去（同 draft.ts::assign）
  const next: GameState = {
    ...commit(state, { ...paid, hands, swap }),
    pendingWindow: {
      type: "swapReturn",
      actors: [action.seat],
      deadline: new Date(Date.parse(ctx.now) + WINDOW_MS).toISOString(),
      defaultChoice: RETURN_STOLEN,
      resume: state.phase,
    },
  };
  const both = { seat: action.seat, target: action.target };
  return {
    state: next,
    events: [
      { type: "stealSwapDrawn", public: { ...both, windowId: windowIdOf(next) }, audit: { index } },
      peek(action.seat, { card: stolen, from: action.target }),
      peek(action.target, { card: stolen, to: action.seat }),
    ],
  };
}

/**
 * ②第二步：从自己现在的手牌（**含刚抽那张**）选 1 张还给对方。
 * 由 punish.ts 的 respond / claimTimeout 在通用校验之后转来；超时按 `RETURN_STOLEN` 收场。
 */
export function settleSwapReturn(state: GameState, action: { choice: string }): ApplyResult {
  const b = state.board!;
  const sw = b.swap;
  if (!sw) return reject(state, "no_window");
  const cardId = action.choice === RETURN_STOLEN ? sw.cardId : action.choice;
  const given = b.hands[sw.seat].find((c) => c.id === cardId);
  if (!given) return reject(state, "not_in_hand");

  const hands = b.hands.map((h, i) =>
    i === sw.seat ? h.filter((c) => c.id !== given.id) : i === sw.target ? [...h, given] : h,
  );
  const { swap: _done, ...cleared } = b;
  const both = { seat: sw.seat, target: sw.target };
  return {
    state: commit(state, { ...cleared, hands }, state.pendingWindow!.resume),
    events: [
      { type: "stealSwapReturned", public: both },
      peek(sw.seat, { card: given, to: sw.target }),
      peek(sw.target, { card: given, from: sw.seat }),
    ],
  };
}

/** ②的可点性：阶段 1、盗够花时，对每个还有手牌的对手各给一条（组合不用枚举，目标就是全部）。 */
export function swapActions(b: Board, seat: number, data: SkillData = SKILL_DATA): Action[] {
  const e = swapEffect(b, seat, data);
  if (!e || markCount(b, seat, STEAL) < (paramsOfEffect(e).counts.marks ?? 0)) return [];
  return b.hands.flatMap((h, target): Action[] =>
    target !== seat && h.length > 0 ? [{ type: "stealSwap", seat, target }] : [],
  );
}

/**
 * ③：这张末牌能不能靠盗放宽出去，要扣几个盗。null = 用不了，走原 01-U5。
 * 门槛两档都从定义读：功能牌 `values.marks`、无色牌 `values.marks_wild`。
 * 「仍须合法打出」（06-Q11 / 01-S16）不在这里管——出牌路径的 isPlayable / 叠牌校验在前面。
 *
 * 与并列♥4 同样点名 `play_legality`（04 两处都这么标）。区分它们的是生命周期：
 * 并列是亮出期间常驻改写「一次能打几张」（`while_revealed`），③是出末牌当场结算一次
 * 的放宽（`instant`，且要付盗）。`multiPlayAllowed` 那一侧认的正是另一半。
 */
export function finalCardCost(b: Board, seat: number, card: Card, data: SkillData = SKILL_DATA): number | null {
  const e = effectOf(b, seat, data, (x) => !!x.modifies?.includes("play_legality") && x.duration === "instant");
  if (!e) return null;
  const { counts } = paramsOfEffect(e);
  const cost = isWild(card) ? counts.marks_wild : counts.marks;
  if (cost === undefined || markCount(b, seat, STEAL) < cost) return null;
  return cost;
}

/** ③的扣盗（自动发生，不需要玩家声明——06-Q57）。付不起在 `finalCardCost` 就挡掉了。 */
export function payFinalCard(b: Board, seat: number, cost: number): { board: Board; event: EngineEvent } {
  const board = spendMarks(b, seat, STEAL, cost)!;
  return {
    board,
    event: { type: "marksSpent", public: { seat, mark: STEAL, n: cost, total: markCount(board, seat, STEAL) } },
  };
}
