# Web 客户端与房间流程 Implementation Plan

> **执行方式：** 逐 Task 实施，每个 Task 一次 commit。
> **必读技能：** 动手前加载 `supabase:supabase`（Auth/Realtime/SSR 的正确写法，尤其 `@supabase/ssr` cookie 处理）与 `vercel:nextjs`（App Router / Server Components 边界）。视觉相关任务加载 `frontend-design:frontend-design`。

**Goal:** 让真人能用浏览器登录、开房、加入、开局，并在对局 HUD 里看到自己的手牌与回合状态；铃铛 + 快照的实时链路跑通。

**Architecture:** `apps/web`（Next.js App Router）→ Edge Functions → `packages/engine`。客户端**永远不判规则**，只渲染 `ClientSnapshot` 并把用户意图发成 `Action`。收到 Realtime 铃铛 → 拉快照；铃铛不保证送达，所以有 30s 轮询与回前台必拉兜底（spec §3.2）。

## Global Constraints

- **只动 `apps/web/` 和 `supabase/`。** `packages/engine/` 有另一个代理在并行实现规则，**一个字都不要改**——包括 `src/types.ts`。
- `packages/engine/src/types.ts`（commit `9a8e895`）是冻结契约，从它 import 类型，不要在前端另抄一份类型定义。需要改字段？停下来在最终报告里提出。
- **并行现实**：引擎的真实动作（出牌/摸牌/惩罚）此刻还没实现，`applyAction` 对它们会返回 `unknown_action`。所以本计划的对局 HUD **靠 fixture 快照渲染**（见 Task 4），等两边合并后再接真数据。不要为了「能跑通」去引擎里补实现。
- 设计稿在 `design/mockups/`（`lobby.html` / `room.html` / `game.html` / `encyclopedia.html`）：**照着搬**结构、文案、状态，配色统一从 `tokens.css` 的自定义属性来。不要重新发明视觉。
- 客户端不得持有 service role key。`NEXT_PUBLIC_*` 只放 URL 与 publishable key。
- 每个 Task 一次 commit，不 push。

---

### Task 1: Supabase 客户端与匿名登录

**Files:** Create `apps/web/lib/supabase/{client,server}.ts`、`apps/web/app/login/page.tsx`; Modify `supabase/config.toml`、`apps/web/.env.local.example`

**决策：MVP 用匿名登录 + 昵称**，不做邮箱/密码——私房熟人局，一个昵称就够，邮箱注册是纯摩擦。`config.toml` 里 `[auth] enable_anonymous_sign_ins = true`。

> **已被取代（2026-08-10）：** 登录改成邮箱 + 密码，昵称降为「没有 profile 时补的第二步」。
> 匿名登录随之关掉（`enable_anonymous_sign_ins = false`）。设计稿：`design/mockups/login.html`。

- [ ] **Step 1:** 按 `supabase` 技能的 `@supabase/ssr` 写法建 browser/server 两个 client 工厂（**不要**用已废弃的 auth-helpers）
- [ ] **Step 2:** 登录页：输入昵称 → `signInAnonymously()` → 写 `profiles` 行（`username` 长度 2–24，见迁移里的 check 约束；**单字昵称如「凛」会被拒**，前端要给出人话提示，别让用户撞 500）
- [ ] **Step 3: 验证** — `supabase start` 后实际走一遍：登录后 `profiles` 出现对应行，刷新页面仍是登录态（cookie 正确落地）
- [ ] **Step 4: Commit** `feat(web): anonymous auth with nickname profile`

### Task 2: 房间生命周期 Edge Functions

**Files:** Create `supabase/functions/{create-room,join-room}/index.ts`; Modify `supabase/functions/room-action/index.ts`

- [ ] **Step 1: `create-room`** — 鉴权 → 生成 6 位房间码（`^[A-Z0-9]{6}$`，避开易混的 0/O/1/I；**碰撞要重试**，unique 约束撞了不能直接 500）→ 建 `rooms` 行 → 建房主 `room_seats` seat 0 → 建 `room_state_private` 初始行 `{version:0, phase:"lobby", ...}` → 返回 `{roomId, code}`
- [ ] **Step 2: `join-room`** — 按 code 查房 → 满 4 人 → `409 room_full`；已在座 → 返回原座位（幂等）；房间 `status !== 'lobby'` → `409 already_started`；否则占最小空座位
- [ ] **Step 3: 准备与开局** — `room_seats.ready` 切换走一个 `toggle-ready`（或复用 `room-action`，自己选一个并说明理由）；开局由房主发 `startGame` 走既有 `room-action`，Edge 负责从 `room_seats` + `profiles` 组装 `seats:[{userId,name}]` 传给引擎，并把 `rooms.status` 改 `playing`
- [ ] **Step 4: 验证** — `supabase functions serve` + curl：建房、二号玩家加入、满员拒绝、非法房间码 404。**开局这条会返回 `unknown_action`**（引擎还没实现），如实记录，不要绕过
- [ ] **Step 5: Commit** `feat(edge): room create/join/ready lifecycle`

### Task 3: 大厅与房间页

**Files:** Create `apps/web/app/page.tsx`（大厅）、`apps/web/app/room/[code]/page.tsx`; 参照 `design/mockups/lobby.html`、`room.html`

