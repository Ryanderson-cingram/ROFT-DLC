# 回合制多人在线卡牌游戏：服务端架构与工程最佳实践调研

日期：2026-07-28
调研方式：一手来源核查（官方文档、源码、官方博客、GDC/开发者第一方分享、学术论文），每条结论附来源 URL。

## 被评估架构（基线）

- Next.js（Vercel）客户端
- Supabase：Auth / Postgres / Realtime
- 权威规则引擎跑在 Supabase Edge Function
- Postgres 为唯一真相（single source of truth）
- Realtime Broadcast 只发 `{roomId, version, seq}` 铃铛（不含游戏状态）
- 客户端收铃铛后拉取"视角过滤快照"
- 写入采用乐观锁 `expectedVersion` + `idempotency_key`

---

## 1. 权威服务器 + 纯函数规则引擎 `(state, action) => state` + 事件/命令日志

**结论：符合行业标准。** 开源框架（boardgame.io、Colyseus）与商业卡牌游戏一线工程分享（炉石传说、Legends of Runeterra、MTG Arena）一致采用"服务器权威 + 规则引擎驱动状态 + 事件/命令记录"。纯函数在 boardgame.io 中是硬性要求；商业游戏不一定强调纯函数，但"服务器权威 + 事件日志/可重放"是共同特征。

**证据：**

- **boardgame.io**（官方文档 Immutability 篇）：明确要求 moves "be pure functions. What this means is that you cannot depend on any external state, nor can you have any side-effects"；理由正是可重放性（"moves can be replayed"，跨端重放同一 move 得到同一状态）与高效变更检测。非法操作返回 `INVALID_MOVE` 由框架丢弃，即"引擎裁决合法性"。
  https://boardgame.io/documentation/#/immutability
- **Colyseus**（官方文档）：首页自述 "an open-source Node.js framework for building **authoritative game servers**"；State Sync 页明确 "Only the server can directly mutate the state... The frontend is not capable of mutating the state directly... it sends messages to the server to request state changes"——客户端只发意图，服务器执行规则。
  https://docs.colyseus.io/ 、https://docs.colyseus.io/state
- **炉石传说**（GDC 2014, Brian Schwab, Blizzard）：Entity/Tag/Power 事件驱动状态机，主循环为"取合法选项发给玩家 → 执行所选 Power → Update State（反复处理 triggers 与 deaths）"。
  https://archive.org/stream/GDC2014Schwab_201611/GDC2014-Schwab_djvu.txt
  （辅证，逆向协议：服务器以 TAG_CHANGE/FULL_ENTITY 等 Power History 事件流推送状态变更，https://hearthsim.info/docs/gamestate-protocol/）
- **Legends of Runeterra**（Riot 官方 tech blog，CI/CD 篇）：原文 "*LoR* is game-server authoritative"，并因此可用 pytest 经 HTTP 直接对 game server 下指令做无 UI 的规则测试——服务器权威引擎带来的可测试性收益。
  https://technology.riotgames.com/news/legends-runeterra-cicd-pipeline
- **MTG Arena**（Wizards 官方博客, Alex Werner）：GRE（Game Rules Engine）"tracks the state of the game and enforces all the rules-correct card interactions"（C++ + CLIPS），GRE 产出可被规则改写的指令列表——命令列表模式。（注：该文未逐字声明 GRE 跑在服务器端。）
  https://magic.wizards.com/en/news/mtg-arena/on-whiteboards-naps-and-living-breakthrough

**对照评注**：Edge Function 权威引擎 + Postgres 命令/事件日志 + 纯函数规则引擎与上述来源方向一致。细微差异：Colyseus/炉石是"服务器推送状态增量/事件流"，本架构是"铃铛 + 拉快照"——同属服务器权威，只是同步传输策略不同，并非偏离标准（见第 2、7 节）。

---

## 2. 隐藏信息（手牌）：server-side view projection

**结论：符合。** boardgame.io（playerView）、Colyseus（StateView/@view）、炉石（服务器端 dispatcher 按玩家过滤实体）三个独立来源都在**服务器侧**做视角投影，机密信息从不到达无权客户端。"收铃铛后拉视角过滤快照"就是这个模式。

**证据：**

