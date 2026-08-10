# Profile 统计与成就系统

2026-08-10 · 设计稿：`design/mockups/profile.html`

面向的问题：玩家没有任何跨局的记录。这一版给出「一局打完 → 数据沉淀 → 成就解锁 → 局内弹窗 → profile 页 → 榜单」这条完整链路的设计，
**不含天梯分与段位**（2026-08-10 拍板：先不做排位分数，榜单一律按原始统计排序）。

---

## 0. 三条不能绕开的既有约束

写这份 spec 之前先把地基摸清楚，下面每一条都直接决定了架构：

**① `room_events` 会被删。** `purge_stale_rooms`（0005）挂在 pg_cron 上每小时跑一次，
把 `finished_at` 超过 24 小时的房间连同它的 `room_events` 整个删掉。
→ **统计不能「以后再从事件流算」**。要么在终局那一刻算完，要么就永远算不出来了。

**② 所有写入都过 `apply_room_action` 这一个 RPC。** CAS + state + status + events 在同一个事务里。
→ 成就的解锁写入必须**搭这趟车**，否则就会出现「事件写进去了、成就没写成」的裂缝。

**③ 客户端已经在增量拉 `room_events`。** `lib/room-log.ts` 以 `snapshot.version` 为触发条件，
拉 `seq >` 上次的那一截，喂给 `<Ticker>` 与 `<LogDrawer>`。
→ **局内弹窗不需要任何新的实时通道**。成就解锁只要是 `room_events` 里的一条事件，它自己就会流到客户端。

这三条合起来指向同一个答案：**成就在终局那一刻、在服务端、在同一个事务里判定，判定结果作为一条普通事件写进 `room_events`。**

---

## 1. 行业惯例与我们的取舍

| 惯例 | 出处 | 我们怎么用 |
|---|---|---|
| 成就绑在**统计量**上，不绑在事件上；到阈值自动解锁，进度天然可显示 | Steamworks 的 stat / achievement 双层模型 | 全盘照抄。见 §3 的 `player_stats` + `achievement_defs` |
| 公开**全服解锁比例**，既是给玩家的稀有度，也是给设计者的难度体检 | Steam 全局解锁率 | 抄。`achievement_defs.unlock_rate` 由日更作业算 |
| 事件流 → 投影（projection）→ 读模型；投影要**幂等**，靠记录「已处理到哪条」去重 | CQRS/ES 的标准做法 | 抄，但**同步投影**（见 §2 为什么不异步） |
| 成就系统与游戏逻辑**解耦**，靠事件通信 | 事件驱动的通用建议 | 抄。引擎一行都不改，成就是引擎输出的**下游消费者** |
| Toast 停留 ≈ 每词 500ms、最短 4 秒；置于角落、不挡主内容 | Toast UX 通行准则 | 抄。见 §5，弹窗贴在坞的上沿、避开手牌 |

**我们不抄的两条**：

- **不做异步消费者 / 消息队列。** 约束①（24 小时后事件就没了）意味着异步只是把「必须算完」的时刻往后挪，
  换来一整套补偿逻辑，收益为零。同步算完，事务一致，没有回补作业。
- **不做通用规则引擎（DSL / 表驱动的任意条件）。** 24 条成就，其中 19 条是「某个计数 ≥ 阈值」。
  规则引擎是给「运营要在不发版的情况下加成就」准备的，我们没有这个需求。
  剩下 5 条特殊的写成具名函数即可。（ponytail：真需要热加载再上，那一天会自己到来。）

---

## 2. 数据流

