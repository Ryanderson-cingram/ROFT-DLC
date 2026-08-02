# 再来一局（原房间重开）与 Supabase 数据保留

> 2026-08-02。范围：终局弹窗多一个「回到本房间再开一局」的出口，以及一局打完之后
> 数据库里那些再也没人看的行怎么清掉。规则不变——本文一条裁定都不改。

---

## 1. 现状

四张表全部 `on delete cascade` 挂在 `rooms` 上（`0001_init.sql`）：

| 表 | 一局的量级 | 现在会不会清 |
|---|---|---|
| `rooms` | 1 行 | ❌ 永远留着 |
| `room_seats` | ≤4 行 | ❌ |
| `room_state_private` | 1 行（整局状态的 JSON，**最大的那个**） | ❌ 覆盖写，不增行 |
| `room_events` | 一局几百行，含 `public_payload` / `private_payload` | ❌ 只增不减 |

`rooms.status` 走 `lobby → playing → finished`，**没有回头路**：
一局打完，房间永远停在 `finished`，`/room/[code]` 那一段
`if (r.status === "playing") router.replace(...)` 也就再没机会把人弹回牌桌。
所以「再来一局」目前只能回大厅新建房间 —— 每局至少留下 1 个死房间 + 几百行事件。

---

## 2. 目标

1. **原房间重开**：终局弹窗给两个出口——「回大厅」与「**再开一局**（房间号不变）」。
   点后房间回到 `lobby`，座位与人保留、`ready` 清空，上一局的事件与状态**清掉**。
2. **自动回收**：没人再回来的房间不许无限堆积。
3. 两件事共用同一条「怎么算一局结束/一个房间死了」的判定，不写两套。

---

## 3. 方案

### 3.1 `restartGame` —— 走既有的 `room-action` RPC，不新开接口

重开是一个**房间层**动作，和 `startGame` 同源，所以放进现有的 `room-action`
（`0003_room_action_rpc.sql` + Edge），沿用同一套 `expectedVersion` 乐观锁与
`idempotencyKey`，不新造端点、不新造鉴权面。

```
action: { type: "restartGame", seat }
```

**前置条件**（服务端判，客户端只按 legalActions/状态显示按钮）：

- `rooms.status = 'finished'`
- 发起者**在座**即可（`room_seats` 里有他）—— 2026-08-02 拍板：不限房主。
  四个人同时点不会出事：乐观锁 + 幂等键让第一条生效、其余拿 `stale_version` 被拒
- 乐观锁 `expectedVersion = rooms.version`

**事务里做四件事**（一条 SQL 事务，要么全成要么全不成）：

1. `delete from room_events where room_id = $1`
2. `delete from room_state_private where room_id = $1`
3. `update room_seats set ready = false where room_id = $1`
4. `update rooms set status = 'lobby', version = version + 1 where id = $1`

`config`（规则包 / 抽技能方式）**保留**——同一桌人多半想按同样的规则再来。
要改规则回等候室改即可。

**客户端**：`GameOver` 弹窗多一个主按钮「再开一局（本房间）」→ 成功后
`router.push('/room/{code}')`。原来那个「回大厅」降为次要出口。
其余三人靠 `room_seats` / `rooms` 的 realtime 订阅收到 `status → lobby`，
`/game/[code]` 那一页加一条：`status === 'lobby'` → `router.replace('/room/{code}')`
（现在只有反方向的那一条）。

> ⚠️ 删 `room_events` 会把行动记录抽屉清空——这正是「清理历史冗余信息」要的效果，
> 代价是**上一局的记录不可回看**。2026-08-02 拍板：**不留**，直接删，不做归档表。
> 日后真要战报/复盘再补 `room_archives`，那时是加一张表，不用回头改这里的删除逻辑。

### 3.2 自动回收 —— `pg_cron` + 一个保留策略函数

新增迁移 `0005_retention.sql`：

```sql
-- 一个房间"活着"的证据：座位上有人、或者最近有过事件
create or replace function public.purge_stale_rooms() returns int ...
```

删除条件（**全部满足**才删）：

| 条件 | 阈值 | 理由 |
|---|---|---|
| `rooms.status = 'lobby'` 且 `room_seats` 为空 | 建成 > 1 小时 | 建了没人进的空房 |
| `rooms.status = 'finished'` | 结束 > 24 小时（2026-08-02 拍板） | 打完没人再开的房 |
| 任意 status，最近一条 `room_events.created_at` | > 7 天 | 打到一半没人管的房 |

删 `rooms` 一行，其余三张表跟着 cascade 走，不用逐表写 delete。

`rooms` 需要补一列 `finished_at timestamptz`（`status → finished` 时写），
否则「结束超过 24 小时」无从判断——`created_at` 是建房时间，不是结束时间。

