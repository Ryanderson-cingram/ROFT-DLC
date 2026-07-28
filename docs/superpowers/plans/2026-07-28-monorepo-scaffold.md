# Monorepo 脚手架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 涉及 Supabase 的任务先加载 `supabase` 技能。

**Goal:** 建起可 CI 的 monorepo 走通骨架：pnpm workspace + 纯 TS 引擎包（带首批单测）+ Next.js 壳 + Supabase 迁移与两个 Edge Function（`ping` 动作端到端走通乐观锁与事件落库）。

**Architecture:** 见 spec `docs/superpowers/specs/2026-07-28-roft-dlc-web-design.md` §3–§5。本计划只搭骨架：引擎实现唯一动作 `ping`（校验→事件→version++），证明「客户端 → Edge → 引擎 → Postgres CAS → 事件 → 铃铛」整条管道；真实规则在后续计划。

**Tech Stack:** pnpm ≥9、TypeScript 5.x、Vitest、Next.js 15（App Router）、Supabase CLI（Postgres 迁移 + Deno Edge Functions）。

## Global Constraints

- **不得**触碰 `design/mockups/`（设计代理在并行工作）
- 引擎包纯 TS、零 IO、零依赖；内部相对导入**必须带 `.ts` 扩展名**（Deno 与 Node 双跑的前提）
- 表名/字段与 spec §4 一致：`profiles` `rooms` `room_seats` `room_state_private` `room_events` `skill_defs`
- 写入约定：`expectedVersion` 乐观锁 + `idempotency_key` 唯一约束（spec §4）
- Broadcast 只带 `{ roomId, version, seq }`，经 DB 触发器 `realtime.send`（spec §3.2）
- 每个任务一次 commit；不 push（等用户要求）

---

### Task 1: Workspace 根

**Files:**
- Create: `pnpm-workspace.yaml`、`package.json`、`tsconfig.base.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: workspace 包名约定 `@roft/engine`、`web`；根脚本 `pnpm test` / `pnpm build`

- [ ] **Step 1: 写 workspace 文件**

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

```json
// package.json
{
  "name": "roft-dlc",
  "private": true,
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck"
  },
  "packageManager": "pnpm@9.15.0"
}
```

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  }
}
```

`.gitignore` 追加：`node_modules/`、`.next/`、`supabase/.temp/`、`.env*`。

- [ ] **Step 2: 验证** `pnpm install` 退出码 0（此时无包，秒过）
- [ ] **Step 3: Commit** `git add -A && git commit -m "chore: pnpm workspace root"`

### Task 2: `packages/engine` 骨架（TDD）

**Files:**
- Create: `packages/engine/package.json`、`packages/engine/tsconfig.json`、`packages/engine/src/types.ts`、`packages/engine/src/index.ts`
- Test: `packages/engine/test/apply-action.test.ts`

**Interfaces:**
- Produces（后续所有任务与计划依赖，签名逐字沿用）:

```ts
// types.ts 全文
export type Phase = "lobby" | "dealing" | "turnStart" | "play" | "afterPlay";
export interface PendingWindow {
  type: string;
  actors: number[];          // seat 下标
  deadline: string;          // ISO 时间戳（由 Edge 注入的 ctx.now 计算）
  defaultChoice: string;
  resume: Phase;
}
export interface GameState {
  version: number;
  phase: Phase;
  seats: { userId: string }[];
  pendingWindow?: PendingWindow;
}
export type Action =
  | { type: "ping"; seat: number }
  | { type: "respond"; seat: number; windowId: string; choice: string };
export interface EngineEvent { type: string; public: Record<string, unknown>; private?: { seat: number; payload: Record<string, unknown> } }
export interface Ctx { rng: () => number; now: string }
export interface ApplyResult { state: GameState; events: EngineEvent[]; rejected?: { reason: string } }
```

```ts
// index.ts 导出
export function applyAction(state: GameState, action: Action, ctx: Ctx): ApplyResult;
export function projectView(state: GameState, seat: number): { version: number; phase: Phase; youSeat: number };
export * from "./types.ts";
```

- [ ] **Step 1: 写失败测试**

