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

  // 进池的门槛是「机制全部已注册」，不是「标注完整」——否则玩家会抽到一个亮出后什么都不发生的技能
  it("引用未注册原语的技能不进可抽池，并点名技能与字段", () => {
    const bad = doc(def({
      id: "spade-9",
      structured: true,
      effects: [{ key: "1", kind: "passive" }, { key: "2", kind: "replacement" }],
    }));
    const r = loadSkills(bad, new Set(["passive"]));
    expect(r.pool).toEqual([]);
    expect(r.unsupported).toEqual([{ id: "spade-9", missing: ['effects[1].kind: "replacement"'] }]);
  });

  it("原语已注册 → 进池", () => {
    const ok = doc(def({
      id: "heart-1",
      structured: true,
      effects: [{ key: "passive", kind: "passive", modifies: ["drawModifier"] }],
    }));
    const r = loadSkills(ok, new Set(["passive", "drawModifier"]));
    expect(r.pool.map((s) => s.id)).toEqual(["heart-1"]);
    expect(r.unsupported).toEqual([]);
  });

  it("缺哪个机制是逐条报出来的，不是笼统说一句不支持", () => {
    const bad = doc(def({ id: "club-3", structured: true, effects: [{ key: "1", modifies: ["marks"] }, { key: "2", kind: "response" }] }));
    expect(loadSkills(bad, new Set()).unsupported[0].missing).toEqual([
      'effects[0].modifies: "marks"',
      'effects[1].kind: "response"',
    ]);
  });

  it("unimplemented 的技能不进可抽池，也不被校验", () => {
    const d = doc(
      def({ id: "done", structured: true, effects: [{ key: "1", kind: "passive" }] }),
      def({ id: "declared-not-built", structured: true, unimplemented: true, effects: [{ key: "1", kind: "no-such" as never }] }),
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
      effects: [{ key: "1", kind: "active", modifies: ["a", "b"] }],
    }))).toEqual([
      { path: "effects[0].kind", name: "active" },
      { path: "effects[0].modifies", name: "a" },
      { path: "effects[0].modifies", name: "b" },
    ]);
  });

  // 真实定义的当下状态：**进池 = 行为真的建好了**。原语齐备还不够——司夜/劫营的定义
  // 只引用了别人注册过的机制名，又都没有 active 效果（「主动必须有 handler」那条查不到它们），
  // 会就这么溜进池子变成「抽到即废」。这两个曾在 04 里标 `unimplemented: true` 挡着，
  // 实现的人删掉那行、同时把 id 加进这里——这条断言就是那个提醒。
  it("原语建到哪一波，池里就有几个技能", () => {
    const r = loadSkills(skillDefs, primitives);
    expect(r.byId.size).toBe(60);
    // 首批 10 个：恩惠、精英、并列、强袭、血棘、影歌、劫营、远星、恒心、司夜
    // 第二批（逐个接线，接一个加一个）：伤逝♥10、异议♥8、忍戒♠J、八门♠8、合纵♠5、连横♠6、近卫♥6、神授♥5、吟游♣5、专精♥9（第二批十个到齐）
    expect(r.pool.map((s) => s.id).sort()).toEqual([
      "club-3",
      "club-5",
      "diamond-1",
      "diamond-10",
      "diamond-2",
      "diamond-3",
      "diamond-j",
      "heart-1",
      "heart-10",
      "heart-3",
      "heart-4",
      "heart-5",
      "heart-6",
      "heart-8",
      "heart-9",
      "spade-1",
      "spade-5",
      "spade-6",
      "spade-8",
      "spade-j",
    ]);
    // 劫营（interrupt 窗口）建完后 04 里再没有 `unimplemented: true`，标注完整却缺机制的
    // 也一个都不剩：两个筐都空了。「缺什么怎么列」由上面的合成定义继续守着。
    expect(r.unsupported).toEqual([]);
    // 合纵/连横的①（06-Q70 裁定后）也建完了，04 里再没有 `unimplemented`：两个筐又都空了
    expect(skillDefs.skills.filter((s) => s.unimplemented)).toEqual([]);
  });

  // 注册表里有 "active" 只说明「阶段 1 发动」这个 kind 引擎认识，不代表某个技能真有行为。
  // 真正能不能执行看 HANDLERS 有没有它——否则玩家抽到它、亮出、发动，拿到 not_implemented。
  it("有 active 效果却没有 handler 的技能不进池", () => {
    const d = doc(def({
      id: "no-such-skill",
      structured: true,
      effects: [{ key: "1", kind: "active" }],
    }));
    const r = loadSkills(d, new Set(["active"]));
    expect(r.pool).toEqual([]);
    expect(r.unsupported[0].missing).toEqual(['effects[0]: 没有 handler']);
  });

  it("纯被动技能不需要 handler（被动由采集器按定义生效）", () => {
    const d = doc(def({ id: "heart-1", structured: true, effects: [{ key: "passive", kind: "passive" }] }));
    expect(loadSkills(d, new Set(["passive"])).pool.map((s) => s.id)).toEqual(["heart-1"]);
  });

  it("默认参数就是生产用的那两个源，加载不抛", () => {
    expect(() => loadSkills()).not.toThrow();
  });
});
