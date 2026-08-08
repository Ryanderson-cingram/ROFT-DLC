import { globalColorLock } from "./skills/bard.ts";
import { specialtyColor } from "./skills/specialty.ts";
import { SKILL_DATA } from "./skills/draw-passives.ts";
import { hasStatus, RAINBOW } from "./skills/primitives/statuses.ts";
import type { ApplyResult, Board, Card, Color, Face, GameState } from "./types.ts";

export const reject = (state: GameState, reason: string): ApplyResult => ({ state, events: [], rejected: { reason } });

/**
 * 窗口 id 默认由版本号派生，所以窗口一被结算（`commit` 清窗口 + version++）旧 id 立刻失效。
 * 例外是 U6/U7 那两个不走 commit 的动作：它们 version+1 却保留窗口，会凭空作废别人手上的
 * id。所以 `uno.ts::bump` 在涨版本前把当下的 id 冻进窗口，这里认冻结值优先。
 */
export const windowIdOf = (state: GameState): string | undefined =>
  state.pendingWindow && (state.pendingWindow.id ?? `w${state.version}:${state.pendingWindow.type}`);

/** U6：这个座位**本回合按过** UNO 键吗。老状态没有这一格，一律当作没按过。 */
export const calledThisTurn = (b: Board, seat: number): boolean => b.unoThisTurn?.[seat] ?? false;

/**
 * U6（2026-08-01 改判）：声明的作用域是「你的这个回合」。
 * 回合内怎么波动都不清（并列被截剩牌回手、恒心弃 1 摸 1、洗牌②摸 1 弃 1 都要穿过 1 张），
 * 交回合那一刻由 `passTurn` 统一结算；回合之外沿用旧口径——手牌一离开 1 张立刻作废。
 *
 * 「回合内不清」只保护**本回合按过按钮**的声明（2026-08-08 澄清）。上一个回合末成立、
 * 结转进来的那一份不在保护范围内：它跟着那 1 张牌存续，手牌一离开 1 张就作废——
 * 否则「上一轮喊过 → 这一轮摸 1 张」会一路顶着徽记走到回合末，再被虚喊结算平白罚 2。
 */
export const syncUno = (board: Board): Board => ({
  ...board,
  saidUno: board.saidUno.map(
    (v, i) => v && ((i === board.currentSeat && calledThisTurn(board, i)) || board.hands[i].length === 1),
  ),
});

/** U8：一局最多把出牌堆（除顶）与弃牌堆洗回摸牌堆 2 次。 */
export const MAX_RESHUFFLES = 2;

/**
 * U7b（2026-08-02）：交回合之后，**刚交出回合的那个座位**有这么久的补喊宽限，抓不得。
 * 没有它，「忘喊可补、补喊与抓先到先得」在实战里兑现不了——抓的人可以把光标压在按钮上
 * 等着，被抓者还要先看到自己回合结束。调大这一个常量就能放宽。
 */
export const UNO_GRACE_MS = 1_000;

/**
 * 反应窗口的时限：惩罚叠链、劫营打断、掷骰接管、摸 N 弃 N、结盟、近卫交牌、洗牌取消、
 * 攒魂亮牌、阳谋……**一律这么久**。
 *
 * 从前这个数在九个文件里各写了一份（`punish` / `raid` / `dice` / `shuffle-card` /
 * `nightlord` / `soul-harvest` / `draw-discard` / `alliance` / `guard`），
 * 于是「窗口给多久」这件事有九份真相：调一次要改九处，漏一处就是一桌上两种节奏。
 * 收成一个之后，真人测试要放宽（摸 8 弃 8 / 交牌 / 结盟都得挑牌，30 秒偏紧）只动这里。
 *
 * 开局抽 3 选 1 **不用**这个数：那一步要读技能说明，自有 `DRAFT_WINDOW_MS`（60s）。
 */
export const WINDOW_MS = 30_000;

/**
 * U8 平局条件：洗满 2 次之后摸牌堆再度见底，且还没有人获胜。
 * 判的是**牌堆状态**而不是「没人能动了」——所以它是确定性的：同一个牌桌永远给同一个答案。
 */
export const stalemate = (b: Board) =>
  b.winner === undefined && b.drawPile.length === 0 && (b.reshuffles ?? 0) >= MAX_RESHUFFLES;

/**
 * 把牌桌换成新的，version + 1；输入 state 永不修改。
 * 任何状态转换默认关闭反应窗口——要开窗口的转换自己再挂上去。
 * U6 的「回合外已喊随手牌数作废」也在这里统一执行，没有哪条路径能绕开
 * （回合**内**的那一半由 passTurn 在交回合时结算）。
 */
export const commit = (state: GameState, board: Board, phase: GameState["phase"] = state.phase): GameState => ({
  ...state,
  version: state.version + 1,
  phase,
  board: syncUno(board),
  pendingWindow: undefined,
});

/** 无色牌：变色 / +4（诸神包的毒、洗牌同样无色）。 */
export const isWild = (c: Card) => c.color === null;