- **boardgame.io**（Secret State 篇）：`playerView` "accepts a function that receives an object containing `G`, `ctx`, and `playerID`, and returns a version of `G` that is stripped of any information that should be hidden from that specific player"；内置 `PlayerView.STRIP_SECRETS` 删除 `G.secret`、`G.players` 只保留本人键；涉密 moves 需标 `client: false` 强制 "run on the server"。
  https://boardgame.io/documentation/#/secret-state
- **Colyseus**（StateView 篇，v0.16）："By default, the entire state is visible to all clients. However, you may want to control which parts of the state are visible to each client."——`@view()` 装饰器 + 每客户端 `StateView`，序列化按视图编码（取代旧 `@filter()`）。
  https://docs.colyseus.io/state/view
- **炉石**（HearthSim 逆向协议文档，基于真实线上协议的二手佐证）：服务器有 "a dispatcher which knows to hold back and/or change some packets for each player"；对手手牌以无 card ID 的实体下发，抽牌经 `SHOW_ENTITY` 只对本人揭示——服务器全局状态与客户端已知状态明确不对称。
  https://hearthsim.info/docs/gamestate-protocol/

**对照评注**：本架构相对"直接 Broadcast 全量状态"的取舍是正确的——铃铛不含状态，天然避免经 Realtime 泄露他人手牌。实施要点：投影必须发生在 Edge Function/RLS 层，绝不能发全量到客户端再由前端隐藏。

---

## 3. 反应窗口 / 优先权系统建模

**结论：需补。** 行业范式是**优先权传递状态机**（MTG CR 117：逐一授予行动权，全员连续 pass 则栈顶结算/阶段结束）；boardgame.io 用 stages/activePlayers 原生支持"多个玩家在他人回合内行动"。本架构的 version/seq + 拉快照解决的是同步问题，不自动给出反应窗口语义，须在规则引擎状态里显式建模。

**证据：**

- **MTG 官方综合规则**（2026-06-19 版，第 117 节 Timing and Priority）：
  - 117.1 "The player with priority may cast spells, activate abilities, and take special actions."
  - 117.3c/d：行动者行动后保留优先权；不行动即 pass，"Then the next player in turn order receives priority"。
  - 117.4 "**If all players pass in succession... the spell or ability on top of the stack resolves or, if the stack is empty, the phase or step ends.**"——完整的 priority-passing 状态机定义。
  - 117.5：每次授予优先权前先执行 state-based actions 并压入触发异能，循环至稳定。
  https://magic.wizards.com/en/rules （下载页）；原文 https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.txt
- **boardgame.io**（Stages 篇）："Stages are useful to allow more than one player to play during a turn."——`setActivePlayers` 可把 currentPlayer/others/all 分别推入不同 stage；`minMoves`/`maxMoves` 控制自动 endStage；文档示例正是"every other player in the game to discard a card"无需另开回合。
  https://boardgame.io/documentation/#/stages

**对照评注（建议做法）**：在引擎状态中加入等价于 activePlayers + priority-pass 的字段，例如 `{ window: { type, respondersRemaining[], deadline } }`；动作集合含显式 `pass`；"全员 pass ⇒ 结算窗口"复刻 CR 117.4。乐观锁 expectedVersion 恰好解决多个响应者并发抢答的竞态（后到者版本冲突后重拉再决策）。超时自动 pass 需要服务端定时器兜底（见第 5 节）。

---

## 4. 服务端 RNG 与可重放性

**结论：符合（前提是随机结果落库）。** 一手来源一致：随机必须由服务端权威生成、seed/PRNG 状态是游戏状态的一部分、随机结果（或种子）必须记录以支持确定性重放。"Edge Function 生成随机 → 结果写入 Postgres 事件日志"与此吻合。

**证据：**

- **boardgame.io Random API**（官方文档）：禁止 moves 里直接 `Math.random()`——"Calling `Math.random()` and other functions that maintain external state would make the game logic impure and not idempotent."；框架把 `random` 对象（`D6`/`Shuffle`/`Number`）注入 moves 上下文，PRNG 状态随游戏状态保存；强调 "The RNG and its state must stay on the server"（防客户端预测），并使游戏 "can be replayed exactly"。
  https://github.com/boardgameio/boardgame.io/blob/main/docs/documentation/random.md
  （辅证：seed 应为每局实例状态，Issue #233 https://github.com/boardgameio/boardgame.io/issues/233）
