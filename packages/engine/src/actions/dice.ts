/**
 * 掷骰（01-R1）与「掷骰接管」两段式窗口（强袭♦1②；04 ♦1 / 06-Q34 / 06-Q40）。
 *
 * 为什么要两段：**任何一次**掷骰之后，场上已亮出强袭的人都可以重掷同数量一次并强制
 * 采用他的结果。所以掷骰的动作不能在一个 apply 里把骰子消费掉——中间必须开一个窗口。
 * 挂起的骰子连同「骰子定了之后要干什么」一起存进 `state.pendingDice`，后者是**可序列化
 * 的数据**（`ResumeSpec`）而不是闭包：整个 GameState 要存库、要按事件重放。
 *
 * 随机的结果一律入事件（`diceRolled`；骰子是当众掷的，所以点数进 public）——重放读事件
 * 不重掷。被接管时两次掷骰各发一条，历史上看得见「原掷 2，被谁重掷成 0」。
 *
 * 接管窗口是 `punishStack` 那种**先到先得**语义：一人响应，窗口即关。
 */
import { resumeBloodthorn } from "./bloodthorn.ts";
import { resumeNightlord } from "./nightlord.ts";
import { resumeAssault } from "./punish.ts";
import { commit, reject, windowIdOf } from "../legal.ts";
import { SKILL_DATA } from "../skills/draw-passives.ts";
import { paramsOfEffect } from "../skills/params.ts";
import { suppressionOf } from "../skills/primitives/suppression.ts";
import type { SkillData } from "../skills/draw-passives.ts";
import type { SkillDef, SkillEffect } from "../skills/types.ts";
import type { ApplyResult, Board, Ctx, EngineEvent, GameState, PendingDice, ResumeSpec } from "../types.ts";

const WINDOW_MS = 30_000;

/** 01-R1：三面骰，每颗 0/1/2。随机只来自注入的 `rng`。 */
export function rollDice(rng: () => number, n: number): number[] {
  return Array.from({ length: n }, () => Math.floor(rng() * 3));
}

/**
 * **resume 注册处**：骰子定了之后按 `kind` 续跑。
 * 新技能要用掷骰 = `ResumeSpec` 加一个成员（带上它续跑所需的全部数据，必须可序列化）
 * + 这里加一个 case。少加一个 case 会被 TS 的穷尽检查当场逮住。
 */
function runResume(
  state: GameState,
  board: Board,
  spec: ResumeSpec,
  values: number[],
  ctx: Ctx,
): ApplyResult {
  switch (spec.kind) {
    case "assault":
      return resumeAssault(state, board, spec, values, ctx);
    case "nightlord":
      return resumeNightlord(state, board, spec, values, ctx);
    case "bloodthorn":
      return resumeBloodthorn(state, board, spec, values, ctx);
  }
}

/** 04 ♦1②：`kind: response` + `window: on_dice_roll` + `modifies: dice`。按定义找，不认技能 id。 */
const isTakeover = (e: SkillEffect) =>
  e.kind === "response" && e.window === "on_dice_roll" && !!e.modifies?.includes("dice");

/** 01-P9：封印把技能整个关掉（`sealable` 缺席 = 默认可封）。 */
export const sealedOff = (b: Board, seat: number, def: SkillDef) =>
  def.sealable !== false && suppressionOf(b, seat).includes("sealed");

/**
 * 此刻能接管一次掷骰的座位（04 ♦1②：不限回合、不限是谁掷的，**含掷骰者自己**）。
 *
 * 这里只看封印一个压制源，不用 `isSuppressed`：`punishTurn` 那一源按 P1/T3 关的是**主动**
 * 技能，而②明文不占主动额度、不限回合、只替掉掷骰这一步（06-Q34）——跟被动同款处理，
 * 与 `draw-passives.ts` 同一条理由。
 */
export function takeoverActors(b: Board, data: SkillData = SKILL_DATA): number[] {
  return b.skills.flatMap((id, seat) => {
    // V3：没亮出的技能对局面毫无影响
    if (!id || !b.revealed[seat]) return [];
    const def = data.byId.get(id);
    if (!def || sealedOff(b, seat, def)) return [];
    return (def.effects ?? []).some(isTakeover) ? [seat] : [];
  });
}

