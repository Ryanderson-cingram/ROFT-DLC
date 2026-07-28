import { describe, expect, it } from "vitest";
import { applyAction } from "../src/index.ts";
import { buildDeck, shuffle } from "../src/deck.ts";
import type { Ctx, GameState } from "../src/types.ts";

/** 确定性伪随机源，只用于测试——引擎自身永远不产生随机数（spec §5.1）。 */
export const lcg = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

export const lobby = (n: number): GameState => ({
  version: 0,
  phase: "lobby",
  seats: Array.from({ length: n }, (_, i) => ({ userId: `u${i}` })),
});

export const ctx = (rng = lcg(1), now = "2026-07-28T12:00:00.000Z"): Ctx => ({ rng, now });

export const start = (n = 3, c: Ctx = ctx()) =>
  applyAction(lobby(n), { type: "startGame", seat: 0 }, c);

describe("startGame", () => {
  it("S1b: deals 7 cards to every player", () => {
    for (const n of [3, 4]) {
      const b = start(n).state.board!;
      expect(b.hands).toHaveLength(n);
      for (const hand of b.hands) expect(hand).toHaveLength(7);
    }
  });

  it("S1b: draw pile is the base pack minus dealt cards and the starter", () => {
    for (const n of [3, 4]) {
      const b = start(n).state.board!;
      expect(b.drawPile).toHaveLength(164 - 7 * n - 1);
      expect(b.discardPile).toHaveLength(1);
    }
  });

  it("S1b: no card is lost or duplicated by dealing", () => {
    const b = start(4).state.board!;
    const all = [...b.drawPile, ...b.discardPile, ...b.hands.flat()];
    expect(all).toHaveLength(164);
    expect(new Set(all.map((c) => c.id)).size).toBe(164);
  });

  it("S1b: play begins at seat 0 in turnStart with the starter's colour active", () => {
    const r = start(3);
    expect(r.rejected).toBeUndefined();
    expect(r.state.phase).toBe("turnStart");
    expect(r.state.version).toBe(1);
    const b = r.state.board!;
    expect(b.currentSeat).toBe(0);
    expect(b.direction).toBe(1);
    expect(b.activeColor).toBe(b.discardPile[0].color);
  });

  it("U3: the starter is always a coloured card, re-flipping past wild/+4", () => {
    let wouldHaveBeenColourless = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const b = start(3, ctx(lcg(seed))).state.board!;
      expect(b.discardPile[0].color).not.toBeNull();
      expect(b.activeColor).not.toBeNull();
      expect(b.drawPile).toHaveLength(164 - 21 - 1);
      // 同一 rng 下若原本翻到的是无色牌，说明这一 seed 走了重翻分支
      if (shuffle(buildDeck("base"), lcg(seed))[21].color === null) wouldHaveBeenColourless++;
    }
    expect(wouldHaveBeenColourless).toBeGreaterThan(0);
  });

  it("rejects a start outside the lobby", () => {
    const started = start(3).state;
    const r = applyAction(started, { type: "startGame", seat: 0 }, ctx());
    expect(r.rejected?.reason).toBe("not_in_lobby");
    expect(r.state).toBe(started);
  });

  it("rejects seat counts outside 3-4 (MVP scope, spec §1)", () => {
    for (const n of [2, 5]) {
      const r = applyAction(lobby(n), { type: "startGame", seat: 0 }, ctx());
      expect(r.rejected?.reason).toBe("bad_seat_count");
    }
  });

  it("spec §4: public events carry counts only, hands go through the private projection", () => {
    const r = start(3);
    const ids = r.state.board!.hands.flat().map((c) => c.id);
    for (const e of r.events) {
      const pub = JSON.stringify(e.public);
      for (const id of ids) expect(pub).not.toContain(id);
    }
    for (let seat = 0; seat < 3; seat++) {
      const mine = r.events.find((e) => e.type === "handDealt" && e.private?.seat === seat);
      expect(mine?.private?.payload.cards).toEqual(r.state.board!.hands[seat]);
      expect(mine?.public).toEqual({ seat, count: 7 });
    }
  });

  it("does not mutate the input state", () => {
    const before = lobby(3);
    const snapshot = JSON.stringify(before);
    applyAction(before, { type: "startGame", seat: 0 }, ctx());
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