- **Martin Fowler《Event Sourcing》**：External Queries 一节——"the response to every external query needs to be remembered"，重放时用历史记录的响应而非当前值以保证确定性；随机数在事件溯源语境下等同一次外部查询，结果必须入事件流。
  https://martinfowler.com/eaaDev/EventSourcing.html
- **PokerStars（第一方，服务端洗牌 + 审计）**：提交澳大利亚议会的官方文件描述洗牌完全在服务端，双独立熵源（客户端事件时序摘要 + Quantis 硬件量子 RNG，每次洗牌 249 位随机比特），RNG 由 GLI 与 Cigital 独立审计。
  https://www.aph.gov.au/DocumentStore.ashx?id=0b05a62d-6bda-4eef-9699-be9655360d9e&subId=514005

**对照评注**：两种等价实现任选其一并坚持——(a) 洗牌/抽牌的**结果**作为事件写入日志（Fowler 式，重放不重新掷骰）；(b) 每局 seed + 确定性 PRNG 状态入库（boardgame.io 式，重放重新计算）。UNO 场景推荐 (a)：结果落库更简单，且审计直接读事件即可。切忌在 Edge Function 里用不落库的 `Math.random()`。

---

## 5. 断线重连与超时 / AFK

**结论：需补（架构描述未覆盖，行业有明确惯例）。** 惯例是：回合硬上限计时 + 临期警示（炉石 rope）；超时默认动作是"自动结束回合/跳过"而非代打；断线给重连宽限期；重连后拉全量快照。本架构"拉快照"天然满足重连语义，但**服务端回合计时器必须自建**。

**证据：**

- **炉石 rope/turn timer**：每回合上限 75 秒，最后约 20 秒燃烧引线警示，到时自动结束回合。（75 秒无 Blizzard 官方文档直接背书，来源为 Hearthstone Wiki 汇总 + 开发者推文：Ben Brode 解释 "slush time" 补时、Yong Woo 称 "burning rope fuse"。）
  https://hearthstone.wiki.gg/wiki/Turn
- **boardgame.io 无内置 turn timer**：Issue #92 自 2018 年起为 open feature request——框架级不提供，需自建。
  https://github.com/boardgameio/boardgame.io/issues/92
- **Colyseus 重连**（官方文档）：服务端 `onLeave` 中 `await this.allowReconnection(client, 30)` 给非主动断线者重连窗口；客户端持 `reconnectionToken` 调 `client.reconnect(token)`；可 `.reject()`（例如错过太多回合）。
  https://docs.colyseus.io/room/reconnection
- **重连拉全量快照**（Colyseus state sync 官方文档）："Clients receive the full state when they join the room. Whenever a mutation occurs in the backend, the state is automatically synchronized"——join/重连先全量、平时增量，直接背书"重连即拉全量快照"。
  https://docs.colyseus.io/state
- **Board Game Arena 超时惯例**（官方文档）："As soon as you run out of time (negative clock), you get a clock penalty."；"When a player has a negative clock, any one of their opponents can make them skip their turn."——超时不代打，而是罚分 + 对手触发 skip；expel 再给 20 秒宽限，被 expel 按弃局计分。
  https://en.doc.boardgamearena.com/Game_clock

**对照评注**：需补三件事——(1) 服务端权威的回合 deadline（存入状态，pg_cron / Edge Function 定时触发超时动作：UNO 场景可选自动摸牌/跳过）；(2) 客户端 rope 式倒计时纯属 UI，以服务端 deadline 为准；(3) 重连流程 = 重新订阅频道 + 无条件拉全量快照（本架构已天然支持，成本为零，这是"铃铛+拉快照"模式的一大优点）。

---

## 6. 性能 / 延迟行业指标

**结论：满足需求，余量充足。** 经典研究给策略/全知类游戏的延迟容忍阈值约 1000ms（回合制只会更宽松）；本架构"写库 → 铃铛 → 拉快照"链路乐观情况 200–500ms，加上 Edge Function 冷启动 p99 约 460ms 仍在预算内。前提：Edge Function 与 Vercel 函数都固定到数据库同区域。

**证据：**

- **Claypool & Claypool, "Latency and Player Actions in Online Games"（CACM 49(11), 2006）**：核心表格——Avatar/First-person（FPS）阈值 **100ms**；Avatar/Third-person（体育/RPG）**500ms**；**Omnipresent（RTS/模拟，最接近回合制）1,000ms**。Warcraft III 实验中 2.5 秒延迟仅使总建造时间（8 分钟基线）增加 14 秒。论文未直接测回合制，1000ms 是最接近类别的下界。
  全文：https://web.cs.wpi.edu/~claypool/papers/precision-deadline/final.pdf ；正式出处：https://dl.acm.org/doi/10.1145/1167838.1167860
