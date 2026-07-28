export type Phase = "lobby" | "dealing" | "turnStart" | "play" | "afterPlay";
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
