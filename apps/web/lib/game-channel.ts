"use client";

import type { Action, ClientSnapshot } from "@roft/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callEdge, humanReason } from "./api";
import { createClient } from "./supabase/client";

/** 铃铛 payload（0001 迁移的 notify_room_event 触发器发的）。 */
type Bell = { roomId: string; version: number; seq: number };

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
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // 版本放 ref：铃铛回调与轮询都要读最新值，不能吃闭包里的旧快照。
  const version = useRef(-1);
  const [linked, setLinked] = useState(false);

  const pull = useCallback(async () => {
    if (!roomId) return;
    const res = await callEdge<{ version: number; view: ClientSnapshot }>("get-snapshot", { roomId });
    setLoaded(true);
    if (!res.ok) {
      setError(humanReason(res.reason));
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
      const idempotencyKey = crypto.randomUUID();
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
      setError(res.status === 409 ? "桌面刚变过，看一眼再重来。" : humanReason(res.reason));
    },
    [roomId, pull],
  );

  return { snapshot, error, loaded, refresh: pull, send, clearError: () => setError(null) };
}