/** U5：功能牌不能作为最后一张牌结束游戏，只有数字牌能打完获胜。 */
const NUMBER_FACES = new Set<Face>(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
// 只看牌面，所以收「有牌面的东西」——影歌①宣言的是色+数而不是一张真牌，用的是同一条判定。
// 正着列举数字面而不是反着排除功能面：宣言的牌面是**客户端送上来的**，反着排除会把
// "42" / "abc" 这种根本不存在的牌面当成数字牌放行（谁都亮不出来 = 全场必摸）。
export const isNumberCard = (c: { face: Face }) => NUMBER_FACES.has(c.face);

/**
 * U1/U3 单张出牌合法性：同色 / 同牌面 / 无色牌任意时候可打。
 * 跟色比的是 `activeColor` 而不是 `top.color`——打过变色牌后两者不同。
 * 牌面同理：并列♥4 打完后跟的是 `activeFace`，缺席才回落到堆顶那张的牌面。
 */
export function isPlayable(c: Card, top: Card, activeColor: Color | null, activeFace?: Face | null): boolean {
  return isWild(c) || c.color === activeColor || c.face === (activeFace ?? top.face);
}

/**
 * **这个座位**此刻能不能打出这张牌 = U1/U3 接得上 + 03 §4 的状态限制。
 * 出牌的每条路径（出牌校验、并列首张、legalActions、U1 摸到即可打）都问它，
 * 不再各自直接问 `isPlayable`——少问一处，那条路上的状态限制就漏判了。
 *
 * 五彩（03 §4）：**不能打出「只是颜色相同」的牌**。同牌面照打，无色牌（变色/+4/毒/洗牌）
 * 照打——它们本来就不是靠颜色接上的。心盲/恋战另有各自的执行面，不在这里。
 */
export function playableFor(b: Board, seat: number, c: Card): boolean {
  // 专精♥9②：当前跟色正好是**你的色**时，任意数字牌都打得出（04 ♥9）
  if (isNumberCard(c) && specialtyColor(b, seat, SKILL_DATA) === b.activeColor) return true;
  if (!isPlayable(c, b.playedPile[0], b.activeColor, b.activeFace)) return false;
  if (hasStatus(b, seat, RAINBOW) && !isWild(c) && c.face !== (b.activeFace ?? b.playedPile[0].face)) return false;
  return true;
}

/**
 * **使用变色牌时不能改变颜色**——牌照打，色只能定成当前跟色。两个来源共用这一条判定：
 * 03 §4 的**五彩**（只管带状态的那个人）与吟游♣5 的**行进曲**（06-Q64，全场生效）。
 * 出牌与洗牌③的取消牌是两条路，都要问它（两条路都能用无色牌定色）。
 * 跟色还没定过（开局翻出无色牌）时无色可守，照常让他选。
 */
export function requiredColor(b: Board, seat: number): Color | null {
  // 专精♥9③：变色牌**只能选你的色**。它比「维持跟色」更具体，所以排在前面
  const specialty = specialtyColor(b, seat, SKILL_DATA);
  if (specialty) return specialty;
  // 五彩（03 §4）与行进曲（吟游♣5，06-Q64）要的是同一件事：色维持原样
  if (hasStatus(b, seat, RAINBOW) || globalColorLock(b, SKILL_DATA)) return b.activeColor;
  return null;
}

export const colorLocked = (b: Board, seat: number, chosen: Color | undefined): boolean => {
  const need = requiredColor(b, seat);
  return !!need && chosen !== need;
};

/**
 * 从**自己**手牌里挑 `ids` 那几张：张数在 `[min, max]`、都在手上、没有重复。
 * 三条都是硬校验——组合不进 `legalActions`（会爆炸），客户端凑什么上来都不作数。
 * 通过返回牌，不通过返回拒因（摸 N 弃 N 与近卫的交牌共用这一处）。
 */
export function pickFromHand(b: Board, seat: number, ids: string[], min: number, max: number): Card[] | string {
  // 同一张报两遍只会掉一张，静默放过就是白赚
  if (ids.length < min || ids.length > max || new Set(ids).size !== ids.length) return "bad_shape";
  const cards = ids.map((id) => b.hands[seat].find((c) => c.id === id));
  return cards.some((c) => !c) ? "not_in_hand" : (cards as Card[]);
}

export const nextSeat = (b: Board, from = b.currentSeat, step = 1) => {
  const n = b.hands.length;
  return (((from + b.direction * step) % n) + n) % n;
};

/**
 * 交出回合。V7 的「每回合一条主动」额度在这里清零——所有换手的路径都得走它，
 * 否则漏掉一条就会出现「上回合发动过、这回合发动不了」的偶发 bug。
 *
 * U6 的声明结算也在这里：交回合那一刻**没有人**在「自己的回合」里，所以一律按
 * 「手牌恰为 1」判——离场者的回合内宽限到此为止，接手者带进来的旧声明同理
 * （洗牌①重分会在同一次 commit 里既换手牌又换手，只靠 syncUno 会把接手者漏掉）。
 * 调用时 `b` 必须是**结算完的**牌桌（摸完/弃完），否则这一步按旧手牌数判。
 */
export const passTurn = (
  b: Board,
  now: string,
  from = b.currentSeat,
  step = 1,
): Pick<Board, "currentSeat" | "activatedThisTurn" | "saidUno" | "unoThisTurn" | "unoGrace"> => ({
  currentSeat: nextSeat(b, from, step),
  activatedThisTurn: b.activatedThisTurn.map(() => false),
  saidUno: b.saidUno.map((v, i) => v && b.hands[i].length === 1),
  // 「本回合按过」的额度跟 `activatedThisTurn` 一起清零：存续下去的只有声明本身
  unoThisTurn: b.saidUno.map(() => false),
  // U7b：交回合后给离场者 1 秒补喊。无条件开——他此刻是不是持 1 张无所谓，
  // `catchable` 本来就还要看手牌数，这里只负责「谁、到什么时候之前抓不得」。
  unoGrace: { seat: from, until: new Date(Date.parse(now) + UNO_GRACE_MS).toISOString() },
});
