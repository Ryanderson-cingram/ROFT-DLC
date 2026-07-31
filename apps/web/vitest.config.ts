import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 组件是纯函数式的（snapshot 进、send 出），所以只要 jsdom + RTL 就够，
 * 不引 Playwright / MSW / 快照库（spec §5.1）。
 *
 * 没装 @vitejs/plugin-react：esbuild 的 automatic JSX 已经能编 tsx，
 * 只有需要 Fast Refresh 才用得上那个插件，跑测试用不着。
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
  },
  resolve: {
    // 与 tsconfig 的 paths 对齐：组件里写的是 "@/lib/..."
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
