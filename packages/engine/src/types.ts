export type Phase = "lobby" | "dealing" | "turnStart" | "play" | "afterPlay";

export type RulePack = "base" | "gods";
export type Color = "R" | "G" | "B" | "Y";
/** 牌面。数字牌 0–9；功能牌 +2/停/转；无色牌 变色/+4；诸神包 毒/洗牌。 */
export type Face =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "+2" | "skip" | "rev"
  | "wild" | "+4"
  | "poison" | "shuffle";
/** `color === null` = 无色牌（变色 / +4 / 毒 / 洗牌）。`id` 在一副牌内唯一。 */
export interface Card { id: string; color: Color | null; face: Face }

export interface PendingWindow {
  type: string;
  actors: number[];          // seat 下标
  deadline: string;          // ISO 时间戳（由 Edge 注入的 ctx.now 计算）
  defaultChoice: string;
  resume: Phase;
}
/** 一局开跑后的牌桌。`lobby` 阶段没有牌桌，故 `GameState.board` 可选。 */
export interface Board {
  rulePack: RulePack;
  drawPile: Card[];
  /** `[0]` 是弃牌堆顶。 */
  discardPile: Card[];
  /** 按座位下标。 */
  hands: Card[][];
  /** 跟色比的是这个，不是牌堆顶那张牌的原色（打过变色牌后两者不同）。 */
  activeColor: Color | null;
  currentSeat: number;
  direction: 1 | -1;
  saidUno: boolean[];
  /** 本轮技能未实现（S1/S2 的持有槽位，只存不用）。 */
  skills: (string | null)[];
  /** U1：刚摸到且可打的那张牌；非 null 时本回合只能打它或结束回合。 */
  drawnPlayable?: Card | null;
  punish?: PunishChain;
  winner?: number;
}
/** P6：每段贡献在打出进链时结算，只作用于自己那一张，所以逐段存。 */
export interface PunishSegment { seat: number; face: "+2" | "+4"; draw: number }
export interface PunishChain { initiator: number; segments: PunishSegment[]; total: number }
export interface GameState {
  version: number;
  phase: Phase;
  seats: { userId: string }[];
  pendingWindow?: PendingWindow;
  board?: Board;
}
export type Action =
  | { type: "ping"; seat: number }
  | { type: "startGame"; seat: number }
  | { type: "playCards"; seat: number; cardIds: string[]; chosenColor?: Color }
  | { type: "drawCard"; seat: number }
  | { type: "endTurn"; seat: number }
  | { type: "claimTimeout"; seat: number; windowId: string }
  | { type: "respond"; seat: number; windowId: string; choice: string };
export interface EngineEvent { type: string; public: Record<string, unknown>; private?: { seat: number; payload: Record<string, unknown> } }
export interface Ctx { rng: () => number; now: string }
export interface ApplyResult { state: GameState; events: EngineEvent[]; rejected?: { reason: string } }
