# ROFT-DLC（UNO + 技能诸神降临）Web 对局系统设计

**日期：** 2026-07-28  
**状态：** 待用户审阅  
**规则锚点：** Excel `UNO技能4.1-诸神降临.xlsx` + `docs/knowledge-base/`  
**栈决策：** 方案 1 — Next.js（Vercel）+ Supabase（Auth/Postgres/Realtime）+ 权威引擎跑在 **Supabase Edge Function**

---

## 1. 背景与目标

将线下「UNO + 自制技能 DLC（诸神降临 4.1）」做成多端游戏；**先 Web**，后期 App 复用同一规则引擎。

**MVP 成功标准**

- **3–4 人**私房可完一局「基础包」（2 人局多技能语义退化：上家=下家、同命对称、主神+神官共胜等，裁定推迟，见 `06-open-questions.md`）
- 断线重连后手牌与回合一致
- 引擎单测 ≥20 条且对齐知识库已定规则
- 客户端不暴露他人手牌

**非目标（MVP）**

- 排位匹配、商城、观战回放 UI
- 一次实现全部 50+ 技能（先框架 + 子集，再扩表）

---

## 2. 规则来源

可查询知识库（实施与测试的唯一规则源）：

| 路径 | 内容 |
|---|---|
| `docs/knowledge-base/01-decided-rules.md` | 已拍板总则（回合、惩罚、神化、万变禁表等） |
| `docs/knowledge-base/02-methodology.md` | 技能属性方法论 |
| `docs/knowledge-base/03-glossary.md` | 术语 / 状态 / 标记 |
| `docs/knowledge-base/04-skills-catalog.md` | 全技能目录 |
| `docs/knowledge-base/05-gods-omens-deck.md` | 诸神 / 预兆 / 172 张牌组 |
| `docs/knowledge-base/06-open-questions.md` | 残余待决（边角） |

改规则：先改知识库 → 再改引擎与测试 → 再改 UI。

---

## 3. 技术架构（已确认）

### 3.1 总览

```text
Client (Next.js on Vercel)
  → Edge Function: room-action / get-snapshot
      → packages/engine applyAction
      → Postgres（version + events）
      → Realtime Broadcast 铃铛
  ← Client 拉视角过滤快照
Presence：在线 / 准备
```

### 3.2 Realtime / Event 最佳实践（已调研并采纳）

| 项 | 决策 |
|---|---|
| 真相来源 | Postgres；Realtime 不是真相 |
| 对局推送 | **Broadcast**（含 Broadcast from DB / `realtime.send`），不用 Postgres Changes 做主路径 |
| Presence | 在线与准备状态 |
| Event | `room_events` 追加日志（审计/回放）；Broadcast 只带 `{ roomId, version, seq }` |
| 客户端 | 收铃铛后拉快照；重连必须重新拉快照；**丢铃铛兜底**：官方明言 Broadcast 不保证送达——客户端低频轮询本房 `version`（约 30s）+ 回前台/重连必拉，发现本地落后即拉快照 |
| 隐私 | `room_state_private` 仅 service role；Broadcast 不含他人手牌 |

### 3.3 Edge Function

- 承载 `applyAction` 编排：鉴权 → 读私有状态 → 引擎 → 乐观锁写入 → 通知  
- 引擎保持纯 TS、无 IO，便于 CI 单测  
- 注意 CPU 2s / 256MB：单次出牌转移足够；进房预热防冷启动（官方数据冷启动 Avg 42ms / P99 460ms，回合制余量充足）  
- **区域部署**：Edge Function 与数据库 **pin 同区域**（避免跨区往返吃掉延迟预算；回合制容忍阈值 ~1s，目标动作往返 <500ms）  

### 3.4 后期 App

同一 `packages/engine` + 同一 Supabase；仅换 UI 壳（Expo 等）。

---

## 4. 数据模型（已确认）

| 表 | 访问 | 用途 |
|---|---|---|
| `profiles` | RLS 本人 | 资料 |
| `rooms` | 成员 | 房间码、status、规则配置、`version` |
| `room_seats` | 成员 | 座位、准备 |
| `room_state_private` | service only | 全量 `GameState` JSON |
| `room_events` | 受控 | 追加事件；**事件与快照同样做公开/私有投影**（事件天然含隐藏信息，如某人摸到的牌；成员只读公开投影） |
| `skill_defs` | 只读 | 技能静态定义 + `ruleset_version` |

