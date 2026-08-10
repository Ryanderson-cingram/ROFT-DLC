import { sealedTargetOf } from "./actions/bloodthorn.ts";
import { punishDiceFor, TAKEOVER_CHOICES } from "./actions/dice.ts";
import { drawCard, drawCards, drawEvents, endTurn, giveTo } from "./actions/draw.ts";
import { drawDiscardActions, drawOfferActions } from "./actions/draw-discard.ts";
import { allianceActions, allyOf } from "./skills/alliance.ts";
import { handOverActions } from "./skills/guard.ts";
import { canChooseOption } from "./skills/bard.ts";
import { mustDrawWhenStuck } from "./skills/gift.ts";
import { revealAllowedOutOfTurn, revealConditionsMet } from "./skills/reveal.ts";
import { stealSwap, swapActions } from "./actions/nightlord.ts";
import { callUno, catchable, catchUno } from "./actions/uno.ts";
import { playCards } from "./actions/play-cards.ts";
import {
  canStack, claimTimeout, dissentActions, farstarActions, punishFace, respond, soulSkipEffect,
  SOUL_SKIP,
} from "./actions/punish.ts";
import { raidActions } from "./actions/raid.ts";
import { shuffleCancelActions, SHUFFLE_CHOICES } from "./actions/shuffle-card.ts";
import { activateSkill, revealSkill } from "./actions/skill.ts";
import { harvestActions } from "./actions/soul-harvest.ts";
import { startGame } from "./actions/start-game.ts";
import { calledThisTurn, isPlayable, playableFor, requiredColor, stalemate, windowIdOf } from "./legal.ts";
import { SKILL_DATA } from "./skills/draw-passives.ts";
import { settleTurnEnd } from "./skills/turn-end.ts";
import { HANDLERS, spendSouls } from "./skills/handlers.ts";
import { paramsOfEffect } from "./skills/params.ts";
import { multiPlayAllowed, valueOverrideFor } from "./skills/primitives/playability.ts";
import { isSealed, suppressesEffect } from "./skills/primitives/suppression.ts";
import type { SkillEffect } from "./skills/types.ts";
import type { Action, ApplyResult, Board, Card, ClientSnapshot, Color, Ctx, GameState } from "./types.ts";
export * from "./types.ts";
import { COLORS } from "./deck.ts";
export { buildDeck, shuffle } from "./deck.ts";
export { isPlayable } from "./legal.ts";
// 客户端要把技能 id 映射成名字/文案（draft 候选、亮出的技能椰）；定义本来就是公开的百科数据
export { skills as loadedSkills } from "./skills/registry.ts";

/**
 * 标记上限表（标记名 → 上限），来自各技能定义的 `mark_cap`（04 围栏块 / 02 §6）。
 * **没有上限的标记不在表里**（司夜的「盗」）——缺席即无上限，UI 别把缺席读成 0。
 *
 * 整表投影不是泄露：技能定义本来就是公开的百科数据（`loadedSkills` 已经整份导出给客户端），
 * 而且上限与「谁持有哪个技能」无关。
 *
 * 惰性 + 记忆化，不在模块顶层读 `byId`：registry → handlers → actions → draw-passives → registry
 * 是一个环，顶层读会拿到还没初始化完的 registry（同 `draw-passives.ts::SKILL_DATA` 的说明）。
 */
let marksCapCache: Readonly<Record<string, number>> | undefined;
const marksCap = () =>
  (marksCapCache ??= Object.fromEntries(
    [...SKILL_DATA.byId.values()].flatMap((d) => (d.effects ?? []).flatMap((e) => Object.entries(e.mark_cap ?? {}))),
  ));
/**
 * 反应窗口的投影。**`shuffleCancel` 的 `actors` 是暗信息**：那一串正是「谁手上有洗牌牌」，
 * 而手牌是私有的——整份投出去等于当众念出别人的手牌内容。只留「有没有你」这一位，
 * 够 UI 判断该不该给你按钮，其余人一个都不给（事件那边同样不发，见
 * `shuffle-card.ts::openWindow` 的 `hideActors`）。
 *
 * 其余窗口原样投：它们的 actors 都由**公开事实**决定（该谁响应惩罚、该谁还牌、该谁弃牌），
 * 本来就是全场看得见的，藏起来反而写不出「等谁」那句话。
 */
