import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 引擎里**实际出现**的 choice 与拒因字符串，从源码里 grep 出来。
 *
 * 为什么读源码而不是手抄一份清单：spec §5.3 第 13/14 条要的是「缺一个就红」。
 * 手抄的清单跟着实现一起腐烂——引擎加了新 choice / 新 reject，前端漏了人话，
 * 抄来的清单里也没有那一条，测试照样绿。读源码才有这个红。
 *
 * 引擎没把这些常量导出（`index.ts` 只导 types + 三个函数），所以只能按文本认。
 * 正则烂掉会导致假绿，调用方各自带一条「数量下限」断言兜着。
 */
/** jsdom 环境里 `import.meta.url` 不是 file: URL，所以从 cwd 往上找仓库根。找不到就当场炸，不静默跳过。 */
const ENGINE_SRC = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "packages/engine/src");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("找不到 packages/engine/src：engine-vocab 靠读引擎源码驱动覆盖率测试");
})();

let cached: string | null = null;
function engineSource(): string {
  if (cached !== null) return cached;
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith(".ts")) chunks.push(readFileSync(p, "utf8"));
    }
  };
  walk(ENGINE_SRC);
  return (cached = chunks.join("\n"));
}

const collect = (patterns: RegExp[]): string[] => {
  const src = engineSource();
  const found = new Set<string>();
  for (const re of patterns) for (const m of src.matchAll(re)) found.add(m[1]);
  return [...found].sort();
};

/**
 * `respond` 动作里能出现的 choice 全集。三种写法：
 * 字面量 `choice: "draw3"`、常量 `const RAID = "raid"`、数组 `const CHOICES = [...]`。
 */
export function engineChoices(): string[] {
  const arrays = engineSource().matchAll(/const [A-Za-z_]*(?:CHOICES|choices) = \[([^\]]*)\]/g);
  const fromArrays = [...arrays].flatMap((m) => [...m[1].matchAll(/"([a-z0-9-]+)"/g)].map((q) => q[1]));
  return [
    ...new Set([
      ...collect([/\bchoice: "([a-z0-9-]+)"/g, /^(?:export )?const [A-Z_0-9]+ = "([a-z0-9-]+)";/gm]),
      ...fromArrays,
    ]),
  ].sort();
}

/** 引擎能吐出的拒因全集：`reject(...)`、`rejected: { reason }`，以及 `malformed` 的裸 return。 */
export const engineRejectReasons = (): string[] =>
  collect([
    /reject\([^,()]+, "([a-z_]+)"\)/g,
    /rejected: \{ reason: "([a-z_]+)" \}/g,
    /\{ rejected: "([a-z_]+)" \}/g,
    /return "([a-z_]+)";/g,
  ]);