```ts
// packages/engine/test/apply-action.test.ts
import { describe, expect, it } from "vitest";
import { applyAction, projectView, type GameState } from "../src/index.ts";

const base: GameState = { version: 3, phase: "play", seats: [{ userId: "u1" }, { userId: "u2" }, { userId: "u3" }] };
const ctx = { rng: () => 0.5, now: "2026-07-28T00:00:00Z" };

describe("applyAction", () => {
  it("ping bumps version and emits event, without mutating input", () => {
    const r = applyAction(base, { type: "ping", seat: 0 }, ctx);
    expect(r.rejected).toBeUndefined();
    expect(r.state.version).toBe(4);
    expect(r.events).toEqual([{ type: "pinged", public: { seat: 0 } }]);
    expect(base.version).toBe(3); // 不可变
  });
  it("rejects unknown seat", () => {
    const r = applyAction(base, { type: "ping", seat: 9 }, ctx);
    expect(r.rejected?.reason).toBe("invalid_seat");
    expect(r.state).toBe(base);
  });
  it("projectView hides other seats' identity", () => {
    expect(projectView(base, 1)).toEqual({ version: 3, phase: "play", youSeat: 1 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败** `pnpm --filter @roft/engine test` → FAIL（模块不存在）
- [ ] **Step 3: 最小实现**

```ts
// packages/engine/src/index.ts
import type { Action, ApplyResult, Ctx, GameState } from "./types.ts";
export * from "./types.ts";

export function applyAction(state: GameState, action: Action, _ctx: Ctx): ApplyResult {
  if (action.seat < 0 || action.seat >= state.seats.length)
    return { state, events: [], rejected: { reason: "invalid_seat" } };
  switch (action.type) {
    case "ping":
      return { state: { ...state, version: state.version + 1 }, events: [{ type: "pinged", public: { seat: action.seat } }] };
    default:
      return { state, events: [], rejected: { reason: "unknown_action" } };
  }
}

export function projectView(state: GameState, seat: number) {
  return { version: state.version, phase: state.phase, youSeat: seat };
}
```

`package.json`：name `@roft/engine`，`"exports": { ".": "./src/index.ts" }`，scripts `test: vitest run`、`typecheck: tsc -p .`，devDeps `vitest`、`typescript`。`tsconfig.json` extends `../../tsconfig.base.json`。

- [ ] **Step 4: 跑测试确认通过** + `pnpm --filter @roft/engine typecheck`
- [ ] **Step 5: Commit** `git commit -m "feat(engine): walking-skeleton applyAction/projectView with tests"`

### Task 3: `apps/web` Next.js 壳

**Files:**
- Create: `apps/web/`（create-next-app 生成）+ 修改 `apps/web/app/page.tsx`、`apps/web/next.config.ts`

- [ ] **Step 1: 生成** `pnpm create next-app@latest apps/web --ts --app --no-eslint --no-tailwind --no-src-dir --import-alias "@/*" --use-pnpm`（交互项全取默认/否）
- [ ] **Step 2: 接引擎证明 workspace 链路**：`pnpm --filter web add @roft/engine --workspace`；`next.config.ts` 加 `transpilePackages: ["@roft/engine"]`；`page.tsx` 替换为：

```tsx
import { projectView, type GameState } from "@roft/engine";

const demo: GameState = { version: 1, phase: "lobby", seats: [{ userId: "demo" }] };

export default function Home() {
  const view = projectView(demo, 0);
  return <main><h1>ROFT-DLC</h1><p>engine ok · phase: {view.phase} · v{view.version}</p></main>;
}
```

- [ ] **Step 3: 验证** `pnpm --filter web build` 成功；`pnpm --filter web dev` 首页渲染 `engine ok · phase: lobby · v1`
- [ ] **Step 4: Commit** `git commit -m "feat(web): next.js shell wired to engine package"`

### Task 4: Supabase 迁移 0001（六表 + RLS + 铃铛触发器）

**Files:**
- Create: `supabase/`（`supabase init` 生成）、`supabase/migrations/0001_init.sql`

- [ ] **Step 1: `supabase init`**（不启动本地栈也能建目录）
- [ ] **Step 2: 写迁移**（下述 SQL 全文入库；列注释即文档）

```sql
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

-- 列级隐私：private_payload 不给 authenticated（RLS 管行、grant 管列）
revoke select on table public.room_events from authenticated;
grant select (id, room_id, seq, actor, type, public_payload, created_at)
  on table public.room_events to authenticated;

-- 铃铛：Broadcast from DB，payload 只有 id（spec §3.2）
create function public.notify_room_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(
    jsonb_build_object('roomId', new.room_id, 'version', new.seq, 'seq', new.seq),
    'bell', 'room:' || new.room_id::text, false);
  return new;
end $$;
create trigger room_events_bell after insert on public.room_events
  for each row execute function public.notify_room_event();
