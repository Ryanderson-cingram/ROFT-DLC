/**
 * `?next=` 的落点。**只认站内的绝对路径**——把这个值直接丢进 `router.replace()`
 * 而不校验，就是一个开放重定向：`?next=//evil.com` 与 `?next=https://evil.com`
 * 在浏览器眼里都是站外地址，钓鱼站拿它给自己的登录页镀一层本站域名。
 *
 * 三条各有各的绕法，缺一不可：
 * 1. 先剥掉所有 ASCII 空白与控制字符——浏览器解析 URL 时会把 TAB/LF/CR 直接删掉，
 *    所以 `/\t/evil.com` 到了地址栏就变回 `//evil.com`（这是这类校验最常见的绕过）；
 * 2. 反斜杠按斜杠算（`/\evil.com` 同理会变成 `//evil.com`）；
 * 3. 剩下的只放行「/ 开头」的一种，`https://…` / `javascript:…` 全部落到 fallback。
 */
export function safeNext(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  const path = raw.replace(/[\u0000-\u0020]/g, "");
  if (!path.startsWith("/")) return fallback;
  if (path.startsWith("//") || path.startsWith("/\\")) return fallback;
  return path;
}
