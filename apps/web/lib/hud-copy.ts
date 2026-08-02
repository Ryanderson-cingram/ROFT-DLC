import type { Action, ClientSnapshot } from "@roft/engine";
import { cardLabel } from "./cards";
import { costActionsOf, playableIds } from "./legal";
import { effectLabel } from "./skills";

/**
 * 快照 → 玩家读得懂的一句话／一个按钮标签。零 DOM、零规则：
 * 能不能做一律看 `legalActions`，这里只负责把它翻成人话。
 * （文案从已删掉的 `hud.tsx` 逐字搬来。）
 *
 * `PHASES` / `PHASE_STEP` 随阶段条一起删了（P2 拆掉阶段条后零消费者）。
 */

/**
 * 窗口选项的人话。查不到就把 choice 原样显示，总比空按钮强。
 *
 * 导出是给覆盖率测试用的：引擎新加一个 choice 而这里没跟上，`hud.test.tsx` 就红
 * （带 `cardIds` 的那几个 choice 走手牌高亮，不出按钮，见测试里的例外表）。
 */
export const CHOICE_LABEL: Record<string, string> = {
  stack: "接着叠",
  accept: "吃下",
  // 劫营♦10 打断的 choice 是 "raid"（`actions/raid.ts::RAID`）；窗口类型才叫 interrupt
  raid: "劫营打断",
  farstar: "远星：弃代价牌，视为跟着叠",
  cancel: "取消这次洗牌",
  pass: "放弃",
  draw3: "不亮牌，摸 3 张",
  "soul-skip": "花魂跳过本回合",
  takeover: "重掷，采用我的结果",
};

/** 座位 → 昵称。快照里只有 userId，昵称由调用方从 room_seats join profiles 映射。 */
export type NameOf = (seat: number) => string;

/** 牌桌中央那句人话。窗口挂着时读条上写的也是它。 */
export function sayFor(s: ClientSnapshot, nameOf: NameOf): string {
  const w = s.pendingWindow;
  const youAreActor = !!w?.actors.includes(s.youSeat);
  const yourTurn = s.currentSeat === s.youSeat;
  const costActions = costActionsOf(s);

  if (s.winner != null) return `${nameOf(s.winner)}赢了这一局。`;
  // U8：终局但没有赢家 = 平局（牌堆洗满两次后又见底）
  if (s.phase === "finished") return "牌摸完了，两次重洗之后还是没人打完：本局平局。";
  if (w?.type === "skillDraft") return "开局：每人挑一个技能带上桌";
  if (w && youAreActor) {
    if (w.type === "punishStack")
      return `被 +2/+4 了：接着叠，或者吃下 ${s.punish?.total ?? 0} 张${
        // 远星：合法代价牌在手牌里高亮，点一张就等于跟着叠了一张
        costActions.size > 0 ? "；也可以点高亮的牌当代价弃掉，视为你也叠了一张" : ""
      }`;
    if (w.type === "soulHarvest")
      return "轮到你了：亮一张对得上的牌，或者不亮直接摸牌（对方按此攒魂）";
    if (w.type === "swapReturn") return "盲抽完了：从手牌里挑 1 张还给对方";
    if (w.type === "shuffleDiscard") return "洗牌·摸一弃一：摸完了，从手牌里挑 1 张弃掉";
    // 洗牌①：手上有洗牌牌的人先到先得，一人取消就作废
    if (w.type === "shuffleCancel")
      return `${nameOf(s.currentSeat ?? 0)}打出了洗牌（全体手牌打乱重分）：点高亮的洗牌牌取消，或者放弃`;
    if (w.type === "diceTakeover")
      return `${nameOf(s.dice?.seat ?? 0)}掷出了 ${s.dice?.values.join("、") ?? "?"}：你可以重掷同样数量并采用你的结果`;
    // 劫营♦10：并列是一张张摆的，窗口只针对刚摆下的那张（= 牌顶）
    if (w.type === "interrupt")
      return `${nameOf(s.currentSeat ?? 0)}刚摆下一张：点高亮的牌打断这一轮，或者放弃`;
    return `等待你响应：${nameOf(s.currentSeat ?? 0)}打出了牌，这一轮只等你要不要打断`;
  }
  // 洗牌③：`actors` 已被引擎遮成「只有你自己」，所以这里既报不出名字、也不该报——
  // 那一串就是「谁手上有洗牌牌」（暗信息）。其余窗口的 actors 由公开事实决定，照旧点名。
  if (w?.type === "shuffleCancel") return "等其他人决定要不要取消这次洗牌，其他操作先停下";
  if (w) return `等${w.actors.map(nameOf).join("、")}响应，其他操作先停下`;
  if (!yourTurn) return `${nameOf(s.currentSeat ?? 0)}的回合，等一等`;
  if (s.drawnPlayable) return "刚摸到的这张能打：打它，或者结束回合";
  // 选了叠就得真叠出来：链没结算前摸牌不合法（P3），别再提示「或者摸牌」。
  if (s.punish) return `接着叠：打一张能接的惩罚牌（累计 ${s.punish.total} 张）`;
  return "你的回合：挑一张能打的牌，或者摸牌";
}

