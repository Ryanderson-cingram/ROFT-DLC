// 压制（02 §2）：某些条件下关掉一个座位的主动技能。
// 做成一层而不是散在各处判断，是因为 §2 把它定义成通用机制，默认源有四个：
// 惩罚回合、血棘封印、技能免疫、预兆「技能暂时失效」。
// 例外写在技能上（如影歌②可在惩罚回合发动，S15）：02 §1 已补 `suppression_exempt`
// 字段（06-Q39，2026-07-30 裁定），由 `suppressesEffect` 逐条读它放行。
import type { Board } from "../../types.ts";
import type { SkillEffect } from "../types.ts";

/** 压制来源。加新源只在这里加一行，调用方不用改。 */
export type SuppressionSource = "punishTurn" | "sealed";

/**
 * 这个座位此刻被哪些源压制着。空数组 = 没被压制。
 * P1/T3：被 +2/+4 的惩罚回合关闭主动技能。
 * P9：血棘封印 = 效果全关但仍持有，解除后原样恢复。
 */
export function suppressionOf(b: Board, seat: number): SuppressionSource[] {
  const sources: SuppressionSource[] = [];
  // 惩罚链未结算且轮到你 = 你正处在惩罚回合
  if (b.punish && b.currentSeat === seat) sources.push("punishTurn");
  if (b.statuses[seat]?.includes("封印")) sources.push("sealed");
  return sources;
}

/**
 * 只问封印那一个源。「亮出」查的正是它：01 §3「可亮出技能；可发动主动技能（非惩罚回合）」——
 * 括号只修饰「发动」，所以 `punishTurn` 压不到亮出（01-V6 亮出也不占额度）；
 * 而 01-P14 明写「封印连未亮出的也不能亮」。
 */
export const isSealed = (b: Board, seat: number) => suppressionOf(b, seat).includes("sealed");

/**
 * 02 §1 的 `suppression_exempt` 词表 → 本文件的压制源。一处写死，别处不再翻译。
 * `sealed` **故意不在表里**：封印不可例外（01-P9，可否被封由技能级的 `sealable` 管）——
 * 就算某条定义写了 `[sealed]`，这里也查不到对应源，照压不误。
 */
const EXEMPTABLE: Record<string, SuppressionSource> = { punish_turn: "punishTurn" };

/**
 * 这条子效果此刻发不发得出来：压制着这个座位的每一个源，都得在它的 exempt 里找得到才放行。
 * 06-Q39：影歌②声明了 `[punish_turn]`，所以惩罚回合照发；同一个人若还被封印，仍然发不了。
 */
export const suppressesEffect = (b: Board, seat: number, e: Pick<SkillEffect, "suppression_exempt">) =>
  suppressionOf(b, seat).some((src) => !(e.suppression_exempt ?? []).some((x) => EXEMPTABLE[x] === src));
