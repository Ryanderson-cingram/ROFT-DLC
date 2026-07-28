import { projectView, type GameState } from "../../../packages/engine/src/index.ts";
import { serviceClient, userClient } from "../_shared/db.ts";

Deno.serve(async (req) => {
  const { roomId } = await req.json();
  const { data: { user } } = await userClient(req).auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const svc = serviceClient();
  const { data: seat } = await svc.from("room_seats").select("seat")
    .eq("room_id", roomId).eq("user_id", user.id).maybeSingle();
  if (!seat) return Response.json({ error: "not_a_member" }, { status: 403 });

  const { data: priv } = await svc.from("room_state_private").select("state").eq("room_id", roomId).single();
  if (!priv) return Response.json({ error: "room_not_found" }, { status: 404 });

  const state = priv.state as GameState;
  return Response.json({ version: state.version, view: projectView(state, seat.seat) });
});
