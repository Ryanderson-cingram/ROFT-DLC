-- 再来一局（原房间重开）与历史数据回收。
-- spec：`docs/superpowers/specs/2026-08-02-rematch-and-retention.md`
--
-- ⚠️ 先补一条 spec 写的时候没发现的洞：`rooms.status` **从来没有被写成 'finished'**。
-- 0001 建了 check 约束（lobby/playing/finished），但只有 startGame 走 p_new_status='playing'，
-- 终局那一步谁都没写。重开的前置条件与回收的「打完 24 小时」全靠它，所以这一版把这条边补上。

-- ---------------------------------------------------------------- finished_at

-- 回收要的是「**打完**多久」，而 created_at 是**建房**时间——一局打三小时的房间用 created_at
-- 判就会被提前删掉。所以单开一列，与 status='finished' 同生同灭（重开时置回 null）。
alter table public.rooms add column finished_at timestamptz;

-- 存量不用回填：status 在这一版之前从没被写成 'finished'，一行都没有。

-- 房主/大厅要读它（同 status 那一列的可见性），照 0001 的显式列级 grant 模式补上
grant select (finished_at) on table public.rooms to authenticated;

-- ---------------------------------------------------------------- 终局盖时间戳
-- 只在 0003 的函数体上加一行 finished_at，其余逐字不变（plpgsql 不支持只替换一段，
-- 所以整份重贴；改动就是 update rooms 那句里多出来的那一行）。

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
  if p_events is null or jsonb_array_length(p_events) = 0 then
    raise exception 'apply_room_action: refusing to apply an action with no events';
  end if;

  select room_version into v_version
    from room_events where room_id = p_room and idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('version', v_version, 'idempotent', true); end if;

  update rooms
     set version = p_expected_version + 1,
         status  = coalesce(p_new_status, status),
         -- 终局那一刻盖上时间戳（回收的唯一依据）。用 case 而不是 coalesce：
         -- 同一个房间重开再打完要盖**新**的时间，不能保留上一局的
         finished_at = case when p_new_status = 'finished' then now() else finished_at end
   where id = p_room and version = p_expected_version
  returning version into v_version;
  if not found then return null; end if;

  update room_state_private
     set state = p_state || jsonb_build_object('version', v_version),
         updated_at = now()
   where room_id = p_room;

  select coalesce(max(seq), 0) into v_seq from room_events where room_id = p_room;

  insert into room_events (
    room_id, seq, room_version, actor, type, public_payload, private_payload, idempotency_key)
  select p_room, v_seq + e.i, v_version, p_actor,
         e.ev ->> 'type',
         coalesce(e.ev -> 'public', '{}'::jsonb),
         case
           when e.ev ? 'private' and e.ev ? 'audit'
             then jsonb_build_object('private', e.ev -> 'private', 'audit', e.ev -> 'audit')
           when e.ev ? 'audit' then jsonb_build_object('audit', e.ev -> 'audit')
           else e.ev -> 'private'
         end,
         case when e.i = 1 then p_idempotency_key end
    from jsonb_array_elements(p_events) with ordinality as e(ev, i);

  return jsonb_build_object('version', v_version, 'seq', v_seq + jsonb_array_length(p_events));

exception when unique_violation then
  select room_version into v_version
    from room_events where room_id = p_room and idempotency_key = p_idempotency_key;
  if v_version is null then raise; end if;
  return jsonb_build_object('version', v_version, 'idempotent', true);
end $$;

-- ---------------------------------------------------------------- 重开

/**
 * 原房间重开：房间号不变、人不动，把上一局的痕迹清干净。
 * 返回 {version}；**返回 SQL NULL = CAS 冲突或房间不在 finished**（零副作用）。
 *
 * `p_state` 由 Edge 用引擎的类型现造一份全新的 lobby state 传进来——GameState 的形状是
 * 引擎的事，不在 SQL 里拼（同 create-room）。
 *
 * 幂等**不靠 idempotency_key**：那把钥匙记在 room_events 上，而这个函数正要把那张表清空。
 * CAS 就是唯一的串行化点——四个人同时点，第一条把 version 推进，其余全部 not found → 409。
 * 客户端把 409 当成「别人已经重开了」，照样进等候室即可（结果一致，所以不需要重试）。
 */
