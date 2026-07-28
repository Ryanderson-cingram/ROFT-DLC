// 单一生成源的守门：产物必须能由 docs/knowledge-base/ 逐字节重现，
// 迁移里的 seed 必须内嵌同一份 JSON。任一处手改（双源漂移）都在这里红。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { build, outPath } from '../../../../scripts/gen-skill-defs.ts';
import { skillDefs } from './skill-defs.ts';

const built = build();
const committed = (k: 'json' | 'ts' | 'sql') => readFileSync(outPath(k), 'utf8');

describe('skill defs 生成源', () => {
  it.each(['json', 'ts', 'sql'] as const)('%s 与重跑生成脚本的产物逐字节一致', (k) => {
    expect(committed(k)).toBe(built[k]);
  });

  it('迁移内嵌的正是同一份 JSON', () => {
    expect(committed('sql')).toContain(committed('json'));
  });

  it('56 条（4★ + 52 点位），id 唯一，版本锚定 4.1', () => {
    expect(skillDefs.rulesetVersion).toBe('4.1');
    expect(skillDefs.skills).toHaveLength(56);
    expect(new Set(skillDefs.skills.map((s) => s.id)).size).toBe(56);
  });

  it('尚未结构化——effects[] 等字段一律不猜', () => {
    expect(skillDefs.skills.every((s) => s.structured === false)).toBe(true);
  });
});
