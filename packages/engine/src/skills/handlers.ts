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
import { drainRoll } from "../actions/bloodthorn.ts";
import { drawCards, drawEvents, giveTo } from "../actions/draw.ts";
import { openHarvest } from "../actions/soul-harvest.ts";
import { commit, passTurn, reject } from "../legal.ts";
import { paramsOf } from "./params.ts";
import { spendMarks } from "./primitives/marks.ts";
import type { SkillData } from "./draw-passives.ts";
import type { ApplyResult, Board, Color, Ctx, Face, GameState } from "../types.ts";

/**
 * `board` 是脊梁记完次数账之后的牌桌，`state` 是原始状态（供 `commit` 涨版本号）。
 * `effect.cardIds` 是玩家为付代价挑的牌——恒心要弃一张，弃哪张只有玩家知道，
 * 跟无色牌的 `chosenColor` 一样是提交时带上来的，不是引擎能替他选的。
 */
export type SkillHandler = (
  state: GameState,
  board: Board,
  seat: number,
  effect: { key: string; cardIds: string[]; declared?: { color: Color; face: Face } },
  ctx: Ctx,
  data: SkillData,
) => ApplyResult;

/** 恒心♠1：弃 `discard` 张手牌，摸 `draws` 张。两个数都来自定义数据。 */
const steadfast: SkillHandler = (state, b, seat, effect, ctx, data) => {
  const p = paramsOf("spade-1", effect.key, data.byId);
  const need = p.counts.discard ?? 0;
  if (effect.cardIds.length !== need) return reject(state, "cost_unpayable");

  const paid = effect.cardIds.map((id) => b.hands[seat].find((c) => c.id === id));
  if (paid.some((c) => !c)) return reject(state, "not_in_hand");
  const dropped = paid.map((c) => c!);

  // 弃 ≠ 出牌（06-Q55）：弃的牌进弃牌堆，不碰出牌堆顶与跟色；洗回时照常回摸牌堆。
  const ids = new Set(effect.cardIds);
  const paidBoard: Board = {
    ...b,
    hands: b.hands.map((h, i) => (i === seat ? h.filter((c) => !ids.has(c.id)) : h)),
    discardPile: [...b.discardPile, ...dropped],
  };

  // 02 §6：技能自己造成的摸牌不是「改摸牌数」，但仍然只能从 drawCards 这一个出口走
  const { board, drawn, reshuffledOrder } = drawCards(paidBoard, { kind: "skill", base: p.counts.draws ?? 0, seat }, ctx.rng);
  return {
    state: commit(state, { ...board, hands: giveTo(board, seat, drawn) }),
    events: [
      // 弃牌堆全公开（02 §5），所以弃了什么是公开信息
      { type: "cardsDiscarded", public: { seat, cards: dropped } },
      ...drawEvents(seat, drawn, reshuffledOrder),
    ],
  };
};

/**
 * 影歌♦3：①指定一张「色+数」开攒魂窗口；②花魂跳过本回合（01-S15）。
 * ②在**惩罚回合**也发得出来（06-Q39 的 `suppression_exempt`），但那条路走的是惩罚窗口的
 * respond 分支（punish.ts::soulSkip），不经过这里——这里只管普通回合。
 */
const shadowSong: SkillHandler = (state, b, seat, effect, ctx, data) => {
  if (effect.key === "1") return openHarvest(state, b, seat, effect.key, effect.declared, ctx);

  // ② 代价：花 marks 个魂。付不起 → 发动不了且不消耗次数（06-Q54）
  const paid = spendSouls(b, seat, paramsOf("diamond-3", effect.key, data.byId).counts.marks ?? 0);
  if (!paid) return reject(state, "cost_unpayable");
  // 跳过本回合 = 直接交给下家（01-S15：占主动条，但回合都跳了，实际无冲突）
  return {
    state: commit(state, { ...paid, drawnPlayable: null, ...passTurn(paid, seat) }, "turnStart"),
    events: [{ type: "turnSkipped", public: { seat } }],
  };
};

/**
 * 血棘♦2①：掷 `dice` 颗骰，当前被你封印的那个人摸等量（04 ♦2 补齐）。
 * 封印的赋予与解除是被动，长在 punish.ts 与 play-cards.ts 里，不经过这里。
 */
const bloodthorn: SkillHandler = (state, b, seat, effect, ctx, data) =>
  drainRoll(state, b, seat, paramsOf("diamond-2", effect.key, data.byId).counts.dice ?? 0, ctx, data);

/** 影歌的代价：花 `n` 个魂。付不起返回 null，一个都不扣。惩罚窗口那条路也用它。 */
export const spendSouls = (b: Board, seat: number, n: number): Board | null => spendMarks(b, seat, "魂", n);

/** 按 id 注册**行为**。属性一概不在这里——那些从定义读。 */
export const HANDLERS: Readonly<Record<string, SkillHandler>> = {
  "spade-1": steadfast,
  "diamond-2": bloodthorn,
  "diamond-3": shadowSong,
};
