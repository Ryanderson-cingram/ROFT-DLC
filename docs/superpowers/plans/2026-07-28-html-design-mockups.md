# 纯 HTML 静态设计稿 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **设计任务额外要求：** 动手写任何页面前，先加载 `frontend-design`（或 `frontend-design:frontend-design`）技能确定视觉方向；本计划只锁结构与内容，不锁美学。

**Goal:** 产出 ROFT-DLC（UNO+技能）Web 对局的 5 个纯 HTML 静态设计稿页面，作为后续 Next.js UI 的视觉与信息架构蓝本。

**Architecture:** 每屏一个自包含 `.html` 文件（内联 CSS 或引用共享 `tokens.css`；仅允许少量内联 JS 做「状态切换器」），零构建、双击即可在浏览器打开。所有游戏数据为写死的 mock。

**Tech Stack:** 纯 HTML + CSS（可用 CSS 自定义属性/Grid/Flex），禁止外部 CDN 依赖、禁止框架。

## Global Constraints

- 文件全部放 `design/mockups/`，**不得**触碰 `apps/`、`packages/`、`supabase/`（脚手架代理在并行改那些目录）
- 中文 UI 文案；深色牌桌基调（具体美学由 frontend-design 技能决定）
- 移动端优先（375px 宽可用），桌面端自适应增强
- 不用任何真实厂商 UNO 商标素材；牌面自绘（色块+字符即可）
- 每个任务独立提交一次 git commit

---

## 设计大纲与游戏基础信息（设计代理必读，勿再翻规则库）

**规则源**：`docs/knowledge-base/`（如需细节）；spec：`docs/superpowers/specs/2026-07-28-roft-dlc-web-design.md` §6。

**颜色系统**（牌面五色，tokens 必备）：红 / 蓝 / 黄 / 绿 + 彩色（万能牌，四色渐变或拼色）。
**牌面**：数字 0–9、+2、停、转（四色）；变色、+4、洗牌、毒（彩色）。
**玩家**：3–4 人围桌；每人可见信息 = 手牌张数、已亮出技能、状态徽章（五彩/恋战/心盲/领域/同命）、标记计数（魂/盗/形…）、神化 pips（●）、UNO 状态。
**回合四阶段**（HUD 阶段条）：`回合开始（用技能）→ 出牌/摸牌 → 结算 → 回合结束`。HUD 必须有「一句人话」提示，例：*「你的回合：可以先用技能，或直接出牌」*。
**四句总则**（常驻可折叠面板，逐字使用）：
1. 回合开始用技能，然后出牌。
2. 被 +2/+4 时先叠或不叠；叠的时候只算你自己那张的加成。
3. 一人一个技能；亮出来才会生效。
4. 神化 = 多几轮出牌；并列 = 一轮里多张。

**技能卡三层披露**：L0 = 一句话摘要（卡面常显）；L1 = 展开细则；L2 = 置灰时的「为何不可用」（disabledReason，如「惩罚回合不能用主动技能」）。

**MVP 首批 10 技能及 L0 文案**（mock 数据用）：
| 技能 | L0 摘要 |
|---|---|
| 恒心♠1 | 弃一张牌，摸一张牌 |
| 恩惠♥1 | 被惩罚/被技能摸牌时少摸 2 张（至少 1） |
| 精英♥3 | 数字牌可当作大 1 点打出（只剩 1 张手牌时失效） |
| 并列♥4 | 两张同色同数 / 四张同数 / 六张同色可一起打出 |
| 强袭♦1 | 打出 +2/+4 后掷骰改倍率；可替任何人重掷骰子 |
| 血棘♦2 | 你发起的惩罚会封印对方技能 |
| 影歌♦3 | 一次性攒「魂」（最多 6）；花 2 魂跳过回合 |
| 劫营♦10 | 他人打出你也有的同色同数牌时，可同时打出打断 |
| 远星♦J | 上家 +2/+4 时弃代价牌并摸 2，视为跟着叠牌 |
| 司夜♣3 | 打出变色牌后掷骰获「盗」；花盗换手牌 |

**惩罚叠链 UI**：分段累计展示，例：`+2(蓝) → +4(红) → 累计 6 张`，己方可选按钮 = 「叠 +4」/「吃下 6 张」。
**反应窗口（pendingWindow）UI**：屏幕顶部倒计时条 + 文案「等待 玩家C 响应（劫营）· 8s」，非当事玩家为只读态。
**骰子**：三面骰 0/1/2，结果用大数字 toast 展示。

