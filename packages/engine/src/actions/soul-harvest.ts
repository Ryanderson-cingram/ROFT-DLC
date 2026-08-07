/**
 * 影歌♦3① 的攒魂窗口（04 ♦3 的 2026-07-30 补齐流程 / 01-S15 / 06-Q46 / 06-Q56）。
 *
 * 窗口语义是 `skillDraft`「收集全员」的**依次轮转**变体：全场其他人都要各结一次，
 * 但一次只有一个 actor——自发动者的下家起按 `direction` 轮一圈，结完一个换下一个。
 * 上下文（宣言、队列、已摸张数）挂在 `board.soulHarvest`，因为 `commit` 会清窗口，
 * 所以窗口对象每次都重建（deadline 顺延），跟 draft.ts::assign 一个路数。
 *
 * 比对对象是发动者**当众指定的色+数**，与牌顶无关，也不要求他手里有那张牌。
 */
import { drawCards, drawEvents, giveTo } from "./draw.ts";
import { WINDOW_MS, commit, isNumberCard, nextSeat, reject } from "../legal.ts";
import { paramsOf } from "../skills/params.ts";
import { gainMarks, markCount } from "../skills/primitives/marks.ts";
import type { SkillData } from "../skills/draw-passives.ts";
import type {
  Action,
  ApplyResult,
  Board,
  Card,
  Color,
  Ctx,
  EngineEvent,
  GameState,
  SoulHarvest,
} from "../types.ts";

const COLORS: Color[] = ["R", "G", "B", "Y"];

/** 三选一。`draw3` 是「亮不出或不愿亮」，也是超时的默认。 */
const CHOICES = ["show-exact", "show-partial", "draw3"] as const;
type Choice = (typeof CHOICES)[number];

/** 亮出的这张牌与宣言牌匹配得上吗。exact = 同色且同数，partial = 同色或同数。 */
const matches = (c: Card, d: SoulHarvest["declared"], choice: Choice) =>
  choice === "show-exact" ? c.color === d.color && c.face === d.face : c.color === d.color || c.face === d.face;

/** 窗口对象由上下文派生：当前 actor 恒为队首，deadline 每轮转重算（每人 30s）。 */
const withWindow = (state: GameState, h: SoulHarvest, now: string): GameState => ({
  ...state,
  pendingWindow: {
    type: "soulHarvest",
    actors: [h.queue[0]],
    deadline: new Date(Date.parse(now) + WINDOW_MS).toISOString(),
    defaultChoice: "draw3",
    resume: "turnStart",
  },
});

/**
 * 可以被宣言的牌面：四色 × **1–9**（04 2026-08-02 裁定）。
 *
 * 0 每色 2 张、1–9 每色 3 张（05 §3 的构成表），宣言 0 时别人亮得出同数的概率只有其余牌面的
 * 三分之二，攒魂期望更高——它是**严格占优**的一手，留着等于让其余 36 个选项形同虚设。
 *
 * 只管宣言：0 照旧是数字牌，U5 的「只有数字牌能打完获胜」不受影响——所以是在这里多判一条，
 * **不是**去改 `isNumberCard`（那条被收官判定共用）。
 */
const isDeclarable = (d: SoulHarvest["declared"]) => isNumberCard(d) && d.face !== "0";

/**
 * 发动①：校验宣言并开窗口。响应顺序 = 自发动者下家起按 direction 轮一圈（不含发动者）。
 * **不校验发动者手里有没有**——他本来就可以空口指定。
 */
export function openHarvest(
  state: GameState,
  b: Board,
  seat: number,
  effectKey: string,
  declared: SoulHarvest["declared"] | undefined,
  ctx: Ctx,
): ApplyResult {
  if (!declared) return reject(state, "declaration_required");
  if (!COLORS.includes(declared.color) || !isDeclarable(declared)) return reject(state, "bad_declaration");

  const queue = b.hands.map((_, i) => nextSeat(b, seat, i + 1)).slice(0, b.hands.length - 1);
  const harvest: SoulHarvest = { seat, declared, queue, drawn: 0, effectKey };
  return {
    // 宣言是当众的，所以进 public
    state: withWindow(commit(state, { ...b, soulHarvest: harvest }), harvest, ctx.now),
    events: [{ type: "soulHarvestStarted", public: { seat, declared, actors: queue } }],
  };
}

/**
 * 当前 actor 交卷。由 punish.ts 的 respond / claimTimeout 在通用校验之后转来。
 * 校验不过（亮的牌不匹配、不在手里）→ reject，局面不动，他可以重选。
 */
