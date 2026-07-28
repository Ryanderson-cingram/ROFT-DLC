// 计划 §1「硬约束：数据引用不存在的机制必须炸」。
// 数据驱动最典型的失败是静默失效：JSON 写了个 kind，引擎没实现，技能亮出后什么都不发生。
// 这里守的就是「不许静默跳过」。
import { describe, expect, it } from "vitest";
import { loadSkills, mechanismRefs } from "../../src/skills/registry.ts";
import { primitives } from "../../src/skills/primitives/index.ts";
import { skillDefs } from "../../src/skills/skill-defs.ts";
import type { LoadableSkillDef } from "../../src/skills/registry.ts";

const def = (over: Partial<LoadableSkillDef> & { id: string }): LoadableSkillDef => ({
  name: "假技能",
  suit_rank: "♠0",
  status: "✅",
  summary: "测试用",
  caveats: null,
  structured: false,
  ...over,
});

const doc = (...skills: LoadableSkillDef[]) => ({ skills });

describe("skill registry", () => {
  it("按 id 取到定义", () => {
    const r = loadSkills(doc(def({ id: "heart-1", name: "恩惠" })), new Set());
    expect(r.byId.get("heart-1")?.name).toBe("恩惠");
    expect(r.byId.get("nope")).toBeUndefined();
  });

  it("定义引用未注册的原语 → 抛错，点名技能与字段", () => {
    const bad = doc(def({
      id: "spade-9",
      structured: true,
      effects: [{ kind: "passive" }, { kind: "replacement" }],
    }));
    expect(() => loadSkills(bad, new Set(["passive"]))).toThrowError(
      /spade-9[\s\S]*effects\[1\]\.kind[\s\S]*replacement/,
    );
  });

  it("原语已注册 → 正常加载，不抛", () => {
    const ok = doc(def({
      id: "heart-1",
      structured: true,
      effects: [{ kind: "passive", modifies: ["drawModifier"] }],
    }));
    expect(() => loadSkills(ok, new Set(["passive", "drawModifier"]))).not.toThrow();
  });

  it("未注册的原语不是被跳过，而是逐条报出来", () => {
    const bad = doc(def({ id: "club-3", structured: true, effects: [{ modifies: "marks" }] }));
    expect(() => loadSkills(bad, new Set())).toThrowError(/club-3[\s\S]*effects\[0\]\.modifies[\s\S]*marks/);
  });

  it("unimplemented 的技能不进可抽池，也不被校验", () => {
    const d = doc(
      def({ id: "done", structured: true, effects: [{ kind: "passive" }] }),
      def({ id: "declared-not-built", structured: true, unimplemented: true, effects: [{ kind: "no-such" }] }),
      def({ id: "not-structured" }),
    );
    const r = loadSkills(d, new Set(["passive"]));
    expect(r.pool.map((s) => s.id)).toEqual(["done"]);
    // 但仍然按 id 取得到——不进池 ≠ 不存在
    expect(r.byId.get("declared-not-built")).toBeDefined();
  });

  it("mechanismRefs 把一条定义引用的机制名连同字段路径全列出来", () => {
    expect(mechanismRefs(def({
      id: "x",
      effects: [{ kind: "active", modifies: ["a", "b"] }],
    }))).toEqual([
      { path: "effects[0].kind", name: "active" },
      { path: "effects[0].modifies", name: "a" },
      { path: "effects[0].modifies", name: "b" },
    ]);
  });

  it("真实的 56 条定义：此刻一条都没结构化，所以可抽池是空的", () => {
    const r = loadSkills(skillDefs, primitives);
    expect(r.byId.size).toBe(56);
    expect(r.pool).toEqual([]);
  });

  it("默认参数就是生产用的那两个源，不抛", () => {
    expect(() => loadSkills()).not.toThrow();
  });
});
