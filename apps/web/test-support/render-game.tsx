import type { Action, Card, ClientSnapshot } from "@roft/engine";
import { render, within } from "@testing-library/react";
import { useState } from "react";
import { FIXTURE_NAMES } from "@/test-support/snapshot";
import { Dock } from "@/components/game/dock";
import type { PickColor } from "@/components/game/dock-slots";
import { GameTable } from "@/components/game/table";

/** 页面的全部接缝：快照进，这几个回调出。测试只断言「入口存在 + 交上去的 payload 对」。 */
export type Handlers = {
  onPlay: (card: Card, useSkill?: boolean) => void;
  onPlayMany: (cards: Card[]) => void;
  onAction: (action: Action) => void;
  onExpire: () => void;
  onSkillClick: () => void;
  onOpenPile: () => void;
};

const noop = () => {};

/**
 * 与 `app/game/[code]/page.tsx` 同一套组装：牌桌壳 + 命令坞。
 *
 * 并列多选的 `picked` 住在页面（spec §3.3：它决定 `onPlayMany` 的 payload），
 * 所以这里也得替页面持着它，否则点「多张一起打」不会有任何反应。
 */
function Game({
  snapshot,
  on,
  pickColor,
  costPick,
}: {
  snapshot: ClientSnapshot;
  on: Partial<Handlers>;
  pickColor?: PickColor | null;
  costPick?: { onPick: (card: Card) => void; onCancel: () => void } | null;
}) {
  const [picked, setPicked] = useState<string[] | null>(null);
  const nameOf = (seat: number) =>
    FIXTURE_NAMES[snapshot.players[seat]?.userId ?? ""] ?? `座位 ${seat + 1}`;
  const onAction = on.onAction ?? noop;
  return (
    <>
      <GameTable
        snapshot={snapshot}
        nameOf={nameOf}
        names={FIXTURE_NAMES}
        onSkillClick={on.onSkillClick}
        onOpenPile={on.onOpenPile}
      />
      <Dock
        snapshot={snapshot}
        nameOf={nameOf}
        onPlay={on.onPlay ?? noop}
        onPlayMany={(cards) => {
          setPicked(null);
          on.onPlayMany?.(cards);
        }}
        onAction={onAction}
        onExpire={on.onExpire}
        onSkillClick={on.onSkillClick}
        pickColor={pickColor}
        picked={picked}
        onPicked={setPicked}
        costPick={costPick}
      />
    </>
  );
}

/** `update(snap)` 原地换一份快照——「同一棵树上内容变了之后」的那几条（重挂、闪一下、浮报）要它。 */
export const renderGame = (
  snapshot: ClientSnapshot,
  on: Partial<Handlers> = {},
  pickColor?: PickColor | null,
  costPick?: { onPick: (card: Card) => void; onCancel: () => void } | null,
) => {
  const ui = (s: ClientSnapshot) => <Game snapshot={s} on={on} pickColor={pickColor} costPick={costPick} />;
  const r = render(ui(snapshot));
  return { ...r, update: (s: ClientSnapshot) => r.rerender(ui(s)) };
};

/** 手牌区。可点的牌是 `<button>`、不可点的是 `<span>`——所以 role 查询天然只捞到可点的那些。 */
export const hand = (root: HTMLElement) => within(root).getByRole("group", { name: "你的手牌" });

/** 手牌里此刻可点的牌，按 `aria-label`（「红 3」）给。多选态下用 `pickedCardNames`。 */
export const cardNames = (root: HTMLElement) =>
  within(hand(root))
    .queryAllByRole("button")
    .map((el) => el.getAttribute("aria-label") ?? "");

/** 并列多选里已选中的牌（`aria-pressed`）。 */
export const pickedCardNames = (root: HTMLElement) =>
  within(hand(root))
    .queryAllByRole("button", { pressed: true })
    .map((el) => el.getAttribute("aria-label") ?? "");

/** 命令坞三个槽位里此刻看得见的按钮（含点开的菜单项），按文字给。 */
export const buttonLabels = (root: HTMLElement) =>
  within(within(root).getByRole("group", { name: "命令坞" }))
    .queryAllByRole("button")
    .map((el) => el.textContent ?? "");