**技能定义数据驱动（单一生成源）**：技能定义不硬编码在 handler 里——由 `docs/knowledge-base/` 经构建期脚本生成**版本化 JSON**（字段模型见 `02-methodology.md`），作为唯一生成源：

- `packages/engine` 打包该 JSON，handler 仅按 `id` 注册**行为**，属性（窗口/目标/次数/层级等）一律从定义数据读取
- `skill_defs` 表存放同一份 JSON（以 `ruleset_version` 锚定），供 UI / 玩家百科 / 后台查询
- 两处内容同源同版本，CI 校验一致性，杜绝双源漂移

写入：`expectedVersion` 乐观锁 + `idempotency_key` 唯一约束。

房间配置示例：技能获取 `draft3`（默认）；规则包 `base` | `gods`。

---

## 5. 引擎与状态机（已确认）

### 5.1 API

```text
applyAction(state, action, ctx) → { state, events, rejected? }
legalActions(state, seat) → Action[]
projectView(state, seat) → ClientSnapshot
```

**随机源（服务端权威、可重放）**：引擎自身不产生随机数——`ctx.rng` 由 Edge Function 注入（服务端 CSPRNG）。所有掷骰、洗牌、随机抽取的**结果**写入 `room_events`（如 `diceRolled { values }`、`deckShuffled { order|seed }`）。重放/审计时引擎从事件读取随机结果而非重掷；幂等重试返回首次事件，天然不会二次掷骰。

### 5.2 Phase 与反应窗口

主流程：`lobby → dealing → turnStart → play → afterPlay`

**通用反应窗口（pendingWindow）**——规则库中需要暂停等待非当前行动者决策的场景远不止惩罚（合纵/连横「立刻相应」S13、劫营对并列/神化每张牌的打断窗口 G5、远星/异议响应上家 +2/+4、近卫逐张交牌 P12、阳谋翻开对决、迫近接管…）。不为每个技能开私有 phase，统一建模为：

```text
pendingWindow {
  type,            // punishStack | respondReveal | interrupt | pinPoint | …
  actors,          // 待决玩家集合（可多人，如劫营窗口 = 所有持劫营者）
  deadline,        // 服务端时间戳
  defaultChoice,   // 超时/弃权时的默认解法（一律 = 视为不响应/放弃）
  resume,          // 窗口结算后回到的主流程位置
}
```

- 惩罚 `punishWindow`（叠 / 远星 / 影歌跳过 / 吃下）是 pendingWindow 的一个 `type`，不再特殊
- **多响应者结算语义（MTG priority 式）**：`actors` 多于一人时，逐一收 `respond`（含「放弃」）；**全员放弃或超时 → 按 defaultChoice 结算**；任一人成功响应 → 按该响应结算并清空本窗口其余待决（并发抢答由乐观锁天然串行化，先到先得）
- **拼点是可复用子流程**（U4 全序 + 发起人胜平局），被窃贼/天堂/不意/黑白/诸神黄昏挑战等复用，实现一次
- 窗口可嵌套（栈）：如惩罚链中触发近卫逐张决策

### 5.3 Action（摘要）

`revealSkill` | `activateSkill` | `playCards` | `drawForNoPlay` | `stackPunish` | `acceptPunish` | `challengeGod` | `chooseColor` | **`respond(windowId, choice)`**（所有反应窗口的统一入口，`choice` 含「放弃」）| …

### 5.4 校验管道

身份 → 幂等 → version → phase/行动者（**含 pendingWindow.actors 校验**）→ 压制与封印 → apply → events → version++。

### 5.5 MVP 技能子集（建议首批）

恒心、精英、并列、强袭、血棘、远星、劫营、影歌、恩惠、司夜（框架级）；其余按目录迭代。全量技能数据仍从知识库导出，未实现 handler 的技能不进可抽池或标记 `unimplemented`。

---

## 6. 客户端 UX（已确认）

- 进度式披露：默认**基础包**；诸神包可选  
- HUD：阶段一句人话 + `legalActions` 高亮  
- 四句总则常驻可折叠  
- 技能 L0/L1/L2（摘要 / 细则 / 为何不可用）  
- 动效：阶段条、惩罚分段累计、技能翻开  
- 内置玩家版百科（由 knowledge-base 生成）

---

## 7. 错误处理 / 重连 / 测试（已确认）