调度：`pg_cron` 每小时跑一次 `select public.purge_stale_rooms();`。

### 3.3 事件表瘦身（可选，量大了再做）

`room_events` 是唯一会线性增长的表。上面两条能覆盖绝大多数情况；
如果单局事件量本身成了问题，再考虑：

- `private_payload` 在**本局结束时**就地清空（它只在结算期间有用，
  局终之后没有任何读者），保留 `public_payload` 供记录抽屉用
- 给 `room_events` 建 `created_at` 的 BRIN 索引 + 按月分区

这两条现在都属于 YAGNI —— 先测出真实增长曲线再说。

---

## 4. 测试方案

### 4.1 引擎（vitest，`packages/engine`）

`restartGame` **不进引擎** —— 它是房间层动作，引擎只管一局之内的规则。
引擎侧无改动，无新测试。

### 4.2 数据库（`supabase/tests/`，pgTAP 或 SQL 断言脚本）

| # | 测试点 | 断言 |
|---|---|---|
| D1 | 重开清干净 | 跑一局→`restartGame`→`room_events` / `room_state_private` 该房间 0 行 |
| D2 | 重开保留座位 | `room_seats` 行数不变、`user_id` 不变、`ready` 全 false |
| D3 | 重开保留房间号与 config | `code` / `config` 逐字不变，`status='lobby'`，`version` +1 |
| D4 | 不在座的人不能重开 | 用一个没坐进这一桌的 `user_id` 调用 → 拒，`version` 不动 |
| D4b | 两人同时点 | 同一 `expectedVersion` 并发两条 → 一条成、一条 `stale_version`，`version` 只 +1 |
| D5 | 未终局不能重开 | `status='playing'` 时调用 → 拒 |
| D6 | 乐观锁 | 用过期的 `expectedVersion` → 拒 |
| D7 | 幂等 | 同一个 `idempotencyKey` 连发两次 → 只生效一次，`version` 只 +1 |
| D8 | 回收·空房 | 建房无人、`created_at` 回拨 2 小时 → purge 后房间没了 |
| D9 | 回收·刚建的空房不删 | `created_at` 回拨 10 分钟 → purge 后还在 |
| D10 | 回收·终局 24 小时 | `finished_at` 回拨 25 小时 → 删；回拨 1 小时 → 不删 |
| D11 | 回收·有人在座的 lobby 房不删 | 座位非空 + 建了 2 小时 → 还在 |
| D12 | cascade | 删 `rooms` 一行后，另外三张表该房间 0 行 |
| D13 | purge 不误伤别的房间 | 两个房间只有一个够格 → 另一个逐行不变 |

> 时间靠**参数注入**而不是 `pg_sleep`：`purge_stale_rooms(now timestamptz default now())`，
> 测试传一个假的 now。跟引擎里 `ctx.now` 同一套思路。

### 4.3 前端（vitest + testing-library，`apps/web`）

| # | 测试点 | 断言 |
|---|---|---|
| W1 | 终局弹窗两个出口 | `GameOver` 有「再开一局（本房间）」与「回大厅」两个可点入口 |
| W2 | 在座的人都看得到重开 | 四个座位的视角下按钮都在（不限房主） |
| W3 | 重开 payload | 点击 → `restartGame` + 正确的 `seat` / `expectedVersion` |
| W4 | 平局也能重开 | `winner` 缺席时按钮照在 |
| W5 | 被动回等候室 | `/game/[code]` 收到 `status='lobby'` → `router.replace('/room/{code}')` |
| W6 | 重开失败有人话 | RPC 拒 → 弹窗内出错误提示，按钮不锁死 |

### 4.4 手工验收（三端同时开）

1. 三人打完一局 → 房主点「再开一局」→ 另外两人**不用刷新**就回到等候室
2. 等候室里房间号与上一局一致，三人都在座、都显示未准备
3. 记录抽屉是空的（上一局的事件已清）
4. 直接再开一局，牌局正常跑完 —— 确认没有上一局的残留状态

---

## 5. 上线顺序

1. `0005_retention.sql`：`rooms.finished_at` + `purge_stale_rooms()` + cron（**先上，独立可回滚**）
2. `room-action` 加 `restartGame` 分支 + D1–D7
3. 前端两个出口 + `/game` 的 lobby 回跳 + W1–W6
4. 观察一周 `room_events` 的行数曲线，再决定要不要做 §3.3

---

## 6. 已拍板（2026-08-02）

| 问题 | 决定 |
|---|---|
| 上一局的记录要不要留 | **不留**，重开即删，不做归档表 |
| 谁能点重开 | **任何在座玩家**，不限房主 |
| 终局房间留多久 | **24 小时** |