const projectWindow = (w: GameState["pendingWindow"], seat: number): GameState["pendingWindow"] =>
  w?.type === "shuffleCancel" ? { ...w, actors: w.actors.filter((a) => a === seat) } : w;

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
 * 收场：U8 的平局判定 + 终局事件。两件事挤在一个函数里，是因为它们判的是同一个时点。
 *
 * **U8 平局**：洗满 2 次之后摸牌堆再度见底、且无人打完 → 本局终局无赢家。
 * 判定时点是**回合交接**——`turnStart` 且没有挂着的反应窗口，也就是「这一轮全部结算完了、
 * 下一个人该动了」的那一刻。放在 applyAction 的出口而不是 `commit` 里，是因为这里看得到
 * **最终**状态：`commit` 会清窗口而各动作随后再挂回去（攒魂窗口就活在 turnStart），
 * 在 commit 里判会把「窗口还没结完」误当成交接。
 *
 * 条件只看牌堆状态，不看「还有没有人能动」——所以它是确定性的、可测的，
 * 也因此那条「牌堆枯竭后无限转圈」的死局不复存在。
 *
 * **`gameEnded`**：终局的**唯一**事件，胜负与平局共用一条。
 * 从前只有平局发事件（`gameDrawn`），赢家只写进 `board.winner`——于是任何纯事件流的
 * 消费者（记录抽屉、跨局统计）都读不到「谁赢了」。四条胜利路径散落在
 * play-cards / raid / shuffle-card 里，逐个补事件迟早漏一条；这里是 applyAction 的出口，
 * **所有动作都从这里出去，绕不开**，判一次就覆盖全部路径。
 *
 * `winner` 缺席 = 平局（同 `Board.winner` 的口径），此时给出 `reason`。
 */
function settleEnd(before: GameState, r: ApplyResult): ApplyResult {
  if (r.rejected) return r;
  let { state, events } = r;
  if (state.phase === "turnStart" && !state.pendingWindow && state.board && stalemate(state.board))
    state = { ...state, phase: "finished" };
  // `before.phase` 的判断挡的是「终局之后又跑了一个动作」——那种动作会被 dispatch 拒掉，
  // 但拒不掉的将来若有（房间层动作走的是另一条路），也不该重复发第二条终局事件。
  if (state.phase === "finished" && before.phase !== "finished")
    events = [...events, {
      type: "gameEnded",
      public: state.board?.winner === undefined
        ? { reason: "deck_exhausted" }
        : { winner: state.board.winner },
    }];
  return state === r.state && events === r.events ? r : { ...r, state, events };
}

/** U6：交回合时喊过却不是 1 张 → 罚摸 2 张（规则摸牌，非惩罚 P1）。 */
const MISCALL_DRAW = 2;

/**
 * U6 交回合结算（2026-08-02 改判）：**本回合喊过、但交回合那一刻手牌不是 1 张 → 罚摸 2**。
 *
 * 「作废」那一半在 `passTurn` 里（它把 `saidUno` 按「手牌恰 1」重算）；补罚这一半留在这里，
 * 因为 `passTurn` 返回的是 Board 的一个切片——摸牌要 rng、要发事件，它两样都做不了。
 * 放在 `applyAction` 的出口（同 `settleStalemate`）：所有动作都从这里出去，绕不开。
 *
 * 判据是「**离场的那个座位**」= 动作之前的 `currentSeat`，而不是 `passTurn` 的 `from`：
 * 劫营打断时 `from` 是打断者（他不进回合），真正结束回合的是被打断的那个人。
 *
 * 与 `syncUno` 的分工：`syncUno` 管**回合外**的作废（手牌一离开 1 张即清），那是自然失效、
 * 不该罚；这里只认「你自己的回合结束了」这一个时点。
 *
 * 判的是「**本回合按过按钮**」（`unoThisTurn`）而不是「声明此刻有效」（`saidUno`）：
 * 上一个回合末成立、结转进来的声明在那时已经结算过（恰 1 张、成立），这一回合再算一次
 * 就是「上一轮喊过 UNO → 这一轮无牌可出摸 1 张 → 平白罚摸 2」（2026-08-08 澄清）。
 */
