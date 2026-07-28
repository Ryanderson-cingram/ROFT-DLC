import { describe, expect, it } from "vitest";
import { applyAction } from "../src/index.ts";
import { ctx, lobby } from "./helpers.ts";

describe("applyAction", () => {
  it("rejects an out-of-range seat before touching any rule", () => {
    const s = lobby(3);
    const r = applyAction(s, { type: "startGame", seat: 9 }, ctx());
    expect(r.rejected?.reason).toBe("invalid_seat");
    expect(r.state).toBe(s);
  });

  it("rejects an unknown action type", () => {
    const s = lobby(3);
    const r = applyAction(s, { type: "nope", seat: 0 } as never, ctx());
    expect(r.rejected?.reason).toBe("unknown_action");
    expect(r.state).toBe(s);
  });

  it("bumps the version on every accepted action", () => {
    const r = applyAction(lobby(3), { type: "startGame", seat: 0 }, ctx());
    expect(r.state.version).toBe(1);
  });
});
