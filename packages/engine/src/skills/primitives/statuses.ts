/**
 * 状态（原语 `statuses`）。规格：03-glossary.md §4。
 *
 * §4 有两条**全局**硬规则（「负面三者互斥」「所有状态不能叠加多层」）和一条
 * 状态间的交互（领域免疫恋战）。它们在这里实施一次，各技能不再重复判断——
 * 这正是把 `statuses` 抽成原语的理由。除这三条外本文件不认识任何状态语义，
 * 也不认识任何技能。
 */
import { SKILL_DATA } from "../draw-passives.ts";
import type { SkillData } from "../draw-passives.ts";
import type { Board } from "../../types.ts";

/**
 * §4 的状态名。引擎里按这几个字认，所以名字只在这里写一次
 * （数据侧的落点是 04 围栏块的 `grants`，生成器查同一张表）。
 */
export const RAINBOW = "五彩";

/** §4 标题：五彩/心盲/恋战，持有其一则不能获得另外两种。 */
const EXCLUSIVE_TRIO = [RAINBOW, "心盲", "恋战"];

export const hasStatus = (b: Board, seat: number, status: string): boolean =>
  b.statuses[seat]?.includes(status) ?? false;

/** 他已亮出的技能有没有声明免疫这个状态（V3 没亮出不算数；封印期间连免疫一起关，01-P9）。 */
function statusImmune(b: Board, seat: number, status: string, data: SkillData): boolean {
  const id = b.skills[seat];
  if (!id || !b.revealed[seat]) return false;
  const def = data.byId.get(id);
  if (!def || def.structured !== true) return false;
  if (def.sealable !== false && (b.statuses[seat] ?? []).includes("封印")) return false;
  return (def.effects ?? []).some((e) => e.immune?.includes(status));
}

/** 能不能获得。三条否决全在这里，`grantStatus` 只是它的执行面。 */
export function canGrantStatus(b: Board, seat: number, status: string, data: SkillData = SKILL_DATA): boolean {
  // 02 §6 的 `immune`：技能声明免疫某个状态（专精♥9 免疫五彩）。判定放在这里，
  // 所以**谁来赋都挡得住**——八门②、寄生、狂欢…赋状态的每条路径自动生效
  if (statusImmune(b, seat, status, data)) return false;
  const held = b.statuses[seat] ?? [];
  if (held.includes(status)) return false; // §4：不能叠加多层
  if (EXCLUSIVE_TRIO.includes(status) && held.some((s) => EXCLUSIVE_TRIO.includes(s))) return false; // §4：三者互斥
  if (status === "恋战" && held.includes("领域")) return false; // §4：领域「免疫恋战」
  return true;
}

/**
 * 赋予状态。被上面任一条挡住时**静默无效**，返回原 Board。
 *
 * ponytail: §4 只写「不能获得」，没写是「拒绝（报错）」还是「无效（忽略）」。
 * 选无效是因为它不会把一次合法的技能发动整个打回——但这不是裁定，等文档定。
 * 调用方需要区分时用 `canGrantStatus` 先问。
 */
export const grantStatus = (b: Board, seat: number, status: string, data: SkillData = SKILL_DATA): Board =>
  canGrantStatus(b, seat, status, data) ? withStatuses(b, seat, [...(b.statuses[seat] ?? []), status]) : b;

/** 移除；本来就没有则局面照旧。 */
export const removeStatus = (b: Board, seat: number, status: string): Board =>
  withStatuses(b, seat, (b.statuses[seat] ?? []).filter((s) => s !== status));

const withStatuses = (b: Board, seat: number, statuses: string[]): Board => ({
  ...b,
  statuses: b.statuses.map((s, i) => (i === seat ? statuses : s)),
});
