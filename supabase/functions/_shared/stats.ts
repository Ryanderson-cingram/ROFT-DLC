import type { ApplyResult, EngineEvent } from "../../../packages/engine/src/index.ts";
import {
  ACHIEVEMENTS,
  evaluate,
  mergePrior,
  hourIn,
  sliceCurrentGame,
  tallyGame,
  type PlayerStats,
} from "../../../packages/stats/src/index.ts";
import type { SupabaseClient } from "./db.ts";

/**
 * 一局的事件条数上限。PostgREST 默认会截断，截断了 tally 就静默算少——
 * 所以显式给一个远高于实际的值：fuzz 里一局平均 ~150 条事件，最长的也没到 800。
 * 真撞上这个数说明有别的问题（重开没清干净？），那时候日志里会有一条告警。
 */
const MAX_EVENTS = 5000;

/** 传给 `apply_room_action` 的 `p_stats` 的一行。 */
export interface StatsRow {
  userId: string;
  stats: PlayerStats;
  unlocked: string[];
}

const KNOWN = new Set(ACHIEVEMENTS.map((a) => a.id));

/**
 * 终局那一步：把这一局碾成每个人的累计量与新解锁的成就。
 *
 * 返回 `{ rows, events }`——`rows` 塞进 RPC 的 `p_stats`，`events` 追加到这一次的
 * 事件流里（客户端的 `room-log.ts` 本来就在增量拉 `room_events`，所以局内弹窗
 * 不需要任何新通道）。
 *
 * **这一局的事件 = 库里已有的 + 这一次动作产生的**。后者还没写进库
 * （整个都在同一个事务里，RPC 还没调），所以要手动接上，否则终局那一手
 * （往往正是「打出最后一张」）会被漏掉。
 */
export async function tallyFinishedGame(
  svc: SupabaseClient,
  roomId: string,
  result: ApplyResult,
): Promise<{ rows: StatsRow[]; events: EngineEvent[] }> {
  const seats = result.state.seats ?? [];
  if (seats.length === 0) return { rows: [], events: [] };

  const { data: stored, error } = await svc
    .from("room_events")
    .select("type, public_payload")
    .eq("room_id", roomId)
    .order("seq", { ascending: true })
    .limit(MAX_EVENTS);
  if (error) throw error;
  if (stored && stored.length >= MAX_EVENTS)
    console.warn(`tallyFinishedGame: room ${roomId} 的事件条数撞到上限 ${MAX_EVENTS}，统计可能算少`);

  const history: EngineEvent[] = (stored ?? []).map((r) => ({
    type: r.type as string,
    public: (r.public_payload ?? {}) as Record<string, unknown>,
  }));
  // 房间可以重开，`room_events` 会一直往后追加——只算最后一局
  const events = sliceCurrentGame([...history, ...result.events]);

  // 「守夜人」按牌局的统一时区判，不看玩家当地时间（2026-08-11 拍板）。
  // 容器跑在 UTC，直接 getHours() 会把「深夜」算成悉尼的上午 10 点。
  const tallied = tallyGame(events, result.state, hourIn(new Date()));
  const userIds = seats.map((s) => s.userId).filter(Boolean);

  // 两条读并发跑：一条拿此前的累计量，一条拿已经有的成就（去重的唯一口径）
  const [priorRes, ownedRes] = await Promise.all([
    svc.from("player_stats").select("user_id, stats").in("user_id", userIds),
    svc.from("player_achievements").select("user_id, achievement_id").in("user_id", userIds),
  ]);
  if (priorRes.error) throw priorRes.error;
  if (ownedRes.error) throw ownedRes.error;

  const priorOf = new Map<string, Partial<PlayerStats>>(
    (priorRes.data ?? []).map((r) => [r.user_id as string, (r.stats ?? {}) as Partial<PlayerStats>]),
  );
  const ownedOf = new Map<string, Set<string>>();
  for (const r of ownedRes.data ?? []) {
    const set = ownedOf.get(r.user_id as string) ?? new Set<string>();
    set.add(r.achievement_id as string);
    ownedOf.set(r.user_id as string, set);
  }

  const rows: StatsRow[] = [];
  const events_out: EngineEvent[] = [];
  for (const [seat, { delta, flags }] of tallied) {
    const userId = seats[seat]?.userId;
    if (!userId) continue;

    // 合并只此一份（TypeScript）——库那边只是把算好的整份放进去，见 0006 的表注释
    // mergePrior 自己会跟 emptyStats() 铺底，残缺的老行不会算出 NaN
    const next = mergePrior(priorOf.get(userId) ?? {}, delta, flags.won);
    const owned = ownedOf.get(userId) ?? new Set<string>();
    // `KNOWN` 过滤挡的是「表里有、代码里被删了」的历史 id：它们不该再算作已拥有，
    // 更不该被当成新解锁写回去（外键会拒，整个事务跟着炸）
    const unlocked = evaluate(next, flags, owned).filter((id) => KNOWN.has(id));

    rows.push({ userId, stats: next, unlocked });
    // 一个人一条，没解锁的不发——空的 toast 是噪音
    if (unlocked.length > 0)
      events_out.push({ type: "achievementUnlocked", public: { seat, ids: unlocked } });
  }
  return { rows, events: events_out };
}
