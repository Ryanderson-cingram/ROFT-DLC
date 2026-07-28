import { applyAction, type Action, type GameState } from "../../../packages/engine/src/index.ts";
import { json, serveAuthed } from "../_shared/http.ts";

serveAuthed(async ({ body, user, svc }) => {
  const { roomId, expectedVersion, idempotencyKey } = body as {
    roomId: string;
    expectedVersion: number;
    idempotencyKey: string;
  };
  const action = body.action as Action;

  const { data: dup } = await svc.from("room_events").select("room_version")
    .eq("room_id", roomId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (dup) return json({ version: dup.room_version, idempotent: true });

  const { data: room } = await svc.from("rooms").select("created_by, status").eq("id", roomId).single();
  if (!room) return json({ error: "room_not_found" }, 404);

  // 座位号由服务端认定，不听客户端的——否则谁都能冒充别人出牌
  const { data: seat } = await svc.from("room_seats").select("seat")
    .eq("room_id", roomId).eq("user_id", user.id).maybeSingle();
  if (!seat) return json({ error: "not_a_member" }, 403);
  if (action.type === "startGame" && room.created_by !== user.id)
    return json({ reason: "not_the_host" }, 400);

  const { data: priv } = await svc.from("room_state_private").select("state").eq("room_id", roomId).single();
  if (!priv) return json({ error: "room_not_found" }, 404);

  const result = applyAction({ ...(priv.state as GameState) }, { ...action, seat: seat.seat }, {
    rng: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
    now: new Date().toISOString(),
  });
  if (result.rejected) return json({ reason: result.rejected.reason }, 400);

  // CAS + state + status + events 全在这一个事务里。null = 版本冲突且零副作用。
  const { data: applied, error } = await svc.rpc("apply_room_action", {
    p_room: roomId,
    p_expected_version: expectedVersion,
    p_actor: user.id,
    p_state: result.state,
    p_events: result.events,
    p_idempotency_key: idempotencyKey,
    p_new_status: action.type === "startGame" ? "playing" : null,
  });
  if (error) {
    console.error("apply_room_action failed", error);
    return json({ error: "apply_failed" }, 500);
  }
  if (!applied) return json({ error: "version_conflict" }, 409);
  return json({ version: applied.version });
});
