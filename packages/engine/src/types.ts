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
export interface GameState {
  version: number;
  phase: Phase;
  seats: { userId: string }[];
  pendingWindow?: PendingWindow;
}
export type Action =
  | { type: "ping"; seat: number }
  | { type: "respond"; seat: number; windowId: string; choice: string };
export interface EngineEvent { type: string; public: Record<string, unknown>; private?: { seat: number; payload: Record<string, unknown> } }
export interface Ctx { rng: () => number; now: string }
export interface ApplyResult { state: GameState; events: EngineEvent[]; rejected?: { reason: string } }
