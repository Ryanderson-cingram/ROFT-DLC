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
tallyGame(events, final, finishedAt)  ── 纯函数，@roft/engine 之外的新包 @roft/stats
  │      输入：这一局的全部事件 + 终局 state + 终局时刻
  │      输出：每个座位的 { delta, flags }
  ▼
mergePrior(prior, delta, won) → next     ← 合并只此一份（TypeScript）
evaluate(next, flags, owned)  → 本局该有而还没有的成就 id
  ▼
apply_room_action(..., p_stats)   ← 同一个事务
  ├─ player_stats     整份覆盖写（合并已在 TS 里做完）
  ├─ player_achievements  插入解锁（on conflict do nothing = 幂等）
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

### 3.1 `player_stats` —— 一人一行、一个 jsonb

```sql
create table public.player_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
```

> **2026-08-10 实现时推翻了初稿。** 初稿写的是 40 个具名列 + SQL 里逐列 `+=` 的 upsert。
> 动手时才看清代价：合并逻辑（连胜要看这一局赢没赢、`punishMax` 取极值、四张分布表逐键相加）
> 在 `packages/stats` 里已经有一份带 47 个用例的实现（`mergePrior`），
> 在 SQL 里再写一遍就是**双源**——这个仓库为 skill_defs 专门配了 CI 漂移检查来防的正是这件事。
>
> 所以改成：**合并只留 TypeScript 一份，SQL 只负责原子落库**。
> 形状的唯一来源是 `SeatDelta`（一局的增量）与 `PlayerStats`（累计量），
> 表里不写 check 约束去复述它（复述就是第三份真相）。

代价写在明处：`stats` 是**整体覆盖写**，同一个人的两局**同时**结算会丢掉其中一局
（后写的那份基于旧值算）。一个人同时打两局本来就要主动开两个房间，损失是一局的计数——
不值得为它引入一套 CAS 重试。真出现了再上。

榜单靠**表达式索引**走，不需要具名列：

```sql
create index player_stats_wins_idx on public.player_stats (((stats->>'wins')::int) desc);
create index player_stats_caught_idx on public.player_stats (((stats->>'unoCaught')::int) desc);
create index player_stats_streak_idx on public.player_stats (((stats->>'streakBest')::int) desc);
```

`stats` 里装什么见 `packages/stats/src/types.ts`：约 30 个标量计数
（战绩 / 牌与惩罚 / UNO / 技能与盘外 / 纪录），外加四张分布表
`bySkill`（≤ 60 键）、`byCard`、`vsPlayer`、`withAlly`——后两张随交手对象增长，见 §7 风险①。

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

新包，纯函数，零依赖（除了 `@roft/engine` 的类型）。**引擎只加了一条 `gameEnded` 事件**，
其余一行不改——成就是引擎输出的下游消费者。

```ts
tallyGame(events, final, finishedAt): Map<seat, { delta: SeatDelta; flags: GameFlags }>
mergePrior(prior: Partial<PlayerStats>, delta: SeatDelta, won: boolean): PlayerStats
evaluate(stats: PlayerStats, flags: GameFlags, owned: Set<string>): string[]
```

⚠️ **`PlayerStats` 必须装下 `SeatDelta` 的每一列。** 初版把它写成「判定用得上的那个子集」，
于是 `mergePrior` 把出牌数 / 摸牌数 / 骰子分布 / 宿敌一路丢掉——52 个单测全绿，
端到端跑第一次才看见 profile 页会拿到一屏 undefined。
现在有一条结构性用例守着（`mergePrior · 一列都不能少`）：加了列忘了并，它会红。

**24 条成就分三类**（不是初稿说的 19 + 5）：

- **计数型 11 条** —— 定义里写 `stat` + `goal`，一个循环全覆盖。
- **形态型 10 条** —— 条件是「这一局之内的样子」，`tallyGame` 顺手在 `GameFlags` 里立旗。
- **派生型 3 条** —— 要同时读多个累计量（万神殿读 `bySkill` 四神的 `w`、博物志数 `bySkill` 的键数、
  无漏要 `unoCalled ≥ 100 且 unoGotCaught === 0`）。