```
一局对局
  │
  │  engine.applyAction() 逐动作产出 EngineEvent[]
  ▼
room_events（append-only，24 小时后被 purge 回收）
  │
  │  ← 终局那一帧（result.state.phase === "finished"）：
  │     room-action 边缘函数在调 apply_room_action **之前**多跑一步
  ▼
tallyGame(events, finalState)  ── 纯函数，@roft/engine 之外的新包 @roft/stats
  │      输入：这一局的全部事件 + 终局 state
  │      输出：每个座位的一份 delta（≈ 40 个计数）+ 触发的成就 id
  ▼
apply_room_action(..., p_stats_delta, p_unlocked)   ← 同一个事务
  ├─ player_stats     累加 delta（upsert，列级 +=）
  ├─ player_achievements  插入新解锁（on conflict do nothing = 幂等）
  └─ room_events      追加 achievementUnlocked 事件（每人一条）
                          │
                          │  既有的 bell 触发器照常发实时铃铛
                          ▼
                    客户端 room-log.ts 增量拉到它
                          ├─ <Ticker> / <LogDrawer>：当作普通一条日志
                          └─ <AchievementToast>：只挑 achievementUnlocked 且 seat === 我
```

**为什么 tally 放在边缘函数而不是 plpgsql**：判定要读引擎的类型（`Card`、`PunishChain`、`SnapshotPlayer`），
用 TypeScript 写是几十行、用 plpgsql 写是几百行 jsonb 挖掘且没有类型。
边缘函数已经 `import` 了引擎，加一个 `@roft/stats` 是零成本。

**为什么终局才算，不是每个动作都算**：每个动作都算 = 每次出牌都要多写一次 `player_stats`，
写放大 20 倍换来的只是「实时看到计数在涨」——而计数只在 profile 页看得到，profile 页在局外。

---

## 3. 表

### 3.1 `player_stats` —— 一人一行的宽表

```sql
create table public.player_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,

  -- 战绩
  games int not null default 0,
  wins int not null default 0,
  draws int not null default 0,
  games_first int not null default 0,      -- 先手局数（先手胜率的分母）
  wins_first int not null default 0,
  turns_total int not null default 0,      -- ÷ games = 场均回合
  streak_cur int not null default 0,
  streak_best int not null default 0,

  -- 牌与惩罚
  cards_played int not null default 0,
  cards_drawn int not null default 0,
  punish_taken int not null default 0,     -- 因惩罚链摸掉的张数
  punish_max int not null default 0,       -- 单条链承受的最大总量
  punish_deflected_max int not null default 0,
  punish_broken int not null default 0,

  -- UNO
  uno_called int not null default 0,
  uno_caught int not null default 0,       -- 我抓到别人
  uno_got_caught int not null default 0,   -- 我被抓
  uno_miscalled int not null default 0,

  -- 技能与盘外
  skills_activated int not null default 0,
  wins_after_activate int not null default 0,
  dice_rolled int not null default 0,
  dice_hist smallint[] not null default '{0,0,0}',   -- ×0 / ×1 / ×2
  alliances_formed int not null default 0,
  alliances_refused int not null default 0,
  raids_started int not null default 0,
  marks_gained int not null default 0,
  sealed_count int not null default 0,

  -- 纪录（取极值，不累加）
  fastest_win_turns int,
  longest_game_turns int,
  most_cards_one_turn int not null default 0,
  peak_hand int not null default 0,

  -- 分布（jsonb，键少值多的那几项）
  by_skill jsonb not null default '{}',    -- {"club-3": {"n": 34, "w": 24}, ...} → 本命神职 + 博物志
  by_card jsonb not null default '{}',     -- {"R+2": 96, ...} → 最常打出的一张
  vs_player jsonb not null default '{}',   -- {"<uuid>": {"n": 26, "w": 7}} → 宿敌
  with_ally jsonb not null default '{}',   -- 结盟过的人的胜率 → 最佳盟友

  updated_at timestamptz not null default now()
);
```

**为什么是宽表不是 `(user_id, stat_key, value)` 竖表**：40 个计数、全部在同一次终局里一起更新、
profile 页一次性全要。竖表要 40 行 upsert + 一次 pivot 才能渲染一屏。
榜单要在某一列上建索引，竖表就得建部分索引或物化视图。宽表一行搞定。

**为什么 4 个分布放 jsonb**：它们的键是开放集合（60 个技能、108 张牌面、所有玩家），
拆成表就是 4 张 `(user_id, key, n, w)`，为了 profile 页一屏的四个模块多养 4 张表不值当。
`by_skill` 最多 60 键、`by_card` 最多 ~15 键（只记数字牌 + 功能牌的色/面组合）、
`vs_player` 与 `with_ally` 随交手对象增长——**这两个要设上限**，见 §7 风险。