---

### Task 1: 设计令牌与共享样式 `tokens.css`

**Files:**
- Create: `design/mockups/tokens.css`

**Interfaces:**
- Produces: CSS 自定义属性 `--card-red/--card-blue/--card-yellow/--card-green/--card-wild-a/--card-wild-b`、`--bg-table`、`--surface`、`--text-primary/secondary`、间距 `--sp-1..4`、圆角 `--radius-card/panel`、字体栈；工具类 `.card`（牌面基础样式，带 `data-color` / `data-face` 属性变体）、`.badge`（状态徽章）、`.pip`（神化点）。后续所有页面只从这里取色。

- [ ] **Step 1: 加载 frontend-design 技能，定下美学方向**（深色牌桌基调内自由发挥；写一段 10 行内的 design-direction 注释在文件头）
- [ ] **Step 2: 写 tokens.css**，包含上述全部变量与 `.card/.badge/.pip` 基类，并附一个自测区块注释（说明每个变量用途）
- [ ] **Step 3: 写临时预览页验证**：在 `design/mockups/_preview.html` 平铺 5 色×代表牌面（3、+2、停、转、+4、毒）与徽章、pips，浏览器打开目检对比度（正文文字对背景 ≥ 4.5:1）
- [ ] **Step 4: Commit**

```bash
git add design/mockups/tokens.css design/mockups/_preview.html
git commit -m "design: tokens and card/badge base styles"
```

### Task 2: 大厅 `lobby.html`

**Files:**
- Create: `design/mockups/lobby.html`（引用 `tokens.css`）

**必备元素（验收清单）：**
- 顶栏：产品名 ROFT-DLC + 用户昵称「凛」
- 主操作：① 创建房间（弹出式/内联表单：规则包 `基础包|诸神包` 单选，默认基础包；技能获取 `抽3选1` 固定显示）② 加入房间（6 位房间码输入，示例码 `KX7Q2M`）
- 次要入口：「玩家百科」链接（指向 encyclopedia.html）
- 空状态文案体现「进度式披露」：诸神包选项旁小字「进阶内容，建议先玩过基础包」

- [ ] **Step 1: 写 lobby.html**（全部必备元素，mock 数据写死）
- [ ] **Step 2: 浏览器打开自检**：375px 与 1280px 两档宽度截图确认无横向滚动、可点击目标 ≥ 44px
- [ ] **Step 3: Commit** `git add design/mockups/lobby.html && git commit -m "design: lobby mockup"`

### Task 3: 房间等候室 `room.html`

**Files:**
- Create: `design/mockups/room.html`

**必备元素：**
- 房间码大号展示 `KX7Q2M` + 复制按钮样式
- 4 个座位卡：mock 为「凛（房主，已准备）/ 阿柴（已准备）/ 小满（未准备）/ 空位（虚线框+邀请提示）」
- 规则配置摘要（只读）：基础包 · 抽3选1 · 3–4 人
- 底部主按钮：房主视角「开始游戏（2/3 已准备）」置灰态 + 非房主视角「准备」高亮态——两种视角用页内状态切换器（见 Task 4 的切换器模式）展示
- Presence 表达：在线绿点/离线灰点

- [ ] **Step 1: 写 room.html**（含两视角切换）
- [ ] **Step 2: 浏览器自检**（同 Task 2 两档宽度）
- [ ] **Step 3: Commit** `git commit -m "design: room lobby mockup"`

### Task 4: 对局 HUD 主态 `game.html`（状态 A/B）

**Files:**
- Create: `design/mockups/game.html`

**状态切换器模式**（本页固定用法，内联 JS ≤40 行）：

```html
<nav class="state-picker">
  <button data-state="a">A 我的回合</button>
  <button data-state="b">B 惩罚叠链</button>
  <button data-state="c">C 反应窗口</button>
  <button data-state="d">D 选颜色</button>
  <button data-state="e">E 开局抽技能</button>
</nav>
<script>
  document.querySelector('.state-picker').addEventListener('click', e => {
    const s = e.target.dataset.state; if (!s) return;
    document.body.dataset.state = s;   // CSS 用 body[data-state="b"] .only-b 控制显隐
  });
</script>
```