- **Supabase Edge Functions 冷启动**（官方博客，2025-07《Persistent Storage and 97% Faster Cold Starts for Edge Functions》）：优化后 boot time **Avg 42ms / P95 86ms / P99 460ms / Worst 1,630ms**（优化前 Avg 870ms / P99 15,069ms）；>1s spike 占比从 47% 降至 4%。
  https://supabase.com/blog/persistent-storage-for-faster-edge-functions ；架构：https://supabase.com/docs/guides/functions/architecture
- **Supabase regional invocation**（官方文档）：默认函数在**离用户最近**的区域执行；对多次数据库往返的场景官方建议用 `x-region` header / supabase-js `region` 选项固定到**数据库所在区域**；注意 "requests will NOT be automatically re-routed to another region"（显式指定后失去故障转移）。
  https://supabase.com/docs/guides/functions/regional-invocation
- **Vercel 函数区域**（官方文档）："Vercel allows you to specify the region in which your functions execute, ideally close to your data source (such as your database)"；默认 iad1，经 `vercel.json` `"regions"` 配置。
  https://vercel.com/docs/functions/configuring-functions/region ；实测工具：https://db-latency.vercel.app/
- **单房间消息量粗估**（无需引用）：UNO 每桌 4–10 人、每步 1 条铃铛（几十字节）、节奏约每几秒 1 步 → 每桌 ≲1 msg/sec 发送 ×玩家数扇出，与第 7 节配额对照余量巨大。

**对照评注**：动作往返预算可拆为——Edge Function 调用（含偶发冷启动 p99 460ms）+ 1–3 次 DB 往返（同区 <5ms/次）+ Broadcast 扇出 + 客户端拉快照（一次 REST/RPC）。总计典型 <500ms、劣化 <1.5s，对照 1000ms 阈值（且回合制更宽松）合格。**必须执行**：Edge Function pin 到 DB region、Vercel 函数 region 同区，否则跨洲 RTT × 多次 DB 往返会吃穿预算。

---

## 7. Supabase Realtime 的官方定位与限制、乐观锁适用性

**结论：符合官方推荐方向，但必须补"丢铃铛"兜底。** 官方明确推荐 Broadcast 而非 Postgres Changes；官方明确**不保证消息送达**（at-most-once、无顺序承诺）——"铃铛+拉快照"把一致性放在拉取端方向正确，但丢铃铛时客户端不知道有更新，需 fallback。expectedVersion CAS 由 Postgres 官方文档语义直接背书；官方没有"DB 权威回合制游戏"参考实现，本架构属自行组合，但每个构件都有官方定位支撑。

**证据：**

- **Broadcast vs Postgres Changes**（官方文档）："Subscribing to Database Changes" 页：Broadcast 是 "the recommended method for scalability and security"，Postgres Changes "does not scale as well as Broadcast"，"We recommend using Broadcast for most use cases."
  https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
  官方 benchmarks 量化：Postgres Changes 启用 RLS 时低至 0.1–64 msgs/sec、约 4,000 并发；Broadcast 可达 800,000+ msgs/sec、250,000 并发；原因 "Database changes are processed on a single thread to maintain the change order"。
  https://supabase.com/docs/guides/realtime/benchmarks
- **Broadcast from Database**：`realtime.send()` 可在 Postgres 触发器/事务内发消息（写入 `realtime.messages`，3 天后删除）——可把"发铃铛"放进与状态写入同一事务，消除 Edge Function 写库成功但发铃铛失败的双写问题。
  https://supabase.com/docs/guides/realtime/broadcast
- **送达保证**：supabase/realtime 官方 GitHub README 原话："**The server does not guarantee that every message will be delivered to your clients** so keep that in mind as you're using Realtime." docs 亦无任何 delivery/ordering 承诺。缓解：官方 **Broadcast Replay**（`realtime.messages` 保留 72 小时，重连后可回放最近消息，每请求最多 25 条）。
  https://github.com/supabase/realtime ；https://supabase.com/docs/guides/realtime/architecture ；Replay 见 https://supabase.com/docs/guides/realtime/broadcast