### 3.2 `achievement_defs` —— 成就定义（种子数据）

```sql
create table public.achievement_defs (
  id text primary key,                     -- 'catch-hunter'
  tier text not null check (tier in ('凡','玄','天','神')),
  name text not null,                      -- '抓漏喊猎人'
  mark text not null,                      -- '捕'（封泥上那个字）
  descr text not null,
  -- 计数型成就：到这一列的这个值就解锁。特判型两列都是 null。
  stat_key text,                           -- 'uno_caught'
  stat_goal int,
  sort int not null default 0,
  unlock_rate real,                        -- 全服解锁比例，日更作业写
  created_at timestamptz not null default now()
);
```

放表里而不是硬编码在代码里，只为了两件事：**profile 页要渲染未解锁成就的名字与描述**（否则客户端得内嵌一份定义），
以及 `unlock_rate` 要能被作业写回。判定逻辑仍在代码里——表只存**描述**，不存**规则**。

同 `skill_defs` 的做法：定义的唯一来源是 `packages/stats/src/achievements.ts`，
迁移的 seed 由 `pnpm --filter @roft/stats gen:achievements` 生成，CI 用 `git diff --exit-code` 卡双源漂移。

### 3.3 `player_achievements` —— 谁在什么时候解锁了什么

```sql
create table public.player_achievements (
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_id text not null references public.achievement_defs(id),
  unlocked_at timestamptz not null default now(),
  room_id uuid,                            -- 在哪一局解的；房间被回收后置 null（on delete set null）
  primary key (user_id, achievement_id)     -- ← 主键即幂等：重复解锁 on conflict do nothing
);
```

主键就是去重键。约束②说过写入搭 `apply_room_action` 的车，
所以「同一个动作被重放」时 RPC 的幂等分支会先返回，根本走不到这里；
即使走到了，`on conflict do nothing` 也让它成为无害的空操作。

### RLS

- `player_stats`、`player_achievements`：`select` 对 `authenticated` 全开（profile 页要能看别人的、榜单要能列所有人）。
  **没有任何 `insert`/`update` policy** —— 只有 service_role 写，同 `room_state_private` 的路子。
- `achievement_defs`：`select` 全开，同 `skill_defs`。

---

## 4. 判定：`@roft/stats`

新包，纯函数，零依赖（除了 `@roft/engine` 的类型）。**引擎一行不改。**

```ts
// packages/stats/src/index.ts
export interface SeatDelta { /* player_stats 每一列的增量 */ }

export function tallyGame(
  events: EngineEvent[],          // 这一局从 gameStarted 到终局的全部事件
  final: GameState,
  seats: { seat: number; userId: string }[],
): Map<number, SeatDelta>;

export function evaluate(
  before: PlayerStats,            // 这一局之前的累计
  delta: SeatDelta,
  gameFlags: GameFlags,           // 这一局的特判标记（见下）
  owned: Set<string>,             // 已经有的成就 id
): string[];                      // 本局新解锁的 id
```

**24 条成就分两类：**

**计数型（19 条）** —— 定义里写 `stat_key` + `stat_goal`，`evaluate` 一个循环全覆盖：

```ts
for (const d of DEFS) {
  if (!d.statKey || owned.has(d.id)) continue;
  if (before[d.statKey] < d.goal && before[d.statKey] + delta[d.statKey] >= d.goal)
    unlocked.push(d.id);
}
```

**特判型（5 条）** —— 条件是「这一局之内的形态」，不是累计量。`tallyGame` 顺手在 `GameFlags` 里立旗，
`evaluate` 里各写一行。逐条列出，每条标明**靠哪个事件判**：

