import { json, serveAuthed } from "../_shared/http.ts";

// 为什么不走 room-action：room-action 是「喂给引擎的动作」通道——它跑 applyAction、
// 撞乐观锁、写 room_events。准备状态是等候室的元数据，不是 GameState 的一部分，
// 冻结契约的 Action 联合里也没有 toggleReady。硬塞进去就得动引擎契约，得不偿失。
serveAuthed(async ({ body, user, svc }) => {
  const { data: seat } = await svc.from("room_seats").select("seat, ready")
    .eq("room_id", body.roomId).eq("user_id", user.id).maybeSingle();
  if (!seat) return json({ error: "not_a_member" }, 403);

  const ready = typeof body.ready === "boolean" ? body.ready : !seat.ready;
  await svc.from("room_seats").update({ ready })
    .eq("room_id", body.roomId).eq("user_id", user.id);
  return json({ seat: seat.seat, ready });
});
