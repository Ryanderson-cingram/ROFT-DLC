// 技能定义的唯一生成源：docs/knowledge-base/04-skills-catalog.md → 版本化 JSON。
// 产物：packages/engine/src/skills/skill-defs.{json,ts} 与 supabase/migrations/0004_skill_defs_seed.sql
// 跑：pnpm --filter @roft/engine gen:skills（CI 重跑后 git diff 必须为空）
//
// 两路输入，都在 04 里：
//   1. 散文（表格行 / ★ 条目要点）→ id/name/suit_rank/status/summary/caveats/notes
//   2. ```yaml 围栏块（格式见 02-methodology §6）→ effects[]/reveal_window/layer/…
// 围栏块是**原样透传**：文档写了什么就出什么，显式留空 → null（= 未裁定），
// 省略 → 字段缺席（= 取 02 §1 的文档默认值）。生成器不替文档补默认值、更不猜。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SkillDef, SkillDefsDoc, SkillEffect } from '../packages/engine/src/skills/types.ts';

const RULESET_VERSION = '4.1';
const SOURCE = 'docs/knowledge-base/04-skills-catalog.md';
const GENERATOR = 'scripts/gen-skill-defs.ts';

const repoRoot = new URL('..', import.meta.url);

/** 04 §统计：4 条 ★ + 52 个点位 + 4 尊神。少一条就是解析漏了，别静默通过。 */
const EXPECTED_COUNT = 60;

const SUITS: Record<string, string> = { '♥': 'heart', '♦': 'diamond', '♠': 'spade', '♣': 'club' };

/** 04 文件头的状态图例（含复合值）。状态栏里塞别的东西（分类、备注）在这里红。 */
const STATUSES = new Set(['✅', '❓', '⚠️', '✅/❓']);

