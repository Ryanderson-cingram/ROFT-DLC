import { projectView, type GameState } from "../../../packages/engine/src/index.ts";
import { json, serveAuthed } from "../_shared/http.ts";

serveAuthed(async ({ body, user, svc }) => {
  const roomId = body.roomId as string;
  const { data: seat } = await svc.from("room_seats").select("seat")
    .eq("room_id", roomId).eq("user_id", user.id).maybeSingle();
  if (!seat) return json({ error: "not_a_member" }, 403);

  const { data: priv } = await svc.from("room_state_private").select("state").eq("room_id", roomId).single();
  if (!priv) return json({ error: "room_not_found" }, 404);

  const state = priv.state as GameState;
  return json({ version: state.version, view: projectView(state, seat.seat) });
});
