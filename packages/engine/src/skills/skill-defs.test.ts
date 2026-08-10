// 单一生成源的守门：产物必须能由 docs/knowledge-base/ 逐字节重现，
// 迁移里的 seed 必须内嵌同一份 JSON。任一处手改（双源漂移）都在这里红。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { build, ENUMS, outPath, parseFence, toEffect } from '../../../../scripts/gen-skill-defs.ts';
import { skillDefs } from './registry.ts';
import type { RevealWindow, SkillEffect, SkillEffectKind, SkillWindow } from './types.ts';

const built = build();
const committed = (k: 'json' | 'sql') => readFileSync(outPath(k), 'utf8');

describe('skill defs 生成源', () => {
  it.each(['json', 'sql'] as const)('%s 与重跑生成脚本的产物逐字节一致', (k) => {
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

/**
 * 生成器的取值白名单 ↔ `types.ts` 的联合类型，两边不许漂移。
 *
 * 从前这条由 `skill-defs.ts` 那个带类型标注的镜像免费提供：生成器多认一个值、
 * 联合里没有，那份 `const skillDefs: SkillDefsDoc = {…}` 就编译不过。镜像换成
 * JSON + 一句 cast 之后没人再对——cast 是不查的，于是「生成器放行了一个引擎类型
 * 不认识的值」会一路静默到运行时。所以在这里补回来。
 *
 * 机件：下面每张表的**键**由 tsc 按联合查穷尽性（少一个不算 Record，多一个不可赋值），
 * 值再与生成器那张 Set 逐一比。两侧任一边先动，这里就红。
 * `duration` / `procedure` 不在此列——types.ts 那两格本来就是 `string`，没有联合可对。
 */
describe('取值白名单与联合类型同步', () => {
  const keysOf = (t: Record<string, true>) => new Set(Object.keys(t));

  const KINDS: Record<SkillEffectKind, true> = {
    passive: true, active: true, on_reveal: true, on_play: true,
    response: true, replacement: true, status_grant: true, meta_rule: true,
  };
  const WINDOWS: Record<SkillWindow, true> = {
    turn_start: true, play_phase: true, after_play: true, turn_end: true,
    on_punish_resolve: true, on_stack_contribute: true, interrupt: true,
    on_draw: true, on_dice_roll: true, any: true,
  };
  const REVEAL_WINDOWS: Record<RevealWindow, true> = {
    own_turn: true, any_time: true, when_skipped: true, when_challenged_uno: true,
  };
  const TARGETING: Record<NonNullable<SkillEffect['targeting']>, true> = {
    self: true, single: true, all_others: true, global: true,
  };
  const ONCE: Record<NonNullable<SkillEffect['once']>, true> = {
    once: true, once_per_player: true, per_player_count: true, unlimited: true,
  };

  it.each([
    ['kind', KINDS],
    ['window', WINDOWS],
    ['reveal_window', REVEAL_WINDOWS],
    ['targeting', TARGETING],
    ['once', ONCE],
  ] as const)('%s 的白名单与联合逐值相同', (field, table) => {
    expect(ENUMS[field]).toEqual(keysOf(table));
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
  // 第二批（spec 2026-08-02，接一个加一个）
  'heart-10', // 伤逝
  'heart-8', // 异议
  'spade-j', // 忍戒
  'spade-8', // 八门
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

  // L6 是后置程序：不改数字，所以「改了什么执行方式」全靠 `procedure` 那个名字（02 §6）
  it('procedure 与 draw_procedure 同进同出', () => {
    for (const [id, e] of effects) {
      const isProc = !!e.modifies?.includes('draw_procedure');
      expect(!!e.procedure, `${id}/${e.key}: procedure 与 draw_procedure 对不上`).toBe(isProc);
    }
  });
});

// 状态是**闭集**（03 §4 就是那张表），所以拼错一个状态名要在生成时红——
// 引擎赋一个谁都不认识的状态，牌桌上什么都不会发生。
describe('赋予状态（02-methodology §6 的 grants）', () => {
  const fence = (effect: string, structured = true) =>
    parseFence(`id: spade-8\n${structured ? 'structured: true\n' : ''}effects:\n  - key: 2a\n${effect}`, '围栏块');
  const toEffects = (effect: string, structured = true) => {
    const doc = fence(effect, structured);
    return (doc.effects as Record<string, unknown>[]).map((e) => toEffect(e, '围栏块', structured));
  };

  it('03 §4 表里的状态原样透传', () => {
    expect(toEffects('    kind: status_grant\n    grants: [五彩]')[0].grants).toEqual(['五彩']);
  });

  it('表里没有的状态名不放行', () => {
    expect(() => toEffects('    kind: status_grant\n    grants: [五采]')).toThrow(/没有的状态/);
  });

  it('grants 只能写在 status_grant 上（被动改摸数不该顺手赋状态）', () => {
    expect(() => toEffects('    kind: passive\n    grants: [五彩]')).toThrow(/只能写在/);
  });

  it('完整标注里 grants 不能是空数组（赋予什么？）', () => {
    expect(() => toEffects('    kind: status_grant\n    grants: []')).toThrow(/赋予什么状态/);
  });
});

// 拼错一支程序的名字、或声明了 draw_procedure 却不说是哪支，都会静默变成「什么都不做」。
describe('L6 后置程序的名字（02-methodology §6 的 procedure）', () => {
  const fence = (effect: string, structured = true) =>
    parseFence(`id: spade-j\n${structured ? 'structured: true\n' : ''}effects:\n  - key: passive\n${effect}`, '围栏块');
  const toEffects = (effect: string, structured = true) => {
    const doc = fence(effect, structured);
    return (doc.effects as Record<string, unknown>[]).map((e) => toEffect(e, '围栏块', structured));
  };
  const L6 = '    modifies: [draw_procedure]\n    layer: [L6]\n    values: { L6: 6 }';

  it('认得已注册的那支', () => {
    expect(toEffects(`${L6}\n    procedure: draw_then_discard`)[0].procedure).toBe('draw_then_discard');
  });

  it('没登记的名字不放行（引擎按名字分派，认不出就静默跳过）', () => {
    expect(() => toEffects(`${L6}\n    procedure: draw_then_dicsard`)).toThrow(/取值表/);
  });

  it('完整标注声明了 draw_procedure 就必须说是哪支', () => {
    expect(() => toEffects(L6)).toThrow(/没写是哪支/);
  });

  it('写了 procedure 却没在 modifies 里点名 draw_procedure，也红', () => {
    expect(() => toEffects('    modifies: [draw_count]\n    layer: [L2]\n    values: { L2: 1 }\n    procedure: draw_then_discard'))
      .toThrow(/没在 modifies 里点名/);
  });
});