// ── 围栏块的字段与取值白名单（02-methodology §1/§2/§3/§6/§7）。
// 白名单之外一律抛错：拼错字段名静默变成「没标注」是最难查的漂移。
const SKILL_KEYS = new Set([
  'id',
  'category',
  'reveal_window',
  'force_reveal_ok',
  'force_activate_ok',
  'sealable',
  'upgrade_to',
  'pairs_with',
  'reveal_when',
  'notes',
  'structured',
  'unimplemented',
  'effects',
]);
const EFFECT_KEYS = new Set([
  'key',
  'kind',
  'window',
  'cost',
  'values',
  // 标记名 ↔ 上限的绑定（03 §5 的标记 + 04 的上限）。`values.max` 认不出自己管的是哪个标记
  // （精英♥3 的 max 管的是牌面点数），所以上限单独一个键，键名就是标记名。
  'mark_cap',
  'applies_to',
  'targeting',
  'once',
  'stacks_with_turn_limit',
  'suppression_exempt',
  'priority',
  'option_of',
  'modifies',
  'procedure',
  'grants',
  'immune',
  'duration',
  'layer',
]);
// 生成产物里的字段顺序（JSON 逐字节比对，顺序必须稳定且好读）
const EFFECT_ORDER = [...EFFECT_KEYS];
const SKILL_ORDER = [
  'id',
  'name',
  'suit_rank',
  'category',
  'status',
  'summary',
  'caveats',
  'notes',
  'reveal_window',
  'force_reveal_ok',
  'force_activate_ok',
  'sealable',
  'reveal_when',
  'upgrade_to',
  'pairs_with',
  'effects',
  'structured',
  'unimplemented',
];
const ENUMS: Record<string, Set<string>> = {
  kind: new Set([
    'passive',
    'active',
    'on_reveal',
    'on_play',
    'response',
    'replacement',
    'status_grant',
    'meta_rule',
  ]),
  window: new Set([
    'turn_start',
    'play_phase',
    'after_play',
    'turn_end',
    'on_punish_resolve',
    'on_stack_contribute',
    'interrupt',
    'on_draw',
    'on_dice_roll',
    'any',
  ]),
  targeting: new Set(['self', 'single', 'all_others', 'global']),
  once: new Set(['once', 'once_per_player', 'per_player_count', 'unlimited']),
  duration: new Set([
    'instant',
    'until_event',
    'while_revealed',
    'until_skill_replaced',
    'permanent',
  ]),
  reveal_window: new Set(['own_turn', 'any_time', 'when_skipped', 'when_challenged_uno']),
  // L6 后置程序的名字（02 §6）。新增一支要同时在引擎的 `PROCEDURES` 里注册，
  // 否则数据点名了一支引擎没有的程序 = 静默什么都不做。
  procedure: new Set(['draw_then_discard', 'hand_over']),
};
const LAYERS = new Set(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
/** 02 §6 `values` 的键白名单：§7 的层名 + 代价/张数名。拼错键名 = 这个数静默没标。 */
const VALUE_KEYS = new Set([
  ...LAYERS,
  'discard',
  'draws',
  'draws_partial',
  'draws_combo',
  'give',
  'marks',
  'marks_wild',
  'dice',
  'card_value',
  'max',
]);
// `skill_others` = **他人**技能造成的摸牌（06-Q56 给恩惠♥1 的口径）；`skill` 不分你我
const DRAW_EVENTS = new Set(['punish', 'skill', 'skill_others', 'rule']);
/**
 * 03 §4 的状态表 + 封印（血棘♦2 赋予、压制层消费）。
 * 与 `mark_cap` 的键不同，状态是**闭集**（§4 就是那张表），所以查白名单：
 * 拼错一个状态名 = 引擎赋一个谁都不认识的状态，静默什么都不发生。
 */
const STATUS_NAMES = new Set(['五彩', '心盲', '恋战', '领域', '同命', '封印']);
const MODIFIES = new Set([
  'draw_count',
  'draw_procedure',
  'draw_obligation',
  'punish_amount',
  'card_value',
  'color_rule',
  'play_legality',
  'turn_flow',
  'dice',
]);

const clean = (s: string) => s.trim().replace(/\s+$/, '');
const orNull = (s: string) => (s === '' || s === '—' || s === '-' ? null : s);

// ── 极小 YAML 子集解析器（02-methodology §6 的格式，Node 内置 API，无依赖）。
// 只认四样东西：顶层 `键: 值`、`effects:` 下的对象列表、行内数组 `[a, b]`、行内映射 `{ k: 1 }`。
// 超出子集就抛错，绝不「尽力而为」地静默吃掉一行标注。
type Scalar = string | boolean | null;
const FIELD = /^([a-z_]+):[ ]?(.*)$/;

function parseValue(v: string, at: string): Scalar | string[] | Record<string, number> {
  const t = v.trim();
  if (t === '') return null; // 显式留空 = 文档未裁定
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t.startsWith('[')) {
    if (!t.endsWith(']')) throw new Error(`${at}: 行内数组未闭合「${t}」`);
    const inner = t.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((s) => s.trim());
  }
  // 行内映射用于 `values`（02 §6）与 `mark_cap`：值只能是整数。
  // 键不限 ASCII——`mark_cap` 的键就是标记名，而 03 §5 的标记名是中文且是开放集合。
  // 键合不合法各自校验：`values` 查 §6 白名单，`mark_cap` 不查（标记名是开放字符串）。
  if (t.startsWith('{')) {
    if (!t.endsWith('}')) throw new Error(`${at}: 行内映射未闭合「${t}」`);
    const out: Record<string, number> = {};
    const inner = t.slice(1, -1).trim();
    if (inner === '') return out;
    for (const pair of inner.split(',')) {
      const m = /^([^\s:,{}]+):[ ]*(-?\d+)$/.exec(pair.trim());
      if (!m) throw new Error(`${at}: 行内映射项只能是「键: 整数」，收到「${pair.trim()}」`);
      if (m[1] in out) throw new Error(`${at}: 行内映射键「${m[1]}」重复`);
      out[m[1]] = Number(m[2]);
    }
    return out;
  }
  return t;
}

export function parseFence(body: string, at: string): Record<string, unknown> {
  const doc: Record<string, unknown> = {};
  const effects: Record<string, unknown>[] = [];
  let inEffects = false;

  for (const raw of body.split('\n')) {
    if (!raw.trim()) continue;
    const indented = /^\s/.test(raw);
    const line = raw.trim();

    if (!indented) {
      const m = FIELD.exec(line);
      if (!m) throw new Error(`${at}: 顶层无法解析「${line}」`);
      const [, k, v] = m;
      if (!SKILL_KEYS.has(k)) throw new Error(`${at}: 未知技能级字段「${k}」`);
      if (k in doc) throw new Error(`${at}: 字段「${k}」重复`);
      if (k === 'effects') {
        if (v.trim() !== '') throw new Error(`${at}: effects 只能是列表`);
        inEffects = true;
        doc.effects = effects;
      } else {
        inEffects = false;
        doc[k] = parseValue(v, at);
      }
      continue;
    }

    if (!inEffects) throw new Error(`${at}: 只有 effects 支持缩进「${line}」`);
    const isItem = line.startsWith('- ');
    if (isItem) effects.push({});
    if (!effects.length) throw new Error(`${at}: effects 的第一行必须以「- 」开头`);
    const m = FIELD.exec(isItem ? line.slice(2) : line);
    if (!m) throw new Error(`${at}: effects 项无法解析「${line}」`);
    const [, k, v] = m;
    if (!EFFECT_KEYS.has(k)) throw new Error(`${at}: 未知子效果字段「${k}」`);
    effects[effects.length - 1][k] = parseValue(v, at);
  }
  return doc;
}