**Mock 对局数据（写死在标记里，所有状态共用）：**
- 玩家：凛（自己，7 张手牌）、阿柴（下家，2 张，已喊 UNO 徽章）、小满（4 张，状态「恋战」）、老白（11 张，神化 ●●）
- 自己手牌：红3、红7、蓝7、绿0、黄+2、变色、+4（可打牌高亮=`legalActions`，状态 A 下红3/红7/蓝7/黄+2 可打）
- 牌顶：红7；技能：自己=恒心（已亮出）、阿柴=劫营（已亮出）、小满=未亮出（牌背）、老白=血棘（已亮出）

**状态 A「我的回合-阶段1」必备：** 阶段条第 1 格点亮；HUD 人话「你的回合：可以先用技能，或直接出牌」；恒心技能卡可点态（L0 常显，点开 L1 细则弹层示例）；四句总则折叠面板（默认收起）；「摸牌」次按钮；UNO 喊话按钮（灰，条件未满足 L2 提示「剩 2 张牌时才需要喊」）。
**状态 B「惩罚叠链」必备：** 链条分段横幅 `黄+2(阿柴) → 红+4(老白) → 累计 6 张`；行动按钮「叠 +4」主色 /「吃下 6 张」危险色；恒心技能卡置灰 + L2 文案「惩罚回合不能用主动技能」；倒计时条 12s。

- [ ] **Step 1: 写 game.html 骨架 + 状态切换器 + 状态 A**
- [ ] **Step 2: 加状态 B**（叠链横幅、置灰技能、L2 提示）
- [ ] **Step 3: 浏览器自检**：A/B 切换无残影；375px 下手牌横向滚动而非换行溢出；阶段条在两态正确
- [ ] **Step 4: Commit** `git commit -m "design: game HUD states A/B (turn + punish chain)"`

### Task 5: 对局 HUD 反应态 `game.html`（状态 C/D/E）

**Files:**
- Modify: `design/mockups/game.html`（追加三个状态区块，复用 Task 4 切换器与 mock 数据）

**状态 C「反应窗口-他人回合」必备：** 顶部倒计时条「等待你响应：小满打出了 蓝7，你可以劫营 · 8s」；自己手牌中蓝7 高亮脉冲；按钮「劫营打断」/「放弃」；其他玩家区标注「小满出牌中」。
**状态 D「选颜色」必备：** 模态四色大按钮（红/蓝/黄/绿）+ 标题「你打出了 +4，选择颜色」；背景 HUD 半透明冻结。
**状态 E「开局抽3选1」必备：** 三张技能卡并排（精英/远星/司夜，含 L0 文案，取自上方表格），点选态样式 + 确认按钮；顶部进度「其他玩家选择中 2/4」。

- [ ] **Step 1: 写状态 C**
- [ ] **Step 2: 写状态 D 与 E**
- [ ] **Step 3: 浏览器自检**：五态切换全部正常；D 的模态遮罩不透出下层可点击暗示
- [ ] **Step 4: Commit** `git commit -m "design: game HUD states C/D/E (respond, color, draft)"`

### Task 6: 玩家百科 `encyclopedia.html`

**Files:**
- Create: `design/mockups/encyclopedia.html`

**必备元素：** 顶部说明「由规则知识库生成」；四句总则置顶卡片；10 个 MVP 技能的卡片列表（L0 常显 + 点击展开 L1，用 `<details>` 原生实现，零 JS）；按花色分组的锚点导航；搜索框（纯样式即可）。L1 细则文案可从 `docs/knowledge-base/04-skills-catalog.md` 对应行改写为玩家口吻。

- [ ] **Step 1: 写 encyclopedia.html**（`<details>` 展开，无 JS）
- [ ] **Step 2: 浏览器自检**：展开/收起原生可用；375px 单列
- [ ] **Step 3: 删除 `_preview.html`**（Task 1 的临时文件，使命完成）
- [ ] **Step 4: Commit** `git add -A design/mockups && git commit -m "design: player encyclopedia mockup; drop preview page"`

---

## Verification（整计划完成后）

1. `open design/mockups/lobby.html room.html game.html encyclopedia.html` 逐页目检
2. 清单核对：本文件每个 Task 的「必备元素」全部存在
3. 全部页面无外部网络请求（DevTools Network 面板为空）
4. `git log --oneline` 应有 ≥6 个 design: 提交
