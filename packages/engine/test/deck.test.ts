import { describe, expect, it } from "vitest";
import { buildDeck, shuffle } from "../src/deck.ts";
import type { Card, Color, Face } from "../src/types.ts";

const COLORS: Color[] = ["R", "G", "B", "Y"];
const count = (deck: Card[], color: Color | null, face: Face) =>
  deck.filter((c) => c.color === color && c.face === face).length;

describe("buildDeck (05-gods-omens-deck §3)", () => {
  const base = buildDeck("base");
  const gods = buildDeck("gods");

  it("§3: each colour has 2 zeros", () => {
    for (const c of COLORS) expect(count(base, c, "0")).toBe(2);
  });

  it("§3: each colour has 3 of every 1-9", () => {
    for (const c of COLORS)
      for (const n of ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as Face[])
        expect(count(base, c, n)).toBe(3);
  });

  it("§3: each colour has 3 +2, 4 skip, 2 reverse", () => {
    for (const c of COLORS) {
      expect(count(base, c, "+2")).toBe(3);
      expect(count(base, c, "skip")).toBe(4);
      expect(count(base, c, "rev")).toBe(2);
    }
  });

  it("§3: 4 wild and 8 wild+4, all colourless", () => {
    expect(count(base, null, "wild")).toBe(4);
    expect(count(base, null, "+4")).toBe(8);
  });

  it("§3: base pack is 164 cards and excludes poison/shuffle", () => {
    expect(base).toHaveLength(164);
    expect(base.some((c) => c.face === "poison" || c.face === "shuffle")).toBe(false);
  });

  it("§3: gods pack is the full 172 with 5 poison and 3 shuffle", () => {
    expect(gods).toHaveLength(172);
    expect(count(gods, null, "poison")).toBe(5);
    expect(count(gods, null, "shuffle")).toBe(3);
  });

  it("§3: every card has a unique id", () => {
    expect(new Set(gods.map((c) => c.id)).size).toBe(172);
  });
});

describe("shuffle", () => {
  const deck = buildDeck("base");

  it("is deterministic for a given rng", () => {
    const a = shuffle(deck, () => 0.5);
    const b = shuffle(deck, () => 0.5);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it("preserves length and the multiset of cards", () => {
    const out = shuffle(deck, () => 0.5);
    expect(out).toHaveLength(deck.length);
    expect(out.map((c) => c.id).sort()).toEqual(deck.map((c) => c.id).sort());
  });

  it("returns a new array and does not mutate the input", () => {
    const before = deck.map((c) => c.id);
    const out = shuffle(deck, () => 0.5);
    expect(out).not.toBe(deck);
    expect(deck.map((c) => c.id)).toEqual(before);
  });

  it("actually reorders (not the identity permutation)", () => {
    const out = shuffle(deck, () => 0.5);
    expect(out.map((c) => c.id)).not.toEqual(deck.map((c) => c.id));
  });
});
