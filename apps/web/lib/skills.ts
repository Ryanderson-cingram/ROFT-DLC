/**
 * 玩家版技能文案，逐字取自 design/mockups/encyclopedia.html（它本身出自
 * docs/knowledge-base/04-skills-catalog.md）。spec §4 说最终要由构建期脚本
 * 从知识库生成 skill_defs，那时这份常量整体换掉；在那之前它是百科页与
 * 对局里技能弹窗的同一个来源，不要在组件里再抄一遍。
 *
 * **双源收敛（spec §8）**：`name` / `sigil` / `suit` 与引擎 `skill-defs.ts` 逐字重复，
 * 所以这里一条都不再写——主键就是**引擎 id**，那三项现读 `loadedSkills.byId`。
 * 从前 `Skill.id` 用中文名当主键，于是每次查技能都要绕引擎换一次名；那段桥接随之消失。
 */
import { loadedSkills } from "@roft/engine";

export type Suit = "spade" | "heart" | "diamond" | "club";

/** 引擎定义里**没有**的那几项：面向玩家的分类与两档说明。 */
export interface SkillCopy {
  /**
   * 玩家版分类。**不是** `effects[].kind` 的直译：引擎按子效果标机制
   * （司夜是 `on_play` + `meta_rule`×2、血棘是 `status_grant` + `active`），
   * 而玩家要的是整张技能怎么用。设计稿 game-status.html 的四张卡就是这么写的。
   */
  kind: "主动" | "被动" | "响应";
  l0: string;
  l1: string;
  /**
   * 每条主动效果的按钮文案，键 = 引擎的 `effectKey`（04 标注里的 ①②）。
   * 影歌①②是同一个技能的两条主动，没有它两个按钮的字面完全一样（spec §4.3）。
   * 只有多条主动的技能需要写；查不到就回落到 l0。
   */
  effects?: Record<string, string>;
}

export const SUITS: { id: Suit; sigil: string; name: string }[] = [
  { id: "spade", sigil: "♠", name: "黑桃" },
  { id: "heart", sigil: "♥", name: "红桃" },
  { id: "diamond", sigil: "♦", name: "方块" },
  { id: "club", sigil: "♣", name: "梅花" },
];

/** 引擎 id → 玩家版文案。**纯文案表**：名字、沿印、花色都不在这里。 */
export const SKILLS: Record<string, SkillCopy> = {
  "spade-1": {
    kind: "主动",
    l0: "弃一张牌，摸一张牌",
    l1: "回合开始阶段用一次：从手牌里丢一张进弃牌堆，再从牌堆摸一张。手牌数不变，专治「一手牌全打不出去」。",
  },
  "heart-1": {
    kind: "被动",
    l0: "被惩罚/被技能摸牌时少摸 2 张（至少 1）",
    l1: "不用挑时机，自动生效：因为惩罚或别人的技能要摸牌时，少摸 2 张，但最少还是要摸 1 张。碰上叠链，是按整条链的总张数减 2，不是每一段各减。",
  },
  // 04 §♥3 2026-07-29 裁定 + 引擎 stacks_with_turn_limit: true —— 当大 1 点打是主动选的
  "heart-3": {
    kind: "主动",
    l0: "数字牌可当作大 1 点打出（只剩 1 张手牌时失效）",
    l1: "手里的数字牌可以当成大 1 点的那个数打出去，最大只能当到 9。只剩 1 张手牌时这条失效，不能靠它收尾。",
  },
  "heart-4": {
    kind: "主动",
    l0: "两张同色同数 / 四张同数 / 六张同色可一起打出",
    l1: "满足其一就能一次打出多张：两张同色同数、四张同数、六张同色。和神化一起时按「轮」算 —— 神化给你多几轮，并列让你一轮里出多张。",
  },
  "diamond-1": {
    kind: "主动",
    l0: "打出 +2/+4 后掷骰改倍率；可替任何人重掷骰子",
    l1: "你打出 +2 或 +4 之后，可以掷一次三面骰（0/1/2）改这一张的倍率。另外，任何人掷完骰子，你都可以用同样数量的骰子重掷一次，最后采用你的结果。",
  },
  "diamond-2": {
    kind: "被动",
    l0: "你发起的惩罚会封印对方技能",
    l1: "由你发起的惩罚会封住对方的技能，直到解封条件达成。被封的人就算还没亮技能，这段时间也不能亮。回合开始你还可以掷骰，让被你封住的人摸等量的牌。",
    effects: { "1": "掷骰放血：被你封印的人摸等量的牌" },
  },
  "diamond-3": {
    kind: "主动",
    l0: "一次性攒「魂」（最多 6）；花 2 魂跳过回合",
    l1: "回合开始阶段可以攒魂，最多攒到 6 个。花 2 魂跳过一个回合，惩罚回合也能跳。攒魂和跳过都占用你这回合的主动位，一回合只能做一件。",
    effects: { "1": "攒 1 个魂（最多 6）", "2": "花 2 魂跳过这一回合" },
  },
  "diamond-10": {
    kind: "响应",
    l0: "他人一次打多张时，可用同色同数的牌打断",
    l1: "并列（将来还有神化）是一张张摆下去的，每摆一张你都有一次机会：手里正好有同色同数的那张，就打出去打断他。对方摸 1 张，剩下没摆的牌回到他手里，接着从你的下家按你打的这张继续。被打断的人剩下的神化轮作废。",
  },
  "diamond-j": {
    kind: "响应",
    l0: "上家 +2/+4 时弃代价牌并摸 2，视为跟着叠牌",
    l1: "上家出 +2，你弃一张同色的停或转；上家出 +4，你弃一张 +2。然后摸 2 张，就算你也跟着叠了一层。注意：视为的那张 +4 用你弃掉的 +2 的颜色，不能另选颜色。",
  },
  // 06-Q57：①②③ 全是被动触发，一条主动都没有——不占「每回合一条主动」
  "club-3": {
    kind: "被动",
    l0: "打出变色牌后掷骰获「盗」；花盗换手牌",
    l1: "你每打出一张变色牌，就掷一次骰，得到 0、1 或 2 个「盗」。回合开始阶段可以花盗换手牌。攒到 3 盗或 5 盗时，最后一张牌可以是功能牌或变色牌，但那张仍然必须能合法打出。",
  },
};

