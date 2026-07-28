create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 2 and 24),
  created_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  status text not null default 'lobby' check (status in ('lobby','playing','finished')),
  config jsonb not null default '{"rulePack":"base","skillDraft":"draft3"}',
  version bigint not null default 0,          -- 乐观锁 CAS 目标
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.room_seats (
  room_id uuid not null references public.rooms(id) on delete cascade,
  seat smallint not null check (seat between 0 and 3),
  user_id uuid not null references public.profiles(id),
  ready boolean not null default false,
  primary key (room_id, seat),
  unique (room_id, user_id)
);

create table public.room_state_private (   -- service role only：不建任何 policy
  room_id uuid primary key references public.rooms(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.room_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  seq bigint not null,
  actor uuid references public.profiles(id),
  type text not null,
  public_payload jsonb not null default '{}',
  private_payload jsonb,                    -- 永不给客户端（列级 grant 排除）
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (room_id, seq),
  unique (room_id, idempotency_key)
);
create index on public.room_events (room_id, seq desc);

create table public.skill_defs (
  ruleset_version text not null,
  id text not null,
  def jsonb not null,
  primary key (ruleset_version, id)
);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_seats enable row level security;
alter table public.room_state_private enable row level security;  -- 无 policy = 只有 service role
alter table public.room_events enable row level security;
alter table public.skill_defs enable row level security;

create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "profiles self upsert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles self update" on public.profiles for update to authenticated using (id = auth.uid());

create function public.is_room_member(p_room uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from room_seats where room_id = p_room and user_id = auth.uid()) $$;

create policy "rooms member read" on public.rooms for select to authenticated
  using (public.is_room_member(id) or created_by = auth.uid());
create policy "seats member read" on public.room_seats for select to authenticated
  using (public.is_room_member(room_id));
create policy "events member read" on public.room_events for select to authenticated
  using (public.is_room_member(room_id));
create policy "skill defs readable" on public.skill_defs for select to authenticated using (true);

-- Data API 暴露：显式授权模式（config.toml 的 auto_expose_new_tables 保持未设置＝新云端默认；
-- 该字段已废弃，2026-10-30 移除，别为了「显式」去打开它——打开就是退回旧模式）。
-- 新表默认不授权任何角色，RLS 只管「哪些行」，能不能碰到表仍要这里显式 grant。
-- room_events 不在整表 grant 里——它按列授权，见下。room_state_private 只给 service_role。
grant select on table
  public.profiles, public.rooms, public.room_seats, public.skill_defs
  to authenticated;
grant insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table
  public.profiles, public.rooms, public.room_seats,
  public.room_state_private, public.room_events, public.skill_defs
  to service_role;

-- 列级隐私：private_payload 不给 authenticated（RLS 管行、grant 管列）
grant select (id, room_id, seq, actor, type, public_payload, created_at)
  on table public.room_events to authenticated;

-- 铃铛：Broadcast from DB，payload 只有 id（spec §3.2 = {roomId, version, seq}）
-- seq 编码为 version*100 + 批内序号，所以 version = seq / 100（bigint 整除）。
create function public.notify_room_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(
    jsonb_build_object('roomId', new.room_id, 'version', new.seq / 100, 'seq', new.seq),
    'bell', 'room:' || new.room_id::text, false);
  return new;
end $$;
create trigger room_events_bell after insert on public.room_events
  for each row execute function public.notify_room_event();
