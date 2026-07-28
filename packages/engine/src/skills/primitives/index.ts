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
  "draw_count", //   同上，`modifies` 那一侧的名字
  "marks", //        03 §5 计数标记的获得/上限/花费
  "statuses", //     03 §4 状态的赋予/互斥/移除
  // 下面两个是 02 §2 的 `kind` 值，不是机制。放进来只是因为 kind 与原语名共用一个
  // 命名空间；「这个技能真的能执行吗」由 loadSkills 另外查 HANDLERS，见 registry.ts。
  "active", //       阶段 1 声明发动，占 V7 的额度
  "passive", //      条件满足即触发，不占次数（V8）
]);

export { resolveDrawCount } from "./draw-modifier.ts";
export type { DrawEventKind, DrawModifier, DrawProcedure, DrawRequest, DrawResolution } from "./draw-modifier.ts";
export { gainMarks, markCount, spendMarks } from "./marks.ts";
export { canGrantStatus, grantStatus, hasStatus, removeStatus } from "./statuses.ts";