function checkEnum(field: string, value: unknown, at: string) {
  const allowed = ENUMS[field];
  if (!allowed || value === null || value === undefined) return;
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new Error(`${at}: ${field} = 「${String(value)}」不在 02-methodology 的取值表里`);
  }
}

/**
 * `values` 是数值的唯一机读落点（02 §6，原 Q53）。这里守两件事：
 * 键在白名单里（拼错 = 这个数静默没标），以及层名键与 `layer` 对得上。
 * 完整标注（`structured: true`）双向都得齐——声明了 L2 却没给数，引擎跑到那一层只能炸。
 */
function checkValues(raw: Record<string, unknown>, at: string, structured: boolean) {
  const v = raw.values;
  const layers = Array.isArray(raw.layer) ? (raw.layer as string[]) : [];
  if (v === undefined || v === null) {
    if (structured && layers.length) throw new Error(`${at}: 声明了 layer ${layers.join('/')} 却没有 values`);
    return;
  }
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${at}: values 必须写成行内映射 { 键: 数字 }`);
  const keys = Object.keys(v as Record<string, number>);
  for (const k of keys) {
    if (!VALUE_KEYS.has(k)) throw new Error(`${at}: values 含未登记的键「${k}」——先加进 02-methodology §6`);
    if (LAYERS.has(k) && !layers.includes(k)) throw new Error(`${at}: values 给了 ${k} 的数，但 layer 里没有 ${k}`);
  }
  if (structured) {
    for (const l of layers) {
      // L1（替换层）的值可以是**掷出来的**：伤逝按链上张数掷骰求和，骰数随牌桌变，
      // 没有常数可标。带了 `dice` 就算标全了（02 §6 的这条例外只给 L1 开）。
      if (l === 'L1' && keys.includes('dice')) continue;
      if (!keys.includes(l)) throw new Error(`${at}: layer 声明了 ${l}，但 values 里没有它的数`);
    }
  }
}

/**
 * `mark_cap: { 标记名: 上限 }`——03 §5 的标记名是**开放集合**（§5 自己写着「不完全列表」），
 * 所以键不查白名单，只守两件事：写成行内映射，且上限 ≥ 1。
 * **没有上限的标记不写这个字段**（司夜的「盗」）：缺席 = 无上限，写 0 会被读成「上限是 0」。
 */
function checkMarkCap(v: unknown, at: string) {
  if (v === undefined || v === null) return;
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${at}: mark_cap 必须写成行内映射 { 标记名: 上限 }`);
  for (const [k, n] of Object.entries(v as Record<string, number>)) {
    if (n < 1) throw new Error(`${at}: mark_cap「${k}」= ${n}；无上限就别写这个键，别写 0`);
  }
}

/**
 * `procedure` 与 `modifies: [draw_procedure]` 必须同进同出（02 §6）。
 * L6 不改数字，光有 `layer: [L6]` 说不出改的是哪种执行方式——少了名字引擎只能静默跳过。
 */
function checkProcedure(raw: Record<string, unknown>, at: string, structured: boolean) {
  const isProc = Array.isArray(raw.modifies) && raw.modifies.includes('draw_procedure');
  if (raw.procedure !== undefined && raw.procedure !== null && !isProc) {
    throw new Error(`${at}: 写了 procedure 却没在 modifies 里点名 draw_procedure`);
  }
  if (structured && isProc && !raw.procedure) throw new Error(`${at}: modifies 含 draw_procedure，但没写是哪支 procedure`);
}

/**
 * `reveal_when`（02 §6）：亮出窗口的条件。键是白名单，且**必须**跟着一个 `reveal_window`——
 * 条件挂空档等于写了个谁都不会读的数。
 */
