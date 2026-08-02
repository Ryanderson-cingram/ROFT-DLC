-- 再来一局与历史数据回收（0005_retention.sql）。
-- spec：`docs/superpowers/specs/2026-08-02-rematch-and-retention.md` §4.2，编号与那张表对应。
--
-- 跑：`supabase test db`
--
-- 时间靠**注入**而不是 pg_sleep：`purge_stale_rooms(p_now)` 收一个假的 now，
-- 所以「24 小时之后」是一个参数，不是真的等一天（同引擎里 ctx.now 的思路）。

begin;
select plan(22);

-- ---------------------------------------------------------------- 夹具

-- profiles 挂在 auth.users 上，测试里要先造用户
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@t.local', '', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@t.local', '', now(), now()),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@t.local', '', now(), now());

insert into public.profiles (id, username) values
  ('11111111-1111-1111-1111-111111111111', '小凛'),
  ('22222222-2222-2222-2222-222222222222', '阿柴'),
  ('33333333-3333-3333-3333-333333333333', '路人甲');

/** 造一桌：房间 + 两个座位 + state + 若干事件。返回 room id。 */
create or replace function pg_temp.make_room(
  p_code text,
  p_status text default 'finished',
  p_version bigint default 5,
  p_created timestamptz default now(),
  p_finished timestamptz default now()
) returns uuid language plpgsql as $$
declare v_room uuid;
begin
  insert into public.rooms (code, status, version, created_by, created_at, finished_at)
  values (p_code, p_status, p_version, '11111111-1111-1111-1111-111111111111', p_created,
          case when p_status = 'finished' then p_finished end)
  returning id into v_room;

  insert into public.room_seats (room_id, seat, user_id, ready) values
    (v_room, 0, '11111111-1111-1111-1111-111111111111', true),
    (v_room, 1, '22222222-2222-2222-2222-222222222222', true);

  insert into public.room_state_private (room_id, state)
  values (v_room, jsonb_build_object('version', p_version, 'phase', 'finished'));

  insert into public.room_events (room_id, seq, room_version, type, public_payload, idempotency_key, created_at)
  select v_room, i, p_version, 'cardPlayed', '{}'::jsonb, 'k' || i, p_created
    from generate_series(1, 3) as i;

  return v_room;
end $$;

/** 一份全新的 lobby state，形状同 Edge 造的那一份。 */
create or replace function pg_temp.fresh_state() returns jsonb language sql as $$
  select jsonb_build_object('version', 0, 'phase', 'lobby', 'seats', '[]'::jsonb, 'config', '{}'::jsonb);
$$;

-- ---------------------------------------------------------------- 重开（D1–D7）

do $$
declare v_room uuid; v_res jsonb;
begin
  v_room := pg_temp.make_room('AAAAA1');
  v_res := public.restart_room(v_room, 5, '11111111-1111-1111-1111-111111111111', pg_temp.fresh_state());
  perform set_config('test.room', v_room::text, false);
  perform set_config('test.res', coalesce(v_res::text, 'null'), false);
end $$;

select is(
  (select count(*)::int from public.room_events where room_id = current_setting('test.room')::uuid),
  0, 'D1 重开清干净：room_events 一行不剩');

select is(
  (select state ->> 'phase' from public.room_state_private where room_id = current_setting('test.room')::uuid),
  'lobby', 'D1 重开清干净：state 换成新的 lobby 局面（行还在，不是删掉）');

select is(
  (select count(*)::int from public.room_state_private where room_id = current_setting('test.room')::uuid),
  1, 'D1 state 那一行必须还在——它全局只 INSERT 一次，删了下一局就推不动');

select is(
  (select count(*)::int from public.room_seats where room_id = current_setting('test.room')::uuid),
  2, 'D2 重开保留座位：人不动');

select is(
  (select bool_or(ready) from public.room_seats where room_id = current_setting('test.room')::uuid),
  false, 'D2 重开保留座位：ready 全清');

select is(
  (select code from public.rooms where id = current_setting('test.room')::uuid),
  'AAAAA1', 'D3 房间号不变');

select is(
  (select status from public.rooms where id = current_setting('test.room')::uuid),
  'lobby', 'D3 status 回到 lobby');

select is(
  (select version from public.rooms where id = current_setting('test.room')::uuid),
  6::bigint, 'D3 version +1');

select is(
  (select finished_at from public.rooms where id = current_setting('test.room')::uuid),
  null, 'D3 finished_at 清空（下一局打完会盖新的）');

-- D4 不在座的人
do $$
declare v_room uuid; v_res jsonb;
begin
  v_room := pg_temp.make_room('BBBBB1');
  v_res := public.restart_room(v_room, 5, '33333333-3333-3333-3333-333333333333', pg_temp.fresh_state());
  perform set_config('test.room4', v_room::text, false);
  perform set_config('test.res4', coalesce(v_res::text, 'null'), false);
end $$;

