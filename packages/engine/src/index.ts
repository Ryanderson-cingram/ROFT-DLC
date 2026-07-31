import { sealedTargetOf } from "./actions/bloodthorn.ts";
import { punishDiceFor, TAKEOVER_CHOICES } from "./actions/dice.ts";
import { drawCard, endTurn } from "./actions/draw.ts";
import { stealSwap, swapActions } from "./actions/nightlord.ts";
import { callUno, catchable, catchUno } from "./actions/uno.ts";
import { playCards } from "./actions/play-cards.ts";
import {
  canStack, claimTimeout, farstarActions, punishFace, respond, soulSkipEffect, SOUL_SKIP, windowIdOf,
} from "./actions/punish.ts";
import { raidActions } from "./actions/raid.ts";
import { shuffleCancelActions, SHUFFLE_CHOICES } from "./actions/shuffle-card.ts";
import { activateSkill, revealSkill } from "./actions/skill.ts";
import { harvestActions } from "./actions/soul-harvest.ts";
import { startGame } from "./actions/start-game.ts";
import { isPlayable, stalemate } from "./legal.ts";
import { SKILL_DATA } from "./skills/draw-passives.ts";
import { HANDLERS, spendSouls } from "./skills/handlers.ts";
import { paramsOfEffect } from "./skills/params.ts";
import { multiPlayAllowed, valueOverrideFor } from "./skills/primitives/playability.ts";
import { isSealed, suppressesEffect } from "./skills/primitives/suppression.ts";
import type { SkillEffect } from "./skills/types.ts";
import type { Action, ApplyResult, Board, Card, ClientSnapshot, Color, Ctx, GameState } from "./types.ts";
export * from "./types.ts";
export { buildDeck, shuffle } from "./deck.ts";
export { isPlayable } from "./legal.ts";
// 客户端要把技能 id 映射成名字/文案（draft 候选、亮出的技能椰）；定义本来就是公开的百科数据
export { skills as loadedSkills } from "./skills/registry.ts";

const COLORS: Color[] = ["R", "G", "B", "Y"];
/** 牌 id 列表：必须是数组且每项是字符串，否则后面的 `.map` / `.find` 会炸。 */
const cardIdList = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
/** 座位号：整数才算数。`< 0 || >= n` 放行小数与 NaN（NaN 的比较恒为 false）。 */
const seatNo = (v: unknown, n: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n;

/**
 * 信任边界。Edge 只覆盖服务端认定的 `seat`，其余字段是客户端原样送上来的 JSON——
 * 任何一个房间成员都能伪造。校验放在引擎而不是 Edge：**引擎才是权威**（Edge 只做编排），
 * 而且这一层单测覆盖得到。契约是「引擎永不抛异常」，所以这里给拒因，不抛。
 *
 * 只管**形状与值域**；「这个字段此刻该不该出现」（如有色牌不许定色）是规则，归各动作。
 */
function malformed(state: GameState, action: Action): string | null {
  if (!seatNo(action.seat, state.seats.length)) return "invalid_seat";
  switch (action.type) {
    case "playCards":
      if (!cardIdList(action.cardIds)) return "bad_card_ids";
      if (action.chosenColor !== undefined && !COLORS.includes(action.chosenColor)) return "bad_color";
      // 值域校验在这里，「这张牌此刻该不该带它」是规则，归 play-cards.ts
      if (action.shuffleChoice !== undefined && !SHUFFLE_CHOICES.includes(action.shuffleChoice))
        return "bad_shuffle_choice";
      return null;
    case "catchUno":
    case "stealSwap":
      return seatNo(action.target, state.seats.length) ? null : "bad_target";
    case "respond":
      // 洗牌③的取消牌要定色（同 playCards 的 chosenColor，客户端原样送上来的）
      if (action.chosenColor !== undefined && !COLORS.includes(action.chosenColor)) return "bad_color";
      return action.cardIds === undefined || cardIdList(action.cardIds) ? null : "bad_card_ids";
    case "activateSkill":
      return action.cardIds === undefined || cardIdList(action.cardIds) ? null : "bad_card_ids";
    default:
      return null;
  }
}

/**
 * U8 平局：洗满 2 次之后摸牌堆再度见底、且无人打完 → 本局终局无赢家。
 *
 * 判定时点是**回合交接**——`turnStart` 且没有挂着的反应窗口，也就是「这一轮全部结算完了、
 * 下一个人该动了」的那一刻。放在 applyAction 的出口而不是 `commit` 里，是因为这里看得到
 * **最终**状态：`commit` 会清窗口而各动作随后再挂回去（攒魂窗口就活在 turnStart），
 * 在 commit 里判会把「窗口还没结完」误当成交接。所有动作都从这里出去，绕不开。
 *
 * 条件只看牌堆状态，不看「还有没有人能动」——所以它是确定性的、可测的，
 * 也因此那条「牌堆枯竭后无限转圈」的死局不复存在。
 */
function settleStalemate(r: ApplyResult): ApplyResult {
  const s = r.state;
  if (r.rejected || s.phase !== "turnStart" || s.pendingWindow || !s.board || !stalemate(s.board)) return r;
  return {
    ...r,
    state: { ...s, phase: "finished" },
    events: [...r.events, { type: "gameDrawn", public: { reason: "deck_exhausted" } }],
  };
}

export function applyAction(state: GameState, action: Action, ctx: Ctx): ApplyResult {
  const bad = action && typeof action === "object" ? malformed(state, action) : "unknown_action";
  if (bad) return { state, events: [], rejected: { reason: bad } };
  return settleStalemate(dispatch(state, action, ctx));
}

function dispatch(state: GameState, action: Action, ctx: Ctx): ApplyResult {
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
    case "stealSwap":
      return stealSwap(state, action, ctx);
    case "callUno":
      return callUno(state, action.seat, ctx);
    case "catchUno":
      return catchUno(state, action, ctx);
    case "revealSkill":
      return revealSkill(state, action.seat);
    case "activateSkill":
      return activateSkill(state, action, ctx);
    default:
      return { state, events: [], rejected: { reason: "unknown_action" } };
  }
}

