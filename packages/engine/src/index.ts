import { drawCard, endTurn } from "./actions/draw.ts";
import { playCards } from "./actions/play-cards.ts";
import { canStack, claimTimeout, respond, windowIdOf } from "./actions/punish.ts";
import { activateSkill, revealSkill } from "./actions/skill.ts";
import { startGame } from "./actions/start-game.ts";
import { isPlayable } from "./legal.ts";
import { SKILL_DATA } from "./skills/draw-passives.ts";
import { valueOverrideFor } from "./skills/primitives/playability.ts";
import { isSuppressed } from "./skills/primitives/suppression.ts";
import type { Action, ApplyResult, ClientSnapshot, Ctx, GameState } from "./types.ts";
export * from "./types.ts";
export { buildDeck, shuffle } from "./deck.ts";
export { isPlayable } from "./legal.ts";

export function applyAction(state: GameState, action: Action, ctx: Ctx): ApplyResult {
  if (action.seat < 0 || action.seat >= state.seats.length)
    return { state, events: [], rejected: { reason: "invalid_seat" } };
  switch (action.type) {
    case "startGame":
      return startGame(state, ctx);
    case "playCards":
      return playCards(state, action, ctx);
    case "drawCard":
      return drawCard(state, action.seat, ctx);
    case "endTurn":
      return endTurn(state, action.seat);
    case "respond":
      return respond(state, action, ctx);
    case "claimTimeout":
      return claimTimeout(state, action, ctx);
    case "revealSkill":
      return revealSkill(state, action.seat);
    case "activateSkill":
      return activateSkill(state, action, ctx);
    default:
      return { state, events: [], rejected: { reason: "unknown_action" } };
  }
}

/**
 * 这个座位此刻能做的事。客户端的「可打高亮」一律来自这里，不许自己判合法性。
 * 无色牌不带 `chosenColor`——定色是提交前的客户端模态，不是服务端窗口。
 */
export function legalActions(state: GameState, seat: number): Action[] {
  const b = state.board;
  if (!b || state.phase === "finished") return [];

  const w = state.pendingWindow;
  if (w) {
    // P1：惩罚窗口里只有叠或吃，主动技能不可用
    if (!w.actors.includes(seat)) return [];
    const windowId = windowIdOf(state)!;
    const choices = ["stack", "accept"].filter(
      (c) => c !== "stack" || (b.punish != null && b.hands[seat].some((card) => canStack(card, b.punish!))),
    );
    return choices.map((choice) => ({ type: "respond", seat, windowId, choice }));
  }

  if (seat !== b.currentSeat) return [];

  // V1/V6：持有未亮出就能亮，且亮出不占额度，所以它和出牌并列可选。
  // activateSkill 暂不进这里——effectKey 要从技能定义读，等各技能的 handler 接上再说。
  const skillActions: Action[] =
    b.skills[seat] && !b.revealed[seat] && !isSuppressed(b, seat) ? [{ type: "revealSkill", seat }] : [];

  const top = b.discardPile[0];
  // U1：摸到可打的牌之后，只剩「打那一张」和「结束回合」
  if (b.drawnPlayable)
    return [
      { type: "playCards", seat, cardIds: [b.drawnPlayable.id] },
      { type: "endTurn", seat },
    ];
  const plays = b.hands[seat]
    .filter((c) => (b.punish ? canStack(c, b.punish) : isPlayable(c, top, b.activeColor)))
    .map((c): Action => ({ type: "playCards", seat, cardIds: [c.id] }));
  if (b.punish) return plays;

  // 精英♥3：本来打不出去、但当作大 1 点就能跟上牌顶的牌。带 useSkill 才合法，
  // 所以它们是**另一条**动作，不是上面那批的变体（V7：用了就占掉本回合的主动）。
  const def = b.skills[seat] ? SKILL_DATA.byId.get(b.skills[seat]!) : undefined;
  const skillPlays = b.hands[seat]
    .filter((c) => !isPlayable(c, top, b.activeColor) && String(valueOverrideFor(b, seat, c, def)?.value) === top.face)
    .map((c): Action => ({ type: "playCards", seat, cardIds: [c.id], useSkill: true }));
  return [...skillActions, ...plays, ...skillPlays, { type: "drawCard", seat }];
}

/** 视角投影：只有 `seat` 自己的手牌进快照，其余玩家降级为公开计数。 */
export function projectView(state: GameState, seat: number): ClientSnapshot {
  const b = state.board;
  return {
    version: state.version,
    phase: state.phase,
    youSeat: seat,
    yourHand: b?.hands[seat] ?? [],
    players: state.seats.map((s, i) => ({
      seat: i,
      userId: s.userId,
      handCount: b?.hands[i].length ?? 0,
      saidUno: b?.saidUno[i] ?? false,
      // V3：没亮出的技能等于暗牌，别人不该看见。自己的当然自己知道。
      skillId: (i === seat || b?.revealed[i] ? b?.skills[i] : null) ?? null,
      // ponytail: 神化是下一个计划（G1）的事，本轮恒为 0
      ascensions: 0,
    })),
    currentSeat: b?.currentSeat ?? null,
    direction: b?.direction ?? 1,
    activeColor: b?.activeColor ?? null,
    discardTop: b?.discardPile[0] ?? null,
    drawPileCount: b?.drawPile.length ?? 0,
    drawnPlayable: b?.drawnPlayable ?? null,
    punish: b?.punish,
    pendingWindow: state.pendingWindow,
    windowId: windowIdOf(state),
    winner: b?.winner,
    legalActions: legalActions(state, seat),
    disabledReasons: disabledReasons(state, seat),
  };
}

function disabledReasons(_state: GameState, _seat: number): Record<string, string> {
  // 暂时恒为空。这里曾经放过 callUno 的置灰文案，但引擎里根本没有 callUno 动作，
  // 等于逼 UI 渲染一个永远点不亮的按钮。喊话时机与漏喊罚则规则库都没定
  // （见 06-open-questions.md），定了再实现——不要为了让按钮亮起来发明规则。
  // 字段留着：技能的 L2「为何不可用」文案就靠它。
  return {};
}
