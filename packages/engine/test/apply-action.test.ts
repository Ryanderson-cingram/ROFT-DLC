import { describe, expect, it } from "vitest";
import { applyAction, projectView, type GameState, type Seat } from "../src/index.ts";

const seat = (userId: string): Seat => ({
  userId, name: userId, hand: [], saidUno: false, apotheosis: 0, skillId: null,
});

const base: GameState = {
  version: 3, phase: "play", config: { rulePack: "base", skillDraft: "draft3" },
  seats: [seat("u1"), seat("u2"), seat("u3")],
  currentSeat: 0, direction: 1, drawPile: [], discardPile: [], activeColor: null,
  roundsLeft: 1, drawnPlayable: null, punish: null, pendingWindow: null, winner: null,
};
const ctx = { rng: () => 0.5, now: "2026-07-28T00:00:00Z" };

describe("applyAction", () => {
  it("ping bumps version and emits event, without mutating input", () => {
    const r = applyAction(base, { type: "ping", seat: 0 }, ctx);
    expect(r.rejected).toBeUndefined();
    expect(r.state.version).toBe(4);
    expect(r.events).toEqual([{ type: "pinged", public: { seat: 0 } }]);
    expect(base.version).toBe(3); // 不可变
  });
  it("rejects unknown seat", () => {
    const r = applyAction(base, { type: "ping", seat: 9 }, ctx);
    expect(r.rejected?.reason).toBe("invalid_seat");
    expect(r.state).toBe(base);
  });
  it("projectView hides other seats' identity", () => {
    expect(projectView(base, 1)).toEqual({ version: 3, phase: "play", youSeat: 1 });
  });
});