/**
 * 手牌上方那行「高亮是什么意思」。
 *
 * 两个本地态（快照里没有）由调用方给，其余全部由快照推出来：
 * - `multiPicking` = 正在并列多选
 * - `costPicking` = 正在挑发动技能要弃的那张代价牌（恒心♠1，提交前的本地选择）
 *
 * **按窗口分叉**：司夜②还牌与洗牌②弃牌两个窗口里手牌就是操作对象，
 * 高亮的意思是「可以还给对方」「可以弃掉」，不是「现在能打」。
 */
export function handHint(s: ClientSnapshot, multiPicking: boolean, costPicking = false): string {
  if (multiPicking) return "多打：点选 2 张同色同数 / 4 张同数 / 6 张同色";
  if (costPicking) return "点一张牌弃掉当代价（手牌全部可选）";
  if (costActionsOf(s).size > 0) {
    if (s.pendingWindow?.type === "interrupt") return "高亮 = 能用来打断（同色同数）";
    if (s.pendingWindow?.type === "shuffleCancel") return "高亮 = 能用来取消这次洗牌（点了先定色）";
    return "高亮 = 能当代价弃掉";
  }
  if (s.pendingWindow?.actors.includes(s.youSeat)) {
    if (s.pendingWindow.type === "swapReturn") return "高亮 = 可以还给对方";
    if (s.pendingWindow.type === "shuffleDiscard") return "高亮 = 可以弃掉";
  }
  return playableIds(s).size > 0 ? "高亮 = 现在能打" : "这一轮没有能打的牌";
}

/** 一条动作 → 按钮上写什么。 */
export function buttonLabel(a: Action, s: ClientSnapshot, nameOf: NameOf): string {
  switch (a.type) {
    // 强袭♦1①：按面值打就点牌，这个按钮是「改用掷骰定倍率」那一条
    case "playCards": {
      const c = s.yourHand.find((x) => x.id === a.cardIds[0]);
      return `掷骰打${c ? cardLabel(c) : ""}（0 / 1 / 2 倍）`;
    }
    case "drawCard":
      return "摸牌";
    case "endTurn":
      return "结束回合";
    case "claimTimeout":
      return "催促超时";
    case "catchUno":
      return `抓${nameOf(a.target)}：没喊 UNO`;
    case "revealSkill":
      return "亮出技能";
    // 司夜♣3②：花 1 盗与谁换牌是玩家的选择，所以每个目标各一个按钮
    case "stealSwap":
      return `花 1 盗与${nameOf(a.target)}换 1 张`;
    // 影歌①②是同一个技能的两条主动：标签必须按 effectKey 分（否则两个按钮字面一样）
    case "activateSkill":
      return `发动技能：${effectLabel(s.players[a.seat]?.skillId ?? null, a.effectKey)}`;
    case "respond": {
      if (a.choice === "accept") return `吃下 ${s.punish?.total ?? 0} 张`;
      // 影歌①的亮牌选项：动作自带要亮哪张，按钮就写清楚亮的是什么、亮完摸不摸
      const shown = a.cardIds && s.yourHand.find((c) => c.id === a.cardIds![0]);
      if (shown)
        return `亮出${cardLabel(shown)}${a.choice === "show-exact" ? "（同色同数，不摸牌）" : "（半匹配，摸 1 张）"}`;
      return CHOICE_LABEL[a.choice] ?? a.choice;
    }
    default:
      return a.type;
  }
}
