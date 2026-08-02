import { applyAction, type Action, type GameState } from "../../../packages/engine/src/index.ts";
import { json, serveAuthed } from "../_shared/http.ts";

serveAuthed(async ({ body, user, svc }) => {
  const { roomId, expectedVersion, idempotencyKey } = body as {
    roomId: string;
    expectedVersion: number;
    idempotencyKey: string;
  };
  /**
   * 房间层动作与引擎动作走同一个端点。`restartGame` 不在引擎的 `Action` 里——引擎只管
   * 一局之内的规则，「把房间倒回等候室」是房间的事，所以类型上是并集，路由上在
   * `applyAction` 之前岔开。
   */
  const action = body.action as Action | { type: "restartGame"; seat: number };
  // 浅校验，不是主防线：字段的形状与值域由引擎裁决（它才是权威，且单测覆盖得到）。
  // 这里只挡「连 action 都不是个对象」——那会在下面读 `action.type` 时就抛，根本到不了引擎。
  if (!action || typeof action !== "object" || typeof action.type !== "string")
    return json({ reason: "bad_action" }, 400);

  // 幂等不在这里预检查——事务外的预检查挡不住两个同 key 的并发请求。
  // 由 RPC 里的唯一约束裁决，重放走 apply_room_action 的 unique_violation 分支。
  const { data: room } = await svc.from("rooms").select("created_by, status, config").eq("id", roomId).single();
  if (!room) return json({ error: "room_not_found" }, 404);

  // 座位号由服务端认定，不听客户端的——否则谁都能冒充别人出牌
  const { data: seat } = await svc.from("room_seats").select("seat")
    .eq("room_id", roomId).eq("user_id", user.id).maybeSingle();
  if (!seat) return json({ error: "not_a_member" }, 403);
  if (action.type === "startGame" && room.created_by !== user.id)
    return json({ reason: "not_the_host" }, 400);

  /*
    再来一局（原房间重开）。**不是引擎动作**——引擎只管一局之内的规则，「把房间倒回等候室」
    是房间层的事，所以它在 applyAction 之前岔开，走自己的 RPC。

    2026-08-02 拍板：任何在座玩家都能点（上面的 seat 查询已经是那道门），不限房主。
    这里的 status 预检查挡不住 TOCTOU，真正的门闩写在 restart_room 的 where 里。
  */
  if (action.type === "restartGame") {
    if (room.status !== "finished") return json({ reason: "game_not_finished" }, 400);
    // 全新的 lobby state，形状与 create-room 那份逐字一致（GameState 归引擎，不在 SQL 里拼）
    const { data: seats } = await svc.from("room_seats").select("user_id").eq("room_id", roomId).order("seat");
    const fresh: GameState = {
      // version 由 restart_room 用 CAS 之后的真值盖掉（`p_state || {version}`），这里写什么都不算数
      version: 0,
      phase: "lobby",
      seats: (seats ?? []).map((s) => ({ userId: s.user_id })),
      config: room.config as GameState["config"],
    };
    const { data: restarted, error: restartError } = await svc.rpc("restart_room", {
      p_room: roomId,
      p_expected_version: expectedVersion,
      p_actor: user.id,
      p_state: fresh,
    });
    if (restartError) {
      console.error("restart_room failed", restartError);
      return json({ error: "apply_failed" }, 500);
    }
    // null = CAS 冲突或房间已经不在 finished（零副作用）。多半是别人抢先重开了——
    // 客户端照样进等候室，结果一致
    if (!restarted) return json({ error: "version_conflict" }, 409);
    if (restarted.error) return json({ reason: restarted.error }, 403);
    return json({ version: restarted.version });
  }

  const { data: priv } = await svc.from("room_state_private").select("state").eq("room_id", roomId).single();
  if (!priv) return json({ error: "room_not_found" }, 404);

  const result = applyAction({ ...(priv.state as GameState) }, { ...(action as Action), seat: seat.seat }, {
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
    // 终局那一步以前**没人写** `rooms.status`（0001 建了 check 却没有写入路径），于是房间
    // 永远停在 playing——重开的前置条件与回收的「打完 24 小时」都靠它，2026-08-02 补上。
    // 引擎的 phase 是唯一权威，这里只是把它同步到房间层。
    p_new_status:
      action.type === "startGame" ? "playing"
      : result.state.phase === "finished" ? "finished"
      : null,
  });
  if (error) {
    console.error("apply_room_action failed", error);
    return json({ error: "apply_failed" }, 500);
  }
  if (!applied) return json({ error: "version_conflict" }, 409);
  return json(applied.idempotent ? { version: applied.version, idempotent: true } : { version: applied.version });
});