export function settleHarvest(
  state: GameState,
  action: { seat: number; choice: string; cardIds?: string[] },
  ctx: Ctx,
  data: SkillData,
): ApplyResult {
  const b = state.board!;
  const h = b.soulHarvest;
  if (!h) return reject(state, "no_window");
  const choice = action.choice as Choice;
  if (!CHOICES.includes(choice)) return reject(state, "bad_choice");
  // 数值全从发动者那条子效果的定义里读：摸几张、魂上限都不该在这里写死
  const p = paramsOf(b.skills[h.seat] ?? "", h.effectKey, data.byId);

  const events: EngineEvent[] = [];
  let base = 0;
  let shown: Card | undefined;
  if (choice === "draw3") {
    base = p.counts.draws ?? 0;
  } else {
    if (action.cardIds?.length !== 1) return reject(state, "bad_choice");
    shown = b.hands[action.seat].find((c) => c.id === action.cardIds![0]);
    if (!shown) return reject(state, "not_in_hand");
    if (!matches(shown, h.declared, choice)) return reject(state, "bad_choice");
    // 同色且同数 = 不摸；同色或同数 = 摸 draws_partial 张
    base = choice === "show-partial" ? (p.counts.draws_partial ?? 0) : 0;
  }
  // 亮出 = 展示给所有人（牌不离手），所以那张进 public
  events.push({ type: "soulHarvestResponse", public: { seat: action.seat, choice, card: shown ?? null } });

  let board = b;
  let got = 0;
  if (base > 0) {
    // 06-Q56：发起者是影歌持有者，所以这是「他人技能造成的摸牌」，响应者的恩惠可以减
    const r = drawCards(b, { kind: "skill", base, seat: action.seat, initiator: h.seat }, ctx.rng);
    board = { ...r.board, hands: giveTo(r.board, action.seat, r.drawn) };
    got = r.drawn.length;
    events.push(...drawEvents(action.seat, r.drawn, r.reshuffledOrder));
  }

  // 06-Q46：魂按**实际摸到**的张数计，不是「该摸几张」
  const next: SoulHarvest = { ...h, queue: h.queue.slice(1), drawn: h.drawn + got };
  // 还有人没响应：窗口重建给下一个 actor（deadline 顺延），commit 会清窗口所以手动接回去
  if (next.queue.length > 0)
    return { state: withWindow(commit(state, { ...board, soulHarvest: next }), next, ctx.now), events };

  const { soulHarvest: _done, ...cleared } = board;
  // 攒的**是哪个标记、上限多少**都从定义的 `mark_cap` 读（04 ♦3 = `{ 魂: 6 }`），
  // 本文件不写「魂」这两个字——03 §5 的标记名是开放集合，写死就是第二份真相。
  // 一条效果只攒一个标记（首批十技能如此），所以取首项；定义没标就一个都不给。
  const [mark, cap] = Object.entries(p.markCap)[0] ?? ["", undefined];
  const ended = mark ? gainMarks(cleared, h.seat, mark, next.drawn, cap) : cleared;
  return {
    state: commit(state, ended, state.pendingWindow!.resume),
    events: [
      ...events,
      {
        type: "soulHarvestEnded",
        public: { seat: h.seat, gained: next.drawn, souls: markCount(ended, h.seat, mark) },
      },
    ],
  };
}

/**
 * 攒魂窗口里当前 actor 的合法动作。三选一里「亮牌」那两条按手牌逐张给出——
 * 客户端不判匹配，它只把这里给的动作原样渲染成按钮。
 *
 * 完美匹配的牌**两条都给**（2026-07-31 裁定）：它确实同时满足「同色且同数」与「同色或同数」，
 * 走②多摸 1 张虽然纯亏，但选不选是玩家自己的事，引擎不替他做决定。
 * 所有亮得出去的牌都会出现在这里，UI 照单高亮。
 */
export function harvestActions(b: Board, seat: number, windowId: string): Action[] {
  const d = b.soulHarvest!.declared;
  return [
    ...b.hands[seat].flatMap((c): Action[] =>
      CHOICES.filter((choice) => choice !== "draw3" && matches(c, d, choice)).map(
        (choice): Action => ({ type: "respond", seat, windowId, choice, cardIds: [c.id] }),
      ),
    ),
    { type: "respond", seat, windowId, choice: "draw3" },
  ];
}
