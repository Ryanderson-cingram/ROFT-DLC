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
  "draw_procedure", // 02 §7 的 L6 后置程序：不改数字，只改执行方式（忍戒♠J 多摸再弃）
  "draw_obligation", // 改「要不要摸」而不是「摸几张」：U1 无牌可出必须摸 → 神授♥5 可以不摸
  "marks", //        03 §5 计数标记的获得/上限/花费
  "statuses", //     03 §4 状态的赋予/互斥/移除
  "card_value", //   改写一张牌算几点（精英♥3）
  "play_legality", // 改写一次能合法打出几张（并列♥4）
  "color_rule", //   改写「视为打出的那张」用什么颜色（远星♦J：视为的 +4 用所弃 +2 的颜色）
  "turn_flow", //    改写回合的流向：跳过自己的回合（影歌♦3②）
  "punish_amount", //改写惩罚段的贡献张数（强袭♦1①掷骰定倍率）
  "dice", //         01-R1 三面骰，含「掷骰接管」两段式窗口（强袭♦1②）
  "meta_rule", //    02 §2 的 kind：改写全局或自身规则
  // 下面两个是 02 §2 的 `kind` 值，不是机制。放进来只是因为 kind 与原语名共用一个
  // 命名空间；「这个技能真的能执行吗」由 loadSkills 另外查 HANDLERS，见 registry.ts。
  "active", //       阶段 1 声明发动，占 V7 的额度
  "passive", //      条件满足即触发，不占次数（V8）
  "replacement", //  整体改写一次摸牌的计算（伤逝♥10 的 L1；02 §7）
  "on_reveal", //    亮出当下结算（合纵♠5 / 连横♠6①：亮出即问另一半「相应吗」，01-S13）
  "on_play", //      打出某张牌时触发（强袭♦1①：出牌动作带旗标声明）
  "response", //     他人动作后开窗口响应（强袭♦1②：掷骰接管）
  "status_grant", // 条件满足即给某人一个状态（血棘♦2 的封印；03 §4 + 02 §2 压制层消费它）
]);

export { DRAW_THEN_DISCARD, PROCEDURES, resolveDrawCount } from "./draw-modifier.ts";
export type { DrawEventKind, DrawModifier, DrawProcedure, DrawRequest, DrawResolution } from "./draw-modifier.ts";
export { gainMarks, markCount, spendMarks } from "./marks.ts";
export { multiPlayAllowed, valueOverrideFor } from "./playability.ts";
export type { ValueOverride } from "./playability.ts";
export { canGrantStatus, grantStatus, hasStatus, removeStatus } from "./statuses.ts";
