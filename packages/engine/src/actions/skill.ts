// 亮出与发动。规则：01 §4 V1–V8、T1、T3/P1。
// 这里只管「能不能亮 / 能不能发动」与次数账，具体技能干什么由各自的原语负责。
import { commit, reject } from "../legal.ts";
import { isSuppressed } from "../skills/primitives/suppression.ts";
import type { ApplyResult, Board, GameState } from "../types.ts";

/** V1：默认只能在己方回合亮出。V2 的白名单例外由技能定义的 reveal_window 放行——待 §3 补窗口（06 Q40）。 */
export function revealSkill(state: GameState, seat: number): ApplyResult {
  const b = state.board;
  if (!b) return reject(state, "not_started");
  if (state.pendingWindow) return reject(state, "pending_window");
  if (seat !== b.currentSeat) return reject(state, "not_your_turn");
  if (!b.skills[seat]) return reject(state, "no_skill");
  if (b.revealed[seat]) return reject(state, "already_revealed");

  return {
    // V6：亮出不占「每回合一条主动」的额度，所以这里不碰 activatedThisTurn
    state: commit(state, { ...b, revealed: setAt(b.revealed, seat, true) }),
    events: [{ type: "skillRevealed", public: { seat, skillId: b.skills[seat] } }],
  };
}

/** V7：发动占 1 次；同一技能多条主动每回合只能选发动一条。 */
export function activateSkill(state: GameState, seat: number, _effectKey: string): ApplyResult {
  const b = state.board;
  if (!b) return reject(state, "not_started");
  if (state.pendingWindow) return reject(state, "pending_window");
  if (seat !== b.currentSeat) return reject(state, "not_your_turn");
  // T1：主动技能默认只在阶段 1（回合开始）
  if (state.phase !== "turnStart") return reject(state, "not_turn_start");
  if (!b.skills[seat]) return reject(state, "no_skill");
  // V3/V4：亮出才生效，但亮出的当回合即可发动
  if (!b.revealed[seat]) return reject(state, "not_revealed");
  // T3/P1：惩罚回合与封印都走压制层
  if (isSuppressed(b, seat)) return reject(state, "suppressed");
  if (b.activatedThisTurn[seat]) return reject(state, "already_activated");

  // 效果本身还没接线：原语按波次实现，各技能的 handler 在后续 Task 里挂上来
  return {
    state: commit(state, { ...b, activatedThisTurn: setAt(b.activatedThisTurn, seat, true) }),
    events: [{ type: "skillActivated", public: { seat, skillId: b.skills[seat], effectKey: _effectKey } }],
  };
}

const setAt = <T>(arr: T[], i: number, v: T): T[] => arr.map((x, j) => (j === i ? v : x));
