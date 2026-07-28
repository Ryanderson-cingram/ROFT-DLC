-- 等候室用 Postgres Changes 跟座位/准备/开局状态。
-- spec §3.2 禁的是拿 Postgres Changes 做**对局**主路径（那条走铃铛 + 快照）；
-- 等候室不是对局主路径，一张 4 行的表直接订阅比再造一套广播便宜。
-- RLS 照旧生效：非成员订阅不到别人房间的行。
alter publication supabase_realtime add table public.rooms, public.room_seats;
