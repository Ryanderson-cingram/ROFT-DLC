-- room-action 的写路径改成一个事务。
-- 之前是四条独立语句（CAS version / 写 state / 改 status / 插事件），中间任何一条失败
-- 都留下撕裂状态。全部塞进一个 plpgsql 函数体 = 一个事务，要么全成要么全不成。

-- 事件所属的房间版本。以前靠 seq/100 反推，那个编码假设「单 action 事件数 < 100」。
alter table public.room_events add column room_version bigint not null default 0;
alter table public.room_events alter column room_version drop default;
grant select (room_version) on table public.room_events to authenticated;  -- 列级 grant 是叠加的

/**
 * 一次动作的全部写入。失败即整体回滚。
 * 返回 {version, seq}；**返回 SQL NULL 表示 CAS 版本冲突**（此时本函数没有任何副作用）。
 */
create or replace function public.apply_room_action(
  p_room uuid,
  p_expected_version bigint,
  p_actor uuid,
  p_state jsonb,
  p_events jsonb,
  p_idempotency_key text,
  p_new_status text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_version bigint;
  v_seq bigint;
begin
  -- 幂等键只挂在批内第一条事件上；没有事件就没有地方记它，重放保护会静默失效。
  if p_events is null or jsonb_array_length(p_events) = 0 then
    raise exception 'apply_room_action: refusing to apply an action with no events';
  end if;

  -- 幂等重放必须在 CAS 之前：重放带的通常是**旧的** expectedVersion（第一次其实成功了，
  -- 客户端只是没收到响应），先做 CAS 的话它会直接冲突失败，幂等键就形同虚设。
  select room_version into v_version
    from room_events where room_id = p_room and idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('version', v_version, 'idempotent', true); end if;

  -- CAS 必须是第一条写语句：它顺带锁住 rooms 行，把同房间的并发写串行化，
  -- 下面 max(seq)+1 才不需要额外的序列或锁。
  update rooms
     set version = p_expected_version + 1,
         status  = coalesce(p_new_status, status)
   where id = p_room and version = p_expected_version
  returning version into v_version;
  if not found then return null; end if;

  -- version 的唯一权威是 rooms.version；快照走 state.version，两者必须是同一个数。
  update room_state_private
     set state = p_state || jsonb_build_object('version', v_version),
         updated_at = now()
   where room_id = p_room;

  -- seq：每房间单调递增的真序列，不再编码 version。
  select coalesce(max(seq), 0) into v_seq from room_events where room_id = p_room;

  insert into room_events (
    room_id, seq, room_version, actor, type, public_payload, private_payload, idempotency_key)
  select p_room, v_seq + e.i, v_version, p_actor,
         e.ev ->> 'type',
         coalesce(e.ev -> 'public', '{}'::jsonb),
         -- private（只给某座位）与 audit（谁都不给，只为重放）都进这一列：
         -- private_payload 的列级 grant 已把 authenticated 排除在外，客户端永远看不到。
         case
           when e.ev ? 'private' and e.ev ? 'audit'
             then jsonb_build_object('private', e.ev -> 'private', 'audit', e.ev -> 'audit')
           when e.ev ? 'audit' then jsonb_build_object('audit', e.ev -> 'audit')
           else e.ev -> 'private'
         end,
         case when e.i = 1 then p_idempotency_key end
    from jsonb_array_elements(p_events) with ordinality as e(ev, i);

  return jsonb_build_object('version', v_version, 'seq', v_seq + jsonb_array_length(p_events));

-- 上面的预检查挡不住真正的并发：两个同 key 的请求可能双双查不到、双双往下走。
-- 最后由唯一约束裁决，输的那个走这里——异常处理块自带隐式 savepoint，
-- 抛出时上面的 CAS 与 state 写入一并回滚，所以它同样是零副作用。
exception when unique_violation then
  select room_version into v_version
    from room_events where room_id = p_room and idempotency_key = p_idempotency_key;
  -- 查不到说明撞的是别的唯一约束（如 room_id+seq），那是真 bug，不能吞掉
  if v_version is null then raise; end if;
  return jsonb_build_object('version', v_version, 'idempotent', true);
end $$;

-- 授权照 0001 的显式模式：只有 service_role 能调（Edge 用 service key）。
revoke all on function public.apply_room_action(uuid, bigint, uuid, jsonb, jsonb, text, text) from public;
grant execute on function public.apply_room_action(uuid, bigint, uuid, jsonb, jsonb, text, text) to service_role;

-- 铃铛读新列，不再除 100。触发器本身不变，只换函数体。
create or replace function public.notify_room_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(
    jsonb_build_object('roomId', new.room_id, 'version', new.room_version, 'seq', new.seq),
    'bell', 'room:' || new.room_id::text, false);
  return new;
end $$;