| id | 名 | 判定 | 事件源 |
|---|---|---|---|
| `deflect` | 反手 | 某条 `punishStack` 的 `total ≥ 12` 且下一条事件把它转给了别人 | `punishStack` + `punishAccepted` 的 seat 变化 |
| `bare-blade` | 空手接白刃 | 我 `handCount === 1` 跨过一整轮，且期间没有针对我的 `unoCaught` | 快照序列 + `unoCaught` |
| `faceless` | 无相胜 | 我赢了，且全局没有我的 `skillRevealed` | `skillRevealed` 缺席 + `final.board.winner` |
| `lone-wolf` | 独狼 | 我赢了，且所有针对我的结盟邀请都是 `allianceRefused` | `allianceWindowOpened` + `allianceRefused` |
| `spotless` | 零封之局 | 我赢了，且全局没有我的 `cardsDrawn`、没吃过惩罚 | `cardsDrawn` 缺席 |

其余三条「神」品（万神殿、博物志、天命）是**跨局的派生量**，不需要特判也不需要新列——
直接读 `by_skill`：四神四个 key 的 `w > 0` 即万神殿；`by_skill` 的键数达 60 即博物志。

**测试**：`packages/stats/test/` 里给每条成就一个用例——喂一串真事件，断言解不解锁。
特判那 5 条各再补一条**反例**（差一点点不该解锁）。计数那 19 条共用一个表驱动的用例即可。

---

## 5. 局内弹窗

**放哪儿**：坞的**上沿左侧**，复用 `.handtoast` 那一档的位置与形制（`tokens.css` 已经有了）——
它是「手牌进了一批」的飘字，同样是不打断操作的一句话，同样贴着坞、同样 3 秒自走。
右上角是 UNO 定点，绝不能碰。牌桌中央与手牌区一概不许挡（spec §1 第 4 条：底坞永远亮着）。

**长什么样**：一枚封泥缩到 28px + 一行「解锁 · 反手」+ 品级点。品级色沿用 profile 页那四档。
神品那枚多一道流光——与 profile 页同一条视觉规则，玩家在两处认得出是同一个东西。

**停多久**：4 秒（≈ 8 个字 × 500ms 的下限）。多条同时解锁时**排队**、不叠放，
每条 4 秒，最多显示 3 条，再多的收成一句「+N 枚封泥」。理由：一局最多可能解 5–6 条，
六个盒子一起飘会盖住半个坞。

**怎么拿到**：`room-log.ts` 已经在拉 `room_events`。新增事件类型：

```ts
{ type: "achievementUnlocked", public: { seat, ids: ["deflect", "spotless"] } }
```

`humanize()` 里加一条分支（`kind: "system"`），记录抽屉与跑马灯自动就有了；
`<AchievementToast>` 另挂一个订阅，只挑 `seat === 我的座位` 的那些。

**公开还是私密**：`public_payload` 里带 seat 和 id，**全场可见**。
理由：卡牌品类里「对手刚解锁了一枚 0.3% 的成就」是极强的桌面戏剧性，而成就不含任何暗牌信息。
跑马灯上别人的解锁写成「照野 解锁了封泥 · 逆流」，自己的才弹窗。

**降级**：`prefers-reduced-motion` 下弹窗不做位移，直接显示 / 消失（同 `.handtoast` 的现有处理）。

---

## 6. profile 页与榜单

**profile 页**：一次 `select` 拿 `player_stats` 一行 + `player_achievements` 全部 + `achievement_defs` 全部。
三个查询、无 join、无聚合。设计稿 `design/mockups/profile.html` 里的每一格都能从这三份数据直接算出来。

**近 20 场**：`player_stats` 里没有，也不该有（宽表不装序列）。
另开一张窄表 `player_recent(user_id, finished_at, won, skill_id, turns)`，
终局时插一行，同一个作业里删掉每人第 20 行之后的。它是唯一一处需要「留一段历史」的地方。

**榜单**：不引入合成分数，每条榜的排序键就是 `player_stats` 的**某一列**：

| 榜 | 排序键 | 门槛 |
|---|---|---|
| 胜率 | `wins::real / games` | `games >= 50`（否则 1 胜 0 负就是榜一） |
| 抓漏喊 | `uno_caught` | 无 |
| 最长连胜 | `streak_best` | 无 |

