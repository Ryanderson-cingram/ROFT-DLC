import type { ApplyResult, Board, Card, Color, Face, GameState } from "./types.ts";

export const reject = (state: GameState, reason: string): ApplyResult => ({ state, events: [], rejected: { reason } });

/**
 * 窗口 id 默认由版本号派生，所以窗口一被结算（`commit` 清窗口 + version++）旧 id 立刻失效。
 * 例外是 U6/U7 那两个不走 commit 的动作：它们 version+1 却保留窗口，会凭空作废别人手上的
 * id。所以 `uno.ts::bump` 在涨版本前把当下的 id 冻进窗口，这里认冻结值优先。
 */
export const windowIdOf = (state: GameState): string | undefined =>
  state.pendingWindow && (state.pendingWindow.id ?? `w${state.version}:${state.pendingWindow.type}`);

/**
 * U6（2026-08-01 改判）：声明的作用域是「你的这个回合」。
 * 回合内怎么波动都不清（并列被截剩牌回手、恒心弃 1 摸 1、洗牌②摸 1 弃 1 都要穿过 1 张），
 * 交回合那一刻由 `passTurn` 统一结算；回合之外沿用旧口径——手牌一离开 1 张立刻作废。
 */
export const syncUno = (board: Board): Board => ({
  ...board,
  saidUno: board.saidUno.map((v, i) => v && (i === board.currentSeat || board.hands[i].length === 1)),
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
): Pick<Board, "currentSeat" | "activatedThisTurn" | "saidUno" | "unoGrace"> => ({
  currentSeat: nextSeat(b, from, step),
  activatedThisTurn: b.activatedThisTurn.map(() => false),
  saidUno: b.saidUno.map((v, i) => v && b.hands[i].length === 1),
  // U7b：交回合后给离场者 1 秒补喊。无条件开——他此刻是不是持 1 张无所谓，
  // `catchable` 本来就还要看手牌数，这里只负责「谁、到什么时候之前抓不得」。
  unoGrace: { seat: from, until: new Date(Date.parse(now) + UNO_GRACE_MS).toISOString() },
});
