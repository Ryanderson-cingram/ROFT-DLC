// 亮出与发动。规则：01 §4 V1–V8、T1、T3/P1。
// 这里只管「能不能亮 / 能不能发动」与次数账，具体技能干什么由各自的原语负责。
import { commit, reject } from "../legal.ts";
import { openAllianceWindow } from "../skills/alliance.ts";
import { revealAllowedOutOfTurn, revealConditionsMet, settleOnReveal } from "../skills/reveal.ts";
import { SKILL_DATA } from "../skills/draw-passives.ts";
import { HANDLERS } from "../skills/handlers.ts";
import { isSealed, suppressesEffect } from "../skills/primitives/suppression.ts";
import type { SkillData } from "../skills/draw-passives.ts";
import type { SkillWindow } from "../skills/types.ts";
import type { ApplyResult, Board, Color, Ctx, Face, GameState, Phase } from "../types.ts";

/**
 * V1：默认只能在己方回合亮出；V2 的白名单例外由**定义**放行（`reveal_window` + `reveal_when`，
 * 判据在 `skills/reveal.ts`，引擎不认技能 id）。
 * V2b：**反应窗口挂着时一律禁亮**——例外只放宽「必须是自己的回合」，不放宽这一条。
 */
export function revealSkill(state: GameState, seat: number, ctx: Ctx, data: SkillData = SKILL_DATA): ApplyResult {
  const b = state.board;
  if (!b) return reject(state, "not_started");
  if (state.pendingWindow) return reject(state, "pending_window");
  if (!b.skills[seat]) return reject(state, "no_skill");
  if (b.revealed[seat]) return reject(state, "already_revealed");
  // 01-P14：血棘封印含「未亮出也不能亮出」。**只查封印**：01 §3「可亮出技能；可发动主动技能
  // （非惩罚回合）」——括号只修饰「发动」，惩罚回合照样亮得出（V6 亮出也不占额度）。
  if (isSealed(b, seat)) return reject(state, "suppressed");
  const def = data.byId.get(b.skills[seat]!);
  // V2b（2026-08-08）：`reveal_when` 是主动亮出的门槛——条件不满足时连己方回合也不可亮
  if (!revealConditionsMet(b, seat, def)) return reject(state, "reveal_condition_unmet");
  // V1 / V2：轮不到你时，只有定义写明例外的技能亮得出（判据按定义，不认技能 id）
  if (seat !== b.currentSeat && !revealAllowedOutOfTurn(b, seat, def))
    return reject(state, "not_your_turn");

  // V6：亮出不占「每回合一条主动」的额度，所以这里不碰 activatedThisTurn
  // 02 §2 的 `on_reveal`：亮出当下要结算的东西（专精♥9 的底牌定色）
  const shown: Board = settleOnReveal({ ...b, revealed: setAt(b.revealed, seat, true) }, seat, data);
  const events = [{ type: "skillRevealed", public: { seat, skillId: b.skills[seat] } }];
  // 01-S13：合纵/连横是一对，任一方**亮出当下**就要问另一半「相应吗」（一锤定音，见 06-Q70）
  return openAllianceWindow(state, shown, seat, ctx, events) ?? { state: commit(state, shown), events };
}

/**
 * 02 §3 的时机窗口 → 引擎阶段。目前只有 `turn_start`（T1 的默认），
 * 其余窗口（响应、出牌时…）跟着各自的技能在后续 Task 到来。
 */
const WINDOW_PHASE: Partial<Record<SkillWindow, Phase>> = { turn_start: "turnStart" };

/**
 * V7：发动占 1 次；同一技能多条主动每回合只能选发动一条。
 *
 * 这里的每一条判断都读定义，不认技能 id：`kind` 决定能不能「发动」（V8：被动不能），
 * `window` 决定在哪个阶段（T1），`stacks_with_turn_limit` 决定占不占额度。
 * 具体干什么交给 `HANDLERS[id]`——脊梁不知道恒心是弃牌还是摸牌。
 */
