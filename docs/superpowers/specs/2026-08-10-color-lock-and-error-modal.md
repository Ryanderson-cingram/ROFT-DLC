# 定色锁收敛为单一真相 + 服务端报错改弹窗

> 2026-08-10。两条真机反馈：①服务端报错只出现在页面最下方，看不见；
> ②五彩只画得出的那一个色，吟游行进曲却画四个、选错才报错。
> 结论先说：**②不是「给行进曲补个分支」，是客户端在重新推导规则**——
> 同一个病有三个来源，反馈里只碰到两个，专精♥9 是没被发现的第三个，
> 而且它锁的色跟另外两个**不是同一个色**。修法是把判据投进快照、删掉客户端那段推导。
> **零规则改动**：引擎的判定一行不动，`docs/knowledge-base/` 不需要改。

---

## 1. 需求②：三个来源，客户端只抄了一个

### 1.1 引擎侧只有一个权威

`legal.ts::requiredColor(b, seat)` 是「这张无色牌必须定成什么色」的唯一判据，
经 `colorLocked` 消费，只有两个调用点：

| 调用点 | 场景 |
|---|---|
| `actions/play-cards.ts:66` | 打出无色牌（变色 / +4 / 毒 / 洗牌） |
| `actions/shuffle-card.ts:169` | 洗牌③的取消牌（也是无色牌） |

它有**三个**来源，优先级在函数里已经定死：

| 来源 | 锁到哪个色 | 判据 |
|---|---|---|
| 专精♥9③ | **他的专属色**（≠ 跟色） | `specialtyColor(b, seat)` |
| 五彩（03 §4 状态） | 当前跟色 | `hasStatus(b, seat, RAINBOW)` |
| 行进曲（吟游♣5，全场） | 当前跟色 | `globalColorLock(b, data)` |

专精排在最前是有意的：它比「维持跟色」更具体（`legal.ts` 原注）。

### 1.2 客户端侧抄了三分之一

`app/game/[code]/page.tsx:234`：

```ts
const lockedTo = (card?: Card) =>
  card?.color === null && snapshot.players[snapshot.youSeat]?.statuses.includes("五彩")
    ? snapshot.activeColor : null;
```

只认 `statuses` 里的五彩，还把锁定色写死成 `activeColor`。三个来源的实际表现：

| 场景 | 引擎要求 | 客户端画 | 结果 |
|---|---|---|---|
| 五彩 | 跟色 | 跟色 ✓ | 一致，只画 1 个色块 |
| **行进曲** | 跟色 | 不锁 ✗ | 画 4 个，选错 → `color_locked` |
| **专精♥9** | 他的专属色 | 不锁 ✗ | 画 4 个，**且锁的根本不是跟色**，选错 → `color_locked` |

反馈里报的是行进曲。**专精♥9 有同样的病且更隐蔽**：即使把 `lockedTo` 补成
「五彩 or 行进曲」，专精照样错——它要的色压根不是 `activeColor`。

### 1.3 根因

这违反本项目自己反复申明的**客户端零规则**。仓库里同类问题早有标准答案，
`ClientSnapshot.canPlayMultiple` 的注释逐字写着：

> 合法的多张组合会组合爆炸，`legalActions` 不枚举它们——所以这个能力位是 UI
> 唯一的合法信号。没有它，客户端只能自己判「我有没有并列」，那就破了「客户端零规则」。

定色锁是一模一样的形状：`legalActions` 表达不了「这张无色牌只能定成某个色」
（`playCards` 动作里没有 `chosenColor` 的枚举），所以**必须投影一个能力位**。

给 `lockedTo` 补两个分支是第四次抄规则，下一个锁色技能（宝藏★ 的变色分支）
还会错第四次。所以：投影 `requiredColor`，**删掉 `lockedTo`**。

---

## 2. 需求①：报错落在粘性底坞下方

`app/game/[code]/page.tsx:326`：

```tsx
{error && <p className="wrap hint" role="alert" style={{ color: "var(--danger-text)" }}>{error}</p>}
```

它在 JSX 里排在 `<Dock>` **之后**，而 `.dockwrap` 是 `position: sticky; bottom: 0`
（`globals.css:536`），`.table` 是 `flex: 1 0 auto`（不压缩，靠页面滚动）。
于是这个 `<p>` 落在文档流里粘性底坞的**下方**——手机上它在折线以外，
要一路滚到页面最底才看得见。这就是反馈里的现象。

另一层问题：`lib/game-channel.ts` 把两类性质不同的错误合成了同一个字符串。

| 来源 | 性质 | 现在的处置 |
|---|---|---|
| `send()` 被拒（400） | 一次性，玩家点出来的 | 同一个 `<p>` |
| `pull()` 失败 / 409 | **牌面可能是陈的**，关掉之后页面还在骗人 | 同一个 `<p>` |

