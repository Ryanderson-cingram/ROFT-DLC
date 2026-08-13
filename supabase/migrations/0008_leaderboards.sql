-- ================================================================
-- 榜单（spec `2026-08-10-profile-stats-and-achievements` §6）
-- ================================================================

/**
 * 三条榜，每条的排序键就是 `player_stats` 里的**某一格**——不做天梯分那种合成分数
 * （2026-08-10 拍板），所以每个数玩家都能自己验算。
 *
 * **为什么是一个函数，而不是三条 PostgREST 查询**：排序键得按数字排。
 * `?order=stats->>wins.desc` 排的是 **text**——"9" 会排在 "10" 前头，榜单当场就是错的。
 * jsonb 取出来是文本，转型只能在 SQL 里做，那就干脆连排名一起在这儿算完。
 *
 * **不上物化视图**（spec §6）：几千行直接扫就够快，物化视图要养一个刷新作业。
 * 十万行那天再说。「我排第几」同样现算——`rank()` 已经把整张表排好了，捞自己那一行是白送的。
 *
 * security **invoker**（默认）：三张表的 RLS 对 authenticated 是 select 全开
 * （成就与统计里没有暗信息），所以不需要 definer，也就不需要在函数里自己判权限。
 */
create or replace function public.leaderboards()
returns jsonb
language sql
stable
set search_path = public
as $$
  with s as (
    select ps.user_id, p.username,
           coalesce((ps.stats->>'games')::int, 0)      as games,
           coalesce((ps.stats->>'wins')::int, 0)       as wins,
           coalesce((ps.stats->>'unoCaught')::int, 0)  as caught,
           coalesce((ps.stats->>'streakBest')::int, 0) as streak
      from player_stats ps
      join profiles p on p.id = ps.user_id
  ),
  -- 胜率榜的 50 局门槛写在这里（spec §6）：否则「1 胜 0 负」就是榜一。
  -- 另两条榜的门槛是「这一格得有数」——0 是「还没发生过」，不是并列最后一名。
  entries as (
    select 'winRate' as board, user_id, username, wins::real / games as value, games
      from s where games >= 50
    union all
    select 'caught', user_id, username, caught, games from s where caught > 0
    union all
    select 'streak', user_id, username, streak, games from s where streak > 0
  ),
  -- rank() 而不是 row_number()：并列就是并列（都 12 连胜的两个人不分先后）
  ranked as (select e.*, rank() over (partition by board order by value desc) as rk from entries e)
  select coalesce(jsonb_object_agg(board, b), '{}'::jsonb)
    from (
      select board,
             jsonb_build_object(
               -- 榜上共几人（「第 128 / 340」的分母）
               'total', count(*),
               'rows', coalesce(
                 jsonb_agg(jsonb_build_object(
                   'userId', user_id, 'name', username, 'value', value, 'games', games, 'rank', rk
                 ) order by rk, username) filter (where rk <= 100),
                 '[]'::jsonb),
               -- 「我排第几」。没上榜（不够门槛 / 这一格还是 0）就是 null，页面写「还没上榜」
               'mine', case
                 when count(*) filter (where user_id = auth.uid()) = 0 then null
                 else jsonb_build_object(
                   'rank', min(rk) filter (where user_id = auth.uid()),
                   'value', min(value) filter (where user_id = auth.uid()))
               end
             ) as b
        from ranked
       group by board
    ) x;
$$;

revoke all on function public.leaderboards() from public;
grant execute on function public.leaderboards() to authenticated;
-- 冒烟脚本用 service_role 跑（scripts/e2e-stats.mjs）
grant execute on function public.leaderboards() to service_role;
