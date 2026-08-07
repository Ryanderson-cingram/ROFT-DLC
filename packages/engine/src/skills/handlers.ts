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
import { openDrawDiscard } from "../actions/draw-discard.ts";
import { swapWithAlly } from "./alliance.ts";
import { canChooseOption, chooseOption } from "./bard.ts";
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
 * 八门♠8①：一次性摸 8 弃 8（04 ♠8 / 03 §2「摸 N 弃 N 是**一个窗口**」）。
 *
 * 「不受其他技能影响」= 02 §7 的 **L1 替换**（与伤逝♥10 逐字同源的那句卡面文字）：
 * 那 8 张是定值，命中 L1 即跳过 L2/L3/L4，别人的活泼板/狂欢改不动它，
 * **连自己②的「所有摸牌 +1」也不加**。这句的确切范围仍未裁定，见 06-Q69。
 *
 * 弃那 8 张不吃层级（03 §2），所以 `openDrawDiscard` 的 `req.base` 就是它，一个数据来源。
 */
const eightGates: SkillHandler = (state, b, seat, effect, ctx, data) => {
  const def = data.byId.get("spade-8")!;
  const n = paramsOf("spade-8", effect.key, data.byId).draw.L1;
  // 计划 §1：定义没给这个数就是数据坏了，静默摸 0 张比报错难查得多
  if (n === undefined) throw new Error("八门①：定义声明了 L1，但 values 里没有它的数值");
  return openDrawDiscard(
    state, b, seat, { kind: "skill", base: n, seat }, { kind: "afterSkill" }, ctx, [], data,
    [{ layer: "L1", source: def.name, value: n }],
  );
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
    state: commit(state, { ...paid, drawnPlayable: null, ...passTurn(paid, ctx.now, seat) }, "turnStart"),
    events: [{ type: "turnSkipped", public: { seat } }],
  };
};

/**
 * 血棘♦2①：掷 `dice` 颗骰，当前被你封印的那个人摸等量（04 ♦2 补齐）。
 * 封印的赋予与解除是被动，长在 punish.ts 与 play-cards.ts 里，不经过这里。
 */
const bloodthorn: SkillHandler = (state, b, seat, effect, ctx, data) =>
  drainRoll(state, b, seat, paramsOf("diamond-2", effect.key, data.byId).counts.dice ?? 0, ctx, data);

/**
 * 合纵♠5 / 连横♠6①b：结盟后回合开始与盟友**整副手牌互换**（06-Q70）。
 * 不需对方同意、占 V7 的主动条——两条都由定义（`stacks_with_turn_limit: true`）与脊梁负责，
 * 这里只管换。没结盟时脊梁本来就不给这条动作，硬发也会被 `swapWithAlly` 拒掉。
 */
const allianceSwap: SkillHandler = (state, b, seat, _effect, ctx) => swapWithAlly(state, b, seat, ctx);

/**
 * 吟游♣5①：选一支歌声（04 ♣5 / 01-S20）。玩家报的 `key` 就是那一支——
 * 「哪一支生效」由通用的选项闸门（`option_of`）说了算，这里只记下选中的是谁。
 * 开唱条件「上家打出的不是 +2/+4」在 `bard.ts`，与 `legalActions` 同一个判据。
 */
const bard: SkillHandler = (state, b, seat, effect) => {
  if (!canChooseOption(b)) return reject(state, "skill_unavailable");
  const id = b.skills[seat]!;
  return {
    state: commit(state, chooseOption(b, id, effect.key, seat)),
    events: [{ type: "optionChosen", public: { seat, skillId: id, key: effect.key } }],
  };
};

/** 影歌的代价：花 `n` 个魂。付不起返回 null，一个都不扣。惩罚窗口那条路也用它。 */
export const spendSouls = (b: Board, seat: number, n: number): Board | null => spendMarks(b, seat, "魂", n);

/** 按 id 注册**行为**。属性一概不在这里——那些从定义读。 */
export const HANDLERS: Readonly<Record<string, SkillHandler>> = {
  "club-5": bard,
  "spade-1": steadfast,
  "spade-5": allianceSwap,
  "spade-6": allianceSwap,
  "spade-8": eightGates,
  "diamond-2": bloodthorn,
  "diamond-3": shadowSong,
};
