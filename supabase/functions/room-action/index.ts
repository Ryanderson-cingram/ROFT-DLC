import { applyAction, type Action, type GameState } from "../../../packages/engine/src/index.ts";
import { json, serveAuthed } from "../_shared/http.ts";

serveAuthed(async ({ body, user, svc }) => {
  const { roomId, expectedVersion, idempotencyKey } = body as {
    roomId: string;
    expectedVersion: number;
    idempotencyKey: string;
  };
  const action = body.action as Action;

  const { data: dup } = await svc.from("room_events").select("seq")
    .eq("room_id", roomId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (dup) return json({ version: Math.floor(dup.seq / 100), idempotent: true });

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

  const { data: cas } = await svc.from("rooms")
    .update({ version: expectedVersion + 1 })
    .eq("id", roomId).eq("version", expectedVersion).select("version");
  if (!cas?.length) return json({ error: "version_conflict" }, 409);

  await svc.from("room_state_private").update({ state: result.state }).eq("room_id", roomId);
  if (action.type === "startGame") await svc.from("rooms").update({ status: "playing" }).eq("id", roomId);

  await svc.from("room_events").insert(result.events.map((e, i) => ({
    // seq 语义：每 action 一批事件，seq = 新version*100 + 批内序号（单 action 事件数 <100）
    room_id: roomId, seq: (expectedVersion + 1) * 100 + i, actor: user.id, type: e.type,
    public_payload: e.public, private_payload: e.private ?? null,
    idempotency_key: i === 0 ? idempotencyKey : null,
  })));
  return json({ version: expectedVersion + 1 });
});
