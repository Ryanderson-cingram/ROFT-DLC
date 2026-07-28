/**
 * 通用计数标记（原语 `marks`）。规格：03-glossary.md §5（魂/盗/异/形/颠/陨）。
 *
 * 做成一张按座位的通用计数表、而不是每个技能一个计数器，是因为 §5 自己就写了
 * 「颠可当作异/盗/魂/形」——不同源的标记必须同构才可能互相顶替。
 *
 * 上限**不在这里**：§5 的表里只有影歌的魂写了上限（01-P S15「至多六张」），
 * 而那是技能定义的数字，所以由调用方从 JSON 里读出来传进 `cap`。本文件不认识
 * 任何技能，也不认识任何具体标记名——标记名是开放字符串（§5 明写「不完全列表」）。
 */
import type { Board } from "../../types.ts";

/** 没有的标记是 0，不是 undefined。 */
export const markCount = (b: Board, seat: number, mark: string): number => b.marks[seat]?.[mark] ?? 0;

const withMarks = (b: Board, seat: number, marks: Record<string, number>): Board => ({
  ...b,
  marks: b.marks.map((m, i) => (i === seat ? marks : m)),
});

/**
 * 获得 `n` 个标记。`cap` 是上限，省略 = 无上限（§5 大多数标记没写上限）。
 * 已经超过上限时维持现状而不倒扣——上限管的是「能拿到多少」，不是强制回收。
 */
export function gainMarks(b: Board, seat: number, mark: string, n: number, cap?: number): Board {
  const now = markCount(b, seat, mark);
  const next = cap === undefined ? now + n : Math.max(now, Math.min(now + n, cap));
  return withMarks(b, seat, { ...b.marks[seat], [mark]: next });
}

/**
 * 花掉 `n` 个 `mark`；不够时按 `substitutes` 给的顺序用替代标记补足差额
 * （§5「颠可当作异/盗/魂/形」——调用方传 `["颠"]`，本文件不认识颠）。
 * 付不起返回 `null`，且**一个都不扣**（代价要么全付要么不付）。
 *
 * ponytail: 「本币和替代标记谁先花」规则库没写（06 也没这一题）。这里本币优先，
 * 结果确定但不是裁定；等文档定了改这个 reduce 的顺序即可，签名不变。
 */
export function spendMarks(
  b: Board,
  seat: number,
  mark: string,
  n: number,
  substitutes: readonly string[] = [],
): Board | null {
  const held = b.marks[seat] ?? {};
  const next = { ...held };
  let owed = n;
  for (const m of [mark, ...substitutes]) {
    const pay = Math.min(owed, next[m] ?? 0);
    next[m] = (next[m] ?? 0) - pay;
    owed -= pay;
    if (owed === 0) break;
  }
  return owed > 0 ? null : withMarks(b, seat, next);
}
