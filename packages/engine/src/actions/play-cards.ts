import { commit, isNumberCard, isPlayable, isWild, passTurn, reject } from "../legal.ts";
import { SKILL_DATA } from "../skills/draw-passives.ts";
import { valueOverrideFor } from "../skills/primitives/playability.ts";
import { drawCards, drawEvents, giveTo } from "./draw.ts";
import { canStack, extendChain, openPunishWindow, punishFace } from "./punish.ts";
import type { SkillData } from "../skills/draw-passives.ts";
import type { ApplyResult, Board, Card, Color, Ctx, EngineEvent, GameState } from "../types.ts";

export function playCards(
  state: GameState,
  action: { seat: number; cardIds: string[]; chosenColor?: Color; useSkill?: boolean },
  ctx: Ctx,
  data: SkillData = SKILL_DATA,
): ApplyResult {
  const b = state.board;
  if (!b) return reject(state, "not_started");
  if (state.pendingWindow) return reject(state, "pending_window");
  if (state.phase !== "turnStart" && state.phase !== "play") return reject(state, "wrong_phase");
  if (action.seat !== b.currentSeat) return reject(state, "not_your_turn");
  // ponytail: 并列 / 神化的多张打出是下一个计划（G1/G2）的事
  if (action.cardIds.length !== 1) return reject(state, "single_card_only");

  const card = b.hands[action.seat].find((c) => c.id === action.cardIds[0]);
  if (!card) return reject(state, "not_in_hand");
  // U1：摸到可打的牌后，本回合只能打那一张，或者结束回合
  if (b.drawnPlayable && b.drawnPlayable.id !== card.id) return reject(state, "must_play_drawn_or_end");
  // P3/P4/P5：惩罚链未结算时，只能接合法的惩罚牌
  if (b.punish && !canStack(card, b.punish)) return reject(state, "must_stack");
  if (isWild(card) && !action.chosenColor) return reject(state, "color_required");

  // 本来就能打的牌不走技能——带不带 useSkill 都不该白吃掉 V7 的额度
  if (isPlayable(card, b.discardPile[0], b.activeColor))
    return resolvePlay(state, b, action.seat, card, ctx, action.chosenColor);

  const used = action.useSkill ? useValueOverride(b, action.seat, card, data) : null;
  if (!used) return reject(state, "illegal_card");
  if ("rejected" in used) return reject(state, used.rejected);
  return resolvePlay(state, used.board, action.seat, card, ctx, action.chosenColor, used.events);
}

/**
 * 精英式的点数改写（原语 `playability`）：只在牌本来打不出去时才动用。
 * 改的是判定不是牌——牌照常按牌面进牌顶，所以这里只回答「算不算合法」。
 */
function useValueOverride(
  b: Board,
  seat: number,
  card: Card,
  data: SkillData,
): { board: Board; events: EngineEvent[] } | { rejected: string } | null {
  const id = b.skills[seat];
  const ov = valueOverrideFor(b, seat, card, id ? data.byId.get(id) : undefined);
  // 加点后要能跟上牌顶的**点数**（颜色对不上正是精英的用武之地）
  if (!ov || String(ov.value) !== b.discardPile[0].face) return null;

  // V7：精英占额度（2026-07-29 裁定，原 Q45）。今天只有神化能让一回合出多张，
  // 所以这条账在基础包里看不出差别；照裁定记上，神化到了就是对的。
  if (!ov.effect.stacks_with_turn_limit) return { board: b, events: [] };
  if (b.activatedThisTurn[seat]) return { rejected: "already_activated" };
  return {
    board: { ...b, activatedThisTurn: b.activatedThisTurn.map((x, i) => (i === seat ? true : x)) },
    events: [{ type: "skillActivated", public: { seat, skillId: id, effectKey: ov.effect.key } }],
  };
}

function resolvePlay(
  state: GameState,
  b: Board,
  seat: number,
  card: Card,
  ctx: Ctx,
  chosenColor?: Color,
  before: EngineEvent[] = [],
): ApplyResult {
  const hands = b.hands.map((h, i) => (i === seat ? h.filter((c) => c.id !== card.id) : h));
  const face = punishFace(card);
  let played: Board = {
    ...b,
    hands,
    discardPile: [card, ...b.discardPile],
    activeColor: chosenColor ?? card.color,
    direction: card.face === "rev" ? ((b.direction * -1) as 1 | -1) : b.direction,
    drawnPlayable: null,
    punish: face ? extendChain(b.punish, seat, face) : b.punish,
  };
  const events: EngineEvent[] = [...before, { type: "cardPlayed", public: { seat, card, chosenColor: chosenColor ?? null } }];

  if (played.hands[seat].length === 0) {
    // U5：只有数字牌能打完获胜；功能牌打空手牌 → 摸 1 张代价牌，游戏继续。
    // 该牌照常结算（下面的惩罚链/停/转都还要走），摸的这张不是惩罚（P1）。
    if (isNumberCard(card))
      return { state: commit(state, { ...played, punish: undefined, winner: seat }, "finished"), events };

    const { board, drawn, reshuffledOrder } = drawCards(played, { kind: "rule", base: 1, seat }, ctx.rng);
    played = { ...board, hands: giveTo(board, seat, drawn) };
    events.push(...drawEvents(seat, drawn, reshuffledOrder));
  }

  if (face) {
    const opened = openPunishWindow(state, played, seat, ctx);
    return { ...opened, events: [...events, ...opened.events] };
  }

  // 「停」跳过下家的回合开始窗口（U3 + 传统 UNO）
  const step = card.face === "skip" ? 2 : 1;
  return {
    state: commit(state, { ...played, ...passTurn(played, seat, step) }, "turnStart"),
    events,
  };
}
