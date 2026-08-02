/**
 * 覆盖率驱动的闩：**词表从源码 grep 出来**，不手抄（同 `apps/web/test-support/engine-vocab.ts`）。
 *
 * 手抄的清单跟着实现一起腐烂——引擎加了第 9 种反应窗口 / 快照多了一个字段，抄来的
 * 清单里也没有那一条，测试照样绿。读源码才有「引擎一动就自动红」这个红。
 *
 * 正则烂掉会导致假绿，所以每条断言都带一个「数量下限」兜着。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { projectView } from "../../src/index.ts";
import { card, table } from "../helpers.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/** src 下所有非测试的 .ts 拼在一起。 */
const allSource = (() => {
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) chunks.push(readFileSync(p, "utf8"));
    }
  };
  walk(SRC);
  return chunks.join("\n");
})();

/** `src` 里 `a` 与 `b` 之间那一段（`b` 缺省 = 到结尾）。 */
const between = (src: string, a: string, b?: string) => {
  const from = src.indexOf(a);
  expect(from, `源码里找不到 ${a}`).toBeGreaterThanOrEqual(0);
  const to = b ? src.indexOf(b, from) : src.length;
  expect(to, `源码里找不到 ${b}`).toBeGreaterThan(from);
  return src.slice(from, to);
};

// ---------------------------------------------------------------- 反应窗口

/**
 * 引擎**造得出来**的窗口类型。窗口对象的辨识特征是 `type: "…"` 紧跟着 `actors`
 * （事件字面量跟的是 `public`，正好分得开）。
 */
const CONSTRUCTED = [
  ...new Set([...allSource.matchAll(/type: "([A-Za-z]+)",\s*(?:\/\/[^\n]*\n\s*)*actors\b/g)].map((m) => m[1])),
].sort();

/** 某个分派器**认得**的窗口类型（`w.type === "…"` / `w.type !== "…"`）。 */
const handled = (src: string) =>
  new Set([...src.matchAll(/w\.type [!=]== "([A-Za-z]+)"/g)].map((m) => m[1]));

/** 三个分派器都把 `punishStack` 当兜底分支（不写在 if 条件里），所以补进去再比。 */
const FALLBACK = "punishStack";

describe("每一种反应窗口都被三个分派器认得（新增一种就自动红）", () => {
  it("词表本身是活的：至少 grep 到 8 种窗口，且含 punishStack", () => {
    expect(CONSTRUCTED.length).toBeGreaterThanOrEqual(8);
    expect(CONSTRUCTED).toContain(FALLBACK);
  });

  it.each([
    { who: "respond（punish.ts）", src: () => between(read("actions/punish.ts"), "export function respond(", "export function claimTimeout(") },
    { who: "claimTimeout（punish.ts）", src: () => between(read("actions/punish.ts"), "export function claimTimeout(", "function settle(") },
    { who: "legalActions（index.ts）", src: () => between(read("index.ts"), "export function legalActions(", "export function projectView(") },
  ])("$who 认得全部窗口类型", ({ src }) => {
    const known = handled(src());
    known.add(FALLBACK);
    expect([...known].sort()).toEqual(CONSTRUCTED);
  });
});

// ---------------------------------------------------------------- 快照字段

/** `types.ts` 里 `ClientSnapshot` 声明的字段名（顶层缩进两格的那一层）。 */
const SNAPSHOT_FIELDS = [
  ...between(read("types.ts"), "export interface ClientSnapshot {", "\n}").matchAll(/^ {2}(\w+)\??:/gm),
].map((m) => m[1]).sort();

describe("ClientSnapshot 的字段表与 projectView 的输出逐字对上", () => {
  const s = table([[card("R", "3")], [card("Y", "1")], [card("Y", "2")]]);

  it("词表本身是活的：至少 20 个字段", () => {
    expect(SNAPSHOT_FIELDS.length).toBeGreaterThanOrEqual(20);
  });

  // 声明了却不投影 = UI 永远读到 undefined；投影了却没声明 = 类型上看不见的暗字段。
  // 两个方向都要红，所以比的是**集合相等**而不是包含。
  it.each([0, 1, 2])("座位 $0 的快照键集合 === 接口字段集合", (seat) => {
    expect(Object.keys(projectView(s, seat)).sort()).toEqual(SNAPSHOT_FIELDS);
  });

  it("没有牌桌时字段也一个不少（大厅快照不是残缺对象）", () => {
    expect(Object.keys(projectView({ version: 0, phase: "lobby", seats: [{ userId: "u0" }] }, 0)).sort())
      .toEqual(SNAPSHOT_FIELDS);
  });
});

// ---------------------------------------------------------------- 标记上限

/** 技能定义里所有 `mark_cap`（04 围栏块 → `skill-defs.json`）。 */
const DEFINED_CAPS: Record<string, number> = Object.fromEntries(
  (JSON.parse(readFileSync(join(SRC, "skills/skill-defs.json"), "utf8")).skills as {
    effects?: { mark_cap?: Record<string, number> }[];
  }[]).flatMap((d) => (d.effects ?? []).flatMap((e) => Object.entries(e.mark_cap ?? {}))),
);

describe("marksCap 直接来自定义的 mark_cap（03 §5）", () => {
  const s = table([[card("R", "3")], [card("Y", "1")], [card("Y", "2")]]);

  it("词表本身是活的：定义里至少有一个上限（影歌的魂 6）", () => {
    expect(DEFINED_CAPS.魂).toBe(6);
  });

  it("快照顶层的 marksCap 与定义逐字相等——加了新上限漏投就红", () => {
    expect(projectView(s, 0).marksCap).toEqual(DEFINED_CAPS);
  });

  it("marksCap 与座位、与谁持有哪个技能无关（它是定义的函数）", () => {
    const held = table([[card("R", "3")], [card("Y", "1")], [card("Y", "2")]], {
      skills: ["diamond-3", "club-3", null],
      revealed: [true, false, false],
    });
    for (const seat of [0, 1, 2]) expect(projectView(held, seat).marksCap).toEqual(DEFINED_CAPS);
  });

  it("没有上限的标记**缺席**而不是 0（司夜的盗）", () => {
    const held = table([[card("R", "3")], [card("Y", "1")], [card("Y", "2")]], {
      skills: ["club-3", null, null],
      revealed: [true, false, false],
      marks: [{ 盗: 7 }, {}, {}],
    });
    const snap = projectView(held, 0);
    expect(snap.players[0].marks.盗).toBe(7);
    expect("盗" in snap.marksCap).toBe(false);
  });
});
