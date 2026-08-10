import { createClient } from "./supabase/client";

/** crypto.randomUUID 只在安全上下文（HTTPS/localhost）存在；内网用 http://IP 访问时没有，退到 getRandomValues 手拼 v4。 */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type EdgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; reason: string };

/**
 * 这次失败**值不值得用同一个 idempotencyKey 再来一次**。
 *
 * ⚠️ 只对带幂等键的请求开。没有键的重试会重复下单——`create-room` 会多开一个房间。
 * 现在只有 `game-channel.ts::send`（room-action）满足条件。
 *
 * - `0`：没拿到响应。可能压根没发出去，**也可能是服务端已经提交、回程丢了**
 *   （Wi-Fi 掉线、切后台、代理超时）。两种都靠幂等键收口——服务端认出这个 key
 *   就把第一次的结果还回来（room-action 的幂等预检查）。
 * - `429`：被限流，等一下就好。
 * - `5xx`：网关 / 冷启动 / 运行时重启。动作本身还没被裁决过。
 *
 * 其余 4xx 是**确定性**拒绝——「还没轮到你」重试一万次也是同一个答案，
 * 重试只会让用户多等。
 */
export const shouldRetry = (status: number) => status === 0 || status === 429 || status >= 500;

/**
 * 打 Edge Function。用裸 fetch 而不是 functions.invoke，是因为 409/400 的
 * 状态码与 reason 都要原样交给调用方——冲突要拉快照，非法动作要显示人话。
 */
export async function callEdge<T>(name: string, body: object): Promise<EdgeResult<T>> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  let res: Response;
  try {
    res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // status 0 = 根本没到服务端。调用方可以带同一个 idempotencyKey 安全重试。
    return { ok: false, status: 0, reason: "network" };
  }
  const payload = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data: payload as T };
  return { ok: false, status: res.status, reason: payload.reason ?? payload.error ?? "unknown" };
}

/**
 * 服务端 reason → 人话。查不到的原样显示，总好过一句「出错了」。
 *
 * 全集来源：`grep 'reject(' packages/engine/src`（拒因字符串）+ `index.ts::malformed`
 * 的形状校验 + `supabase/functions/*` 的编排层错误。这是 L2 的**唯一**落点：
 * 按钮由 legalActions 生成，不可用的动作根本不渲染，所以「点了被拒」才需要人话
 * （spec §4.4，不做引擎侧 disabledReasons）。
 */
