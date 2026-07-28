// 技能定义加载器。职责只有两件：按 id 索引，以及在加载时炸掉引用了未注册机制的定义。
// 规则来源：docs/knowledge-base/02-methodology.md §1/§2；计划 §1「硬约束」。
import { primitives } from "./primitives/index.ts";
import { skillDefs } from "./skill-defs.ts";
import type { SkillDef } from "./types.ts";

/**
 * 02 §1 的子效果。`skill-catalog-structuring` 计划产出它，此刻 skill-defs 里还没有这个字段，
 * 所以在这里结构化地声明，而不是改 skills/types.ts（那份是别人的地盘）。
 */
export interface SkillEffect {
  /** 02 §2 的效果类型 */
  kind?: string;
  /** 02 §1：改摸数 / 改惩罚 / 改颜色规则等标签，值就是它要用的原语名 */
  modifies?: string | string[];
}

export type LoadableSkillDef = SkillDef & {
  effects?: SkillEffect[];
  /** 计划 §1：机制还没建的技能显式标出来，不进抽 3 选 1 的池 */
  unimplemented?: boolean;
};

export interface LoadedSkills {
  byId: Map<string, LoadableSkillDef>;
  /** S1 抽 3 选 1 的可抽池。只有结构化且未标 unimplemented 的技能进池。 */
  pool: LoadableSkillDef[];
}

/** 定义里「点名一个机制」的字段。新增这类字段要在这里加，否则它引用的原语不会被校验。 */
const MECHANISM_FIELDS = ["kind", "modifies"] as const;

/** 一条定义引用的全部机制名，连同字段路径——路径是为了让报错能点名到具体位置。 */
export function mechanismRefs(def: LoadableSkillDef): { path: string; name: string }[] {
  const refs: { path: string; name: string }[] = [];
  def.effects?.forEach((e, i) => {
    for (const field of MECHANISM_FIELDS) {
      const v = e[field];
      if (v === undefined) continue;
      for (const name of Array.isArray(v) ? v : [v]) refs.push({ path: `effects[${i}].${field}`, name });
    }
  });
  return refs;
}

/**
 * 结构化 = 定义声称自己机器可执行。声称了就必须兑现，所以只校验这些；
 * 显式标 unimplemented 的是诚实的「还没建」，不校验也不进池。
 */
const isImplemented = (d: LoadableSkillDef) => d.structured === true && d.unimplemented !== true;

export function loadSkills(
  doc: { skills: LoadableSkillDef[] } = skillDefs,
  registered: ReadonlySet<string> = primitives,
): LoadedSkills {
  const pool = doc.skills.filter(isImplemented);
  const missing = pool.flatMap((d) =>
    mechanismRefs(d).filter((r) => !registered.has(r.name)).map((r) => `  ${d.id} ${r.path}: "${r.name}"`)
  );
  // 静默跳过就是这套设计要防的病，所以是抛错而不是过滤掉
  if (missing.length > 0)
    throw new Error(`技能定义引用了未注册的原语（引擎没实现这个机制）：\n${missing.join("\n")}`);
  return { byId: new Map(doc.skills.map((d) => [d.id, d])), pool };
}
