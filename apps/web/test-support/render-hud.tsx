import type { Action, Card, ClientSnapshot } from "@roft/engine";
import { render } from "@testing-library/react";
import { FIXTURE_NAMES } from "@/fixtures/snapshot";
import { Hud } from "@/components/game/hud";

/** HUD 的全部接缝：快照进，这四个回调出。测试只断言「入口存在 + 交上去的 payload 对」。 */
export type Handlers = {
  onPlay: (card: Card, useSkill?: boolean) => void;
  onPlayMany: (cards: Card[]) => void;
  onAction: (action: Action) => void;
  onExpire: () => void;
};

const noop = () => {};

export const renderHud = (snapshot: ClientSnapshot, on: Partial<Handlers> = {}) =>
  render(
    <Hud
      snapshot={snapshot}
      names={FIXTURE_NAMES}
      onPlay={on.onPlay ?? noop}
      onPlayMany={on.onPlayMany ?? noop}
      onAction={on.onAction ?? noop}
      onExpire={on.onExpire}
    />,
  );

/** 牌面是 `<button aria-label="红 3">`：点牌一律按这个名字找。 */
export const cardNames = (root: HTMLElement, selector = ".hand .card--legal") =>
  [...root.querySelectorAll(selector)].map((el) => el.getAttribute("aria-label"));

export const buttonLabels = (root: HTMLElement) =>
  [...root.querySelectorAll(".actions button")].map((el) => el.textContent ?? "");