- [ ] **Step 1: 大厅** — 创建房间（规则包单选，默认基础包；「抽 3 选 1」只读）+ 加入房间（6 位码）+ 玩家百科入口。诸神包旁的「进阶内容，建议先玩过基础包」照搬
- [ ] **Step 2: 房间页** — 房间码大号 + 复制按钮（用 `navigator.clipboard`）；4 个座位卡；准备/开始按钮按是否房主切换（设计稿里的两视角切换器在真实产品里由身份决定，**不要**保留切换器）
- [ ] **Step 3: Presence** — Supabase Realtime Presence 显示在线绿点/离线灰点；座位与准备状态用 Postgres Changes 或订阅后重拉（**理由写进 commit message**：这是 lobby，不是对局主路径，spec §3.2 只禁止用 Postgres Changes 做**对局**主路径）
- [ ] **Step 4: 验证** — 开两个浏览器 profile（或一个正常窗 + 一个无痕窗）真的互相看见：A 建房 → B 用码加入 → A 看到 B 出现并变绿 → B 准备 → A 看到状态变化
- [ ] **Step 5: Commit** `feat(web): lobby and room screens with presence`

### Task 4: 对局 HUD（fixture 驱动）

**Files:** Create `apps/web/app/game/[code]/page.tsx`、`apps/web/components/game/*`、`apps/web/fixtures/snapshot.ts`; 参照 `design/mockups/game.html`

**这是本计划的核心：把设计稿的五个状态变成受 `ClientSnapshot` 驱动的真实组件。**

- [ ] **Step 1: 写 fixture** — `apps/web/fixtures/snapshot.ts` 导出 5 个 **`ClientSnapshot` 类型标注**的常量（A 我的回合 / B 惩罚叠链 / C 反应窗口 / D 选颜色 / E 开局抽技能），数据照搬设计稿的 mock（凛 7 张、阿柴 2 张已喊 UNO、小满 4 张、老白 11 张神化 2）。**类型标注是重点**——它是引擎契约的编译期验证，fixture 编译不过就说明契约有洞，把洞报告出来
- [ ] **Step 2: 组件** — 牌面、玩家席、阶段条、技能卡（L0/L1/L2）、四句总则折叠面板、惩罚叠链横幅、倒计时条。全部只读 `snapshot`，**任何组件内不得判断出牌是否合法**——可打高亮一律来自 `snapshot.legalActions`
- [ ] **Step 3: 状态 D 选颜色** — 按契约，定色是**提交前的客户端模态**（`playCards.chosenColor`），不是服务端窗口。别为它发请求
- [ ] **Step 4: 验证** — 用一个临时的 `?fixture=a..e` query 参数切换五态目检（375px + 1280px）；**这个参数在 Task 5 结束前删掉**
- [ ] **Step 5: Commit** `feat(web): game HUD components driven by ClientSnapshot fixtures`

### Task 5: 实时链路接线

**Files:** Create `apps/web/lib/game-channel.ts`; Modify game page

- [ ] **Step 1: 铃铛订阅** — 订阅 `room:${roomId}` 的 `bell` 事件（Broadcast from DB，payload `{roomId, version, seq}`）→ 收到即调 `get-snapshot`。**只在 `payload.version > 本地 version` 时才拉**，避免自己动作的回声引发重复请求
- [ ] **Step 2: 兜底**（spec §3.2，Broadcast 不保证送达）— 30s 低频轮询本房 `version`；`visibilitychange` 回前台必拉；重连必拉。发现本地落后即拉快照
- [ ] **Step 3: 发动作** — 统一的 `sendAction(action)`：带 `expectedVersion` 与 `idempotencyKey`（`crypto.randomUUID()`，**重试时复用同一个 key**，这正是幂等约束的用途）；`409` → 拉快照后提示用户重试，不要自动重放（状态已变，原动作可能已非法）；`400` → 显示 `reason` 对应的人话
- [ ] **Step 4: 反应窗口倒计时** — 窗口出现时本地起倒计时，到点自动发 `claimTimeout`（spec §7）
- [ ] **Step 5: 删掉 Task 4 的 `?fixture=` 开关**，页面改为真实快照驱动（此时开局仍会失败，因为引擎未实现——**如实记录**）
- [ ] **Step 6: Commit** `feat(web): realtime bell, snapshot refetch, action dispatch`

### Task 6: 玩家百科

**Files:** Create `apps/web/app/encyclopedia/page.tsx`；内容源 `design/mockups/encyclopedia.html`

- [ ] **Step 1:** 静态页，`<details>` 原生展开，零客户端 JS（Server Component 即可）
- [ ] **Step 2: 验证** `pnpm --filter web build` 后该路由是静态预渲染
- [ ] **Step 3: Commit** `feat(web): player encyclopedia page`

---

## Verification（整计划完成后）

1. `pnpm --filter web build` 绿；`pnpm --filter web typecheck` 干净
2. 真人流程实测（两个浏览器 profile）：登录 → 建房 → 加入 → 准备 → 看到彼此在线
3. 对局 HUD 五态目检通过（375px 无横向滚动）
4. **隐私自检**：DevTools Network 面板里 `get-snapshot` 的响应体中搜不到他人手牌
5. 未 push；最终报告列出所有「因为引擎未实现而无法端到端验证」的环节，逐条说明，不要含糊带过

## Out of scope

技能行为与抽 3 选 1 的真实流程（状态 E 本轮只有静态 UI）、神化轮次、诸神包、断线重连的座位回收、观战。
