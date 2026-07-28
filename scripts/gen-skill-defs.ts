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

/** 04 §统计：4 条 ★ + 52 个点位。少一条就是解析漏了，别静默通过。 */
const EXPECTED_COUNT = 56;

const SUITS: Record<string, string> = { '♥': 'heart', '♦': 'diamond', '♠': 'spade', '♣': 'club' };

// ★ 条目的 id 只在 02-methodology 举了一个例（宏伟 = star-grandeur），
// 其余三条没有文档依据，这里手工锚定；改名要同时改文档与本表。
const STAR_IDS: Record<string, string> = {
  宏伟: 'star-grandeur',
  宝藏: 'star-treasure',
  灾难: 'star-disaster',
  狂欢: 'star-carnival',
};

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
  'notes',
  'structured',
  'effects',
]);
const EFFECT_KEYS = new Set([
  'key',
  'kind',
  'window',
  'cost',
  'targeting',
  'once',
  'stacks_with_turn_limit',
  'priority',
  'modifies',
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
  'upgrade_to',
  'effects',
  'structured',
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
};
const LAYERS = new Set(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
const MODIFIES = new Set([
  'draw_count',
  'draw_procedure',
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
// 只认三样东西：顶层 `键: 值`、`effects:` 下的对象列表、行内数组 `[a, b]`。
// 超出子集就抛错，绝不「尽力而为」地静默吃掉一行标注。
type Scalar = string | boolean | null;
const FIELD = /^([a-z_]+):[ ]?(.*)$/;

function parseValue(v: string, at: string): Scalar | string[] {
  const t = v.trim();
  if (t === '') return null; // 显式留空 = 文档未裁定
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t.startsWith('[')) {
    if (!t.endsWith(']')) throw new Error(`${at}: 行内数组未闭合「${t}」`);
    const inner = t.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((s) => s.trim());
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

function toEffect(raw: Record<string, unknown>, at: string): SkillEffect {
  if (typeof raw.key !== 'string' || raw.key === '') {
    throw new Error(`${at}: 每条子效果都要有非空的 key（02-methodology §6）`);
  }
  for (const f of ['kind', 'window', 'targeting', 'once', 'duration']) checkEnum(f, raw[f], at);
  for (const [f, allowed] of [
    ['modifies', MODIFIES],
    ['layer', LAYERS],
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
    if ('upgrade_to' in doc) skill.upgrade_to = doc.upgrade_to as string;
    if ('notes' in doc) {
      skill.notes = [skill.notes, doc.notes].filter(Boolean).join('；');
    }
    if ('effects' in doc) {
      skill.effects = (doc.effects as Record<string, unknown>[]).map((e) => toEffect(e, at));
    }
    if ('structured' in doc) {
      if (doc.structured !== true) throw new Error(`${at}: structured 只在完整标注时写 true`);
      if (!skill.effects?.length) throw new Error(`${at}: structured: true 但没有 effects`);
      skill.structured = true;
    }
  }

  for (const s of skills) {
    if (s.upgrade_to && !byId.has(s.upgrade_to)) {
      throw new Error(`${s.id}: upgrade_to「${s.upgrade_to}」不是已知条目`);
    }
  }
}

export function parseCatalog(md: string): SkillDef[] {
  const skills: SkillDef[] = [];
  let suit: string | null = null;

  for (const raw of md.split('\n')) {
    const line = clean(raw);

    // 花色小节：`## ♥ 红心`
    const section = /^## +(.)/.exec(line);
    if (section) {
      suit = SUITS[section[1]] ? section[1] : null;
      continue;
    }

    // ★ 条目：`### 宏伟★ — ✅/❓` + 其后的 `- **摘要**：…` 要点
    const star = /^### +(.+?)★ +— +(.+)$/.exec(line);
    if (star) {
      const [status, ...rest] = star[2].split(' ');
      const name = star[1];
      const id = STAR_IDS[name];
      if (!id) throw new Error(`★ 技能「${name}」没有 id 映射，先在 STAR_IDS 里锚定`);
      skills.push({
        id,
        name,
        suit_rank: '★',
        status,
        summary: '',
        caveats: null,
        ...(rest.length ? { notes: rest.join(' ') } : {}),
        structured: false,
      });
      continue;
    }

    // ★ 条目的要点：`- **摘要**：…` / `- **疑点**：…` / 其余归入 notes
    const bullet = /^- +\*\*(.+?)\*\*：(.*)$/.exec(line);
    if (bullet && skills.length && skills[skills.length - 1].suit_rank === '★') {
      const cur = skills[skills.length - 1];
      const [label, text] = [bullet[1], clean(bullet[2])];
      if (label === '摘要') cur.summary = text;
      else if (label === '疑点') cur.caveats = orNull(text);
      else cur.notes = [cur.notes, `${label}：${text}`].filter(Boolean).join('；');
      continue;
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
