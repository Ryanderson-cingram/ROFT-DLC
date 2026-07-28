import type { Action, ApplyResult, Ctx, GameState } from "./types.ts";
export * from "./types.ts";

export function applyAction(state: GameState, action: Action, _ctx: Ctx): ApplyResult {
  if (action.seat < 0 || action.seat >= state.seats.length)
    return { state, events: [], rejected: { reason: "invalid_seat" } };
  switch (action.type) {
    case "ping":
      return { state: { ...state, version: state.version + 1 }, events: [{ type: "pinged", public: { seat: action.seat } }] };
    default:
      return { state, events: [], rejected: { reason: "unknown_action" } };
  }
}

export function projectView(state: GameState, seat: number) {
  return { version: state.version, phase: state.phase, youSeat: seat };
}