const REVEAL_CONDITIONS = new Set(['hand_at_least']);
function checkRevealWhen(doc: Record<string, unknown>, at: string) {
  const v = doc.reveal_when;
  if (v === undefined || v === null) return;
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${at}: reveal_when 必须写成行内映射`);
  if (!doc.reveal_window) throw new Error(`${at}: 写了 reveal_when 却没有 reveal_window——条件挂在空档上`);
  for (const k of Object.keys(v as Record<string, number>)) {
    if (!REVEAL_CONDITIONS.has(k)) throw new Error(`${at}: reveal_when 含未登记的条件「${k}」`);
  }
}

/**
 * `grants` 与 `kind: status_grant` 同进同出（02 §6），状态名查 03 §4 的闭集。
 * 血棘♦2 的封印是**结算副产物**（吃下惩罚即封印），赋予写在 `actions/bloodthorn.ts` 里，
 * 所以它虽然是 `status_grant` 却不带 `grants`——完整标注时才要求写。
 */
function checkGrants(raw: Record<string, unknown>, at: string, structured: boolean) {
  const v = raw.grants;
  if (v === undefined || v === null) return;
  if (!Array.isArray(v)) throw new Error(`${at}: grants 必须写成行内数组`);
  if (raw.kind !== 'status_grant') throw new Error(`${at}: grants 只能写在 kind: status_grant 上`);
  if (structured && v.length === 0) throw new Error(`${at}: grants 是空的——赋予什么状态？`);
  for (const s of v) if (!STATUS_NAMES.has(s)) throw new Error(`${at}: grants 含 03 §4 没有的状态「${s}」`);
}

/** `immune`：免疫哪几个状态（02 §6）。状态名查 03 §4 的同一张闭集表。 */
function checkImmune(raw: Record<string, unknown>, at: string) {
  const v = raw.immune;
  if (v === undefined || v === null) return;
  if (!Array.isArray(v)) throw new Error(`${at}: immune 必须写成行内数组`);
  for (const s of v) if (!STATUS_NAMES.has(s)) throw new Error(`${at}: immune 含 03 §4 没有的状态「${s}」`);
}

export function toEffect(raw: Record<string, unknown>, at: string, structured: boolean): SkillEffect {
  if (typeof raw.key !== 'string' || raw.key === '') {
    throw new Error(`${at}: 每条子效果都要有非空的 key（02-methodology §6）`);
  }
  for (const f of ['kind', 'window', 'targeting', 'once', 'duration', 'procedure']) checkEnum(f, raw[f], at);
  checkValues(raw, at, structured);
  checkProcedure(raw, at, structured);
  checkGrants(raw, at, structured);
  checkImmune(raw, at);
  checkMarkCap(raw.mark_cap, at);
  for (const [f, allowed] of [
    ['modifies', MODIFIES],
    ['layer', LAYERS],
    ['applies_to', DRAW_EVENTS],
  ] as const) {
    const v = raw[f];
    if (v === undefined || v === null) continue;
    if (!Array.isArray(v)) throw new Error(`${at}: ${f} 必须写成行内数组`);
    for (const x of v) if (!allowed.has(x)) throw new Error(`${at}: ${f} 含未知取值「${x}」`);
  }
  const out: Record<string, unknown> = {};
  for (const k of EFFECT_ORDER) if (k in raw) out[k] = raw[k];
  return out as unknown as SkillEffect;
}

/** 把围栏块并进散文解析出来的条目；id 对不上就是文档写错了，抛。 */
function applyFences(md: string, skills: SkillDef[]) {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const seen = new Set<string>();

  for (const [, body] of md.matchAll(/```yaml\n([\s\S]*?)\n```/g)) {
    const doc = parseFence(body, '围栏块');
    const id = doc.id;
    if (typeof id !== 'string') throw new Error(`围栏块缺 id：\n${body}`);
    const at = `围栏块 ${id}`;
    const skill = byId.get(id);
    if (!skill) throw new Error(`${at}: 04 里没有这个 id 的条目`);
    if (seen.has(id)) throw new Error(`${at}: 同一个 id 有多个围栏块`);
    seen.add(id);

    checkEnum('reveal_window', doc.reveal_window, at);
    if ('category' in doc) skill.category = doc.category as string;
    for (const k of ['reveal_window', 'force_reveal_ok', 'force_activate_ok', 'sealable'] as const) {
      if (k in doc) (skill as unknown as Record<string, unknown>)[k] = doc[k];
    }
    checkRevealWhen(doc, at);
    if ('reveal_when' in doc) (skill as unknown as Record<string, unknown>).reveal_when = doc.reveal_when;
    if ('upgrade_to' in doc) skill.upgrade_to = doc.upgrade_to as string;
    if ('pairs_with' in doc) skill.pairs_with = doc.pairs_with as string;
    if ('notes' in doc) {
      skill.notes = [skill.notes, doc.notes].filter(Boolean).join('；');
    }
    if ('effects' in doc) {
      const structured = doc.structured === true;
      skill.effects = (doc.effects as Record<string, unknown>[]).map((e) => toEffect(e, at, structured));
      // 02 §6：`option_of` 必须指向**同一技能里的一条主动**（选项本身不是另一条主动）
      const actives = new Set(skill.effects.filter((e) => e.kind === 'active').map((e) => e.key));
      for (const e of skill.effects) {
        const parent = (e as unknown as Record<string, unknown>).option_of;
        if (parent === undefined || parent === null) continue;
        if (!actives.has(parent as string)) throw new Error(`${at}: option_of「${parent}」不是本技能的一条主动`);
        if (e.kind === 'active') throw new Error(`${at}: 选项「${e.key}」不该自己也标成 active（额度记在父主动上）`);
      }
    }
    if ('structured' in doc) {
      if (doc.structured !== true) throw new Error(`${at}: structured 只在完整标注时写 true`);
      if (!skill.effects?.length) throw new Error(`${at}: structured: true 但没有 effects`);
      skill.structured = true;
    }
    // 标注完整、但引擎还没建它的行为：诚实地标出来，`loadSkills` 据此把它挡在抽 3 选 1 之外。
    // 少了这条，一个「定义齐全但没人实现」的技能会被抽到、亮出，然后什么都不发生。
    if ('unimplemented' in doc) {
      if (doc.unimplemented !== true) throw new Error(`${at}: unimplemented 只在还没实现时写 true，实现后删掉这一行`);
      (skill as unknown as Record<string, unknown>).unimplemented = true;
    }
  }

  for (const s of skills) {
    if (s.upgrade_to && !byId.has(s.upgrade_to)) {
      throw new Error(`${s.id}: upgrade_to「${s.upgrade_to}」不是已知条目`);
    }
    // 02 §6：成对技能必须**双向**写（合纵写连横、连横也要写合纵）。单向 = 半张定义，
    // 而 01-S13 是「任一方先亮出都触发」，引擎从哪一头找都得找得到另一半。
    if (s.pairs_with) {
      const other = byId.get(s.pairs_with);
      if (!other) throw new Error(`${s.id}: pairs_with「${s.pairs_with}」不是已知条目`);
      if (other.pairs_with !== s.id) throw new Error(`${s.id}: pairs_with 不对称——${other.id} 没写回 ${s.id}`);
    }
  }
}

export function parseCatalog(md: string): SkillDef[] {
  const skills: SkillDef[] = [];
  // 当前小节：花色字符 / '★' / '神' / null
  let suit: string | null = null;

  for (const raw of md.split('\n')) {
    const line = clean(raw);

    // 小节头：`## ♥ 红心` / `## ★ 升级链` / `## 神 四神`
    const section = /^## +(.)/.exec(line);
    if (section) {
      const c = section[1];
      suit = SUITS[c] || c === '★' || c === '神' ? c : null;
      continue;
    }

    // ★ / 神 小节里的条目：`### 宏伟★ — ✅/❓` + 其后的 `- **id**：…` `- **摘要**：…` 要点
    if (suit === '★' || suit === '神') {
      const entry = /^### +(.+?) +— +(.+)$/.exec(line);
      if (entry) {
        const status = entry[2].trim();
        if (!STATUSES.has(status)) {
          throw new Error(`条目「${entry[1]}」的状态「${status}」不在 04 文件头的图例里`);
        }
        skills.push({
          id: '', // 由紧随其后的 `- **id**：` 要点填上；缺了在下面抛
          name: suit === '★' ? entry[1].replace(/★$/, '') : entry[1],
          suit_rank: suit,
          status,
          summary: '',
          caveats: null,
          structured: false,
        });
        continue;
      }

      // 条目要点：`- **id**：…` / `- **摘要**：…` / `- **疑点**：…` / 其余归入 notes
      const bullet = /^- +\*\*(.+?)\*\*：(.*)$/.exec(line);
      if (bullet && skills.length) {
        const cur = skills[skills.length - 1];
        const [label, text] = [bullet[1], clean(bullet[2])];
        if (label === 'id') cur.id = text.replace(/`/g, '');
        else if (label === '摘要') cur.summary = text;
        else if (label === '疑点') cur.caveats = orNull(text);
        else cur.notes = [cur.notes, `${label}：${text}`].filter(Boolean).join('；');
      }
      continue; // ★ / 神 小节里没有表格
    }

    // 花色表格行：`| 点 | 名 | 状态 | 摘要 | 疑点 |`
    if (!suit || !line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(clean);
    if (cells.length !== 5) continue;
    const [rank, name, status, summary, caveats] = cells;
    if (!/^(10|[1-9]|[JQK])$/.test(rank)) continue; // 跳过表头与分隔行
    skills.push({
      id: `${SUITS[suit]}-${rank.toLowerCase()}`,
      name,
      suit_rank: `${suit}${rank}`,
      status,
      summary,
      caveats: orNull(caveats),
      structured: false,
    });
  }

  applyFences(md, skills);
  return skills.map((s) => {
    const out: Record<string, unknown> = {};
    for (const k of SKILL_ORDER) if (k in s) out[k] = (s as unknown as Record<string, unknown>)[k];
    return out as unknown as SkillDef;
  });
}

export function build(): { json: string; ts: string; sql: string } {
  const md = readFileSync(new URL(SOURCE, repoRoot), 'utf8');
  const skills = parseCatalog(md);

  if (skills.length !== EXPECTED_COUNT) {
    throw new Error(`解析到 ${skills.length} 条，期望 ${EXPECTED_COUNT} 条——${SOURCE} 的格式变了？`);
  }
  const anonymous = skills.filter((s) => !s.id);
  if (anonymous.length) {
    throw new Error(`缺 id（★/神 条目要写 \`- **id**：\`）: ${anonymous.map((s) => s.name).join(', ')}`);
  }
  const dupes = skills.map((s) => s.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dupes.length) throw new Error(`重复 id: ${dupes.join(', ')}`);
  const missing = skills.filter((s) => !s.summary);
  if (missing.length) throw new Error(`缺摘要: ${missing.map((s) => s.id).join(', ')}`);

  const doc: SkillDefsDoc = {
    rulesetVersion: RULESET_VERSION,
    source: SOURCE,
    generator: GENERATOR,
    skills,
  };
  const json = `${JSON.stringify(doc, null, 2)}\n`;

  const ts =
    `// 由 ${GENERATOR} 生成，勿手改；改规则先改 ${SOURCE}，再跑 pnpm --filter @roft/engine gen:skills\n` +
    `// ponytail: 与同目录 skill-defs.json 同源同内容的 TS 镜像。直接 import JSON 需要\n` +
    `// resolveJsonModule，而那在共享 tsconfig 里（别人的地盘）；等它打开就把这里换成一行 import。\n` +
    `import type { SkillDefsDoc } from './types.ts';\n\n` +
    `export const skillDefs: SkillDefsDoc = ${JSON.stringify(doc, null, 2)};\n`;

  // 迁移直接内嵌同一份 JSON 文本（dollar-quote，无转义），保证「同源」肉眼可查。
  const sql = `-- 由 ${GENERATOR} 生成，勿手改。内嵌的 JSON 与 packages/engine/src/skills/skill-defs.json 逐字节相同。
-- skill_defs 表建于 0001_init.sql；这里只灌数据，按 (ruleset_version, id) 幂等 upsert。
with doc as (select $skill_defs$${json}$skill_defs$::jsonb as d)
insert into public.skill_defs (ruleset_version, id, def)
select d->>'rulesetVersion', s->>'id', s
from doc, jsonb_array_elements(d->'skills') as s
on conflict (ruleset_version, id) do update set def = excluded.def;
`;

  return { json, ts, sql };
}

const OUT = {
  json: 'packages/engine/src/skills/skill-defs.json',
  ts: 'packages/engine/src/skills/skill-defs.ts',
  sql: 'supabase/migrations/0004_skill_defs_seed.sql',
} as const;

export const outPath = (k: keyof typeof OUT) => new URL(OUT[k], repoRoot);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const built = build();
  for (const k of Object.keys(OUT) as (keyof typeof OUT)[]) {
    writeFileSync(outPath(k), built[k]);
  }
  console.log(`${built.json.length} bytes, ${JSON.parse(built.json).skills.length} skills`);
}