- 409 version 冲突 → 拉快照  
- 非法 action → 400 + disabledReason  
- 幂等键返回首次结果  
- 重连 / 回前台 → get-snapshot  
- MVP 断线：**保留座位，不自动出牌**——但仅限「轮到你出牌」的主回合；**反应窗口不豁免超时**，否则一个 AFK 玩家会卡死全桌（MVP 首批就含劫营/远星两个响应技能，此问题在 MVP 范围内）  
- **反应窗口超时**：每个 pendingWindow 带 `deadline` + `defaultChoice`（= 视为不响应）。Edge Function 是请求驱动、无服务端定时器，MVP 采用**客户端催促**：任意成员在 deadline 过后调用 `room-action { type: "claimTimeout", windowId }`，服务端校验 `now > deadline` 后按 defaultChoice 结算（谁先到谁生效，乐观锁保证只结算一次）；客户端在窗口出现时本地起倒计时并自动发起。后续如需兜底再加 pg_cron 扫描超时窗口（非 MVP）  
- 主回合出牌无强制计时（MVP 私房局，熟人自治）；正式匹配再引入回合计时器，复用同一 deadline 机制  
- **已知偏离（调研 §5）**：行业惯例是服务端权威定时器触发超时（炉石 rope、BGA clock；boardgame.io 无内置需自建）。我们的 `claimTimeout` 是客户端催促 + 服务端校验 `now > deadline`——**决策是服务端权威的，但触发不是**。后果：一个反应窗口若所有成员同时掉线，将永不结算。私房局可接受；**正式匹配上线前必须补 pg_cron 扫描超时窗口**  
- **部署前必做（调研 §6）**：Edge Function 与 Vercel 函数都 pin 到数据库所在区域。跨洲 RTT × 多次 DB 往返会吃穿 1s 的回合制延迟预算（Claypool 2006 给策略类的阈值）  
- 测试：引擎 fixture（规则 ID）+ Edge 集成（裁剪/冲突/超时争抢）+ E2E 烟雾  

---

## 8. 关键规则摘要（引擎必须遵守）

完整列表见 `01-decided-rules.md`。实施检查清单摘要：

- 骰子 0/1/2；开局 7 张手牌 + 抽 3 选 1；一人一技能  
- 回合：开始（技能）→ 出牌/摸 → 结算 → 结束  
- 惩罚仅 +2/+4；可叠（+2←+2/+4，+4←仅+4）；贡献按己方牌；吃下摸完结束  
- **末牌必须是数字牌**（U5）：功能牌（+2/停/转/变色/+4/毒/洗牌）打空手牌时补摸 1 张，牌照常结算但不判胜；这张代价牌不算惩罚  
- 神化=出牌轮次；劫营打断作废剩余轮；主神在场神化≤3  
- 万变排除：宏伟/灾难/宝藏/狂欢/预兆/飞升 + 四神  
- 同命只响应惩罚，不响应毒  
- 摸牌数多来源修正（恩惠/狂欢/吟游/伤逝/忍戒…）按 `02-methodology.md` §7 **结算层级**统一执行，禁止技能间 ad-hoc 排序  

---

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 技能数量与交互爆炸 | 分包启用；handler 注册表；知识库驱动测试 |
| Edge 冷启动 | 预热；UI loading |
| Realtime 丢包 | 快照为真相；可见性恢复重拉 |
| 规则仍有边角 ❓ | `06-open-questions.md`；遇到再裁；不阻塞 MVP 框架 |

---

## 10. 建议实施顺序（供后续 writing-plans）

1. Monorepo：Next app + `packages/engine` + Supabase 迁移  
2. 引擎：牌组/基础 UNO/惩罚叠链 + 单测  
3. Edge：action / snapshot + Realtime 铃铛  
4. Web：大厅/房间/对局 HUD  
5. 技能框架 + 首批技能  
6. 教学分层与百科  
7. 扩技能与诸神包  

---

## 11. Spec 自检

- [x] 无 TBD 占位阻塞 MVP 架构（残余边角在 06）  
- [x] 架构与 Realtime 决策一致（铃铛 + 快照）  
- [x] 引擎在 Edge，与「纯 TS 可测」不矛盾  
- [x] 范围：Web MVP，App 仅预留  
- [x] 规则以 knowledge-base 为准，避免双源  

---

## 12. 审阅门闩

请审阅本文件。确认后进入 **implementation plan**（writing-plans）；若需修改请直接指出章节。

**未自动 git commit**（遵从「仅在你要求时提交」）；需要入库时告诉我即可。
