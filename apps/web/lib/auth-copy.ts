/**
 * Supabase Auth 的报错 → 人话。与 `api.ts::humanReason` 同一条口径：
 * 查不到的原样兜一句，绝不把英文原文甩给玩家。
 *
 * 只按 `code` 匹配，不看 message：message 是会随 GoTrue 版本改字的。
 * 唯一的例外是密码强度那一支——它的 code 是 `weak_password`，但本地
 * config.toml 只设了 `minimum_password_length = 6`，所以文案直接说 6 位。
 *
 * 登录失败**不区分**「没这个邮箱」和「密码不对」（`invalid_credentials`
 * 本来就是一个 code）：区分开就等于给外人一个查号台。
 */
const SAYINGS: Record<string, string> = {
  invalid_credentials: "邮箱或密码不对。",
  email_not_confirmed: "这个邮箱还没确认，去收件箱点一下确认链接。",
  user_already_exists: "这个邮箱已经注册过了，切到「登录」进来。",
  email_exists: "这个邮箱已经注册过了，切到「登录」进来。",
  weak_password: "密码太弱了，至少 6 位。",
  validation_failed: "邮箱或密码填得不对，检查一下格式。",
  email_address_invalid: "这个邮箱地址不合法。",
  signup_disabled: "现在不开放注册。",
  over_email_send_rate_limit: "试得太频繁了，等一分钟再来。",
  over_request_rate_limit: "试得太频繁了，等一分钟再来。",
  same_password: "新密码跟旧的一样。",
};

export function authMessage(err: { code?: string; message?: string } | null): string {
  if (!err) return "登录没成功，稍后再试一次。";
  if (err.code && SAYINGS[err.code]) return SAYINGS[err.code];
  // 网络断了 / CORS / 服务没起来：supabase-js 抛的是 AuthRetryableFetchError，没有 code
  if (!err.code) return "连不上服务器，检查一下网络再试。";
  return `登录没成功：${err.message ?? err.code}`;
}