### `evaluate` 只比「此刻够不够格」，不比「这一局跨没跨过阈值」

初稿写的是后者（`prior < goal && next >= goal`），理由是「否则每局都会重发一遍」。
实现时发现那个理由不成立——去重的口径本来就是 `owned`（= `player_achievements` 的主键），
「跨过」这层判断是多余的，而且**有害**：

- **它让漏判变成永久错过。** 判定与写库不在一个原子步里（读 prior → 算 → 写），
  中间漏一次（并发、报错、回滚），下一局 `prior` 已经够了、跨不动了，这条成就就永远拿不到。
  只比「够不够格」则下一局自己补上。
- **它让改阈值必须配回填脚本。** 只比「够不够格」的话，调低门槛后够格的人下一局自动拿到。

代价是每局把 24 条过一遍——24 次比大小，不值得为它引入状态。

### 形态型 10 条的判据

| id | 名 | 判据 |
|---|---|---|
| `color-sweep` | 满堂彩 | 单局内四色各打出 ≥ 8 张 |
| `deflect` | 反手 | 指向我的链总量 ≥ 12，且窗口重开时受害者换了人 |
| `bare-blade` | 空手接白刃 | 赢了，且全局既没有我的 `unoCalled`、也没有针对我的 `unoCaught` |
| `swift` | 速通 | 赢了，且全场 `turnEnded` ≤ 12 |
| `faceless` | 无相胜 | 赢了，且全局没有我的 `skillRevealed` |
| `lone-wolf` | 独狼 | 赢了，有我的 `allianceRefused`，且没有含我的 `allianceFormed` |
| `night-watch` | 守夜人 | 终局时刻的钟点 < 4（**服务端时区**，见 §7 风险⑥） |
| `defiant` | 逆流 | 赢了，且有过针对我的 `sealed` |
| `spotless` | 零封之局 | 赢了，且没有我的 `cardsDrawn`（count > 0）、也没有我的 `punishAccepted` |
| `abyss` | 归墟 | 赢了，且 `board.reshuffles ≥ 2` |

### 读不到的东西不猜

初稿列了 `peak_hand`（手牌峰值）与「手牌剩 1 张熬过一整轮」的判据。
**都砍了**：要算准得重放每一次换手 / 交牌 / 结盟互换 / 洗牌重分，公开事件流给不出。
给一个八九不离十的数不如没有这一列。

同理 `bySkill` 只能从**终局 state** 读，不能从 `skillChosen` 事件读——
那条事件的 payload 里没有 `skillId`（抽到什么是暗信息）。

**测试**：47 个用例。最要紧的一半是拿**引擎真发出来的事件**对 payload 键名——
写错一个键不会报错，只会让某个计数永远是 0。

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

**⑤ 成就定义改了怎么办。** 已解决——`evaluate` 只比「此刻够不够格」（§4），
阈值调低后够格的人**下一局自动拿到**，不需要回填脚本。改描述/名字更不受影响（定义在表里）。

**⑥ 守夜人的时区。已解决：全局统一走悉尼时间（2026-08-11 拍板）。**

初稿判「用服务端时区」。跑端到端才看见它有多离谱：边缘运行时的容器跑在 **UTC**，
于是「00:00–04:00 的深夜」实际是悉尼的**上午 10 点到下午 2 点**——名不副实到了荒谬的地步。

中途试过让客户端报 `getTimezoneOffset()`，随即被推翻：那引入一个不可信输入，
而且**同一局会出现有人拿到有人没拿到**（一桌人本来就坐在同一个夜里）。

定稿：`GAME_TIMEZONE = "Australia/Sydney"`，所有人按同一个钟点判，客户端一个字都不用报。
必须是 IANA 时区名而不是写死的 +10——悉尼有夏令时（AEST/AEDT），写死每年小半年是错的。
`hourIn()` 走 `Intl`，配了 5 条用例专钉夏令时两侧。成就描述里写明「悉尼时间」，
否则别的时区的人永远搞不懂为什么没解锁。

同时把 `tallyGame` 的入参从 `Date` 换成 `localHour: number`——
读 `new Date().getHours()` 是藏在纯函数里的**环境依赖**，正是它让这个 bug 躲过了 52 个单测。

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
