"use client";

import type { ClientSnapshot } from "@roft/engine";
import { Fragment } from "react";
import { colorSwatch } from "@/lib/cards";
import type { NameOf } from "@/lib/hud-copy";
import { useBump } from "@/lib/use-bump";

type Props = {
  punish: NonNullable<ClientSnapshot["punish"]>;
  nameOf: NameOf;
};

/**
 * 惩罚叠链（design/mockups/game-respond.html 的 `.chain`）：每段一个色块 + 谁 + 那一张，
 * 末尾是这一屏最大的机器量「累计 N 张」。
 *
 * 色块吃的是 `PunishSegment.color`——**不能从 `playedPile` 回推**：远星♦J 的「视为打出」
 * 一张牌都不进牌河，链里会有一段在牌河上找不到对应的牌（engine `types.ts` 有原注）。
 */
export function PunishChain({ punish, nameOf }: Props) {
  // 又叠了一段：这一屏最大的机器量闪一下（`.is-bump`），眼睛会被带到累计上
  const total = useBump(punish.total, "total");
  return (
    <div className="chain">
      {punish.segments.map((seg, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="arrow">›</span>}
          <span className="seg">
            <i className="swatch" style={{ background: colorSwatch(seg.color) }} />
            {nameOf(seg.seat)} <b>{seg.face}</b>
          </span>
        </Fragment>
      ))}
      <span {...total}>累计 {punish.total} 张</span>
    </div>
  );
}
