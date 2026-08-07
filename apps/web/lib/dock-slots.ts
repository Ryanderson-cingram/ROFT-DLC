import type { Action, ClientSnapshot } from "@roft/engine";
import { buttonLabel, handHint, sayFor, type NameOf } from "./hud-copy";
import { costActionsOf } from "./legal";

/**
 * 命令坞的三个**固定**槽位。设计反馈第 5 条（「按钮别乱跑」）在代码里的落点：
 * 位置永不改变，没有的动作返回 `disabled + reason`，**不返回 undefined**、也不消失。
 *
 * 它同时是「客户端零规则」的守门员——`legalActions` 里有什么就点得动什么，
 * 这里一条合法性都不判，只决定「落在哪个槽、写什么字、灰的话为什么灰」。
 *
 * 不进三槽的动作（坞上／桌上另有位置）：
 * - `callUno` —— 坞右上角常驻定点（U6：按下即受理，代价写在旁边）
 * - `catchUno` —— 跟 `callUno` 并排在同一个定点上（`.unobar`），多目标时每个目标一条。
 *   按钮上写着抓谁，所以不必长在那个人的座位卡里（轨在窄屏是横滚的，找人才点得到）
 * - `claimTimeout` —— 任意成员都能催，跟着倒计时环走（spec §7）
 */

export type SlotTone = "primary" | "danger" | "ghost";
export interface Slot {
  /** 0 条 = 这个槽此刻没得点。1 条渲染成单按钮，>1 条渲染成一个按钮 + 点开的菜单——**槽位位置两种情况下都不变**。 */
  actions: Action[];
  /** 1 条时是那条动作的文案；多条时是组标签（「发动技能」「掷骰打」…）。 */
  label: string;
  tone?: SlotTone;
  /** 恒等于 `actions.length === 0`，由 `fill` 派生，两者不可能不一致。 */
  disabled: boolean;
  reason?: string;
  note?: string;
  /** 多条时给菜单用的逐条文案，与 `actions` 同序。 */
  itemLabels?: string[];
}
export type SlotName = "skill" | "main" | "yield";
export type DockSlots = Record<SlotName, Slot>;

/** 槽位灰着时写的字。有动作时一律用 `buttonLabel`，不在这里另写一套。 */
const IDLE_LABEL: Record<SlotName, string> = { skill: "发动技能", main: "出牌", yield: "摸牌" };

const isRespond = (a: Action, choice: string) => a.type === "respond" && a.choice === choice;

/** 左槽：本技能的主动。`soul-skip` 形式上是 respond，实质是影歌②的主动（见 `hud.tsx:294` 的置灰条件）。 */
const isSkillAction = (a: Action) =>
  a.type === "activateSkill" ||
  a.type === "stealSwap" ||
  a.type === "revealSkill" ||
  isRespond(a, "soul-skip");

/** 右槽：退让与结束。合纵/连横②的「这次不摸」是退让（S14：每次都是可选）。 */
const YIELD_CHOICES = ["accept", "pass", "draw3", "decline", "refuse", "keep"];
const isYieldAction = (a: Action) =>
  a.type === "drawCard" ||
  a.type === "endTurn" ||
  (a.type === "respond" && YIELD_CHOICES.includes(a.choice));

/**
 * 中槽：推进的主操作（叠 / 打断 / 重掷 / 亮牌 / 掷骰打）。
 * 排除项与 `hud.tsx:80-92` 那 5 条 `&&` 过滤逐条对应：
 * 出牌一律点牌（只有强袭那条变体表达不了「同一张的两种打法」，所以单独进槽）；
 * 按牌给出的 respond（远星 / 劫营 / 洗牌③）在手牌里高亮，不占槽；
 * 还牌（司夜②）的 choice 是牌 id，出成按钮没法看；摸 N 弃 N 的确认按钮要带本地选中的
 * 那几张，只有坞自己填得上（同并列的「打出 N 张」），所以两个都不占槽。
 */
const isMainAction = (a: Action, s: ClientSnapshot, hasCostCards: boolean) => {
  if (isSkillAction(a) || isYieldAction(a)) return false;
  if (a.type === "playCards") return !!a.useAssault;
  if (a.type !== "respond") return false;
  const w = s.pendingWindow?.type;
  if (w === "swapReturn" || w === "drawDiscard" || w === "handOver") return false;
  return !(a.cardIds && hasCostCards);
};

