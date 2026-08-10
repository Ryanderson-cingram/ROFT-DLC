"use client";

import type { Action, ClientSnapshot } from "@roft/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callEdge, humanReason, newIdempotencyKey } from "./api";
import { createClient } from "./supabase/client";

/** 铃铛 payload（0001 迁移的 notify_room_event 触发器发的）。 */
type Bell = { roomId: string; version: number; seq: number };

/**
 * 出错了，以及**这个错要不要担心牌面是不是陈的**。
 *
 * - `action`：你刚才那个动作被拒（引擎给的拒因）。一次性，关掉重来即可，牌面是新的。
 * - `sync`：拉快照失败，或撞上 409 版本冲突。**屏幕上的牌面可能已经过时**，
 *   所以这一档要多给一条「重新载入牌面」的出口，不能只让人关掉了事。
 *
 * 从前两者合成一个 `string`，于是「还没轮到你」和「牌面是陈的」长得一模一样。
 */
export type ChannelError = { text: string; kind: "action" | "sync" };

const POLL_LINKED_MS = 30_000;
const POLL_UNLINKED_MS = 3_000;

/**
 * 对局的数据链路：铃铛 → 拉快照。
 *
 * Realtime 不是真相，Postgres 才是（spec §3.2），所以铃铛只当「去拉一次」的信号，
 * 内容一律来自 get-snapshot。官方明言 Broadcast 不保证送达，于是有三道兜底：
 * 轮询本房 version、回前台必拉、（重）订阅成功必拉。
 *
 * 轮询频率随铃铛状态变：铃铛通着就 30s（spec §3.2 的低频兜底），铃铛断着
 * （TIMED_OUT / CHANNEL_ERROR，实测在房间页→对局页切换时会撞上）就 3s，
 * 免得整桌人对着 30s 的陈旧牌面干等。
 */
export function useGameChannel(roomId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [snapshot, setSnapshot] = useState<ClientSnapshot | null>(null);
  const [error, setError] = useState<ChannelError | null>(null);
  const [loaded, setLoaded] = useState(false);
  // 版本放 ref：铃铛回调与轮询都要读最新值，不能吃闭包里的旧快照。
  const version = useRef(-1);
  const [linked, setLinked] = useState(false);

  const pull = useCallback(async () => {
    if (!roomId) return;
    const res = await callEdge<{ version: number; view: ClientSnapshot }>("get-snapshot", { roomId });
    setLoaded(true);
    if (!res.ok) {
      // 拉不到快照 = 屏幕上的牌面就是此刻能拿到的全部，且可能是陈的
      setError({ text: humanReason(res.reason), kind: "sync" });
      return;
    }
    version.current = res.data.version;
    setSnapshot(res.data.view);
  }, [roomId]);

  useEffect(() => {
    pull();
  }, [pull]);

  useEffect(() => {
    if (!roomId) return;
    const channel = supabase
      .channel(`room:${roomId}`)
      .on("broadcast", { event: "bell" }, ({ payload }: { payload: Bell }) => {
        // 只在落后时才拉：自己动作的回声会带回同一个 version，不必重复请求。
        if (payload.version > version.current) pull();
      })
      // 重连成功必拉：断线期间漏掉的铃铛没人补发。
      .subscribe((status) => {
        setLinked(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") pull();
      });
    return () => {
      setLinked(false);
      supabase.removeChannel(channel);
    };
  }, [roomId, pull, supabase]);

  useEffect(() => {
    if (!roomId) return;
    const poll = setInterval(async () => {
      const { data } = await supabase.from("rooms").select("version").eq("id", roomId).maybeSingle();
      if (data && data.version > version.current) pull();
    }, linked ? POLL_LINKED_MS : POLL_UNLINKED_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") pull();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [roomId, pull, supabase, linked]);

  const send = useCallback(
    async (action: Action) => {
      if (!roomId) return;
      setError(null);
      // 同一次意图复用同一个 key：只有这样重试才安全，服务端会还回第一次的结果。
      const idempotencyKey = newIdempotencyKey();
      const post = () =>
        callEdge<{ version: number }>("room-action", {
          roomId,
          expectedVersion: version.current,
          idempotencyKey,
          action,
        });

      let res = await post();
      if (!res.ok && res.status === 0) res = await post(); // 没到服务端，同 key 再来一次

      if (res.ok) {
        await pull();
        return;
      }
      // 409：状态已经变了，原动作可能已经非法 —— 拉新快照让用户自己看，不自动重放。
      await pull();
      // 409 归 sync：它说的正是「你看到的牌面已经不是现在的牌面」
      setError(
        res.status === 409
          ? { text: "桌面刚变过，看一眼再重来。", kind: "sync" }
          : { text: humanReason(res.reason), kind: "action" },
      );
    },
    [roomId, pull],
  );

  // 弹窗关掉时清空。`pull` 一并给出去：`sync` 那一档的「重新载入牌面」要用它
  const clearError = useCallback(() => setError(null), []);

  return { snapshot, error, loaded, send, clearError, reload: pull };
}
