/**
 * 技能效果的接缝：**一个技能 = 一个纯函数**，按 id 注册。
 *
 * 分工是死的：`actions/skill.ts` 那条脊梁管「能不能发动」（V1–V8、T1、压制、次数账），
 * 而且它读的是定义（`kind` / `window` / `stacks_with_turn_limit`）；handler 只管「干什么」，
 * 数值一律走 `paramsOf` 从数据读。所以 handler 里不该出现任何一个规则常数——
 * 出现了就说明有条维度还没进数据。
 *
 * 被动没有 handler：恩惠♥1 全程由 `draw-passives.ts` 的通用采集器驱动，一行专属代码都没有。
 */
import { drawCards, drawEvents, giveTo } from "../actions/draw.ts";
import { commit, reject } from "../legal.ts";
import { paramsOf } from "./params.ts";
import type { SkillData } from "./draw-passives.ts";
import type { ApplyResult, Board, Ctx, GameState } from "../types.ts";

/**
 * `board` 是脊梁记完次数账之后的牌桌，`state` 是原始状态（供 `commit` 涨版本号）。
 * `effect.cardIds` 是玩家为付代价挑的牌——恒心要弃一张，弃哪张只有玩家知道，
 * 跟无色牌的 `chosenColor` 一样是提交时带上来的，不是引擎能替他选的。
 */
export type SkillHandler = (
  state: GameState,
  board: Board,
  seat: number,
  effect: { key: string; cardIds: string[] },
  ctx: Ctx,
  data: SkillData,
) => ApplyResult;

/** 恒心♠1：弃 `discard` 张手牌，摸 `draws` 张。两个数都来自定义数据。 */
const steadfast: SkillHandler = (state, b, seat, effect, ctx, data) => {
  const p = paramsOf("spade-1", effect.key, data.params);
  const need = p.discard ?? 0;
  if (effect.cardIds.length !== need) return reject(state, "cost_unpayable");

  const paid = effect.cardIds.map((id) => b.hands[seat].find((c) => c.id === id));
  if (paid.some((c) => !c)) return reject(state, "not_in_hand");
  const dropped = paid.map((c) => c!);

  // 弃 ≠ 出牌：03 §1 把出牌堆与弃牌堆并称「牌河」，但引擎只有一摞。放**末尾**而不是牌顶，
  // 这样跟色的牌顶不受影响，洗回时（`discardPile.slice(1)`）它又照常回到牌河里。
  const ids = new Set(effect.cardIds);
  const paidBoard: Board = {
    ...b,
    hands: b.hands.map((h, i) => (i === seat ? h.filter((c) => !ids.has(c.id)) : h)),
    discardPile: [...b.discardPile, ...dropped],
  };

  // 02 §6：技能自己造成的摸牌不是「改摸牌数」，但仍然只能从 drawCards 这一个出口走
  const { board, drawn, reshuffledOrder } = drawCards(paidBoard, { kind: "skill", base: p.draws ?? 0, seat }, ctx.rng);
  return {
    state: commit(state, { ...board, hands: giveTo(board, seat, drawn) }),
    events: [
      // 弃牌堆全公开（02 §5），所以弃了什么是公开信息
      { type: "cardsDiscarded", public: { seat, cards: dropped } },
      ...drawEvents(seat, drawn, reshuffledOrder),
    ],
  };
};

/** 按 id 注册**行为**。属性一概不在这里——那些从定义读。 */
export const HANDLERS: Readonly<Record<string, SkillHandler>> = {
  "spade-1": steadfast,
};
