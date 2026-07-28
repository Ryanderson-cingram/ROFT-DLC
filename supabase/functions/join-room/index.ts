import type { GameState } from "../../../packages/engine/src/index.ts";
import { json, serveAuthed } from "../_shared/http.ts";

const SEATS = 4;

serveAuthed(async ({ body, user, svc }) => {
  const code = String(body.code ?? "").trim().toUpperCase();
  const { data: room } = await svc.from("rooms").select("id, status").eq("code", code).maybeSingle();
  if (!room) return json({ error: "room_not_found" }, 404);

  const { data: taken } = await svc.from("room_seats").select("seat, user_id").eq("room_id", room.id);
  const mine = taken?.find((s) => s.user_id === user.id);
  // 幂等：已经在座就把原座位还回去，重复点「加入」不该报错
  if (mine) return json({ roomId: room.id, code, seat: mine.seat });

  if (room.status !== "lobby") return json({ error: "already_started" }, 409);
  const used = new Set(taken?.map((s) => s.seat));
  if (used.size >= SEATS) return json({ error: "room_full" }, 409);

  const seat = [...Array(SEATS).keys()].find((i) => !used.has(i))!;
  // 并发抢同一个空位时 (room_id, seat) 主键会挡下后来者，让他重试拿下一个位子
  const { error } = await svc.from("room_seats").insert({ room_id: room.id, seat, user_id: user.id });
  if (error) return json({ error: "seat_taken", retry: true }, 409);

  // 引擎从 GameState.seats 读座位，所以每次入座都按座位号重建一次
  const { data: all } = await svc.from("room_seats").select("user_id").eq("room_id", room.id).order("seat");
  const { data: priv } = await svc.from("room_state_private").select("state").eq("room_id", room.id).single();
  const state = { ...(priv!.state as GameState), seats: all!.map((s) => ({ userId: s.user_id })) };
  await svc.from("room_state_private").update({ state }).eq("room_id", room.id);

  return json({ roomId: room.id, code, seat });
});
