/**
 * 已实现的机制名（原语）。
 *
 * 技能定义里点名机制的字段（02 §2 的 `kind`、§1 的 `modifies`）只能引用这里有的名字，
 * 否则 `loadSkills` 抛错——计划 §1「数据引用不存在的机制必须炸」。kind 与原语名共用
 * 一个扁平命名空间，因为计划 Task 8 的 CI 断言就是拿它们一起跟这个集合比。
 *
 * 新增一个原语 = 在这里加一行。
 */
export const primitives: ReadonlySet<string> = new Set<string>([
  "drawModifier", // 02 §7 摸牌数结算层级
  "marks", // 03 §5 计数标记的获得/上限/花费
  "statuses", // 03 §4 状态的赋予/互斥/移除
]);

export { resolveDrawCount } from "./draw-modifier.ts";
export type { DrawEventKind, DrawModifier, DrawProcedure, DrawRequest, DrawResolution } from "./draw-modifier.ts";
export { gainMarks, markCount, spendMarks } from "./marks.ts";
export { canGrantStatus, grantStatus, hasStatus, removeStatus } from "./statuses.ts";
