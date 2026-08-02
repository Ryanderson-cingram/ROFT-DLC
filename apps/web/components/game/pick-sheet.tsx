"use client";

import type { Card } from "@roft/engine";
import { COLORS } from "@/lib/cards";
import { CardFace } from "./card-face";
import { Sheet } from "./sheet";

/**
 * 宣言盘：影歌♦3① 发动前「当众指定一张色 + 数」。**这是它唯一的用法**——
 * 从前它还兼着司夜②还牌 / 洗牌②弃牌 / 恒心弃 1 代价三条流程，
 * 那三条 P4 起都在手牌区直接点选，不再弹面板（spec §3.4）。
 *
 * 壳是 `<Sheet>`：遮罩只盖牌桌（`.scrim--table`），手牌与命令坞在下面完整露出。
 * 挑哪张、挑完发什么由调用方决定：组件不判合法性、不发请求，只把选中的那张交回去。
 */
export function PickSheet({
  eyebrow,
  title,
  lead,
  cards,
  onPick,
  onCancel,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  cards: Card[];
  onPick: (card: Card) => void;
  /** 提交前的本地选择，随时能反悔（点遮罩或按钮都算）。 */
  onCancel: () => void;
}) {
  return (
    <Sheet eyebrow={eyebrow} title={title} lead={lead} onCancel={onCancel}>
      <div className="declare">
        {cards.map((card) => (
          <CardFace key={card.id} card={card} legal onClick={() => onPick(card)} />
        ))}
      </div>
      <button type="button" className="btn btn--ghost btn--block" onClick={onCancel}>
        先不发动
      </button>
    </Sheet>
  );
}

/**
 * 可以被宣言的牌面：四色 × **1–9**（影歌①限数字牌，04 2026-08-02 裁定把 0 排除）。
 * 只是给面板画的假牌，不进任何请求——提交时取的是选中那张的 `color` + `face`（= 动作里的 `declared`）。
 * 引擎侧另有一道 `bad_declaration`：这里少画一张不等于规则，规则在 `actions/soul-harvest.ts`。
 */
export const DECLARABLE: Card[] = COLORS.flatMap(({ value }) =>
  Array.from(
    { length: 9 },
    (_, n): Card => ({ id: `declare-${value}${n + 1}`, color: value, face: String(n + 1) as Card["face"] }),
  ),
);
