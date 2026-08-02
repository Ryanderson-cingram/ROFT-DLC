// 技能定义的类型契约。字段模型见 docs/knowledge-base/02-methodology.md §1，
// 机读围栏块的格式见同文档 §6。
// 这里只声明「已经从知识库可靠提取到的」字段：条目没标注的字段一律缺席（undefined），
// 文档明确「未裁定」的字段为 null——两者不可混同，缺席取 §1 的文档默认值，null 等裁定。
// 注意：这是 skills 子模块自己的类型，不是 src/types.ts 那份引擎↔前端共享契约。

import type { DrawEventKind } from './primitives/draw-modifier.ts';

export type SkillStatus = '✅' | '❓' | '⚠️' | '✅/❓';

/** 02-methodology §2 效果类型 */
export type SkillEffectKind =
  | 'passive'
  | 'active'
  | 'on_reveal'
  | 'on_play'
  | 'response'
  | 'replacement'
  | 'status_grant'
  | 'meta_rule';

/** 02-methodology §3 时机窗口 */
export type SkillWindow =
  | 'turn_start'
  | 'play_phase'
  | 'after_play'
  | 'turn_end'
  | 'on_punish_resolve'
  | 'on_stack_contribute'
  | 'interrupt'
  | 'on_draw'
  | 'on_dice_roll'
  | 'any';

/** 02-methodology §7 摸牌数结算层级 */
export type DrawLayer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

/** 01-V2 白名单亮出时机；缺席 = 01-V1 默认「仅己方回合」 */
export type RevealWindow = 'own_turn' | 'any_time' | 'when_skipped' | 'when_challenged_uno';

/** 子效果（02-methodology §1「子效果 effects[]」）。null = 文档未裁定。 */
export interface SkillEffect {
  /** `1` / `2` / `3` / `passive` / `on_reveal`，与 04 散文里的 ①②③ 对应 */
  key: string;
  kind?: SkillEffectKind | null;
  window?: SkillWindow | null;
  /** 弃牌 / 标记 / 一次性等代价，自然语言**给人读**；同一个数的机读版在 `values` */
  cost?: string | null;
  /**
   * 本效果的数值，02-methodology §1/§6 的唯一机读落点（原 Q53）。
   * 键为 §7 的层名（`L2` / `L5`…）或 `discard` / `draws` / `marks` / `dice` / `card_value` / `max`。
   */
  values?: Record<string, number> | null;
  /**
   * 标记上限，键就是 03 §5 的标记名（`{ 魂: 6 }`）。这是「标记名 ↔ 上限」的**唯一**机读落点：
   * `values.max` 认不出自己管的是哪个标记（精英♥3 的 `max: 9` 管的是牌面点数），
   * 少了它引擎只能把标记名写死在 handler 里。**没有上限的标记不写**（司夜的「盗」）——
   * 缺席 = 无上限，写 0 会被读成「上限是 0」。
   */
  mark_cap?: Record<string, number> | null;
  /** 摸牌修正只作用于哪类摸牌事件；缺席 = 一切摸牌 */
  applies_to?: DrawEventKind[];
  targeting?: 'self' | 'single' | 'all_others' | 'global' | null;
  /** 一次性 / 每名玩家限一次 / 玩家人数次 / 无限 */
  once?: 'once' | 'once_per_player' | 'per_player_count' | 'unlimited' | null;
  /** 是否占用「每回合一条主动」（01-V7） */
  stacks_with_turn_limit?: boolean | null;
  /** 压制例外（06-Q39）：本效果无视的压制来源，如影歌② `["punish_turn"]`。封印不可例外（`sealable` 管）。 */
  suppression_exempt?: string[] | null;
  /** 如血棘「优先其他技能」 */
  priority?: boolean | null;
  /** 改摸数 / 改惩罚 / 改颜色规则等标签，取值表见 02-methodology §6 */
  modifies?: string[];
  duration?: string | null;
  /** 仅当 modifies 含 draw_count / draw_procedure 时出现（02-methodology §7） */
  layer?: DrawLayer[];
}

export interface SkillDef {
  /** 稳定 ID，如 `heart-3` / `star-grandeur` / `god-ricin`（02-methodology §1） */
  id: string;
  /** 中文名 */
  name: string;
  /** 花色与点数，如 `♥3` / `★` / `神` */
  suit_rank: string;
  /** 非普通技能的分类，如狂欢★ 的 `buff（非技能牌）` */
  category?: string;
  /** 知识库标注的裁定状态 */
  status: SkillStatus | string;
  /** 04-skills-catalog 的「摘要」栏，L0 自然语言，含 markdown 强调 */
  summary: string;
  /** 「疑点」栏；文档写 `—` 时为 null */
  caveats: string | null;
  /** 其他被记录的说明（★/神条目的「类型」「注」、围栏块的 `notes`），无则省略 */
  notes?: string;
  /** 01-V2 白名单亮出例外；缺席 = V1 默认 own_turn */
  reveal_window?: RevealWindow | null;
  force_reveal_ok?: boolean | null;
  force_activate_ok?: boolean | null;
  /** 可否被血棘♦2 封印；缺席 = 默认 true */
  sealable?: boolean | null;
  /** 升级链目标的 id（02-methodology §5） */
  upgrade_to?: string;
  /** 子效果；部分标注的条目只列已标注的那几条 */
  effects?: SkillEffect[];
  /**
   * 是否已**完整**结构化：条目的全部子效果都标注了才为 true。
   * 部分标注（例如只搬了 §7 的 layer）保持 false——宁可少而准。
   */
  structured: boolean;
  /**
   * 标注完整、但引擎还没建它的行为。`loadSkills` 据此把它挡在抽 3 选 1 之外——
   * 否则玩家会抽到一个亮出后什么都不发生的技能。实现之后从 04 的围栏块里删掉这一行。
   */
  unimplemented?: boolean;
}

export interface SkillDefsDoc {
  rulesetVersion: string;
  /** 生成来源，改规则先改文档 */
  source: string;
  generator: string;
  skills: SkillDef[];
}
