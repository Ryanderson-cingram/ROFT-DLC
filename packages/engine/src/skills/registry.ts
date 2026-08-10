// 技能定义加载器。职责两件：按 id 索引，以及把「标注完整」与「引擎真能执行」分开。
//
// 这套设计要防的病是：一个技能进了抽 3 选 1 的池，玩家抽到、亮出，然后什么都不发生——
// 因为它引用的机制引擎根本没实现。所以**进池的门槛是机制全部已注册**，不是标注完整。
// 标注完整但机制还没建的技能落进 `unsupported` 并逐条报出缺什么，不进池、也不抛错：
// 文档标注与引擎实现本来就会分头推进，加载不该因此瘫掉。漏实现由 CI 兜住
// （断言首批 10 个 MVP 技能必须在池里，见 primitives 计划 Task 8）。
//
// 规则来源：docs/knowledge-base/02-methodology.md §1/§2；计划 §1「硬约束」。
import { HANDLERS } from "./handlers.ts";
import { primitives } from "./primitives/index.ts";
import rawDefs from "./skill-defs.json" with { type: "json" };
import type { SkillDef, SkillDefsDoc } from "./types.ts";

/**
 * 技能定义的唯一产物（由 scripts/gen-skill-defs.ts 从 04-skills-catalog.md 生成）。
 * cast 是必需的一句：JSON 模块的字面量类型会被宽化成 `string`，接不上 `SkillEffectKind`
 * 一类的联合。逐字节的正确性由 CI 的重跑无漂移 + skill-defs.test.ts 守着，不靠这里的类型。
 */
export const skillDefs = rawDefs as SkillDefsDoc;

export type LoadableSkillDef = SkillDef & {
  /** 计划 §1：机制还没建的技能显式标出来，不进抽 3 选 1 的池 */
  unimplemented?: boolean;
};

export interface LoadedSkills {
  byId: Map<string, LoadableSkillDef>;
  /** S1 抽 3 选 1 的可抽池。标注完整 + 引用的机制全部已注册，才进池。 */
  pool: LoadableSkillDef[];
  /** 标注完整、但引擎还没建齐它要的机制。逐条列出缺什么，好让漏实现无处可藏。 */
  unsupported: { id: string; missing: string[] }[];
}

/** 定义里「点名一个机制」的字段。新增这类字段要在这里加，否则它引用的原语不会被校验。 */
const MECHANISM_FIELDS = ["kind", "modifies"] as const;

/** 一条定义引用的全部机制名，连同字段路径——路径是为了让报错能点名到具体位置。 */
export function mechanismRefs(def: LoadableSkillDef): { path: string; name: string }[] {
  const refs: { path: string; name: string }[] = [];
  def.effects?.forEach((e, i) => {
    for (const field of MECHANISM_FIELDS) {
      const v = e[field];
      // null 是标注里「文档没裁定」的显式标记，不是机制名
      if (v === undefined || v === null) continue;
      for (const name of Array.isArray(v) ? v : [v]) refs.push({ path: `effects[${i}].${field}`, name });
    }
  });
  return refs;
}

/** 标注完整：定义声称自己机器可执行。显式标 unimplemented 的是诚实的「还没建」。 */
const isAnnotated = (d: LoadableSkillDef) => d.structured === true && d.unimplemented !== true;

export function loadSkills(
  doc: { skills: readonly LoadableSkillDef[] } = skillDefs,
  registered: ReadonlySet<string> = primitives,
  handlers: Readonly<Record<string, unknown>> = HANDLERS,
): LoadedSkills {
  const pool: LoadableSkillDef[] = [];
  const unsupported: { id: string; missing: string[] }[] = [];

  for (const d of doc.skills.filter(isAnnotated)) {
    const missing = mechanismRefs(d)
      .filter((r) => !registered.has(r.name))
      .map((r) => `${r.path}: "${r.name}"`);

    // 注册表里有 "active" 只说明引擎认识这个 kind，不代表这个技能真有行为。
    // 主动效果得有 handler 才算能执行，否则玩家抽到它、亮出、发动，只会拿到 not_implemented。
    // 被动不需要：它们由摸牌采集器一类的机制按定义生效，没有 per-skill 代码。
    if (!handlers[d.id])
      d.effects?.forEach((e, i) => {
        if (e.kind === "active") missing.push(`effects[${i}]: 没有 handler`);
      });

    if (missing.length > 0) unsupported.push({ id: d.id, missing });
    else pool.push(d);
  }
  return { byId: new Map(doc.skills.map((d) => [d.id, d])), pool, unsupported };
}

/** 生产用的那一份，进程内加载一次。要注入别的定义源就直接调 `loadSkills()`。 */
export const skills = loadSkills();