/**
 * `seat` 打出 +2/+4 时可以掷几颗骰子来定这一张的倍率（强袭①）。0 = 没有这项能力。
 * 同样按定义找：`kind: on_play` + `modifies` 同时含 `punish_amount` 与 `dice`；颗数从 `values` 读。
 */
export function punishDiceFor(b: Board, seat: number, def?: SkillDef): number {
  if (!def || !b.revealed[seat] || sealedOff(b, seat, def)) return 0;
  const e = (def.effects ?? []).find(
    (x) => x.kind === "on_play" && x.modifies?.includes("punish_amount") && x.modifies.includes("dice"),
  );
  return e ? (paramsOfEffect(e).counts.dice ?? 0) : 0;
}

/**
 * 掷 `n` 颗骰子：场上有人能接管就挂起并开窗口，没有就当场按结果续跑（版本只 +1）。
 * `board` 是掷骰这一刻的牌桌，`state` 是原始状态（供 `commit` 涨版本号）。
 */
export function rollWithTakeover(
  state: GameState,
  board: Board,
  seat: number,
  reason: string,
  n: number,
  resume: ResumeSpec,
  ctx: Ctx,
  data: SkillData = SKILL_DATA,
): ApplyResult {
  const values = rollDice(ctx.rng, n);
  const rolled: EngineEvent = { type: "diceRolled", public: { seat, reason, values } };

  const actors = takeoverActors(board, data);
  if (actors.length === 0) {
    const r = runResume(state, board, resume, values, ctx);
    return { ...r, events: [rolled, ...r.events] };
  }

  const deadline = new Date(Date.parse(ctx.now) + WINDOW_MS).toISOString();
  const pendingDice: PendingDice = { seat, reason, values, resume };
  // commit 会清窗口，所以窗口手动接回去（同 draft.ts::assign）。窗口的 `resume` 相位只是留档：
  // 续跑到哪个相位由 resume 执行函数自己 commit 决定。
  const next: GameState = {
    ...commit(state, board),
    pendingDice,
    pendingWindow: { type: "diceTakeover", actors, deadline, defaultChoice: "pass", resume: state.phase },
  };
  return {
    state: next,
    events: [
      rolled,
      {
        type: "diceTakeoverOpened",
        public: { windowId: windowIdOf(next), actors, seat, reason, values, deadline },
      },
    ],
  };
}

/** 接管窗口的两个选择（legalActions 直接照它出动作）。 */
export const TAKEOVER_CHOICES = ["takeover", "pass"];

/**
 * 接管窗口结算。由 punish.ts 的 respond / claimTimeout 在通用校验之后转来。
 *
 * `takeover` = 重掷同数量、采用新结果；`pass`（含超时）= 按原结果续跑。两者都当场关窗口
 * 并执行 resume——先到先得。S2 一人一技能且抽 3 选 1 不发重样的，所以场上至多一名强袭者，
 * 「全员 pass」与「这一个人 pass」是同一件事。
 */
export function settleTakeover(
  state: GameState,
  seat: number,
  choice: string,
  ctx: Ctx,
  data: SkillData = SKILL_DATA,
): ApplyResult {
  const d = state.pendingDice;
  if (!d) return reject(state, "no_window");
  if (!TAKEOVER_CHOICES.includes(choice)) return reject(state, "bad_choice");
  const b = state.board!;
  // 挂起态用掉即清；resume 拿到的是没有 pendingDice 的状态
  const { pendingDice: _used, ...cleared } = state;

  if (choice === "pass") return runResume(cleared, b, d.resume, d.values, ctx);

  if (!takeoverActors(b, data).includes(seat)) return reject(state, "suppressed");
  // 04 ♦1：重掷**同数量**一次。第二次掷骰同样入事件，重放读它不重掷。
  const values = rollDice(ctx.rng, d.values.length);
  const r = runResume(cleared, b, d.resume, values, ctx);
  return {
    ...r,
    events: [{ type: "diceRolled", public: { seat, reason: `${d.reason}-takeover`, values } }, ...r.events],
  };
}