create or replace function public.restart_room(
  p_room uuid,
  p_expected_version bigint,
  p_actor uuid,
  p_state jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_version bigint;
begin
  -- 2026-08-02 拍板：**任何在座玩家**都能重开，不限房主
  if not exists (select 1 from room_seats where room_id = p_room and user_id = p_actor) then
    return jsonb_build_object('error', 'not_a_member');
  end if;

  -- CAS 必须是第一条写语句：它顺带锁住 rooms 行，把同房间的并发重开串行化。
  -- `status = 'finished'` 一并写进 where：Edge 那边的预检查挡不住 TOCTOU，
  -- 真正的门闩在这里（打到一半的房间谁都重开不了）。
  update rooms
     set status = 'lobby',
         version = p_expected_version + 1,
         finished_at = null
   where id = p_room
     and version = p_expected_version
     and status = 'finished'
  returning version into v_version;
  if not found then return null; end if;

  -- 上一局的记录**不留**（2026-08-02 拍板，不做归档表）
  delete from room_events where room_id = p_room;

  -- state 是 update 不是 delete + insert：这一行由 create-room 建，全局只 INSERT 一次，
  -- 删掉的话下一次 apply_room_action 的 UPDATE 会静默改 0 行，牌桌永远推进不了
  update room_state_private
     set state = p_state || jsonb_build_object('version', v_version),
         updated_at = now()
   where room_id = p_room;

  -- 人留着，准备状态清空（房主在等候室里照旧算已准备，那是 UI 的口径）
  update room_seats set ready = false where room_id = p_room;

  return jsonb_build_object('version', v_version);
end $$;

revoke all on function public.restart_room(uuid, bigint, uuid, jsonb) from public;
grant execute on function public.restart_room(uuid, bigint, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------- 回收

-- 「最近一条事件是什么时候」要按房间查，(room_id, seq desc) 那个索引排的是 seq，用不上。
create index room_events_room_created_idx on public.room_events (room_id, created_at desc);

/**
 * 删掉再也没人会回来的房间。三条独立的理由，满足任意一条即删：
 *
 * 1. `lobby` 且**一个人都没有**且建了超过 1 小时 —— 建了没人进的空房
 * 2. `finished` 且打完超过 24 小时 —— 打完没人再开的房（2026-08-02 拍板的保留期）
 * 3. 最近一条事件在 7 天前（或压根没有事件且建房超过 7 天）—— 打到一半没人管的房
 *
 * 只删 `rooms` 一行，另外三张表靠 0001 的 `on delete cascade` 跟着走。
 *
 * `p_now` 是**注入**的而不是直接用 now()：测试要把时间拨到一天以后，靠 pg_sleep 不现实。
 * 同引擎里 `ctx.now` 的思路——时间是入参，函数本身是纯的、可测的。
 */
create or replace function public.purge_stale_rooms(p_now timestamptz default now())
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_deleted integer;
begin
  delete from rooms r
   where
     -- 1. 建了没人进的空房
     (r.status = 'lobby'
        and r.created_at < p_now - interval '1 hour'
        and not exists (select 1 from room_seats s where s.room_id = r.id))
     -- 2. 打完没人再开
     or (r.status = 'finished' and r.finished_at is not null and r.finished_at < p_now - interval '24 hours')
     -- 3. 打到一半没人管：最近一条事件在 7 天前（没有事件就看建房时间）
     or (coalesce(
           (select max(e.created_at) from room_events e where e.room_id = r.id),
           r.created_at
         ) < p_now - interval '7 days');
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function public.purge_stale_rooms(timestamptz) from public;
grant execute on function public.purge_stale_rooms(timestamptz) to service_role;

-- 每小时跑一次。pg_cron 在 Supabase 上要显式建扩展；`cron` schema 归 postgres。
create extension if not exists pg_cron with schema extensions;
select cron.schedule('purge-stale-rooms', '0 * * * *', $$select public.purge_stale_rooms()$$);
