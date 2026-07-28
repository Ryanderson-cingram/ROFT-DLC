import { createClient } from "./supabase/client";

export type EdgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; reason: string };

/**
 * 打 Edge Function。用裸 fetch 而不是 functions.invoke，是因为 409/400 的
 * 状态码与 reason 都要原样交给调用方——冲突要拉快照，非法动作要显示人话。
 */
export async function callEdge<T>(name: string, body: object): Promise<EdgeResult<T>> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  let res: Response;
  try {
    res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // status 0 = 根本没到服务端。调用方可以带同一个 idempotencyKey 安全重试。
    return { ok: false, status: 0, reason: "network" };
  }
  const payload = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data: payload as T };
  return { ok: false, status: res.status, reason: payload.reason ?? payload.error ?? "unknown" };
}

/** 服务端 reason → 人话。查不到的原样显示，总好过一句「出错了」。 */
const SAYINGS: Record<string, string> = {
  room_not_found: "没找到这个房间，房间码再核对一下。",
  room_full: "这一桌已经满 4 人了。",
  already_started: "这一桌已经开局了，进不去。",
  seat_taken: "座位刚被别人占了，再点一次。",
  not_a_member: "你不在这一桌。",
  not_the_host: "只有房主能开桌。",
  bad_seat_count: "3–4 人才能开桌。",
  not_in_lobby: "这一桌已经开过局了。",
  not_your_turn: "还没轮到你。",
  must_stack: "被叠住了：只能接惩罚牌，或者吃下。",
  cannot_stack: "你手里没有能接的惩罚牌，只能吃下。",
  must_draw_first: "先摸一张牌才能结束回合。",
  must_play_drawn_or_end: "这一回合只能打刚摸到的那张，或者结束回合。",
  illegal_card: "这张牌接不上牌顶。",
  color_required: "打变色牌要先选颜色。",
  pending_window: "有人正在响应窗口里，等一下。",
  stale_window: "这个窗口已经结算过了。",
  not_yet_expired: "还没到时间。",
  version_conflict: "桌面刚变过，重新看一眼再操作。",
  network: "网络没通，检查一下再试。",
  unauthenticated: "登录过期了，重新进一次。",
};

export const humanReason = (reason: string) => SAYINGS[reason] ?? `操作没成功（${reason}）`;