- **Realtime Authorization**（官方文档）：`private: true` 频道 + 在 `realtime.messages` 表上写 RLS policy 控制收/发；注意 "Client access policies are cached for the duration of the connection. Your database is not queried for every Channel message."（连接级缓存——铃铛不含敏感数据的设计正好匹配此粒度）。
  https://supabase.com/docs/guides/realtime/authorization
- **Postgres 乐观锁（version 列 CAS）**：postgresql.org 官方文档（READ COMMITTED 节）：并发 UPDATE 会等待先行事务提交，随后 "The search condition of the command (the WHERE clause) is **re-evaluated** to see if the updated version of the row still matches."——因此 `UPDATE games SET state=..., version=version+1 WHERE id=$1 AND version=$expected` 是官方语义直接保证的安全 CAS（冲突时 rowCount=0），无需 SERIALIZABLE。
  https://www.postgresql.org/docs/current/transaction-iso.html ；https://www.postgresql.org/docs/current/mvcc-intro.html
- **幂等键**：Stripe 官方 API 文档（行业事实标准）：`Idempotency-Key` 保存首次请求的状态码与响应体，重放同 key 返回相同结果，key 至少保留 24 小时，参数不一致时报错。Postgres 实现即 `UNIQUE(room_id, idempotency_key)` + 冲突时返回首次结果。
  https://docs.stripe.com/api/idempotent_requests
- **官方多人游戏参考实现**：官方博客 "Realtime: Multiplayer Edition"——Broadcast 定位为 ephemeral（"they bypass the database completely"），示例（光标、聊天）广播瞬时状态；Flutter Flame 射击游戏教程为纯 peer-to-peer broadcast、无服务端权威、不落库。**没有官方的"DB 权威 + 铃铛"回合制参考实现。**
  https://supabase.com/blog/supabase-realtime-multiplayer-general-availability ；https://supabase.com/blog/flutter-real-time-multiplayer-game ；https://github.com/supabase/supabase/tree/master/examples/realtime/flutter-multiplayer-shooting-game
- **配额**（官方 limits 页）：Messages per second Free 100 / Pro 500 / Team 2,500；并发连接 Free 200 / Pro 500 /（no spend cap）10,000；每连接 100 channel。UNO 铃铛模式每桌 ≲1 msg/sec，Free tier 即可支撑数十并发房间；先到的上限是**并发连接数**而非消息速率。
  https://supabase.com/docs/guides/realtime/limits

**对照评注**：三个必做补强——(1) 丢铃铛兜底：reconnect/visibilitychange 时无条件重拉快照 + 低频轮询（回合制 10–30s 一次即可）或 Broadcast Replay；铃铛带 version 使客户端可检测自身落后，快照拉取幂等，天然容忍重复/乱序铃铛——这是该模式的正确性核心。(2) 建议把发铃铛改为 DB 触发器 `realtime.send()`，与状态写入同事务。(3) 频道用 private + RLS。

---

## 8. 总体评定与行业对照表

### 总体评定

**该架构在核心决策上符合行业最佳实践，性能对回合制卡牌游戏绰绰有余。** 五个核心决策（服务器权威纯函数引擎、DB 唯一真相、服务端视角投影、Broadcast 只当铃铛、CAS+幂等写入）分别与 boardgame.io/Colyseus/商业卡牌游戏工程实践、Supabase 官方推荐、Postgres/Stripe 官方语义一一对应。它本质上是把 boardgame.io 的模式（纯函数 moves + playerView + 服务端 RNG + log）用 Supabase 原语重新实现，同时规避了 Postgres Changes 的扩展性瓶颈和 Broadcast 泄密风险。

**三处需补（架构描述未覆盖，非方向错误）：**
1. **丢铃铛兜底**（第 7 节）：Realtime 官方明确 at-most-once，必须加 reconnect 重拉 + 低频轮询或 Broadcast Replay。
2. **反应窗口建模**（第 3 节）：需在引擎状态中显式实现 priority-pass 状态机（respondersRemaining + 显式 pass + deadline）。
3. **服务端回合计时器**（第 5 节）：超时自动行动必须服务端权威触发（pg_cron 等），无现成组件。

**两处执行要点（配置层面）：**
- Edge Function 与 Vercel 函数均 pin 到数据库区域（第 6 节）。
- 随机结果必须落入事件日志，禁止不落库的 `Math.random()`（第 4 节）。