function settleUnoCall(before: GameState, r: ApplyResult, ctx: Ctx): ApplyResult {
  const b0 = before.board;
  const b1 = r.state.board;
  if (r.rejected || !b0 || !b1) return r;
  const seat = b0.currentSeat;
  // 回合没交出去就还没到结算时点（回合内手牌怎么波动都不算数）
  if (b1.currentSeat === seat) return r;
  if (!calledThisTurn(b0, seat) || b1.hands[seat].length === 1) return r;

  // 01-S17b ⑤：UNO 的罚摸一定要摸（2026-08-03 裁定：虚喊那 2 张同样照罚）
  const { board, drawn, reshuffledOrder } = drawCards(b1, { kind: "rule", base: MISCALL_DRAW, seat, reason: "unoPenalty" }, ctx.rng);
  // 罚不到就算了——这里不能像 callUno 那样整条拒收（回合已经交出去了，回滚等于卡死牌桌）。
  // 牌堆枯竭本来就会走 U8 的平局收场。
  if (drawn.length === 0) return r;
  return {
    ...r,
    state: { ...r.state, board: { ...board, hands: giveTo(board, seat, drawn) } },
    events: [...r.events, { type: "unoMiscalled", public: { seat } }, ...drawEvents(seat, drawn, reshuffledOrder)],
  };
}