select is(current_setting('test.res4')::jsonb ->> 'error', 'not_a_member', 'D4 不在座的人不能重开');
select is(
  (select status from public.rooms where id = current_setting('test.room4')::uuid),
  'finished', 'D4 被拒时零副作用：status 不动');
select is(
  (select count(*)::int from public.room_events where room_id = current_setting('test.room4')::uuid),
  3, 'D4 被拒时零副作用：事件一条没少');

-- D5 未终局
do $$
declare v_room uuid;
begin
  v_room := pg_temp.make_room('CCCCC1', 'playing');
  perform set_config('test.res5',
    coalesce(public.restart_room(v_room, 5, '11111111-1111-1111-1111-111111111111', pg_temp.fresh_state())::text, 'null'),
    false);
end $$;

select is(current_setting('test.res5'), 'null', 'D5 打到一半的房间重开不了（返回 NULL = 409）');

-- D6 乐观锁：过期的 expectedVersion
do $$
declare v_room uuid;
begin
  v_room := pg_temp.make_room('DDDDD1');
  perform set_config('test.res6',
    coalesce(public.restart_room(v_room, 4, '11111111-1111-1111-1111-111111111111', pg_temp.fresh_state())::text, 'null'),
    false);
  perform set_config('test.room6', v_room::text, false);
end $$;

select is(current_setting('test.res6'), 'null', 'D6 过期的 expectedVersion → NULL');
select is(
  (select count(*)::int from public.room_events where room_id = current_setting('test.room6')::uuid),
  3, 'D6 被拒时零副作用');

-- D4b 两人先后点（同一个 expectedVersion）：第二条必然落空
do $$
declare v_room uuid;
begin
  v_room := pg_temp.make_room('EEEEE1');
  perform public.restart_room(v_room, 5, '11111111-1111-1111-1111-111111111111', pg_temp.fresh_state());
  perform set_config('test.res4b',
    coalesce(public.restart_room(v_room, 5, '22222222-2222-2222-2222-222222222222', pg_temp.fresh_state())::text, 'null'),
    false);
  perform set_config('test.room4b', v_room::text, false);
end $$;

select is(current_setting('test.res4b'), 'null', 'D4b 两人同点：第二条拿 NULL（客户端当 409）');
select is(
  (select version from public.rooms where id = current_setting('test.room4b')::uuid),
  6::bigint, 'D4b version 只 +1');

-- ---------------------------------------------------------------- 回收（D8–D13）

-- 三种该删的 + 三种不该删的，一次 purge 跑完看谁还在
do $$
declare v_now timestamptz := '2026-08-02 12:00:00+00';
begin
  -- 该删
  insert into public.rooms (code, status, version, created_by, created_at)
  values ('DEL001', 'lobby', 0, '11111111-1111-1111-1111-111111111111', v_now - interval '2 hours');  -- D8 空房
  insert into public.rooms (code, status, version, created_by, created_at, finished_at)
  values ('DEL002', 'finished', 9, '11111111-1111-1111-1111-111111111111', v_now - interval '30 hours', v_now - interval '25 hours'); -- D10
  perform pg_temp.make_room('DEL003', 'playing', 3, v_now - interval '8 days');                        -- D11 弃坑

  -- 不该删
  insert into public.rooms (code, status, version, created_by, created_at)
  values ('KEP001', 'lobby', 0, '11111111-1111-1111-1111-111111111111', v_now - interval '10 minutes'); -- D9 刚建
  insert into public.rooms (code, status, version, created_by, created_at, finished_at)
  values ('KEP002', 'finished', 9, '11111111-1111-1111-1111-111111111111', v_now - interval '3 hours', v_now - interval '1 hour'); -- D10
  perform pg_temp.make_room('KEP003', 'lobby', 0, v_now - interval '2 hours');                          -- D11 有人在座

  perform set_config('test.purged', public.purge_stale_rooms(v_now)::text, false);
end $$;

select is(current_setting('test.purged')::int, 3, 'D8/D10/D13 一次 purge 删掉 3 个够格的房间');

select is(
  (select count(*)::int from public.rooms where code in ('DEL001', 'DEL002', 'DEL003')),
  0, 'D8+D10+D11 该删的都没了（空房 / 打完 25 小时 / 弃坑 8 天）');

select is(
  (select count(*)::int from public.rooms where code in ('KEP001', 'KEP002', 'KEP003')),
  3, 'D9+D10+D13 不该删的一个没动（刚建 / 打完 1 小时 / 有人在座）');

-- D12 cascade：删房间时另外三张表跟着走
select is(
  (select count(*)::int from public.room_events e
     join public.rooms r on r.id = e.room_id where r.code = 'DEL003'),
  0, 'D12 cascade：房间没了，事件也没了');

select is(
  (select count(*)::int from public.room_seats s
     where s.room_id not in (select id from public.rooms)),
  0, 'D12 cascade：没有悬空的座位行');

select * from finish();
rollback;
