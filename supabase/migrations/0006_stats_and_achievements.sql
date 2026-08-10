-- 跨局统计与成就。
-- spec：`docs/superpowers/specs/2026-08-10-profile-stats-and-achievements.md`
--
-- 这一版的形状被 0005 的回收策略逼死了：`purge_stale_rooms` 每小时把打完超过
-- 24 小时的房间连同它的 `room_events` 整个删掉。所以统计**不能「以后再从事件流算」**——
-- 终局那一刻不算，就永远算不出来了。于是判定与落库都挤在终局那一个事务里。

-- ---------------------------------------------------------------- player_stats

/**
 * 一人一行的累计量。
 *
 * **为什么是一个 jsonb 而不是 40 个列**：合并逻辑（连胜要看赢没赢、punish_max 取极值、
 * 四张分布表逐键相加）已经在 `packages/stats/src/achievements.ts::mergePrior` 里，
 * 有 47 个用例守着。在 SQL 里再写一遍就是双源——这个仓库为 skill_defs 专门配了
 * CI 漂移检查来防的正是这件事。所以**合并只留 TypeScript 一份**，
 * SQL 这边只负责把算好的整份原子地放进去。
 *
 * 代价写在明处：`stats` 是整体覆盖写，同一个人的两局**同时**结算会丢掉其中一局
 * （后写的那份是基于旧值算的）。一个人同时打两局本来就要主动开两个房间，
 * 而且损失是一局的计数——不值得为它引入一套 CAS 重试。真出现了再上。
 *
 * 形状的唯一来源是 `SeatDelta` / `PriorStats`（TypeScript）。这里不写 check 约束去复述它：
 * 复述就是第三份真相。
 */
create table public.player_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 榜单按**原始统计**排序，不做天梯分那种合成分数（2026-08-10 拍板）。
-- 每条榜的排序键就是 stats 里的一格，谁都能自己验算。表达式索引让它们走得动。
create index player_stats_wins_idx on public.player_stats (((stats->>'wins')::int) desc);
create index player_stats_caught_idx on public.player_stats (((stats->>'unoCaught')::int) desc);
create index player_stats_streak_idx on public.player_stats (((stats->>'streakBest')::int) desc);
-- 胜率榜要「≥ 50 局」的门槛，排序键是算出来的，所以两列都得在索引里
create index player_stats_winrate_idx on public.player_stats
  (((stats->>'games')::int), ((stats->>'wins')::real / nullif((stats->>'games')::int, 0)) desc);

-- ---------------------------------------------------------------- achievement_defs

/**
 * 成就的**描述**，不是**规则**。
 *
 * 判定逻辑留在 `packages/stats/src/achievements.ts`（它要读引擎的类型，而且改判定本来就该发版）。
 * 建这张表只为两件事：profile 页要渲染**未解锁**成就的名字与描述（否则客户端得内嵌一份定义），
 * 以及 `unlock_rate` 要能被日更作业写回。
 *
 * seed 由 `pnpm --filter @roft/stats gen:achievements` 生成，CI 用 git diff 卡双源漂移——
 * 同 skill_defs 的路子。
 */
create table public.achievement_defs (
  id text primary key,
  tier text not null check (tier in ('凡', '玄', '天', '神')),
  -- 封泥上刻的那一个字
  mark text not null,
  name text not null,
  descr text not null,
  -- 计数型成就的进度条（Steamworks 的 progress stat 那一套）。特判型与派生型两列都是 null。
  stat_key text,
  stat_goal int,
  sort int not null default 0,
  -- 全服解锁比例。既是给玩家看的稀有度，也是给设计者的难度体检（Steam 全局解锁率的用法）。
  -- 日更作业写，建表时留空。
  unlock_rate real,
  check ((stat_key is null) = (stat_goal is null))
);

-- ---------------------------------------------------------------- player_achievements

/**
 * 谁在什么时候解锁了什么。
 *
 * **主键即幂等键**：判定是「此刻够不够格」而不是「这一局跨没跨过阈值」
 * （见 `evaluate` 的注释），所以同一条成就每局都会被算出来一次，
 * 全靠 `on conflict do nothing` 收口。这也让漏写一次能自愈——下一局补上。
 */
create table public.player_achievements (
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_id text not null references public.achievement_defs(id),
  unlocked_at timestamptz not null default now(),
  -- 在哪一局解的。房间被 purge 掉之后置 null——成就本身不跟着房间走
  room_id uuid references public.rooms(id) on delete set null,
  primary key (user_id, achievement_id)
);

create index player_achievements_id_idx on public.player_achievements (achievement_id);

-- ---------------------------------------------------------------- RLS 与授权

alter table public.player_stats enable row level security;
alter table public.achievement_defs enable row level security;
alter table public.player_achievements enable row level security;

-- 三张表都**全员可读**：profile 页要看得了别人的，榜单要列得出所有人。
-- 里面没有任何暗信息——每一格都由公开事件推出来。
create policy "player stats readable" on public.player_stats for select to authenticated using (true);
create policy "achievement defs readable" on public.achievement_defs for select to authenticated using (true);
create policy "player achievements readable" on public.player_achievements for select to authenticated using (true);

-- 写入**没有任何 policy**：只有 service_role 碰得着（同 room_state_private 的路子）。
-- 统计是服务端从事件流算出来的，客户端一个字都不许改。
grant select on table
  public.player_stats, public.achievement_defs, public.player_achievements
  to authenticated;
grant select, insert, update, delete on table
  public.player_stats, public.achievement_defs, public.player_achievements
  to service_role;

-- ---------------------------------------------------------------- apply_room_action

/**
 * 终局那一步顺带把统计与成就落库。
 *
 * **为什么塞进这个函数而不是另开一个 RPC**：两次 `svc.rpc()` 是两个事务。
 * 游戏事件写进去了、统计那次挂了 → 这一局的数据永久丢失（24 小时后事件流就没了，
 * 补都没处补）。CAS + state + events + 统计必须是同一个事务。
 *
 * 老签名（7 参）**先 drop 再建**：带默认值的新参数会变成一个重载，
 * 于是 7 个实参的调用两边都匹配得上 → ambiguous function call。
 *
 * `p_stats` 的形状（由 Edge 用 @roft/stats 算好）：
 *   [{ "userId": uuid, "stats": {...整份合并后的累计量...}, "unlocked": ["swift", ...] }]
 * 缺省 null = 这一步不是终局，什么都不写。
 *
 * 函数体除末尾那一段之外与 0005 逐字相同（plpgsql 不支持只替换一段，所以整份重贴）。
 */
drop function public.apply_room_action(uuid, bigint, uuid, jsonb, jsonb, text, text);

create function public.apply_room_action(
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

  -- ---- 这一段是 0006 新增的，以上与 0005 逐字相同 ----
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