export function applyAction(state: GameState, action: Action, ctx: Ctx): ApplyResult {
  const bad = action && typeof action === "object" ? malformed(state, action) : "unknown_action";
  if (bad) return { state, events: [], rejected: { reason: bad } };
  // 顺序要紧：罚摸可能把牌堆抽干，平局判定得看**罚完之后**的牌堆。
  // 回合末的赋状态（八门②的五彩）不摸牌，排在最前最后都一样，摆在最里层贴着「回合刚交完」
  return settleEnd(state, settleUnoCall(state, settleTurnEnd(state, dispatch(state, action, ctx)), ctx));
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
      return endTurn(state, action.seat, ctx);
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
      return revealSkill(state, action.seat, ctx);
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
  // 合纵♠5 / 连横♠6①b：没结盟就没得换（`pairs_with` = 成对技能，那条主动就是换手牌）
  if (SKILL_DATA.byId.get(b.skills[seat] ?? "")?.pairs_with) return allyOf(b, seat) !== undefined;
  // 吟游♣5①：开唱条件是「上家打出的不是 +2/+4」（04 ♣5）——有选项的主动才问这一条
  if ((SKILL_DATA.byId.get(b.skills[seat] ?? "")?.effects ?? []).some((o) => o.option_of === e.key))
    return canChooseOption(b);
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
    // 司夜②还牌：从自己现在的手牌里挑**一张**交出去（含刚盲抽那张），逐张给出
    if (w.type === "swapReturn")
      return [
        ...b.hands[seat].map((c): Action => ({ type: "respond", seat, windowId, choice: c.id })),
        ...unoActions,
      ];
    // 摸 N 弃 N（03 §2）：组合不枚举（会爆炸），只给一条模板，客户端凑齐 picks 张再提交
    if (w.type === "drawDiscard") return [...drawDiscardActions(seat, windowId), ...unoActions];
    // 合纵/连横②：要 / 不要，两条
    if (w.type === "drawOffer") return [...drawOfferActions(seat, windowId), ...unoActions];
    // 合纵/连横①：相应 / 不相应（S13：亮出当下立刻决定）
    if (w.type === "alliance") return [...allianceActions(seat, windowId), ...unoActions];
    // 近卫♥6：交几张（模板，客户端填 cardIds）/ 不交
    if (w.type === "handOver") return [...handOverActions(seat, windowId), ...unoActions];
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
      // 异议♥8：①反弹给上家（整局一次）、②吃下时弃 N 枚异（每档一条）
      ...dissentActions(b, seat, windowId),
      ...unoActions,
    ];
  }

  // V1/V6：持有未亮出就能亮，且亮出不占额度，所以它和出牌并列可选。
  // V2：写明例外的技能在**别人的回合**也亮得出（判据在 `skills/reveal.ts`，按定义放行）。
  const canReveal =
    !!b.skills[seat] && !b.revealed[seat] && !isSealed(b, seat) &&
    // V2b（2026-08-08）：`reveal_when` 是主动亮出的门槛，己方回合也要过
    revealConditionsMet(b, seat, SKILL_DATA.byId.get(b.skills[seat]!)) &&
    (seat === b.currentSeat || revealAllowedOutOfTurn(b, seat, SKILL_DATA.byId.get(b.skills[seat]!)));
  const skillActions: Action[] = canReveal ? [{ type: "revealSkill", seat }] : [];

  // 轮不到你时，除了 UNO 那两条，就只剩 V2 的例外亮出
  if (seat !== b.currentSeat) return [...skillActions, ...unoActions];

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
          // 02 §6 的选项分支：一条主动有几个选项就给几条（吟游的四支歌声各一个按钮），
          // 报的是**选项**的 key；没有选项的照旧报自己的 key
          .flatMap((e): Action[] => {
            const options = (def?.effects ?? []).filter((o) => o.option_of === e.key);
            const keys = options.length ? options.map((o) => o.key) : [e.key];
            return keys.map((effectKey) => ({ type: "activateSkill", seat, effectKey }));
          })
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
    b.punish ? canStack(c, b.punish) : playableFor(b, seat, c),
  );
  const plays = playable.map((c): Action => ({ type: "playCards", seat, cardIds: [c.id] }));
  const assaultPlays = assaultVariant(playable);
  // 惩罚回合只关「发动」，不关「亮出」（01 §3 的括号只修饰发动，V6 亮出不占额度）——
  // 少了 skillActions 的话，远星♦J 这种只在惩罚轮有用的技能永远没机会亮出来
  if (b.punish) return [...skillActions, ...plays, ...assaultPlays, ...unoActions];

  // 精英♥3：本来打不出去、但当作大 1 点就能跟上牌顶的牌。带 useSkill 才合法，
  // 所以它们是**另一条**动作，不是上面那批的变体（V7：用了就占掉本回合的主动）。
  const skillPlays = b.hands[seat]
    .filter((c) => !playableFor(b, seat, c) && String(valueOverrideFor(b, seat, c, def)?.value) === topFace)
    .map((c): Action => ({ type: "playCards", seat, cardIds: [c.id], useSkill: true }));
  // 神授♥5（01-S17）：无牌可出时可以**不摸直接结束**。判据与 `endTurn` 同源，
  // 所以坞里给的与引擎认的永远一致；没有神授的人这条恒为空（U1 照旧必须摸）。
  const passTurnAction: Action[] =
    !mustDrawWhenStuck(b, seat) ? [{ type: "endTurn", seat }] : [];
  return [
    ...skillActions,
    ...activations,
    ...swaps,
    ...plays,
    ...assaultPlays,
    ...skillPlays,
    { type: "drawCard", seat },
    ...passTurnAction,
    ...unoActions,
  ];
}

