/**
 * 摸牌数结算层级（原语 `drawModifier`）。规格：02-methodology.md §7 的 L0–L6。
 *
 * 同一次摸牌可被多个来源修改。**任何摸牌事件按固定层级结算一次**，不做技能间 ad-hoc
 * 排序（spec §8 明令禁止）。所以这里是「每个修正声明自己的 layer，按层归约」的
 * 声明式列表，不是技能名的 if/else 链——加一个会改摸牌数的技能 = 多产出一条修正，
 * 这个文件不动。
 *
 * 掷骰之类的随机在**组装修正之前**由调用方用注入的 rng 做完，落到 L1 的 `value` 上，
 * 所以本函数是纯的，没有随机源。
 */

/** L0 定型的前半：事件类型。惩罚 = 仅因 +2/+4 的摸牌（01-P1）。 */
export type DrawEventKind = "punish" | "skill" | "rule";

export type DrawModifier =
  /** L1 替换：整体改写计算（伤逝按张数掷骰）。值由调用方先算好。 */
  | { layer: "L1"; source: string; value: number }
  /** L2 加减：同层全部累加。 */
  | { layer: "L2"; source: string; delta: number }
  /** L3 倍率。 */
  | { layer: "L3"; source: string; factor: number }
  /** L4 覆盖：恒定值/归零。`self` = 作用于受罚者自身，冲突时胜过 `global`。 */
  | { layer: "L4"; source: string; scope: "self" | "global"; value: number }
  /** L5 钳制：效果自带下限（恩惠「至少 1」）。 */
  | { layer: "L5"; source: string; min: number }
  /** L6 后置程序：不改数字，只改执行方式（忍戒摸后弃、染手改来源、领域改去向…）。 */
  | { layer: "L6"; source: string; procedure: string };

export type DrawProcedure = Extract<DrawModifier, { layer: "L6" }>;

export interface DrawRequest {
  kind: DrawEventKind;
  /**
   * 谁在摸这张牌。修正的采集是**按摸牌者**做的（恩惠 `targeting: self` 只改自己那次摸牌，
   * L4 的 `scope: "self"` 同理），所以摸牌者是这个事件的一部分，不是调用方的私事——
   * 放在请求里，任何摸牌路径都绕不开它。
   */
  seat: number;
  /**
   * L0 基础值。惩罚事件传的必须是**链上各段贡献的加总**（01-P11「先加总各段贡献再套用」），
   * 而各段「只作用于自己打出的那一张」的修正在**进链时**就已经计入该段贡献（01-P6）——
   * 所以这里绝不能再加一遍。`PunishChain.total` 正是那个加总。
   */
  base: number;
}

export interface DrawResolution {
  count: number;
  /** L6：调用方拿去改执行方式，不影响 count。 */
  procedures: DrawProcedure[];
  /** L1 命中时是谁替换的，供事件与调试；没命中则 undefined。 */
  replacedBy?: string;
}

const pick = <L extends DrawModifier["layer"]>(mods: readonly DrawModifier[], layer: L) =>
  mods.filter((m): m is Extract<DrawModifier, { layer: L }> => m.layer === layer);

export function resolveDrawCount(req: DrawRequest, mods: readonly DrawModifier[] = []): DrawResolution {
  // ponytail: 同层多条 L1 / 多条同 scope 的 L4 谁胜，§7 没写；这里按输入顺序取第一条，
  // 结果确定但不是裁定。等规则库定了再改这两行。
  const [replacement] = pick(mods, "L1");
  let v: number;

  if (replacement) {
    // L1 命中 → 直接得最终值，跳过 L2/L3/L4（伤逝原文「不受其他技能影响」），但仍走 L5
    v = replacement.value;
  } else {
    // L2 加减：同层全部累加，故与顺序无关
    v = req.base + pick(mods, "L2").reduce((sum, m) => sum + m.delta, 0);
    // L3 倍率
    v = pick(mods, "L3").reduce((x, m) => x * m.factor, v);
    // L4 覆盖：作用于受罚者自身的覆盖 > 全局覆盖
    const l4 = pick(mods, "L4");
    const override = l4.find((m) => m.scope === "self") ?? l4[0];
    if (override) v = override.value;
  }

  // L5 钳制：效果自带下限，再兜全局最终值 ≥ 0
  const count = Math.max(0, ...pick(mods, "L5").map((m) => m.min), v);

  return { count, procedures: pick(mods, "L6"), ...(replacement && { replacedBy: replacement.source }) };
}