**一处已知空白**：Supabase 官方没有"DB 权威 + 铃铛"回合制游戏参考实现，该组合需自行承担模式验证，但每个构件均有官方一手背书。

### 行业对照表

| 架构决策 | 行业对照（一手来源） | 评定 |
|---|---|---|
| 权威规则引擎在服务端，客户端只发意图 | Colyseus "authoritative game servers"；LoR "game-server authoritative"；炉石 Power 状态机 | 符合 |
| 纯函数 `(state, action) => state` + 事件日志 | boardgame.io moves 必须纯函数、可重放；MTG Arena GRE 指令列表 | 符合 |
| Postgres 唯一真相，Broadcast 仅作通知 | Supabase 官方：Broadcast 是 ephemeral，推荐用于扩展性；持久数据以 DB 为权威 | 符合 |
| 铃铛 `{roomId, version, seq}` 不含状态 | 等价于避开 boardgame.io "strip secrets" 要防的泄露面；匹配 Realtime 授权的连接级缓存粒度 | 符合 |
| 拉取视角过滤快照 | boardgame.io playerView/STRIP_SECRETS；Colyseus StateView；炉石服务端 dispatcher 过滤 | 符合 |
| 乐观锁 expectedVersion CAS | PostgreSQL READ COMMITTED WHERE 重评估语义直接背书 | 符合 |
| idempotency_key | Stripe 官方幂等键模式（unique 约束 + 重放首次响应） | 符合 |
| 消息送达假设 | Realtime 官方"不保证送达" | **需补**：重拉 + 轮询/Replay 兜底 |
| 反应窗口/优先权 | MTG CR 117 priority-pass 状态机；boardgame.io stages/activePlayers | **需补**：引擎内显式建模 |
| 超时/AFK | 炉石 75s+rope；BGA clock 罚分/skip；boardgame.io 无内置（自建是常态） | **需补**：服务端 deadline + 定时触发 |
| 断线重连 | Colyseus：join/重连发全量状态 | 符合（拉快照天然满足） |
| 服务端 RNG + 可重放 | boardgame.io random API；Fowler Event Sourcing；PokerStars 服务端洗牌+审计 | 符合（前提：随机结果落库） |
| 延迟预算 | Claypool & Claypool：策略类容忍 ~1000ms；Edge Functions 冷启动 Avg 42ms / P99 460ms | 满足（需同区部署） |
| 消息量/配额 | Supabase limits：Free 100 msgs/sec、200 并发连接 | 余量巨大；上限在并发连接数 |

### 主要来源索引

- boardgame.io 官方文档：https://boardgame.io/documentation/ （immutability / secret-state / stages / random）
- Colyseus 官方文档：https://docs.colyseus.io/ （state / state/view / room/reconnection）
- MTG 综合规则 CR 117：https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.txt
- MTG Arena GRE（Wizards 官方博客）：https://magic.wizards.com/en/news/mtg-arena/on-whiteboards-naps-and-living-breakthrough
- LoR（Riot 官方 tech blog）：https://technology.riotgames.com/news/legends-runeterra-cicd-pipeline
- 炉石 GDC 2014（转录）：https://archive.org/stream/GDC2014Schwab_201611/GDC2014-Schwab_djvu.txt
- Martin Fowler, Event Sourcing：https://martinfowler.com/eaaDev/EventSourcing.html
- Claypool & Claypool 2006：https://web.cs.wpi.edu/~claypool/papers/precision-deadline/final.pdf
- Supabase Realtime 文档：https://supabase.com/docs/guides/realtime/ （broadcast / subscribing-to-database-changes / benchmarks / limits / authorization / architecture）
- supabase/realtime README（送达保证）：https://github.com/supabase/realtime
- Supabase Edge Functions：https://supabase.com/docs/guides/functions/regional-invocation ；https://supabase.com/blog/persistent-storage-for-faster-edge-functions
- PostgreSQL 官方文档：https://www.postgresql.org/docs/current/transaction-iso.html
- Stripe 幂等键：https://docs.stripe.com/api/idempotent_requests
- Vercel 函数区域：https://vercel.com/docs/functions/configuring-functions/region
- BGA Game clock：https://en.doc.boardgamearena.com/Game_clock
- Hearthstone Turn/rope：https://hearthstone.wiki.gg/wiki/Turn
