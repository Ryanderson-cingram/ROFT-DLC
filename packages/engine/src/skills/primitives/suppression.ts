// 压制（02 §2）：某些条件下关掉一个座位的主动技能。
// 做成一层而不是散在各处判断，是因为 §2 把它定义成通用机制，默认源有四个：
// 惩罚回合、血棘封印、技能免疫、预兆「技能暂时失效」。
// 例外写在技能上（如影歌②可在惩罚回合发动，S15）——但 02 §1 的字段模型
// 目前没有承载例外的槽位（06 Q39），所以这里只实现「压制」，例外等文档补字段。
import type { Board } from "../../types.ts";

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

export const isSuppressed = (b: Board, seat: number) => suppressionOf(b, seat).length > 0;
