"use client";

import type { ClientSnapshot } from "@roft/engine";
import type { ReactNode } from "react";
import { CardRiver, type PileKey } from "./card-river";
import { PunishChain } from "./punish-chain";
import { Ticker } from "./ticker";
import { TurnDial } from "./turn-dial";
import type { NameOf } from "@/lib/hud-copy";

type Props = {
  snapshot: ClientSnapshot;
  nameOf: NameOf;
  names: Record<string, string>;
  /** 跑马灯与记录抽屉的数据源；缺席（测试里）就不渲染跑马灯。 */
  roomId?: string | null;
  /** 技能徽（每个人的都可点）→ P3 的技能弹窗。 */
  onSkillClick?: (seat: number) => void;
  /** 堆的「查看全部」→ P3 的牌堆全貌弹窗。 */
  onOpenPile?: (which: PileKey) => void;
  /**
   * 升起面板（`<Sheet>`）开着时整块关掉。
   *
   * `.scrim--table` 只是**视觉上**盖住牌桌，键盘照样 Tab 得到座位卡的技能徽——
   * 那正是 spec §7 开头骂旧代码那个毛病的镜像版（视觉遮挡与焦点可达性不一致）。
   * **只关这一半**：底坞（手牌 + 三槽）必须一直可点，那是 `<Sheet>` 之所以非模态的全部理由。
   */
  inert?: boolean;
  /** 命令坞那一半。P3 之前它还住在 `hud.tsx` 里。 */
  children?: ReactNode;
};

/**
 * 牌桌壳（design/mockups/game.html）：轮转轨 + 跑马灯 + 惩罚叠链 + 牌河。
 * **纯展示，不持有任何业务态**——每一格都直接来自快照。
 */
export function GameTable({
  snapshot,
  nameOf,
  names,
  roomId,
  onSkillClick,
  onOpenPile,
  inert,
  children,
}: Props) {
  return (
    <>
      {/* 两块分别关：`.dial` 与 `.table` 是 `.game-page` 竖柱上的两个平级项，
          外面包一层容器会把 `.table { flex: 1 0 auto }` 的伸缩关系整个改掉 */}
      <TurnDial
        snapshot={snapshot}
        nameOf={nameOf}
        onSkillClick={onSkillClick}
        inert={inert}
      >
        <Ticker roomId={roomId} snapshot={snapshot} names={names} />
      </TurnDial>
      <main className="table" inert={inert}>
        {snapshot.punish && <PunishChain punish={snapshot.punish} nameOf={nameOf} />}
        <CardRiver snapshot={snapshot} nameOf={nameOf} onOpenPile={onOpenPile} />
        {children}
      </main>
    </>
  );
}