而且 `useGameChannel` 现在 `return { snapshot, error, loaded, send }`——**没有清除入口**，
错误只有等下一次 `send()` 才被冲掉。改成弹窗必须顺手解决「怎么关」。

---

## 3. Spec

### S1 · 定色锁收敛为单一真相

**S1.1** `ClientSnapshot` 新增投影字段：

```ts
/**
 * 你为一张**无色牌**定色时必须选的颜色；null = 四色随便选。
 * 三个来源（专精♥9③ 的专属色 / 五彩 / 吟游行进曲）在 `legal.ts::requiredColor`
 * 里已分好优先级，这里原样投影——客户端不再自己认技能与状态。
 * **只管无色牌**：并列 4 张同数的定色不是「使用变色牌」，引擎那边也不锁。
 */
wildColorLock: Color | null;
```

`projectView` 填 `b ? requiredColor(b, seat) : null`。

字段名带 `wild` 是刻意的：把「只作用于无色牌」写进契约名，
客户端那道 `card.color === null` 判断就成了**读契约**而不是抄规则。

**S1.2 无泄露论证**（写进注释，同 `marksCap` 的先例）：三个来源全是公开信息——
专精色存在公开的 `Board.chosen`、五彩是公开状态、行进曲是当众选的歌；
且只投**你自己**那一个值。

**S1.3** `page.tsx` 删掉 `lockedTo`，两个 `pickColor` 分支改读：

```ts
lockedTo: card.color === null ? snapshot.wildColorLock : null
```

**S1.4** 单色时**仍需点一下确认，不自动提交**。定色是 `playCards` 的一部分，
自动提交等于玩家没确认就出了牌；且「先不打这张」必须一直可达。
这也是五彩现在的既有行为，保持不变。

**S1.5** 两处写死「五彩」的文案改成不点名来源：

- `lib/api.ts` 的 `color_locked`
- `components/game/dock-slots.tsx` 的 `.colors` aria-label

> `color_locked` 这条拒因**不删**——它仍是信任边界的硬拒（客户端可伪造 `chosenColor`）。
> S1 消灭的是「正常 UI 打得出它」，不是它本身。

### S2 · 报错改弹窗

**S2.1** `useGameChannel` 暴露 `clearError`，并把 `error` 升成带来源的对象：

```ts
type ChannelError = { text: string; kind: "action" | "sync" };
```

`send()` 的拒绝 → `action`；`pull()` 失败与 409 → `sync`。

**S2.2** 复用现成的 `<Modal>`，不新造组件——原生 `<dialog>` 的 focus trap /
Esc / 背景 inert 全是白送的（spec §7.1）。加一个 `.modal--error` 变体类。

**S2.3** 两种来源两种出口：

| kind | 按钮 | 关法 |
|---|---|---|
| `action` | 「知道了」 | Esc / 点遮罩 / 按钮 |
| `sync` | 「重新载入牌面」（调 `pull()`）+「知道了」 | 同上 |

**S2.4** `role="alertdialog"` 盖掉原生 `<dialog>` 的 `role="dialog"`——这是报错不是普通对话框。

**S2.5** 删掉 `page.tsx` 底部那个 `<p>`。

**S2.6 不自动关闭。** 报错要玩家确认过。倒计时窗口挂着时它会挡住操作一瞬——
可接受：错误只在玩家刚点过之后出现，且 `claimTimeout` 由定时器发，模态挡不住它。

**S2.7 范围只限对局页。** 大厅（`lobby-forms.tsx`）、房间（`room/[code]/page.tsx`）、
登录（`login/page.tsx`）、终局（`game-over.tsx`）四处**不动**——
它们都紧贴触发自己的那个按钮，不存在「看不见」的问题，
套弹窗只会把一次失败的登录变成两次点击。

### S3 · 测试

**引擎**（`project-view.test.ts`）：

- 专精♥9 已亮出 → `wildColorLock` = 他的专属色
- 五彩 → 跟色
- 行进曲生效 → 跟色
- 跟色未定（开局翻出无色牌）→ `null`
- 专精 + 行进曲同时在场 → **专精色**（验证优先级随投影一起过来）
- 三个来源在封印期间（01-P9 / 06-Q65）各自失效 → `null`

**Web**：

- `wildColorLock` 非空 → `.colors` 只渲染 1 个按钮且就是那个色
- 为 null → 渲染 4 个
- **反向断言**：带五彩但打的是并列 4 张同数（有色牌）→ 仍渲染 4 个
- 错误弹窗：`action` 出现「知道了」；`sync` 出现「重新载入牌面」；
  关闭后 `clearError` 被调用；页面底部不再有那个 `<p>`

### S4 · 验收

改完之后，「变色牌能定成哪些色」这件事在客户端**一处判断都没有**：

```
grep -n '五彩\|行进曲' apps/web/app apps/web/components
```

应只剩文案与百科条目，不剩任何合法性分支。新增第四个锁色技能时前端零改动。
