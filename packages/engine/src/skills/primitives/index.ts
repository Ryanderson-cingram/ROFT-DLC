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
  "active", //       02 §2：阶段 1 声明发动，占 V7 的额度；由 skills/handlers.ts 按 id 执行
  "passive", //      02 §2：条件满足即触发，不占次数（V8）
]);

export { resolveDrawCount } from "./draw-modifier.ts";
export type { DrawEventKind, DrawModifier, DrawProcedure, DrawRequest, DrawResolution } from "./draw-modifier.ts";
