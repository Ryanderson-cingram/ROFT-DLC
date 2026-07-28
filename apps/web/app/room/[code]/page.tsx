"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { callEdge, humanReason } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import "./room.css";

const SEATS = [0, 1, 2, 3];

type Room = { id: string; code: string; status: string; created_by: string; config: { rulePack: string } };
type SeatRow = { seat: number; user_id: string; ready: boolean };

export default function RoomPage() {
  const router = useRouter();
  const code = String(useParams().code ?? "").toUpperCase();
  const supabase = useMemo(() => createClient(), []);

  const [me, setMe] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [seats, setSeats] = useState<SeatRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [online, setOnline] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadSeats = useCallback(
    async (roomId: string) => {
      const { data } = await supabase
        .from("room_seats")
        .select("seat, user_id, ready")
        .eq("room_id", roomId)
        .order("seat");
      const rows = (data ?? []) as SeatRow[];
      setSeats(rows);
      const { data: people } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", rows.map((r) => r.user_id));
      setNames(Object.fromEntries((people ?? []).map((p) => [p.id, p.username])));
    },
    [supabase],
  );

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/login");
        return;
      }
      setMe(auth.user.id);

      const { data: found } = await supabase
        .from("rooms")
        .select("id, code, status, created_by, config")
        .eq("code", code)
        .maybeSingle();
      setLoaded(true);
      if (!found) return;
      const r = found as Room;
      setRoom(r);
      if (r.status === "playing") router.replace(`/game/${code}`);
      await loadSeats(r.id);
    })();
  }, [code, loadSeats, router, supabase]);

  // 订阅单独一个 effect：频道必须同步建好，cleanup 才一定拿得到它。
  // 建在 await 后面的话，StrictMode 的二次挂载会在第一个频道被登记前就 cleanup，
  // 同 topic 于是订了两次 → 「mismatch between server and client bindings」。
  const roomId = room?.id;
  useEffect(() => {
    if (!roomId || !me) return;
    const channel = supabase
      .channel(`lobby:${roomId}`, { config: { presence: { key: me } } })
      // 座位与准备状态走 Postgres Changes：等候室不是对局主路径（spec §3.2 只禁
      // 拿它做对局主路径），一张 4 行的表订阅比再造一套广播便宜。收到就重拉，不信增量。
      .on("postgres_changes", { event: "*", schema: "public", table: "room_seats", filter: `room_id=eq.${roomId}` },
        () => loadSeats(roomId))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        ({ new: row }) => {
          const next = row as Room;
          setRoom((prev) => (prev ? { ...prev, status: next.status } : prev));
          if (next.status === "playing") router.push(`/game/${code}`);
        })
      .on("presence", { event: "sync" }, () => setOnline(Object.keys(channel.presenceState())))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") channel.track({ at: Date.now() });
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, me, code, loadSeats, router, supabase]);

  const isHost = !!room && room.created_by === me;
  const hostName = room ? names[room.created_by] : undefined;
  const mySeat = seats.find((s) => s.user_id === me);
  // 房主不用自己按准备：他按的是「开始游戏」。
  const readyCount = seats.filter((s) => s.ready || s.user_id === room?.created_by).length;
  const canStart = seats.length >= 3 && readyCount === seats.length;
  const notReady = seats.filter((s) => !s.ready && s.user_id !== room?.created_by)
    .map((s) => names[s.user_id]).filter(Boolean);

  async function toggleReady() {
    setError(null);
    const res = await callEdge("toggle-ready", { roomId: room!.id, ready: !mySeat?.ready });
    if (!res.ok) setError(humanReason(res.reason));
  }

  async function startGame() {
    setError(null);
    const res = await callEdge("room-action", {
      roomId: room!.id,
      expectedVersion: 0,
      idempotencyKey: crypto.randomUUID(),
      action: { type: "startGame", seat: mySeat?.seat ?? 0 },
    });
    if (!res.ok) setError(humanReason(res.reason));
    else router.push(`/game/${code}`);
  }

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!loaded) return <main className="wrap">载入中…</main>;
  if (!room)
    return (
      <main className="wrap stack">
        <h1>没找到这一桌</h1>
        <p className="hint">房间码 {code} 不存在，或者你不在这一桌。</p>
        <p>
          <Link href="/">← 回大厅</Link>
        </p>
      </main>
    );

  return (
    <div className="room-page">
      <header className="topbar">
        <Link href="/">← 大厅</Link>
        <b>等候室</b>
        <span className="hint">{seats.length} 人在座</span>
      </header>

      <main className="wrap stack">
        <section className="code-hero">
          <p className="eyebrow">房间码</p>
          <strong className="code">{room.code}</strong>
          <button className="btn" onClick={copyCode}>
            {copied ? "已复制" : "复制房间码"}
          </button>
          <p className="hint">把这 6 位发给朋友，他们在大厅输入即可入座。</p>
        </section>

        <section>
          <h2>座位</h2>
          <hr className="rail" />
          <div className="seats">
            {SEATS.map((i) => {
              const seat = seats.find((s) => s.seat === i);
              if (!seat)
                return (
                  <div className="seat seat--empty" key={i}>
                    <span className="no">座位 {i + 1}</span>
                    <span>空位</span>
                    {i === seats.length && <small className="hint">再来一人就能凑满四人桌</small>}
                  </div>
                );
              const isOnline = online.includes(seat.user_id);
              const ready = seat.ready || seat.user_id === room.created_by;
              return (
                <div className={`seat${seat.user_id === me ? " seat--self" : ""}`} key={i}>
                  <span className="no">座位 {i + 1}</span>
                  <span className="who">
                    <span className={`dot${isOnline ? "" : " dot--off"}`} />
                    {names[seat.user_id] ?? "…"}
                  </span>
                  <span className="tags">
                    {seat.user_id === room.created_by && <span className="badge">房主</span>}
                    <span className="badge" data-tone={ready ? "ok" : "warn"}>
                      {ready ? "已准备" : "未准备"}
                    </span>
                    {!isOnline && <span className="badge">离线</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">本桌规则 · 开局后不可改</p>
          <div className="summary">
            <div>
              <span>规则包</span>
              {room.config.rulePack === "gods" ? "诸神包" : "基础包"}
            </div>
            <div>
              <span>技能获取</span>抽 3 选 1
            </div>
            <div>
              <span>人数</span>3–4 人
            </div>
          </div>
        </section>

        {error && (
          <p className="hint" role="alert" style={{ color: "var(--danger-text)" }}>
            {error}
          </p>
        )}
      </main>

      <div className="actionbar">
        <div className="inner">
          {isHost ? (
            <>
              <button className="btn btn--primary" disabled={!canStart} onClick={startGame}>
                开始游戏（{readyCount}/{seats.length} 已准备）
              </button>
              <p className="hint">
                {seats.length < 3
                  ? "3 人才能开桌，还差人。"
                  : notReady.length
                    ? `等${notReady.join("、")}准备好就能开桌。`
                    : "都准备好了，可以开桌。"}
              </p>
            </>
          ) : (
            <>
              <button className="btn btn--primary" onClick={toggleReady}>
                {mySeat?.ready ? "取消准备" : "准备"}
              </button>
              <p className="hint">房主是{hostName ?? "…"}，等他开桌。</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