```

- [ ] **Step 3: 验证**：有 Docker 则 `supabase start && supabase db reset` 全绿；无 Docker 则 `supabase db lint` / 目检后在 commit message 注明未跑本地栈
- [ ] **Step 4: Commit** `git commit -m "feat(db): initial schema, RLS, event bell trigger"`

### Task 5: Edge Functions `room-action` / `get-snapshot`

**Files:**
- Create: `supabase/functions/room-action/index.ts`、`supabase/functions/get-snapshot/index.ts`、`supabase/functions/_shared/db.ts`

**Interfaces:**
- Consumes: Task 2 的 `applyAction/projectView`（Deno 直接相对导入 `../../../packages/engine/src/index.ts`——engine 带 `.ts` 扩展名导入正是为此）
- Produces: HTTP 契约 `POST room-action { roomId, expectedVersion, action, idempotencyKey }` → `200 {version} | 400 {reason} | 401 | 409 {error:"version_conflict"}`；`POST get-snapshot { roomId }` → `200 {version, view}`

- [ ] **Step 1: 写 `_shared/db.ts`**（两个 client 工厂：`userClient(req)` 用请求方 JWT、`serviceClient()` 用 service role，均 `npm:@supabase/supabase-js@2`）
- [ ] **Step 2: 写 `room-action/index.ts`**（走通管道；ponytail: 多语句非事务，真实动作前改为单个 RPC 函数包事务）

```ts
import { applyAction, type GameState } from "../../../packages/engine/src/index.ts";
import { serviceClient, userClient } from "../_shared/db.ts";

Deno.serve(async (req) => {
  const { roomId, expectedVersion, action, idempotencyKey } = await req.json();
  const { data: { user } } = await userClient(req).auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const svc = serviceClient();
  const { data: dup } = await svc.from("room_events").select("seq")
    .eq("room_id", roomId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (dup) return Response.json({ version: Math.floor(dup.seq / 100), idempotent: true });

  const { data: priv } = await svc.from("room_state_private").select("state").eq("room_id", roomId).single();
  if (!priv) return Response.json({ error: "room_not_found" }, { status: 404 });

  const result = applyAction(priv.state as GameState, action,
    { rng: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32, now: new Date().toISOString() });
  if (result.rejected) return Response.json({ reason: result.rejected.reason }, { status: 400 });

  const { data: cas } = await svc.from("rooms")
    .update({ version: expectedVersion + 1 })
    .eq("id", roomId).eq("version", expectedVersion).select("version");
  if (!cas?.length) return Response.json({ error: "version_conflict" }, { status: 409 });

  await svc.from("room_state_private").update({ state: result.state }).eq("room_id", roomId);
  await svc.from("room_events").insert(result.events.map((e, i) => ({
    // seq 语义：每 action 一批事件，seq = 新version*100 + 批内序号（单 action 事件数 <100）
    room_id: roomId, seq: (expectedVersion + 1) * 100 + i, actor: user.id, type: e.type,
    public_payload: e.public, private_payload: e.private ?? null,
    idempotency_key: i === 0 ? idempotencyKey : null,
  })));
  return Response.json({ version: expectedVersion + 1 });
});
```

- [ ] **Step 3: 写 `get-snapshot/index.ts`**（鉴权 → `is_room_member` 校验（查 `room_seats`）→ 读 `room_state_private` → `projectView(state, seat)` → `200 {version, view}`）
- [ ] **Step 4: 验证**：有 Docker 则 `supabase functions serve` + 两条 `curl`（401 无 token；带 token ping 走通 200/409）；无 Docker 则 `deno check supabase/functions/**/index.ts`
- [ ] **Step 5: Commit** `git commit -m "feat(edge): room-action + get-snapshot walking skeleton"`

### Task 6: CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 写 workflow**：push/PR 触发；`pnpm/action-setup@v4` + `actions/setup-node@v4`（node 22, cache pnpm）→ `pnpm install --frozen-lockfile` → `pnpm test` → `pnpm --filter web build` → `denoland/setup-deno@v2` + `deno check supabase/functions/room-action/index.ts supabase/functions/get-snapshot/index.ts`
- [ ] **Step 2: 验证** 本地把三条命令按 CI 顺序跑一遍全绿
- [ ] **Step 3: Commit** `git commit -m "ci: engine tests + web build + deno check"`

---

## Verification（整计划完成后）

1. `pnpm install && pnpm test && pnpm --filter web build` 全绿
2. `deno check supabase/functions/*/index.ts` 通过
3. 有 Docker：`supabase start && supabase db reset`，然后 `functions serve` + curl ping 动作返回 `{version}` 且 `room_events` 出现 `pinged` 行、`rooms.version` +1
4. `git log --oneline` 含 6 个任务提交；未 push（等用户指令）

## Out of scope（后续计划）

- 真实 UNO 规则/技能 handler、pendingWindow 结算、claimTimeout、房间创建/加入流程、Realtime 客户端订阅、`skill_defs` 生成脚本
