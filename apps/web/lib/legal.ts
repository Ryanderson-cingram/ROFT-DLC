import type { Action, Card, ClientSnapshot, Color } from "@roft/engine";

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
 * 「从手牌里挑**一张**交上去」——只有司夜②还牌一个窗口：`respond.choice` 就是牌 id。
 * 这个窗口里手牌本身就是操作对象（spec §3.4：无遮罩），所以它与可打的牌走同一套高亮。
 *
 * 摸 N 弃 N 不走这里：它要挑的是**一组**，引擎只给一条模板动作（组合枚举会爆炸），
 * 手牌整个进多选态，凑齐 N 张再由坞里的按钮提交。
 */
export function handPickActionsOf(s: ClientSnapshot): Map<string, Respond> {
  const w = s.pendingWindow;
  return new Map(
    w?.type === "swapReturn"
      ? s.legalActions.flatMap((a) => (a.type === "respond" ? [[a.choice, a] as const] : []))
      : [],
  );
}

/**
 * 这张牌定色时被锁到哪个色（`null` = 四色随便选）。
 *
 * **判据整条来自快照的 `wildColorLock`**，这里一条规则都不判。从前这一句长在
 * `page.tsx` 里、自己认「五彩」那一个状态、还把锁定色写死成跟色，于是三个来源
 * 三种表现：五彩对了，行进曲（吟游♣5，全场）与专精♥9（锁的是他的**专属色**，
 * 根本不是跟色）都画成四色可选，选错才被服务端拒成 `color_locked`。
 *
 * `card.color === null` 不是在判规则，是在读契约：`wildColorLock` 按定义只管无色牌，
 * 并列♥4 的 4 张同数也要定色但**不在其列**（引擎那边同样不锁，见 `play-cards.ts`
 * 的 `isWild(card) &&` 那道门）。
 */
export const wildColorLockFor = (s: ClientSnapshot, card?: Card | null): Color | null =>
  card?.color === null ? s.wildColorLock : null;

/** 手牌里该高亮的牌：能打的 + 能当代价／打断／取消交出去的 + 该挑一张还／弃的。 */
export function playableIds(s: ClientSnapshot): Set<string> {
  return new Set([
    ...playActionsOf(s).keys(),
    ...costActionsOf(s).keys(),
    ...handPickActionsOf(s).keys(),
  ]);
}
