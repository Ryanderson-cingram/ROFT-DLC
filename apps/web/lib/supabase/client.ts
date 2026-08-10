import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side client. Only ever holds the publishable key.
 *
 * 整个标签页共用一个实例：`createBrowserClient` 每 new 一次就各自装一套 auth
 * 状态监听与 storage 订阅，一页里 new 六次等于六份互相不知道的会话状态。
 *
 * **静态页不要在渲染期间调用它**（`useMemo(() => createClient(), [])` 就是渲染期间）。
 * `next build` 会把静态页预渲染一遍，那一刻 `NEXT_PUBLIC_*` 缺一个，
 * `createBrowserClient` 就抛「URL and API key are required」，**整个部署挂掉**——
 * 2026-08-10 的 Vercel preview 就是这么炸的（那个环境没配这两个变量）。
 * 放进 effect 或事件处理器里它只在浏览器里跑，预渲染够不着。
 *
 * 动态路由（`/room/[code]` / `/game/[code]`）不预渲染，照旧 useMemo 无妨。
 */
/* 类型从 `make` 上取、不写 `ReturnType<typeof createBrowserClient>`：后者会落到
   泛型的默认实参上，查询结果整片退化成 any，调用方那边冒出一串 TS7006。 */
const make = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );

let client: ReturnType<typeof make> | undefined;

export function createClient() {
  return (client ??= make());
}
