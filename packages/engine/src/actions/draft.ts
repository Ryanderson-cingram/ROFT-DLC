/**
 * S1 开局抽 3 选 1。整个流程是一个 `skillDraft` 反应窗口：
 * 全员是 actors，各自 `respond(windowId, choice = 技能 id)`，选一个少一个 actor，
 * 清零进 `turnStart`。超时走 claimTimeout，剩下没选的按 defaultChoice（第一个候选）代选。
 *
 * 与惩罚窗口的「先到先得」不同，这里是**收集全员**语义——每个 respond 只结自己那份。
 * 池子从 registry 取：只有机制齐备的技能才可能被抽到（registry 的立身之本）。
 * 规则：01-S1（抽 3 选 1）、S1c（技能与手牌先后不强制）、S2（一人一技能）。
 */
import { commit, reject, windowIdOf } from "../legal.ts";
import { shuffle } from "../deck.ts";
import { skills } from "../skills/registry.ts";
import type { ApplyResult, Board, Ctx, EngineEvent, GameState, PendingWindow } from "../types.ts";

const DRAFT_WINDOW_MS = 60_000; // 第一局要读技能说明，给足 60s；超时自动选第一个

/**
 * 开局发候选。轮流发（seat 0,1,2,… 循环），每人至多 3 个，池子不够就少发——
 * 池子比人还少时有人拿到 0 个候选（无技能开局），不算错：池子随实现的技能增多而变大。
 * 池子为空则整个 draft 跳过，直接 `turnStart`。
 */
export function openDraft(state: GameState, board: Board, ctx: Ctx): ApplyResult {
  const n = board.hands.length;
  const pool = shuffle(skills.pool.map((d) => d.id), ctx.rng);
  const options: string[][] = board.hands.map(() => []);
  for (let i = 0; i < pool.length && i < n * 3; i++) options[i % n].push(pool[i]);

  const actors = options.flatMap((o, seat) => (o.length > 0 ? [seat] : []));
  if (actors.length === 0) return { state: { ...state, phase: "turnStart", board }, events: [] };

  const deadline = new Date(Date.parse(ctx.now) + DRAFT_WINDOW_MS).toISOString();
  const window: PendingWindow = { type: "skillDraft", actors, deadline, defaultChoice: "first", resume: "turnStart" };
  const withWindow: GameState = { ...state, phase: "dealing", board: { ...board, draftOptions: options }, pendingWindow: window };
  return {
    state: withWindow,
    events: [
      {
        type: "draftStarted",
        public: { windowId: windowIdOf(withWindow), actors, deadline },
        // 洗过的池序是随机结果，重放读它不重洗（调研 §4）；绝不进 public
        audit: { pool },
      },
      ...options.flatMap((opts, seat): EngineEvent[] =>
        opts.length === 0 ? [] : [{
          type: "draftOptionsDealt",
          public: { seat, count: opts.length },
          private: { seat, payload: { options: opts } },
        }]),
    ],
  };
}

/** 一个座位交卷。由 punish.ts 的 respond 在通用校验（窗口存在/未过期/是 actor）之后转来。 */
export function settleDraftPick(state: GameState, seat: number, choice: string): ApplyResult {
  const b = state.board!;
  if (!(b.draftOptions?.[seat] ?? []).includes(choice)) return reject(state, "bad_choice");
  return assign(state, new Map([[seat, choice]]));
}

/** 超时：剩下没选的全部按默认（第一个候选）代选，一次结清。 */
export function settleDraftTimeout(state: GameState): ApplyResult {
  const picks = new Map(state.pendingWindow!.actors.map((seat) => [seat, state.board!.draftOptions![seat][0]]));
  return assign(state, picks, true);
}

function assign(state: GameState, picks: Map<number, string>, byTimeout = false): ApplyResult {
  const w = state.pendingWindow!;
  const b = state.board!;
  const board: Board = {
    ...b,
    skills: b.skills.map((s, i) => picks.get(i) ?? s),
    draftOptions: b.draftOptions!.map((o, i) => (picks.has(i) ? [] : o)),
  };
  const actors = w.actors.filter((a) => !picks.has(a));
  // 选了什么是暗信息（持有 ≠ 亮出，01-V3）：public 只说这个座位选完了
  const events: EngineEvent[] = [...picks.entries()].map(([seat, skillId]) => ({
    type: "skillChosen",
    public: { seat, byTimeout },
    private: { seat, payload: { skillId } },
  }));

  if (actors.length === 0) {
    const { draftOptions: _done, ...cleared } = board;
    return {
      state: commit(state, cleared, w.resume),
      events: [...events, { type: "draftFinished", public: {} }],
    };
  }
  // 还有人没选：窗口继续挂着（deadline 不变），commit 会清窗口所以手动接回去
  return {
    state: { ...commit(state, board, "dealing"), pendingWindow: { ...w, actors } },
    events,
  };
}
