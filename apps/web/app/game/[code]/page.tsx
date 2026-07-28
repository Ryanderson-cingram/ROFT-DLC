"use client";

import type { Card, Color } from "@roft/engine";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ColorSheet } from "@/components/game/color-sheet";
import { DraftSheet } from "@/components/game/draft-sheet";
import { Hud } from "@/components/game/hud";
import { isWildCard } from "@/lib/cards";
import { useGameChannel } from "@/lib/game-channel";
import { createClient } from "@/lib/supabase/client";
import "./game.css";

export default function GamePage() {
  const router = useRouter();
  const code = String(useParams().code ?? "").toUpperCase();
  const supabase = useMemo(() => createClient(), []);

  const [roomId, setRoomId] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState(false);
  const [wild, setWild] = useState<Card | null>(null);

  const { snapshot, error, loaded, send } = useGameChannel(roomId);

  // 昵称不在快照里（展示数据不进规则层），自己从 room_seats join profiles 取。
  useEffect(() => {
    (async () => {
      const { data: room } = await supabase
        .from("rooms")
        .select("id, status")
        .eq("code", code)
        .maybeSingle();
      if (!room) {
        setMissing(true);
        return;
      }
      if (room.status === "lobby") {
        router.replace(`/room/${code}`);
        return;
      }
      setRoomId(room.id);
      const { data: seats } = await supabase.from("room_seats").select("user_id").eq("room_id", room.id);
      const { data: people } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", (seats ?? []).map((s) => s.user_id));
      setNames(Object.fromEntries((people ?? []).map((p) => [p.id, p.username])));
    })();
  }, [code, router, supabase]);

  if (missing)
    return (
      <main className="wrap stack">
        <h1>没找到这一桌</h1>
        <p className="hint">房间码 {code} 不存在，或者你不在这一桌。</p>
        <p>
          <Link href="/">← 回大厅</Link>
        </p>
      </main>
    );

  if (!snapshot)
    return (
      <main className="wrap stack">
        <p className="hint">{loaded ? (error ?? "这一桌还没开局。") : "载入牌桌…"}</p>
        <p>
          <Link href={`/room/${code}`}>← 回等候室</Link>
        </p>
      </main>
    );

  return (
    <div className="game-page">
      <Hud
        snapshot={snapshot}
        names={names}
        onPlay={(card) => {
          // 变色 / +4：先在本地定色，颜色随 playCards 一起提交，不额外发请求。
          if (isWildCard(card)) setWild(card);
          else send({ type: "playCards", seat: snapshot.youSeat, cardIds: [card.id] });
        }}
        onAction={(a) => send(a)}
        onExpire={() =>
          snapshot.windowId &&
          send({ type: "claimTimeout", seat: snapshot.youSeat, windowId: snapshot.windowId })
        }
      />
      {error && (
        <p className="wrap hint" role="alert" style={{ color: "var(--danger-text)" }}>
          {error}
        </p>
      )}
      {/* 开局抽技能：引擎本轮不会给出 dealing，这一段等技能计划落地才会亮。 */}
      {snapshot.phase === "dealing" && <DraftSheet />}
      {wild && (
        <ColorSheet
          card={wild}
          onPick={(color: Color) => {
            send({ type: "playCards", seat: snapshot.youSeat, cardIds: [wild.id], chosenColor: color });
            setWild(null);
          }}
          onCancel={() => setWild(null)}
        />
      )}
    </div>
  );
}