const SAYINGS: Record<string, string> = {
  // —— 编排层（Edge Function / 大厅）——
  room_not_found: "没找到这个房间，房间码再核对一下。",
  room_full: "这一桌已经满 4 人了。",
  already_started: "这一桌已经开局了，进不去。",
  seat_taken: "座位刚被别人占了，再点一次。",
  not_a_member: "你不在这一桌。",
  not_the_host: "只有房主能开桌。",
  bad_seat_count: "3–4 人才能开桌。",
  not_in_lobby: "这一桌已经开过局了。",
  game_in_progress: "对局还没结束，现在不能退出房间。",
  version_conflict: "桌面刚变过，重新看一眼再操作。",
  network: "网络没通，检查一下再试。",
  unauthenticated: "登录过期了，重新进一次。",

  // —— 轮次与阶段 ——
  not_started: "这一桌还没开局。",
  not_your_turn: "还没轮到你。",
  wrong_phase: "这个阶段不能做这件事。",
  not_turn_start: "这个技能只能在回合开始阶段发动。",
  pending_window: "有人正在响应窗口里，等一下。",

  // —— 出牌 ——
  illegal_card: "这张牌接不上牌顶。",
  not_in_hand: "你手里没有这张牌。",
  single_card_only: "一次只能打一张——多张要靠并列，而且得先亮出来。",
  bad_shape: "这几张凑不成并列：2 张同色同数 / 4 张同数 / 6 张同色，且都得是数字牌。",
  color_required: "打变色牌要先选颜色。",
  color_not_allowed: "这一手不用选颜色（有色牌自带颜色）。",
  // 锁色有三个来源（专精♥9 的专属色 / 五彩 / 吟游行进曲），所以这句**不点名**——
  // 点名了就有三分之二的场合在说谎。正常 UI 打不出这条：坞里本来就只画得出那一个色块
  // （快照的 `wildColorLock`），这里是伪造 chosenColor 时的信任边界兜底。
  color_locked: "这张牌的颜色被锁住了，只能定成高亮的那个色。",
  shuffle_choice_required: "打洗牌牌要先挑卡面上的那一项。",
  shuffle_choice_not_allowed: "只有洗牌牌才挑卡面选项。",
  assault_unavailable: "现在用不了强袭的掷骰打法。",

  // —— 惩罚链 ——
  must_stack: "被叠住了：只能接惩罚牌，或者吃下。",
  cannot_stack: "你手里没有能接的惩罚牌，只能吃下。",
  no_punish: "现在没有惩罚链。",

  // —— 摸牌与结束回合 ——
  must_draw_first: "先摸一张牌才能结束回合。",
  must_play_drawn_or_end: "这一回合只能打刚摸到的那张，或者结束回合。",
  already_drawn: "这一回合已经摸过牌了。",
  deck_empty: "牌堆空了，摸不到牌。",

  // —— UNO（U6/U7）——
  // 「喊不了」这条拒因没有了：U6 改判后引擎不拦资格，按下即受理，手牌不是 1 张就虚喊罚摸 2 张
  // （`unoMiscalled` 是**事件**，不是拒因——人话在 lib/room-log.ts）。
  already_said: "你已经喊过 UNO 了。",
  not_catchable: "抓不了：对方不是 1 张、已经喊过，或者还在他自己的回合里（宽限期）。",
  // U7b：交回合后那 1 秒是给他补喊的（防秒抓）。正常不会看到这句——按钮那时压根没画出来
  uno_grace: "还太早：他刚交出回合，有 1 秒补喊时间。",

  // —— 技能 ——
  no_skill: "你还没有技能。",
  // V2b（2026-08-08）：`reveal_when` 是主动亮出的门槛（目前只有神授♥5 的手牌 ≥10）
  reveal_condition_unmet: "还没到亮出条件（手牌要有 10 张）。",
  not_revealed: "技能要先亮出来才能用。",
  already_revealed: "技能已经亮出来了。",
  not_active: "这条是被动，不用发动。",
  already_activated: "这一回合已经发动过主动技能了。",
  already_used: "这条技能是一次性的，已经用过了。",
  suppressed: "技能被封住了，现在用不了。",
  cost_unpayable: "付不起代价，发动不了（发动机会不消耗）。",
  no_target: "现在没有可选的目标。",
  bad_target: "这个目标不对。",
  declaration_required: "要先当众指定一张牌。",
  bad_declaration: "指定的这张牌不合规（限数字牌）。",
  skill_unavailable: "这条技能现在用不了。",
  unknown_effect: "没有这条技能效果。",
  not_implemented: "这条技能还没做完。",

  // —— 响应窗口 ——
  no_window: "这个窗口已经不在了。",
  not_your_window: "这个窗口不等你响应。",
  stale_window: "这个窗口已经结算过了。",
  unknown_window: "窗口对不上，刷新一下再看。",
  unsupported_window: "这条技能不能在这个窗口里用。",
  bad_choice: "这个选项不合法。",
  not_yet_expired: "还没到时间。",

  // —— 形状校验（index.ts::malformed，正常 UI 打不出来）——
  unknown_action: "这个操作服务端不认识。",
  invalid_seat: "座位号不对。",
  bad_card_ids: "牌的编号不对。",
  bad_color: "颜色不对。",
  bad_shuffle_choice: "洗牌选项不对。",
};

export const humanReason = (reason: string) => SAYINGS[reason] ?? `操作没成功（${reason}）`;
