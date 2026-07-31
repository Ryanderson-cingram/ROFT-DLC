import { describe, expect, it } from "vitest";
import { engineRejectReasons } from "@/test-support/engine-vocab";
import { humanReason } from "./api";

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
