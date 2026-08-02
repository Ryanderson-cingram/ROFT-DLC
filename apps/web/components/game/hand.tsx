"use client";

import type { Action, Card, ClientSnapshot } from "@roft/engine";
import { CardFace } from "./card-face";
import { sortHand } from "@/lib/hand-sort";
import { costActionsOf, handPickActionsOf, playActionsOf } from "@/lib/legal";

type Props = {
  snapshot: ClientSnapshot;
  /**
   * 并列多选（本地态，快照里没有）：`null` = 不在多选里，数组 = 已选的牌 id（按点选顺序）。
   * 多选时**手牌不重排**——排序只看牌本身（`sortHand`），选中与否不参与，手指不追着牌跑。
   */
  picked: string[] | null;
  onPickToggle: (id: string) => void;
  /**
   * 恒心♠1 那类「发动前先挑一张弃掉」的代价：给了就是 `pickFromHand` 态，
   * 手牌**全部**可点，点哪张就把哪张交回去。不给 = 常态。
   */
  onPickCost?: (card: Card) => void;
  onPlay: (card: Card, useSkill?: boolean) => void;
  onAction: (action: Action) => void;
};

/**
 * 手牌区（design/mockups/game.html 的 `.hand`）。三种交互态，**都不上遮罩**（spec §3.4）：
 *
 * 1. 常态：点高亮的牌出牌／弃代价牌／打断／取消洗牌
 * 2. `pickFromHand`：司夜②还牌与洗牌②弃牌（choice 就是牌 id，来自 `legalActions`），
 *    以及恒心♠1 的弃 1 代价（提交前的本地选择，走 `onPickCost`）——三条流程都不弹面板
 * 3. `multiPlay`：并列多选，选中的牌加 `.card--picked` 并带 `aria-pressed`
 *
 * 高亮一律来自 `lib/legal.ts`（= `legalActions`）：这里一条合法性都不判。
 * 多选态与代价态下每张牌都可点——合不合形状／弃哪张由服务端说了算。
 */
export function Hand({ snapshot: s, picked, onPickToggle, onPickCost, onPlay, onAction }: Props) {
  const play = playActionsOf(s);
  const cost = costActionsOf(s);
  const handPick = handPickActionsOf(s);

  return (
    <div className="hand" role="group" aria-label="你的手牌">
      {sortHand(s.yourHand).map((card) => {
        if (onPickCost)
          return <CardFace key={card.id} card={card} legal onClick={() => onPickCost(card)} />;
        if (picked)
          return (
            <CardFace
              key={card.id}
              card={card}
              picked={picked.includes(card.id)}
              onClick={() => onPickToggle(card.id)}
            />
          );
        const action = handPick.get(card.id) ?? cost.get(card.id);
        const playAction = play.get(card.id);
        const legal = !!action || !!playAction;
        return (
          <CardFace
            key={card.id}
            card={card}
            legal={legal}
            dim={!legal}
            pulse={legal && !!s.pendingWindow}
            onClick={
              action ? () => onAction(action)
              : playAction ? () => onPlay(card, playAction.useSkill)
              : undefined
            }
          />
        );
      })}
    </div>
  );
}
