// 单一生成源的守门：产物必须能由 docs/knowledge-base/ 逐字节重现，
// 迁移里的 seed 必须内嵌同一份 JSON。任一处手改（双源漂移）都在这里红。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { build, outPath, parseFence, toEffect } from '../../../../scripts/gen-skill-defs.ts';
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

  it('60 条（4★ + 52 点位 + 4 神），id 唯一，版本锚定 4.1', () => {
    expect(skillDefs.rulesetVersion).toBe('4.1');
    expect(skillDefs.skills).toHaveLength(60);
    expect(new Set(skillDefs.skills.map((s) => s.id)).size).toBe(60);
  });

  it('structured 只在完整标注时为 true，且必带 effects', () => {
    for (const s of skillDefs.skills) {
      if (s.structured) expect(s.effects?.length).toBeGreaterThan(0);
    }
    // 没标注的条目一律不猜：既没 effects 也不自称 structured
    for (const s of skillDefs.skills) {
      if (!s.effects) expect(s.structured).toBe(false);
    }
  });
});

// spec §5.5 的首批技能子集。有人改 04 把标注改坏了（删了围栏块、拼错 id、
// 把 structured 拿掉），这里红——handler 就是靠这些字段驱动的。
const MVP_IDS = [
  'heart-1', // 恩惠
  'heart-3', // 精英
  'heart-4', // 并列
  'diamond-1', // 强袭
  'diamond-2', // 血棘
  'diamond-3', // 影歌
  'diamond-10', // 劫营
  'diamond-j', // 远星
  'spade-1', // 恒心
  'club-3', // 司夜
] as const;

describe('MVP 技能子集的结构化覆盖', () => {
  it.each(MVP_IDS)('%s 已完整标注', (id) => {
    const s = skillDefs.skills.find((x) => x.id === id);
    expect(s, `04 里没有 ${id}`).toBeDefined();
    expect(s!.structured).toBe(true);
    expect(s!.effects?.length).toBeGreaterThan(0);
    // 每条子效果都要有自己的 key，且同一技能内不重复（02-methodology §6）
    const keys = s!.effects!.map((e) => e.key);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// 原 Q53 的裁定：数值只有一处落点。这几条守的是「数字没被写进 values」不会静默过关。
describe('数值槽 values（02-methodology §1/§6）', () => {
  const fence = (effect: string) => {
    const doc = parseFence(`id: heart-1\nstructured: true\neffects:\n  - key: passive\n${effect}`, '围栏块');
    return (doc.effects as Record<string, unknown>[]).map((e) => toEffect(e, '围栏块', doc.structured === true));
  };

  it('完整标注声明了 layer 就必须给出这一层的数', () => {
    expect(() => fence('    layer: [L2]')).toThrow(/却没有 values/);
    expect(() => fence('    layer: [L2, L5]\n    values: { L2: -2 }')).toThrow(/values 里没有它的数/);
  });

  it('给了层的数却没在 layer 里声明这层，也红', () => {
    expect(() => fence('    layer: [L2]\n    values: { L2: -2, L5: 1 }')).toThrow(/layer 里没有 L5/);
  });

  it('键必须先登记进 02 §6 的白名单，拼错不放行', () => {
    expect(() => fence('    values: { discrad: 1 }')).toThrow(/未登记的键/);
  });

  it('值只能是整数，写成自然语言就红', () => {
    expect(() => fence('    values: { discard: 一张 }')).toThrow(/键: 整数/);
  });

  // 「标记名 ↔ 上限」的绑定。键是中文（03 §5 的标记名是开放集合），所以不查白名单——
  // 但「无上限」必须靠**缺席**表达，写 0 会被下游读成「上限是 0」。
  it('mark_cap 的键是标记名，原样透传', () => {
    expect(fence('    mark_cap: { 魂: 6 }')[0].mark_cap).toEqual({ 魂: 6 });
  });

  it('无上限的标记不许写成 0，只能不写这个键', () => {
    expect(() => fence('    mark_cap: { 盗: 0 }')).toThrow(/别写 0/);
  });
});

describe('摸牌层级（02-methodology §7）', () => {
  const effects = skillDefs.skills.flatMap((s) => (s.effects ?? []).map((e) => [s.id, e] as const));
  const touchesDraw = (e: { modifies?: string[] }) =>
    !!e.modifies?.some((m) => m === 'draw_count' || m === 'draw_procedure');

  it('layer 只出现在改摸牌的效果上', () => {
    for (const [id, e] of effects) {
      if (e.layer) expect(touchesDraw(e), `${id}/${e.key} 带 layer 却不改摸牌`).toBe(true);
    }
  });

  it('改摸牌的效果必须声明 layer', () => {
    for (const [id, e] of effects) {
      if (touchesDraw(e)) expect(e.layer?.length, `${id}/${e.key} 改摸牌却没声明 layer`).toBeGreaterThan(0);
    }
  });
});
