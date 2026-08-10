import { describe, expect, it } from "vitest";
import { applyAction } from "../src/index.ts";
import type { EngineEvent } from "../src/types.ts";
import { card, ctx, table } from "./helpers.ts";

/**
 * `gameEnded` 是终局的**唯一**事件，胜负与平局共用一条。
 *
 * 它挂在 `applyAction` 的出口（`settleEnd`），而不是逐个补在四条胜利路径上——
 * 这组用例守的就是那个「一处覆盖全部路径」的性质：只要终局了就必然有且只有一条。
 * 平局那一支在 `edge/piles-endgame.test.ts` 里连着 U8 的条件一起验。
 */
describe("gameEnded", () => {
  const ended = (events: EngineEvent[]) => events.filter((e) => e.type === "gameEnded");

  it("打完最后一张 → 发 gameEnded 且带 winner", () => {
    const s = table([[card("R", "5")], [card("B", "3")], [card("G", "9")]]);
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [s.board!.hands[0][0].id] }, ctx());

    expect(r.rejected).toBeUndefined();
    expect(r.state.phase).toBe("finished");
    expect(r.state.board!.winner).toBe(0);
    expect(ended(r.events)).toEqual([{ type: "gameEnded", public: { winner: 0 } }]);
  });

  it("终局事件排在**最后**——它是这一串结算的收尾，不是中间某一步", () => {
    const s = table([[card("R", "5")], [card("B", "3")], [card("G", "9")]]);
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [s.board!.hands[0][0].id] }, ctx());

    expect(r.events.at(-1)!.type).toBe("gameEnded");
  });

  it("还没打完就不发", () => {
    const s = table([[card("R", "5"), card("R", "6")], [card("B", "3")], [card("G", "9")]]);
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [s.board!.hands[0][0].id] }, ctx());

    expect(r.state.phase).not.toBe("finished");
    expect(ended(r.events)).toEqual([]);
  });

  /**
   * 终局之后再跑动作会被 dispatch 拒掉（`wrong_phase`），所以拒了就没有事件——
   * 但 `settleEnd` 自己也带一道 `before.phase !== "finished"` 的闸：将来若有绕过
   * dispatch 的路径，也不会补出第二条终局事件。
   */
  it("终局之后不再补发第二条", () => {
    const s = table([[card("R", "5")], [card("B", "3")], [card("G", "9")]]);
    const won = applyAction(s, { type: "playCards", seat: 0, cardIds: [s.board!.hands[0][0].id] }, ctx());
    const again = applyAction(won.state, { type: "endTurn", seat: 1 }, ctx());

    expect(ended(again.events)).toEqual([]);
  });
});