/** 与 `hud.tsx::buttonClass` 同一张映射表（P3 接线时那个函数随 hud 一起删）。 */
const toneOf = (a: Action): SlotTone | undefined => {
  if (a.type === "playCards") return "primary";
  if (a.type === "respond")
    return a.choice === "accept" ? "danger"
      : a.choice === "pass" || a.choice === "decline" || a.choice === "refuse" || a.choice === "keep" ? "ghost"
      : "primary";
  return undefined;
};

/**
 * 多条动作挤在一个槽里时的组标签（按钮上写这个，逐条文案进 `itemLabels` 给菜单）。
 * 查不到就回落到该槽灰着时的字，按钮永远不会是空的。
 */
const GROUP_LABEL: Partial<Record<Action["type"], string>> = {
  activateSkill: "发动技能",
  stealSwap: "花 1 盗换牌",
  playCards: "掷骰打",
  // 中槽里唯一会多条并存的 respond 是影歌①的亮牌（劫营 / 远星 / 洗牌③走手牌高亮，不占槽）
  respond: "亮牌",
};

const fill = (name: SlotName, actions: Action[], s: ClientSnapshot, nameOf: NameOf, reason: string): Slot => {
  const [a] = actions;
  if (!a) return { actions: [], label: IDLE_LABEL[name], disabled: true, reason };
  const itemLabels = actions.map((x) => buttonLabel(x, s, nameOf));
  const many = actions.length > 1;
  return {
    actions,
    label: many ? (GROUP_LABEL[a.type] ?? IDLE_LABEL[name]) : itemLabels[0],
    tone: toneOf(a),
    disabled: false,
    ...(many ? { itemLabels } : {}),
  };
};

/**
 * 三槽的唯一入口。`nameOf` 只用来拼人话（理由句复用那句「一句人话」，不另造文案）。
 */
export function dockSlots(s: ClientSnapshot, nameOf: NameOf): DockSlots {
  const w = s.pendingWindow;
  // 抽 3 选 1 由全屏面板接管，坞整个歇着；终局同理。
  const yourMove =
    s.winner == null &&
    s.phase !== "finished" &&
    (w ? w.type !== "skillDraft" && w.actors.includes(s.youSeat) : s.currentSeat === s.youSeat);

  // 轮不到你动：三槽全灰，理由就是那句人话（「等阿柴响应」/「老白的回合，等一等」/「开局：每人挑一个技能带上桌」）
  if (!yourMove) {
    const reason = sayFor(s, nameOf);
    return {
      skill: fill("skill", [], s, nameOf, reason),
      main: fill("main", [], s, nameOf, reason),
      yield: fill("yield", [], s, nameOf, reason),
    };
  }

  const hasCostCards = costActionsOf(s).size > 0;
  const you = s.players.find((p) => p.seat === s.youSeat);
  const skillReason =
    // 01-P9：被封印期间整张技能卡是关着的（主动发不了、被动也不生效）
    you?.statuses.includes("封印") ? "被血棘封印：技能连被动一起关着"
    // P1：惩罚窗口里只有叠或吃——除非某条效果声明了豁免（影歌②就有），那条会占住这个槽
    : w?.type === "punishStack" ? "惩罚回合不能用主动技能"
    : !you?.skillId ? "你还没有技能"
    : "现在不能发动技能";
  // 手牌就是操作对象的两个窗口，理由用那句人话（「从手牌里挑 1 张还给对方」）比「没有能打的牌」准
  const handPick = w?.type === "swapReturn" || w?.type === "drawDiscard" || w?.type === "handOver";
  const mainReason = handPick ? sayFor(s, nameOf) : handHint(s, false);

  return {
    skill: fill("skill", s.legalActions.filter(isSkillAction), s, nameOf, skillReason),
    main: fill("main", s.legalActions.filter((a) => isMainAction(a, s, hasCostCards)), s, nameOf, mainReason),
    yield: fill("yield", s.legalActions.filter(isYieldAction), s, nameOf, sayFor(s, nameOf)),
  };
}
