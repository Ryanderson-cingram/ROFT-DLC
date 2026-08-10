import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// 客户端类型从这里再出去一次：谁要它就 import 这里，npm 那个说明符只写在这一处
export type { SupabaseClient };

const url = Deno.env.get("SUPABASE_URL")!;

/** Client acting as the caller — RLS applies. */
export function userClient(req: Request): SupabaseClient {
  return createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
}

/** Service-role client — bypasses RLS. Never expose its key to clients. */
export function serviceClient(): SupabaseClient {
  return createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/**
 * 把座位号压回 0‥n-1。座位号在引擎里是**位置身份**（room-action 拿 `room_seats.seat`
 * 直接当引擎座位下标，而 GameState.seats 是按序重建的数组），有洞两边就对不上。
 * 只在没有对局挂着的时候调用（大厅退人、重开前）；按升序挪，目标位恒先空出来。
 */
export async function compactSeats(
  svc: SupabaseClient,
  roomId: string,
): Promise<{ seat: number; user_id: string }[]> {
  const { data } = await svc.from("room_seats").select("seat, user_id")
    .eq("room_id", roomId).order("seat");
  const rows = (data ?? []) as { seat: number; user_id: string }[];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].seat === i) continue;
    await svc.from("room_seats").update({ seat: i }).eq("room_id", roomId).eq("seat", rows[i].seat);
    rows[i].seat = i;
  }
  return rows;
}