实现：每条榜一个部分索引 + `limit 100` 的普通查询。**不上物化视图**——
几千行的表直接查就够快，物化视图要养刷新作业。真到十万行再说。

「我排第几」用 `count(*) where <排序键> > 我的值` 现算，同样不需要预计算。

---

## 7. 已知风险与对策

**① `vs_player` / `with_ally` 会无限长。** 每遇到一个新对手就多一个键。
对策：写入时只保留交手次数最多的 20 个键（`tallyGame` 的输出里做截断），
profile 页只需要「宿敌」和「最佳盟友」各一个。**这是有意的有损压缩，要在代码里写明**。

**② 终局那一帧的事务变重。** 多了一次 `player_stats` upsert（每座位一行）+ 一次 `player_achievements` 插入 + 一条事件。
4 人局 = 多 9 次写。可接受，但要把 `tallyGame` 的输入限制在**这一局**的事件——
`room_events` 是按房间存的，一个房间重开多局会累积，得按最后一次 `gameStarted` 的 seq 切一刀。

**③ 引擎缺终局事件。** `board.winner` 只进 state，`room_events` 里只有平局的 `gameDrawn`，没有对应的胜局事件。
现在 `tallyGame` 能从 `final.board.winner` 读到，所以不阻塞；
但**记录抽屉里「谁赢了」这句话现在是缺的**，且将来任何纯事件流的消费者都读不到胜负。
建议同期补一条 `gameEnded { winner?: number, turns: number }`，是引擎的一行改动。

**④ 存量玩家没有历史数据。** `player_stats` 从这一版之后的对局开始记，之前的局已经被 purge 掉了，无法回填。
profile 页对 `games === 0` 的人要有一个像样的空状态，不能是一屏的 0。

**⑤ 成就定义改了怎么办。** 阈值调低 → 已经够格但没解锁的人不会被追认（判定只在终局跑）。
对策：改阈值时配一个一次性回填脚本，扫 `player_stats` 补发。改描述/名字不受影响（定义在表里）。

---

## 8. 落地顺序

每一步都能独立合并、独立回滚：

1. **引擎补 `gameEnded` 事件**（风险③）。一行改动 + 一个用例。
2. **`@roft/stats` 包 + `tallyGame` + `evaluate` + 24 条定义 + 测试。** 纯函数，不碰任何 IO，可以完全离线做完。
3. **迁移 0006**：三张表 + RLS + `achievement_defs` seed + `apply_room_action` 加两个参数。
4. **room-action 边缘函数**：终局分支里调 `tallyGame`，把结果塞进 RPC。
5. **profile 页**（`apps/web/app/profile/[id]/`）：把设计稿接到真数据上。
6. **局内弹窗**：`humanize` 加分支 + `<AchievementToast>`。
7. **榜单页**：三条榜 + 「我排第几」。

1–2 步做完就已经能在单测里验证全部 24 条成就的判定是对的，那是这个系统里唯一真正复杂的部分。

---

Sources：
[Steamworks Stats and Achievements](https://partner.steamgames.com/doc/features/achievements) ·
[Steam 全局解锁率解读](https://gamerspilot.com/blog/steam-achievement-statistics-global-unlock-rates) ·
[Projections and Read Models in Event-Driven Architecture](https://event-driven.io/en/projections_and_read_models_in_event_driven_architecture/) ·
[Event Sourcing: Projections（投影幂等）](https://domaincentric.net/blog/event-sourcing-projections) ·
[Event Sourcing with PostgreSQL](https://medium.com/@tobyhede/event-sourcing-with-postgresql-28c5e8f211a2) ·
[游戏内经济的幂等与重放策略](https://www.springfuse.com/event-sourcing-game-inventory/) ·
[Toast notifications UX best practices](https://blog.logrocket.com/ux-design/toast-notifications/) ·
[Best Practices For Designing Toasts](https://www.uinkits.com/blog-post/best-practices-for-designing-toasts) ·
[Supabase Realtime — Broadcast from the Database](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes) ·
[Achievements Engine Architecture（GameDev.net）](https://gamedev.net/forums/topic/685344-achievements-engine-architecture/5327435/)
