import type { Action, ClientSnapshot } from "@roft/engine";

/**
 * 快照 → 「哪张牌现在可点」的映射。零规则：这里只把 `legalActions` 换个索引方式，
 * 一条合法性都不自己判（`hud.tsx` 原来的 60-76 行搬过来的）。
 */

type PlayCards = Extract<Action, { type: "playCards" }>;
type Respond = Extract<Action, { type: "respond" }>;

/**
 * 点牌就能打的牌 → 对应动作。
 * 同一张牌的合法打法带不带 `useSkill`（精英把数字牌当大 1 点）由动作本身说了算。
 * 强袭♦1①的「掷骰打」是同一张牌的**另一条**动作，点牌只会按面值打，所以它不进这张表。
 */
export function playActionsOf(s: ClientSnapshot): Map<string, PlayCards> {
  return new Map(
    s.legalActions.flatMap((a) =>
      a.type === "playCards" && !a.useAssault ? a.cardIds.map((id) => [id, a] as const) : [],
    ),
  );
}

/**
 * 「按牌给出的 respond」→ 对应动作。
 * 远星♦J（惩罚窗口里弃代价牌）与劫营♦10（打断窗口里打出同色同数的牌）都是按牌给出的
 * respond 动作（cardIds 在动作里），所以它们与可打的牌走同一套高亮：点哪张由 legalActions
 * 说了算，组件照旧不判合法性。
 * 洗牌③（取消别人的洗牌）也是「按牌给出的 respond」，同一套高亮，点了在 page 里先定色再提交。
 */
export function costActionsOf(s: ClientSnapshot): Map<string, Respond> {
  const w = s.pendingWindow;
  return new Map(
    w?.type === "punishStack" || w?.type === "interrupt" || w?.type === "shuffleCancel"
      ? s.legalActions.flatMap((a) =>
          a.type === "respond" && a.cardIds ? a.cardIds.map((id) => [id, a] as const) : [],
        )
      : [],
  );
}

/**
 * 「从手牌里挑一张交上去」的两个窗口——司夜②还牌与洗牌②弃牌，动作逐字相同：
 * `respond.choice` 就是牌 id。这两个窗口里手牌本身就是操作对象（spec §3.4：无遮罩），
 * 所以它们与可打的牌走同一套高亮。
 */
export function handPickActionsOf(s: ClientSnapshot): Map<string, Respond> {
  const w = s.pendingWindow;
  return new Map(
    w?.type === "swapReturn" || w?.type === "shuffleDiscard"
      ? s.legalActions.flatMap((a) => (a.type === "respond" ? [[a.choice, a] as const] : []))
      : [],
  );
}

/** 手牌里该高亮的牌：能打的 + 能当代价／打断／取消交出去的 + 该挑一张还／弃的。 */
export function playableIds(s: ClientSnapshot): Set<string> {
  return new Set([
    ...playActionsOf(s).keys(),
    ...costActionsOf(s).keys(),
    ...handPickActionsOf(s).keys(),
  ]);
}