export function activateSkill(
  state: GameState,
  action: { seat: number; effectKey: string; cardIds?: string[]; declared?: { color: Color; face: Face } },
  ctx: Ctx,
  data: SkillData = SKILL_DATA,
): ApplyResult {
  const { seat, effectKey } = action;
  const b = state.board;
  if (!b) return reject(state, "not_started");
  if (state.pendingWindow) return reject(state, "pending_window");
  if (seat !== b.currentSeat) return reject(state, "not_your_turn");
  const id = b.skills[seat];
  if (!id) return reject(state, "no_skill");
  // V3/V4：亮出才生效，但亮出的当回合即可发动
  if (!b.revealed[seat]) return reject(state, "not_revealed");
  if (b.activatedThisTurn[seat]) return reject(state, "already_activated");

  const def = data.byId.get(id);
  const picked = def?.effects?.find((e) => e.key === effectKey);
  if (!picked) return reject(state, "unknown_effect");
  // 02 §6 的选项分支（吟游♣5 的四支歌声）：报的是选项的 key，发动的是它的**父主动**——
  // 次数账、窗口、V7 的额度全记在父主动头上，选项本身不是另一条主动。
  const effect = picked.option_of ? def!.effects!.find((e) => e.key === picked.option_of)! : picked;
  // V8：被动是「条件满足即触发」，没有「发动」这个动作
  if (effect.kind !== "active") return reject(state, "not_active");
  // T3/P1：惩罚回合与封印都走压制层。例外是**逐条效果**的（06-Q39），
  // 所以这一步必须排在取到 effect 之后——影歌②声明了豁免惩罚回合，恒心没有。
  if (suppressesEffect(b, seat, effect)) return reject(state, "suppressed");
  // S15：一次性效果整局只发得出一次（S18c 的「重获则重置」到时候清 usedOnce 即可）
  if (effect.once === "once" && b.usedOnce?.[seat]?.[effect.key]) return reject(state, "already_used");
  const phase = WINDOW_PHASE[effect.window ?? "turn_start"];
  if (!phase) return reject(state, "unsupported_window");
  if (state.phase !== phase) return reject(state, "not_turn_start");
  const handler = HANDLERS[id];
  // 定义说它可发动、引擎却没有行为 = 亮出后什么都不发生，正是计划 §1 要防的静默失效
  if (!handler) return reject(state, "not_implemented");

  // V7/V8：占不占额度从定义读，不由 handler 自己决定
  const marked: Board = effect.stacks_with_turn_limit
    ? { ...b, activatedThisTurn: setAt(b.activatedThisTurn, seat, true) }
    : b;
  // 次数账同理走定义。handler 被拒时这块牌桌整个丢掉，所以「付不起代价」不消耗次数（06-Q54）。
  const noted: Board = effect.once === "once" ? markUsedOnce(marked, seat, effect.key) : marked;
  // handler 拿到的是**玩家报的那个 key**（选项就是选项），次数账那边用的才是父主动的 key
  const r = handler(
    state,
    noted,
    seat,
    { key: effectKey, cardIds: action.cardIds ?? [], declared: action.declared },
    ctx,
    data,
  );
  if (r.rejected) return r;
  return { ...r, events: [{ type: "skillActivated", public: { seat, skillId: id, effectKey } }, ...r.events] };
}

const setAt = <T>(arr: T[], i: number, v: T): T[] => arr.map((x, j) => (j === i ? v : x));

/**
 * 记一笔「这条 `once: once` 的子效果用掉了」（01-S15）。
 * 不只发动路径要记：异议♥8① 是响应窗口里的一次性效果，走不到 `activateSkill`，
 * 但同一本账（`Board.usedOnce`）。缺席的表按座位数补齐，别的座位保持原样。
 */
export const markUsedOnce = (b: Board, seat: number, effectKey: string): Board => ({
  ...b,
  usedOnce: setAt(b.usedOnce ?? b.hands.map(() => ({})), seat, { ...b.usedOnce?.[seat], [effectKey]: true }),
});
