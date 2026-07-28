import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2";
import { serviceClient, userClient } from "./db.ts";

// 浏览器从 localhost:3000 打 localhost:56321，永远是跨域；预检不带 Authorization，
// 所以 OPTIONS 必须在鉴权之前短路掉。
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: cors });

/** 每个房间接口都要的三件事：预检、鉴权、service client。 */
export function serveAuthed(
  fn: (args: {
    body: Record<string, unknown>;
    user: User;
    svc: SupabaseClient;
  }) => Promise<Response>,
) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const { data: { user } } = await userClient(req).auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);
    let body: Record<string, unknown> = {};
    if (req.headers.get("content-type")?.includes("json")) {
      // 坏 body 是 400，不是 500——不然日志里全是无从下手的堆栈。
      try {
        body = await req.json();
      } catch {
        return json({ error: "bad_json" }, 400);
      }
    }
    return await fn({ body, user, svc: serviceClient() });
  });
}
