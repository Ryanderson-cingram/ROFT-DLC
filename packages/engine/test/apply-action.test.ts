import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../src/index.ts";
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

  // state.version 与 rooms.version 必须是同一个数：客户端拿快照里的 version 当
  // 下一次动作的 expectedVersion，而 CAS 打的是 rooms.version。任何一个被接受
  // 却不推进 state.version 的动作，都会让这两个数永久错开 → 客户端 409 死循环。
  it("every accepted action advances state.version by exactly one", () => {
    let s = applyAction(lobby(3), { type: "startGame", seat: 0 }, ctx()).state;
    expect(s.version).toBe(1);

    // 跑一段真实序列，把出牌 / 摸牌 / 结束回合 / 惩罚窗口都走到
    for (let i = 0; i < 12 && s.phase !== "finished"; i++) {
      const seat = s.pendingWindow?.actors[0] ?? s.board!.currentSeat;
      const next = legalActions(s, seat)[0];
      if (!next) break;
      // legalActions 不带 chosenColor / cardIds——定色与代价都是客户端提交前的模态，不是引擎的事
      if (next.type === "playCards") {
        const c = s.board!.hands[seat].find((x) => x.id === next.cardIds[0])!;
        if (c.color === null) next.chosenColor = "R";
      }
      // 摸 N 弃 N：legalActions 只给一条模板（组合会爆炸），弃哪几张同样是客户端填的
      if (next.type === "respond" && next.choice === "discard" && s.board!.drawDiscard) {
        next.cardIds = s.board!.hands[seat].slice(0, s.board!.drawDiscard.picks).map((c) => c.id);
      }
      if (next.type === "activateSkill") {
        next.cardIds = [s.board!.hands[seat][0].id];
        // 影歌①还要当众指定一张「色+数」（不要求自己手里有），同样是提交前的选择
        next.declared = { color: "B", face: "2" };
      }
      const before = s.version;
      const r = applyAction(s, next, ctx());
      expect(r.rejected, `${next.type} was rejected`).toBeUndefined();
      expect(r.state.version, `${next.type} did not advance version`).toBe(before + 1);
      s = r.state;
    }
    expect(s.version).toBeGreaterThan(3); // 确实跑了几步，不是空转
  });
});
