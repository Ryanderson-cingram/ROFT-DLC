import { describe, expect, it } from "vitest";
import { applyAction, projectView, type GameState } from "../src/index.ts";

const base: GameState = { version: 3, phase: "play", seats: [{ userId: "u1" }, { userId: "u2" }, { userId: "u3" }] };
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