/**
 * 付得起代价吗（06-Q54：付不起就发不动）。不做通用代价框架——首批十技能里真有代价的
 * 只有两条，按**定义形状**认：
 * - `values.marks`：要花标记（影歌②的 2 魂）
 * - `active` + `modifies: dice`：血棘①，目标是「当前被你封印的那个人」，没有就发不动
 * 少了这一步，legalActions 会给出点了才拿到 `no_target` / `cost_unpayable` 的按钮。
 */
const costPayable = (b: Board, seat: number, e: SkillEffect): boolean => {
  const marks = paramsOfEffect(e).counts.marks;
  if (marks !== undefined) return spendSouls(b, seat, marks) !== null;
  if (e.modifies?.includes("dice")) return sealedTargetOf(b, seat) !== undefined;
  return true;
};

/**
 * 这个座位此刻能做的事。客户端的「可打高亮」一律来自这里，不许自己判合法性。
 * 无色牌不带 `chosenColor`——定色是提交前的客户端模态，不是服务端窗口。
 */
export function legalActions(state: GameState, seat: number): Action[] {
  const b = state.board;
  if (!b || state.phase === "finished") return [];

  // U6/U7：补喊与抓不限回合、不被反应窗口挡，所以拼在每条返回路径上
  const unoActions: Action[] = [];
  if (state.phase !== "dealing") {
    // U6：按钮**常亮**，手牌数不参与——判在按下那一刻（不是 1 张就罚摸 2）。
    // 合法 ≠ 划算：代价由 UI 说清楚，引擎不替玩家做主
    if (!b.saidUno[seat]) unoActions.push({ type: "callUno", seat });
    b.hands.forEach((_h, target) => {
      if (target !== seat && catchable(b, target)) unoActions.push({ type: "catchUno", seat, target });
    });
  }

  const w = state.pendingWindow;
  if (w) {
    if (!w.actors.includes(seat)) return unoActions;
    const windowId = windowIdOf(state)!;
    // S1 抽 3 选 1：候选就是全部合法选择
    if (w.type === "skillDraft")
      return (b.draftOptions?.[seat] ?? []).map((id) => ({ type: "respond", seat, windowId, choice: id }));
    // 影歌①攒魂：三选一，亮牌那两条按手牌逐张给出
    if (w.type === "soulHarvest") return [...harvestActions(b, seat, windowId), ...unoActions];
    // 从自己现在的手牌里挑一张交出去，逐张给出。两个窗口的动作逐字相同：
    // 司夜②还牌（含刚盲抽那张）、洗牌②弃牌（含刚摸那张）
    if (w.type === "swapReturn" || w.type === "shuffleDiscard")
      return [
        ...b.hands[seat].map((c): Action => ({ type: "respond", seat, windowId, choice: c.id })),
        ...unoActions,
      ];
    // 劫营♦10 打断：截刚摆的那张（逐张给出），或放弃（04 ♦10）
    if (w.type === "interrupt") return [...raidActions(b, seat, windowId), ...unoActions];
    // 洗牌③取消：打自己的洗牌牌取消（逐张给出），或放弃（05 §2b 裁定 洗-3）
    if (w.type === "shuffleCancel") return [...shuffleCancelActions(b, seat, windowId), ...unoActions];
    // 强袭②接管：重掷同数量，或放过（04 ♦1②）
    if (w.type === "diceTakeover")
      return [
        ...TAKEOVER_CHOICES.map((choice): Action => ({ type: "respond", seat, windowId, choice })),
        ...unoActions,
      ];
    // P1：惩罚窗口里只有叠或吃，主动技能不可用——除非某条效果声明了豁免（06-Q39）
    const choices = ["stack", "accept"].filter(
      (c) => c !== "stack" || (b.punish != null && b.hands[seat].some((card) => canStack(card, b.punish!))),
    );
    if (soulSkipEffect(b, seat)) choices.push(SOUL_SKIP);
    // 远星♦J：弃代价牌视为叠链（01-P7）。合法代价牌逐张给出，付不起的人这里一条都没有（06-Q54）
    return [
      ...choices.map((choice): Action => ({ type: "respond", seat, windowId, choice })),
      ...farstarActions(b, seat, windowId),
      ...unoActions,
    ];
  }

  if (seat !== b.currentSeat) return unoActions;

  // V1/V6：持有未亮出就能亮，且亮出不占额度，所以它和出牌并列可选。
  const skillActions: Action[] =
    b.skills[seat] && !b.revealed[seat] && !isSealed(b, seat) ? [{ type: "revealSkill", seat }] : [];

  const def = b.skills[seat] ? SKILL_DATA.byId.get(b.skills[seat]!) : undefined;
  // 可发动的主动效果，镜像 activateSkill 脊梁的校验（V7/V8、T1、压制）。
  // 代价（弃哪张）是提交前的客户端选择，这里不带 cardIds。
  const activations: Action[] =
    b.revealed[seat] && !b.activatedThisTurn[seat] &&
    state.phase === "turnStart" && HANDLERS[b.skills[seat] ?? ""]
      ? (def?.effects ?? [])
          .filter(
            (e) =>
              e.kind === "active" &&
              (e.window ?? "turn_start") === "turn_start" &&
              // 压制与「一次性用掉了没有」逐条效果地问，跟发动脊梁同一套判断
              !suppressesEffect(b, seat, e) &&
              !(e.once === "once" && b.usedOnce?.[seat]?.[e.key]) &&
              costPayable(b, seat, e),
          )
          .map((e): Action => ({ type: "activateSkill", seat, effectKey: e.key }))
      : [];

  // 司夜♣3②：阶段 1 花 1 盗与人盲换 1 张。不是「发动」（06-Q57），所以不受 V7 额度约束，
  // 与上面那批主动并列给出；同一阶段 1 可以连发多次，每次 1 盗。
  const swaps = state.phase === "turnStart" ? swapActions(b, seat) : [];

  const top = b.playedPile[0];
  // 并列♥4 的 4 张/6 张打完后跟的牌面不是堆顶那张，跟牌目标以 activeFace 为准
  const topFace = b.activeFace ?? top.face;
  // 强袭①：打 +2/+4 时可以改成掷骰定倍率。带旗标才算数，所以它是同一张牌的**另一条**动作
  // （同精英的 skillPlays），不是上面那批的变体——多张组合不进 legalActions 的道理同源。
  const assaultOn = punishDiceFor(b, seat, def) > 0;
  const assaultVariant = (cards: Card[]): Action[] =>
    assaultOn
      ? cards.filter(punishFace).map((c): Action => ({ type: "playCards", seat, cardIds: [c.id], useAssault: true }))
      : [];

  // U1：摸到可打的牌之后，只剩「打那一张」和「结束回合」
  if (b.drawnPlayable)
    return [
      { type: "playCards", seat, cardIds: [b.drawnPlayable.id] },
      ...assaultVariant([b.drawnPlayable]),
      { type: "endTurn", seat },
      ...unoActions,
    ];
  const playable = b.hands[seat].filter((c) =>
    b.punish ? canStack(c, b.punish) : isPlayable(c, top, b.activeColor, b.activeFace),
  );
  const plays = playable.map((c): Action => ({ type: "playCards", seat, cardIds: [c.id] }));
  const assaultPlays = assaultVariant(playable);
  // 惩罚回合只关「发动」，不关「亮出」（01 §3 的括号只修饰发动，V6 亮出不占额度）——
  // 少了 skillActions 的话，远星♦J 这种只在惩罚轮有用的技能永远没机会亮出来
  if (b.punish) return [...skillActions, ...plays, ...assaultPlays, ...unoActions];

  // 精英♥3：本来打不出去、但当作大 1 点就能跟上牌顶的牌。带 useSkill 才合法，
  // 所以它们是**另一条**动作，不是上面那批的变体（V7：用了就占掉本回合的主动）。
  const skillPlays = b.hands[seat]
    .filter((c) => !isPlayable(c, top, b.activeColor, b.activeFace) && String(valueOverrideFor(b, seat, c, def)?.value) === topFace)
    .map((c): Action => ({ type: "playCards", seat, cardIds: [c.id], useSkill: true }));
  return [
    ...skillActions,
    ...activations,
    ...swaps,
    ...plays,
    ...assaultPlays,
    ...skillPlays,
    { type: "drawCard", seat },
    ...unoActions,
  ];
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
      revealed: b?.revealed[i] ?? false,
      // 03 §5：标记是公开计数，别人的也看得到（魂攒到几个是明面上的博弈信息）
      marks: b?.marks[i] ?? {},
      // 03 §4：状态是公开的（血棘的封印有公开事件，UI 要画「被封印」徽记）。
      // `sealedBy`（谁封的我）不进快照：那是解除条件的内部记账，公开的是「被封着」这件事
      statuses: b?.statuses[i] ?? [],
      // ponytail: 神化是下一个计划（G1）的事，本轮恒为 0
      ascensions: 0,
    })),
    currentSeat: b?.currentSeat ?? null,
    direction: b?.direction ?? 1,
    activeColor: b?.activeColor ?? null,
    playedTop: b?.playedPile[0] ?? null,
    // 并列打完后跟的牌面不一定是堆顶那张（activeFace），UI 的提示要照它写
    followFace: b ? (b.activeFace ?? b.playedPile[0].face) : "0",
    // 多张组合不进 legalActions（会爆炸），所以「能不能多打」由引擎算好给 UI
    canPlayMultiple: b
      ? multiPlayAllowed(b, seat, b.skills[seat] ? SKILL_DATA.byId.get(b.skills[seat]!) : undefined)
      : false,
    // 02 §5：弃牌堆全公开
    discardPile: b?.discardPile ?? [],
    drawPileCount: b?.drawPile.length ?? 0,
    drawnPlayable: b?.drawnPlayable ?? null,
    punish: b?.punish,
    pendingWindow: state.pendingWindow,
    // 骰子当众掷：点数公开。续跑指令（resume）是引擎内部的事，不进快照。
    dice: state.pendingDice && {
      seat: state.pendingDice.seat,
      reason: state.pendingDice.reason,
      values: state.pendingDice.values,
    },
    windowId: windowIdOf(state),
    winner: b?.winner,
    // 只带自己的候选——别人抽到什么和选了什么都是暗信息
    draftOptions: b?.draftOptions?.[seat],
    legalActions: legalActions(state, seat),
    disabledReasons: disabledReasons(state, seat),
  };
}

function disabledReasons(_state: GameState, _seat: number): Record<string, string> {
  // 暂时恒为空。按钮由 legalActions 生成，不可用的动作**根本不渲染**，所以 L2 的真实需求
  // 是「点了被拒时给人话」——那是 apps/web 的拒因表，不是这里。
  // 字段留着：技能的 L2「为何不可用」文案将来靠它。
  return {};
}
