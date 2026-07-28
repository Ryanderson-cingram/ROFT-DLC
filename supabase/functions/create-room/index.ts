import type { GameState } from "../../../packages/engine/src/index.ts";
import { json, serveAuthed } from "../_shared/http.ts";

// 0/O 与 1/I 在口头报码时分不清，直接从字母表里拿掉。
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join("");

serveAuthed(async ({ body, user, svc }) => {
  const rulePack = body.rulePack === "gods" ? "gods" : "base";

  // 房间码撞 unique 约束不是 500，是再摇一次。
  let room: { id: string; code: string } | null = null;
  for (let i = 0; i < 5 && !room; i++) {
    const { data, error } = await svc.from("rooms")
      .insert({ code: newCode(), created_by: user.id, config: { rulePack, skillDraft: "draft3" } })
      .select("id, code").single();
    if (error && error.code !== "23505") return json({ error: error.message }, 500);
    room = data;
  }
  if (!room) return json({ error: "code_exhausted" }, 503);

  await svc.from("room_seats").insert({ room_id: room.id, seat: 0, user_id: user.id });
  const state: GameState = { version: 0, phase: "lobby", seats: [{ userId: user.id }] };
  await svc.from("room_state_private").insert({ room_id: room.id, state });

  return json({ roomId: room.id, code: room.code, seat: 0 });
});
