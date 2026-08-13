-- 近 20 场（spec `2026-08-10-profile-stats-and-achievements` §6）。
--
-- `player_stats` 是宽表，装的是**累计量**；一段按时间排的历史塞不进去，也不该塞。
-- 所以另开一张窄表：一局一人一行，profile 页 `order by finished_at desc limit 20` 自己取近的。

-- ---------------------------------------------------------------- player_recent

/**
 * 一场一行。四列都是终局那一帧现成的东西，一个都不用另算。
 *
 * **`won` 可以是 null——那就是平局**（沿用引擎 `board.winner == null` 的同一条约定，
 * U8：牌堆洗满两次后又见底、无人打完）。写成三态的 text 也行，但那会在库里多立一份
 * 「W/L/D」的词汇表，而这个仓库里「没有赢家 = 平局」已经是既定读法。
 *
 * **不做「只留最近 20 行」的修剪**（初稿写了，2026-08-13 砍掉）：
 * 一场一行 ≈ 40 字节，一万局四人局也才 4 万行，Postgres 眼里等于零。
 * 「近 20 场」是**查询**的口径（`limit 20`），不是存储的口径——为它养一个修剪作业
 * 是拿一份要维护的定时任务去换一点点磁盘。
 * ponytail: 真长到要收的那天，往现成的每小时 `purge_stale_rooms` 里加一条 delete 就够。
 *
 * **没有去重键**：重放走的是 `apply_room_action` 的 `unique_violation` 分支，
 * 整个事务在这条 insert 之前就回滚返回了，够不着这张表（见那个函数的 exception 段）。
 */
create table public.player_recent (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  finished_at timestamptz not null default now(),
  -- null = 平局
  won boolean,
  -- 这一局用的技能。可能没有（座位空着、或这一局没抽到）
  skill_id text,
  -- 全场回合数（`SeatDelta.turns`，一桌人共享同一个数）
  turns int not null default 0,
  -- 收场时我手上还剩几张（赢家恒为 0）
  hand_left int not null default 0
);

-- 唯一的查询就是「某个人的最近 N 场」，索引照着它建
create index player_recent_user_idx on public.player_recent (user_id, finished_at desc);

alter table public.player_recent enable row level security;

-- 同 player_stats：**全员可读**（别人的命盘也要看得见近况），里面没有任何暗信息
create policy "player recent readable" on public.player_recent for select to authenticated using (true);
-- 写入没有 policy：只有 service_role 碰得着
grant select on table public.player_recent to authenticated;
grant select, insert, update, delete on table public.player_recent to service_role;
grant usage, select on sequence public.player_recent_id_seq to service_role;

-- ---------------------------------------------------------------- apply_room_action

/**
 * 终局那一帧顺带插一行近况。**搭 `p_stats` 的车**，不新开参数：
 * 每个座位在 `p_stats` 里本来就有一行，近况那四个值挂在它的 `recent` 上就行。
 * 签名没变，所以是 `create or replace`（0006 那次加参数才必须先 drop）。
 *
 * `p_stats` 的形状（由 Edge 用 @roft/stats 算好）：
 *   [{ "userId": uuid, "stats": {…}, "unlocked": [...],
 *      "recent": { "won": true|false|null, "skillId": "god-fade"|null, "turns": 6, "handLeft": 0 } }]
 *
 * 函数体只有末尾第三条 insert 是 0009 新增的，其余与 0006 逐字相同
 * （plpgsql 没法只替换一段，所以整份重贴）。
 */
create or replace function public.apply_room_action(
  p_room uuid,
  p_expected_version bigint,
  p_actor uuid,
  p_state jsonb,
  p_events jsonb,
  p_idempotency_key text,
  p_new_status text default null,
  p_stats jsonb default null
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

  if p_stats is not null then
    -- 整份覆盖写。合并已经在 TypeScript 里做完了（见 player_stats 的表注释）
    insert into player_stats (user_id, stats, updated_at)
    select (s->>'userId')::uuid, s->'stats', now()
      from jsonb_array_elements(p_stats) as s
    on conflict (user_id) do update
      set stats = excluded.stats, updated_at = excluded.updated_at;

    -- 每局都会把够格的成就整份算一遍，靠主键收口（见 player_achievements 的表注释）
    insert into player_achievements (user_id, achievement_id, room_id)
    select (s->>'userId')::uuid, a.id, p_room
      from jsonb_array_elements(p_stats) as s,
           jsonb_array_elements_text(coalesce(s->'unlocked', '[]'::jsonb)) as a(id)
    on conflict (user_id, achievement_id) do nothing;

    -- ---- 这一段是 0009 新增的，以上与 0006 逐字相同 ----
    -- `where s ? 'recent'`：迁移先上、边缘函数后部署的那个窗口里，老 payload 照样能落库
    insert into player_recent (user_id, finished_at, won, skill_id, turns, hand_left)
    select (s->>'userId')::uuid,
           now(),
           (s#>>'{recent,won}')::boolean,      -- 缺席 / JSON null → SQL null = 平局
           s#>>'{recent,skillId}',
           coalesce((s#>>'{recent,turns}')::int, 0),
           coalesce((s#>>'{recent,handLeft}')::int, 0)
      from jsonb_array_elements(p_stats) as s
     where s ? 'recent';
  end if;

  return jsonb_build_object('version', v_version, 'seq', v_seq + jsonb_array_length(p_events));

exception when unique_violation then
  select room_version into v_version
    from room_events where room_id = p_room and idempotency_key = p_idempotency_key;
  if v_version is null then raise; end if;
  return jsonb_build_object('version', v_version, 'idempotent', true);
end $$;

revoke all on function public.apply_room_action(uuid, bigint, uuid, jsonb, jsonb, text, text, jsonb) from public;
grant execute on function public.apply_room_action(uuid, bigint, uuid, jsonb, jsonb, text, text, jsonb) to service_role;
