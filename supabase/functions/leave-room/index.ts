import type { GameState } from "../../../packages/engine/src/index.ts";
import { compactSeats } from "../_shared/db.ts";
import { json, serveAuthed } from "../_shared/http.ts";

/**
 * 退出房间（拔掉自己的座位），防「幽灵房间」：人早走了、座位还占着。
 *
 * - 对局进行中（playing）不能退：座位在局中是引擎里的身份，拔掉会把整桌打坏。
 * - 大厅（lobby）退：删座位后**压缩座位号**并重建 GameState.seats（同 join-room 的重建）。
 * - 打完（finished）退：只删座位，不压缩也不动 state——终局快照按原座位号读，
 *   压缩会让还在看结算的人错位；座位号的收拾留给重开（room-action 的 restartGame）。
 * - 房主走了就把房主交给剩下的最小座位；最后一个人走了直接删房间（外键 cascade 收走
 *   seats / state / events，不留空房等回收）。
 * - 幂等：房间没了、或本来就不在座，都算「已经退了」。
 */
serveAuthed(async ({ body, user, svc }) => {
  const roomId = String(body.roomId ?? "");
  const { data: room } = await svc.from("rooms").select("status, created_by")
    .eq("id", roomId).maybeSingle();
  if (!room) return json({ ok: true });
  if (room.status === "playing") return json({ reason: "game_in_progress" }, 409);

  await svc.from("room_seats").delete().eq("room_id", roomId).eq("user_id", user.id);

  const { data: rest } = await svc.from("room_seats").select("seat, user_id")
    .eq("room_id", roomId).order("seat");
  if (!rest?.length) {
    await svc.from("rooms").delete().eq("id", roomId);
    return json({ ok: true });
  }

  if (room.status === "lobby") {
    const rows = await compactSeats(svc, roomId);
    const { data: priv } = await svc.from("room_state_private").select("state")
      .eq("room_id", roomId).maybeSingle();
    if (priv) {
      const state = { ...(priv.state as GameState), seats: rows.map((r) => ({ userId: r.user_id })) };
      await svc.from("room_state_private").update({ state }).eq("room_id", roomId);
    }
  }

  if (room.created_by === user.id)
    await svc.from("rooms").update({ created_by: rest[0].user_id }).eq("id", roomId);

  return json({ ok: true });
});
