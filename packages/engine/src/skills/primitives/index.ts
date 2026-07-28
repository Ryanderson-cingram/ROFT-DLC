/**
 * 已实现的机制名（原语）。
 *
 * 技能定义里点名机制的字段（02 §2 的 `kind`、§1 的 `modifies`）只能引用这里有的名字，
 * 否则 `loadSkills` 抛错——计划 §1「数据引用不存在的机制必须炸」。kind 与原语名共用
 * 一个扁平命名空间，因为计划 Task 8 的 CI 断言就是拿它们一起跟这个集合比。
 *
 * 新增一个原语 = 在这里加一行。此刻只有摸牌层级 reducer（02 §7）。
 */
export const primitives: ReadonlySet<string> = new Set<string>([]);
