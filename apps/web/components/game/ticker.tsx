"use client";

import type { ClientSnapshot } from "@roft/engine";
import { useRoomLog } from "@/lib/room-log";

type Props = {
  /** 没有房间 id（测试、还没查到房间）就不渲染——跑马灯不编造内容。 */
  roomId?: string | null;
  snapshot: ClientSnapshot;
  names: Record<string, string>;
};

/**
 * 轮转轨下沿的「最近一条」（design/mockups/game.html 的 `.ticker`）。
 * 与记录抽屉**同源**：都读 `room_events`，都走 `lib/room-log.ts::humanize`，
 * 所以不会出现「跑马灯说一套、抽屉说另一套」。
 */
export function Ticker({ roomId, snapshot, names }: Props) {
  const latest = useRoomLog(roomId, snapshot, names)[0];
  if (!latest) return null;
  return (
    // key：内容一换就重新挂载，令牌里 `.ticker` 的 rise 动画自然重播一次
    <p className="ticker" key={`${latest.line.who}${latest.line.what}`}>
      <span className="ticker__tag">最近</span>
      <b>{latest.line.who}</b>
      <span>{latest.line.what}</span>
    </p>
  );
}