/** 视角投影：只有 `seat` 自己的手牌进快照，其余玩家降级为公开计数。 */
export function projectView(state: GameState, seat: number): ClientSnapshot {
  const b = state.board;
  const dice = state.pendingDice;
  const sh = b?.soulHarvest;
  const sw = b?.swap;
  const sp = b?.shufflePending;
  const dd = b?.drawDiscard;
  const off = b?.drawOffer;
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
      // 花费同样有公开事件（marksSpent），所以「已花几个」与余额同级公开
      marksSpent: b?.marksSpent?.[i] ?? {},
      // 上限见快照顶层的 marksCap（它是定义的函数，与座位无关，所以不逐人重复）
      // 03 §4：状态是公开的（血棘的封印有公开事件，UI 要画「被封印」徽记）
      statuses: b?.statuses[i] ?? [],
      // V7：发动有公开事件（skillActivated），所以「本回合用掉主动没有」是公开信息
      activatedThisTurn: b?.activatedThisTurn[i] ?? false,
      // 01-P14「被谁封的」。2026-08-02 改判为**可投影**：`sealed` 事件的 public payload
      // 一直带 `by`，行动记录早就在渲染「被老白封印了技能」，快照瞒着它只是让 UI 写不出
      // 解封条件。压制层读的真相仍是上面的 statuses，这里只服务文案。
      sealedBy: b?.sealedBy?.[i] ?? null,
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
    // 无色牌定色被锁到哪个色（专精 / 五彩 / 行进曲三合一）。判据整条来自引擎，
    // 客户端不再自己认技能与状态——它只负责把这个色画成唯一那个色块
    wildColorLock: b ? (requiredColor(b, seat) ?? null) : null,
    // 02 §5：弃牌堆全公开
    discardPile: b?.discardPile ?? [],
    // 出牌堆整条也全公开（每张都被所有人亲眼见过）。方向照牌桌原样给：`[0]` 是牌顶，
    // 与 discardPile 相反——引擎不替 UI 调顺序，要正序的自己 reverse
    playedPile: b?.playedPile ?? [],
    // 标记上限（标记名 → 上限），从技能定义读。没有上限的标记不在表里，缺席 ≠ 上限 0
    marksCap: marksCap(),
    drawPileCount: b?.drawPile.length ?? 0,
    drawnPlayable: b?.drawnPlayable ?? null,
    punish: b?.punish,
    pendingWindow: projectWindow(state.pendingWindow, seat),
    // 骰子当众掷：点数公开。续跑指令（resume）是引擎内部的事，**整个**不进快照——
    // 只从里面挑出血棘①的受害者，因为 UI 要写「谁摸这些牌」。
    dice: dice && {
      seat: dice.seat,
      reason: dice.reason,
      values: dice.values,
      target: dice.resume.kind === "bloodthorn" ? dice.resume.target : undefined,
    },
    // 攒魂窗口：宣言当众、已摸张数公开（见 SoulHarvest 的注释）。queue/effectKey 是内部记账
    soulHarvest: sh && { seat: sh.seat, declared: sh.declared, drawn: sh.drawn },
    // 司夜②：只有「谁跟谁换」是公开的。`cardId` 是暗信息，绝不投影
    swap: sw && { seat: sw.seat, target: sw.target },
    // 洗牌牌：打的是①还是②公开（卡面选择当众）
    shufflePending: sp && { seat: sp.seat, choice: sp.choice },
    // 摸 N 弃 N：要弃几张公开（UI 得画「挑 N 张」）。`drawnIds` 是暗信息，绝不投影
    drawDiscard: dd && { seat: dd.seat, picks: dd.picks },
    // 「要不要摸 N 弃 N」（合纵/连横② 与 神授♥5 共用）：只投「谁、几张」，
    // `req`/`resume` 是引擎的续跑指令，不投
    drawOffer: off && { seat: off.seat, picks: off.req.base },
    // 结盟当众成立，谁跟谁是公开信息
    alliance: b?.alliance,
    // 近卫♥6 的交牌窗口：交给谁、最多几张。链是公开的，这两项也就没有暗信息
    handOver: b?.handOver,
    // 当前选中的技能分支（吟游♣5 的歌声）：当众选的，全场公开
    chosen: b?.chosen,
    windowId: windowIdOf(state),
    // U7b：谁在补喊宽限里、到什么时候。公开（抓不抓得着本来就是全场同步的信息），
    // UI 拿它把抓按钮压到点再画；引擎侧 `catchUno` 另有一道 `uno_grace` 的硬拒
    unoGrace: b?.unoGrace,
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