/** 文案 + 引擎定义合成的一张技能卡。`id` 就是**引擎 id**。 */
export interface Skill extends SkillCopy {
  id: string;
  name: string;
  sigil: string;
  suit: Suit;
  /**
   * 引擎定义里的子效果条数（技能弹窗头部的「主动 ×2」计数徽）。
   * 数据在引擎，不在上面那张按钮文案表——文案表只写「多条主动要分别叫什么」。
   */
  effectCount: number;
}

/** 引擎 id → 合成技能卡。不在文案表里（诸神包等）的返回 undefined，调用方回落到 id。 */
export const skillById = (id: string | null): Skill | undefined => {
  const copy = id ? SKILLS[id] : undefined;
  const def = id ? loadedSkills.byId.get(id) : undefined;
  if (!id || !copy || !def) return undefined;
  return {
    ...copy,
    id,
    name: def.name,
    sigil: def.suit_rank,
    suit: id.slice(0, id.indexOf("-")) as Suit,
    effectCount: def.effects?.length ?? 0,
  };
};

/** 百科页按花色分组用。顺序就是文案表的书写顺序。 */
export const allSkills = (): Skill[] => Object.keys(SKILLS).flatMap((id) => skillById(id) ?? []);

/**
 * 发动时要先在本地「指定一张色+数」的效果（影歌①）。
 *
 * ponytail: 02 §1 的字段模型还没有「本效果需要宣言」这一格，所以这里按 id 列出来。
 * 它只决定弹哪个提交面板，不判合法性——校验在引擎（缺宣言 → declaration_required）。
 * 等 §1 补了字段，这张表换成读定义即可。
 */
const DECLARES = new Set(["diamond-3:1"]);
export const needsDeclaration = (skillId: string, effectKey: string) => DECLARES.has(`${skillId}:${effectKey}`);

/**
 * 发动按钮的文案：per-effect 文案优先，没写的回落到 l0（单主动技能不用逐条写）。
 * 查不到技能就给一句保底，按钮永远不会是空的。
 */
export const effectLabel = (skillId: string | null, effectKey: string) => {
  const s = skillById(skillId);
  return s?.effects?.[effectKey] ?? s?.l0 ?? "发动技能";
};

/**
 * U5 脚注（百科页用）。它不是「第五句总则」——四句总则本身逐字不变。
 * 逐字取自 design/mockups/encyclopedia.html。
 */
export const CREED_FOOTNOTE = {
  text: "最后一张牌必须是数字牌才算赢。功能牌（+2 / 停 / 转 / 变色 / +4 / 毒 / 洗牌）打完手牌时要再摸 1 张，牌照常生效，但你没赢。",
  aside: "（司夜的「盗」可以放宽这条）",
};

/** 四句总则（技能弹窗第二页签与百科页共用），逐字同源。 */
export const CREED = [
  "回合开始用技能，然后出牌。",
  "被 +2/+4 时先叠或不叠；叠的时候只算你自己那张的加成。",
  "一人一个技能；亮出来才会生效。",
  "神化 = 多几轮出牌；并列 = 一轮里多张。",
];
