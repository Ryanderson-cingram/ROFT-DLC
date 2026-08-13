import { describe, expect, it } from "vitest";
import { engineRejectReasons } from "@/test-support/engine-vocab";
import { humanReason, shouldRetry } from "./api";

/**
 * spec §5.3 第 14 条：L2 的唯一落点是「点了被拒时给人话」。
 * 拒因清单从引擎源码 grep 出来，不手抄——引擎新加一条 reject 而 SAYINGS 没跟上就红。
 */

describe("拒因人话（humanReason）", () => {
  it("引擎能吐出的每一条拒因都有人话", () => {
    const reasons = engineRejectReasons();
    // 正则烂掉会让下面那条假绿，先钉一个下限（2026-08-01 实测 53 条）
    expect(reasons.length).toBeGreaterThanOrEqual(50);

    const stillEnglish = reasons.filter((r) => humanReason(r) === `操作没成功（${r}）`);
    expect(stillEnglish).toEqual([]);
  });

  it("人话里不夹带原始英文（除了兜底那一句）", () => {
    for (const r of engineRejectReasons()) expect(humanReason(r)).not.toContain(r);
  });

  it("查不到的才回落到兜底，且带上原因方便报 bug", () => {
    expect(humanReason("brand_new_reason")).toBe("操作没成功（brand_new_reason）");
  });
});

/**
 * 重试策略。它之所以能放宽到 5xx/429，是因为服务端的幂等预检查（room-action）
 * 让「同 key 再来一次」第一次真正安全了——从前那道闸在 RPC 里，
 * 永远等不到重放（引擎先按已经前进的状态把动作拒了）。
 */
describe("重试策略（shouldRetry）", () => {
  it("没拿到响应就重试——可能没发出去，也可能是服务端提交了但回程丢了", () => {
    expect(shouldRetry(0)).toBe(true);
  });

  it("限流与 5xx 重试：动作还没被裁决过", () => {
    for (const s of [429, 500, 502, 503, 504]) expect(shouldRetry(s), `${s} 该重试`).toBe(true);
  });

  it("确定性的 4xx 不重试——重试一万次也是同一个答案", () => {
    // 400 拒因（还没轮到你 / 这张牌接不上）、403 不在这桌、404 没这房、409 版本冲突
    for (const s of [400, 401, 403, 404, 409, 422]) expect(shouldRetry(s), `${s} 不该重试`).toBe(false);
  });

  it("成功不重试", () => {
    for (const s of [200, 201]) expect(shouldRetry(s)).toBe(false);
  });
});
