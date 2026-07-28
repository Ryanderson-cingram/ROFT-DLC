// 技能定义的唯一生成源：docs/knowledge-base/04-skills-catalog.md → 版本化 JSON。
// 产物：packages/engine/src/skills/skill-defs.{json,ts} 与 supabase/migrations/0004_skill_defs_seed.sql
// 跑：pnpm --filter @roft/engine gen:skills（CI 重跑后 git diff 必须为空）
//
// 只提取文档里逐条标注了的字段（id/name/suit_rank/status/summary/caveats/notes）。
// 02-methodology §1 的 effects[]/window/layer/targeting 等在 04 里没有逐条标注，
// 一律不生成（structured: false），宁可少而准。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SkillDef, SkillDefsDoc } from '../packages/engine/src/skills/types.ts';

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

const clean = (s: string) => s.trim().replace(/\s+$/, '');
const orNull = (s: string) => (s === '' || s === '—' || s === '-' ? null : s);

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

  return skills;
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
