import { applyAction, type GameState } from "../../../packages/engine/src/index.ts";
import { serviceClient, userClient } from "../_shared/db.ts";

Deno.serve(async (req) => {
  const { roomId, expectedVersion, action, idempotencyKey } = await req.json();
  const { data: { user } } = await userClient(req).auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const svc = serviceClient();
  const { data: dup } = await svc.from("room_events").select("seq")
    .eq("room_id", roomId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (dup) return Response.json({ version: Math.floor(dup.seq / 100), idempotent: true });

  const { data: priv } = await svc.from("room_state_private").select("state").eq("room_id", roomId).single();
  if (!priv) return Response.json({ error: "room_not_found" }, { status: 404 });

  const result = applyAction(priv.state as GameState, action,
    { rng: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32, now: new Date().toISOString() });
  if (result.rejected) return Response.json({ reason: result.rejected.reason }, { status: 400 });

  const { data: cas } = await svc.from("rooms")
    .update({ version: expectedVersion + 1 })
    .eq("id", roomId).eq("version", expectedVersion).select("version");
  if (!cas?.length) return Response.json({ error: "version_conflict" }, { status: 409 });

  await svc.from("room_state_private").update({ state: result.state }).eq("room_id", roomId);
  await svc.from("room_events").insert(result.events.map((e, i) => ({
    // seq 语义：每 action 一批事件，seq = 新version*100 + 批内序号（单 action 事件数 <100）
    room_id: roomId, seq: (expectedVersion + 1) * 100 + i, actor: user.id, type: e.type,
    public_payload: e.public, private_payload: e.private ?? null,
    idempotency_key: i === 0 ? idempotencyKey : null,
  })));
  return Response.json({ version: expectedVersion + 1 });
});
