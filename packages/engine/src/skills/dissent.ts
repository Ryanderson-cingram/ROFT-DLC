/**
 * 异议♥8（04 ♥8 / 01-F3 / 02 §7 L2）。
 * spec：`docs/superpowers/specs/2026-08-02-skills-batch-2.md` 第 2 步。
 *
 * 两条各自独立，共用一个惩罚窗口：
 *
 * - **①（整局一次）**：上家打出 +2/+4 指到我头上时，反转方向并跳过我——反转之后
 *   我的下家正是原来的上家，所以链**原样反弹给他**（段与贡献总和一张不动），他自己选叠或吃。
 *   纯响应窗口，**不占** 01-V7 的主动条：触发时刻在别人的回合里，我没有回合可占；
 *   `once: once` 已经是它的限流（走 `Board.usedOnce`，同影歌①）。
 * - **②**：打出「转」获 1 枚「异」；受罚吃下时**可选**弃 N 枚，每枚 L2 −1。
 *   弃几枚由玩家定（0 ‥ 持有数），超时默认弃 0——异是资源，不替玩家花。
 *
 * 本文件不认技能 id，全部按定义的形状找（同 `damnation.ts`）。
 */
import { sealedOff } from "../actions/dice.ts";
import { SKILL_DATA } from "./draw-passives.ts";
import { paramsOfEffect } from "./params.ts";
import { gainMarks, markCount, spendMarks } from "./primitives/marks.ts";
import type { SkillData } from "./draw-passives.ts";
import type { DrawModifier } from "./primitives/draw-modifier.ts";
import type { SkillEffect } from "./types.ts";
import type { Board, EngineEvent } from "../types.ts";

/** ① 在惩罚窗口里的那个响应选项。 */
export const DISSENT = "dissent";
/** ② 的标记名。03 §5 的标记名是开放集合，与 `nightlord.ts` 的「盗」同一写法。 */
export const DISSENT_MARK = "异";
/** ② 的弃异档位：`accept:2` = 吃下并弃 2 枚异。`accept` 本身 = 弃 0。 */
const ACCEPT_N = /^accept:(\d+)$/;
export const acceptDiscardCount = (choice: string): number => Number(ACCEPT_N.exec(choice)?.[1] ?? 0);
export const isAccept = (choice: string): boolean => choice === "accept" || ACCEPT_N.test(choice);

/** 亮出（V3）且没被封印（P9）才谈得上生效；两条都过才把定义交出去。 */
function liveDef(b: Board, seat: number, data: SkillData) {
  const id = b.skills[seat];
  const def = id && b.revealed[seat] ? data.byId.get(id) : undefined;
  return !def || def.structured !== true || sealedOff(b, seat, def) ? undefined : def;
}

/**
 * ①此刻发得出来吗：按定义找 `kind: response` + 改 `turn_flow` 的那一条，
 * 再查 `once: once` 用掉没有。返回 undefined = 这个人这一刻没有这个选项。
 *
 * 与远星（同为 `kind: response`）靠 `modifies` 分开：远星改 `color_rule`，异议改 `turn_flow`；
 * 与劫营（同为 `response` + `turn_flow`）靠 `window` 分开：劫营开 `interrupt`，异议开 `on_punish_resolve`。
 */
export function dissentEffect(b: Board, seat: number, data: SkillData = SKILL_DATA): SkillEffect | undefined {
  const def = liveDef(b, seat, data);
  const e = def?.effects?.find(
    (x) => x.kind === "response" && x.window === "on_punish_resolve" && !!x.modifies?.includes("turn_flow"),
  );
  // S15：一次性效果整局只发得出一次（S18c 的「重获则重置」到时候清 usedOnce 即可）
  return e && !(e.once === "once" && b.usedOnce?.[seat]?.[e.key]) ? e : undefined;
}

/** ②此刻手上有几枚异可弃：没有这条效果、或一枚都没有 → 0。 */
export function dissentMarksAvailable(b: Board, seat: number, data: SkillData = SKILL_DATA): number {
  return discardEffect(b, seat, data) ? (b.marks[seat]?.[DISSENT_MARK] ?? 0) : 0;
}

/**
 * ②的前半：打出「转」获异。由单张出牌路径在牌落地时调用；不是转、或这个人没有异议 → 原样返回。
 *
 * 「转」是牌面而不是技能数值，所以 `"rev"` 写在这里而不是 04 的 `values`——
 * 同 `play-cards.ts` 里那行「`card.face === "rev"` 就反转方向」。
 * 并列♥4 全是数字牌、远星弃的转是**代价不是打出**，两条路径都不该给异，所以只挂单张出牌这一处。
 */
export function gainDissentMark(
  b: Board,
  seat: number,
  face: string,
  data: SkillData = SKILL_DATA,
): { marks: Board["marks"]; events: EngineEvent[] } {
  const e = face === "rev"
    ? liveDef(b, seat, data)?.effects?.find((x) => x.kind === "on_play" && !!paramsOfEffect(x).counts.marks)
    : undefined;
  if (!e) return { marks: b.marks, events: [] };
  const n = paramsOfEffect(e).counts.marks;
  // 无上限（04 没给 `mark_cap`）：缺席即无上限，不是 0
  const gained = gainMarks(b, seat, DISSENT_MARK, n);
  return {
    marks: gained.marks,
    // 标记数全公开（同司夜的盗），事件带上余额，客户端不必自己加
    events: [{
      type: "marksGained",
      public: { seat, mark: DISSENT_MARK, n, total: markCount(gained, seat, DISSENT_MARK) },
    }],
  };
}

/** ②的弃异那一条：`layer: [L2]` + 按标记计价（`values.marks`）。 */
function discardEffect(b: Board, seat: number, data: SkillData) {
  return liveDef(b, seat, data)?.effects?.find(
    (e) => !!e.modifies?.includes("draw_count") && !!e.layer?.includes("L2") && !!paramsOfEffect(e).counts.marks,
  );
}

/**
 * 吃下惩罚时弃 `n` 枚异：扣标记 + 给出那条 L2 修正（`values.L2` 是**每枚**的值）。
 *
 * `n === 0` 走快路，一个字节都不写（弃 0 是默认选择，不该在快照里留痕）。
 * 付不起（异不够 / 这个人根本没有异议）→ `null`，调用方 reject —— 与远星的
 * `cost_unpayable` 同一条纪律（06-Q54：代价付不起就发不了）。
 */
export function payDissent(
  b: Board,
  seat: number,
  n: number,
  data: SkillData = SKILL_DATA,
): { board: Board; mods: DrawModifier[]; events: EngineEvent[] } | null {
  if (n === 0) return { board: b, mods: [], events: [] };
  const def = liveDef(b, seat, data);
  const e = def && discardEffect(b, seat, data);
  if (!def || !e) return null;
  const paid = spendMarks(b, seat, DISSENT_MARK, n);
  if (!paid) return null;
  const per = paramsOfEffect(e).draw.L2 ?? 0;
  return {
    board: paid,
    mods: [{ layer: "L2", source: def.name, delta: per * n }],
    events: [{
      type: "marksSpent",
      public: { seat, mark: DISSENT_MARK, n, total: markCount(paid, seat, DISSENT_MARK) },
    }],
  };
}
