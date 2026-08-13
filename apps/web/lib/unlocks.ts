"use client";

/**
 * 本局解锁的封泥（spec `2026-08-10-profile-stats-and-achievements` §5）。
 *
 * 解锁**只发生在终局那一帧**（§2：`tallyGame` 挂在 `phase === "finished"` 上），
 * 而那一帧同时会挂起 `<GameOver>` 那个原生 `<dialog>`——它在 top layer，背景整个 inert。
 * 所以这份数据的消费者是收场弹窗，不是坞上的浮报（见 §5 的 2026-08-13 改判）。
 *
 * 事件本身早就流到客户端了（`room-log.ts` 的增量拉取），但那份被 `humanize` 压成了一句话、
 * 丢掉了 id。这里另拉一次 `room_events`：**只在终局跑一次**，不是订阅、没有轮询。
 */

import type { ClientSnapshot } from "@roft/engine";
import { useEffect, useState } from "react";
import { createClient } from "./supabase/client";

/** `achievement_defs` 里渲染要用的那几列。 */
export interface Seal {
  id: string;
  /** 凡 / 玄 / 天 / 神。品级色与 profile 页同一套（`.overseal[data-tier]`）。 */
  tier: string;
  /** 封泥上刻的那一个字。 */
  mark: string;
  name: string;
}

/**
 * 这一局里属于**我**的解锁 id。`achievementUnlocked` 是每人一条（`{ seat, ids }`），
 * 所以要按座位挑；重开会把 `room_events` 整个删掉（`restart_room`），不会串到上一局。
 *
 * 与 `humanize` 同一条规矩：**payload 缺字段 / 改形状也不许抛**——
 * 这份数据渲染在收场弹窗里，抛一次就是「打完一局什么都看不见」。
 */
export function myUnlockedIds(rows: { public_payload: Record<string, unknown> | null }[], seat: number): string[] {
  const mine = rows.filter((r) => r.public_payload?.seat === seat);
  const ids = mine.flatMap((r) => (Array.isArray(r.public_payload!.ids) ? (r.public_payload!.ids as unknown[]) : []));
  return [...new Set(ids.map(String))];
}

/** 终局那一刻拉一次：我这一局解了哪几枚。没解锁 / 没终局都是空数组。 */
export function useMyUnlocks(roomId: string | null | undefined, snapshot: ClientSnapshot | null): Seal[] {
  const [seals, setSeals] = useState<Seal[]>([]);
  const finished = snapshot?.phase === "finished";
  const seat = snapshot?.youSeat;

  useEffect(() => {
    if (!roomId || !finished || seat === undefined) return;
    (async () => {
      const supabase = createClient();
      const { data: rows } = await supabase
        .from("room_events")
        .select("public_payload")
        .eq("room_id", roomId)
        .eq("type", "achievementUnlocked");
      const ids = myUnlockedIds(rows ?? [], seat);
      if (!ids.length) return;
      // 名字与品级只有 `achievement_defs` 有（表存描述、代码存规则，§3.2）
      const { data: defs } = await supabase
        .from("achievement_defs")
        .select("id, tier, mark, name")
        .in("id", ids)
        .order("sort");
      setSeals((defs ?? []) as Seal[]);
    })();
  }, [roomId, finished, seat]);

  return seals;
}
