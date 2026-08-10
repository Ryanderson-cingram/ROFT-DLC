// 成就**描述**的唯一生成源：packages/stats/src/achievements.ts → 迁移 seed。
// 产物：supabase/migrations/0007_achievement_defs_seed.sql
// 跑：pnpm --filter @roft/stats gen:achievements（CI 重跑后 git diff 必须为空）
//
// 表里只存描述（名字、封泥字、描述、品级、进度目标），**不存规则**——
// 判定逻辑留在 achievements.ts 里，它要读引擎的类型，而且改判定本来就该发版。
// 建这张表只为两件事：profile 页要渲染**未解锁**成就的名字与描述（否则客户端得内嵌一份定义），
// 以及 unlock_rate 要能被日更作业写回。
//
// 同 gen-skill-defs.ts 的路子：内嵌 JSON 文本，「同源」肉眼可查。

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACHIEVEMENTS } from '../packages/stats/src/achievements.ts';

const GENERATOR = 'scripts/gen-achievement-defs.ts';
const SOURCE = 'packages/stats/src/achievements.ts';
const OUT = 'supabase/migrations/0007_achievement_defs_seed.sql';

const repoRoot = new URL('..', import.meta.url);
export const outPath = () => new URL(OUT, repoRoot);

/** 24 枚封泥，四品 4 / 6 / 8 / 6。少一条就是漏了，别静默通过。 */
const EXPECTED_COUNT = 24;

export function build(): string {
  if (ACHIEVEMENTS.length !== EXPECTED_COUNT)
    throw new Error(`成就条数对不上：期望 ${EXPECTED_COUNT}，实得 ${ACHIEVEMENTS.length}`);

  const rows = ACHIEVEMENTS.map((a, i) => ({
    id: a.id,
    tier: a.tier,
    mark: a.mark,
    name: a.name,
    descr: a.descr,
    // 有进度条的只有计数型那 11 条；特判与派生型两列都是 null
    stat_key: a.stat?.key ?? null,
    stat_goal: a.stat?.goal ?? null,
    // 排序即定义表里的顺序（已按品级从低到高排好），UI 直接照它铺墙
    sort: i,
  }));
  const json = `${JSON.stringify({ source: SOURCE, generator: GENERATOR, achievements: rows }, null, 2)}\n`;

  return `-- 由 ${GENERATOR} 生成，勿手改。改成就请改 ${SOURCE} 再重跑。
-- achievement_defs 表建于 0006_stats_and_achievements.sql；这里只灌数据，按 id 幂等 upsert。
-- unlock_rate 不在 upsert 的更新列里：那一列归日更作业写，重跑 seed 不该把它抹掉。
with doc as (select $achievement_defs$${json}$achievement_defs$::jsonb as d)
insert into public.achievement_defs (id, tier, mark, name, descr, stat_key, stat_goal, sort)
select a->>'id', a->>'tier', a->>'mark', a->>'name', a->>'descr',
       a->>'stat_key', (a->>'stat_goal')::int, (a->>'sort')::int
from doc, jsonb_array_elements(d->'achievements') as a
on conflict (id) do update set
  tier = excluded.tier, mark = excluded.mark, name = excluded.name,
  descr = excluded.descr, stat_key = excluded.stat_key,
  stat_goal = excluded.stat_goal, sort = excluded.sort;
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sql = build();
  writeFileSync(outPath(), sql);
  console.log(`${sql.length} bytes, ${ACHIEVEMENTS.length} achievements`);
}
