"use client";

import type { Card, Color } from "@roft/engine";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ColorSheet } from "@/components/game/color-sheet";
import { DraftSheet } from "@/components/game/draft-sheet";
import { Hud } from "@/components/game/hud";
import { isWildCard } from "@/lib/cards";
import { FIXTURES, FIXTURE_NAMES, fixtureDWild, fixtureDraft, type FixtureKey } from "@/fixtures/snapshot";
import "./game.css";

// ponytail: 本 Task 只有 fixture 驱动的目检；Task 5 接上真快照时整段删掉。
export default function GamePage() {
  return (
    <Suspense>
      <FixtureGame />
    </Suspense>
  );
}

function FixtureGame() {
  const key = (useSearchParams().get("fixture") ?? "a") as FixtureKey;
  const snapshot = FIXTURES[key] ?? FIXTURES.a;
  const [wild, setWild] = useState<Card | null>(key === "d" ? fixtureDWild : null);
  const [log, setLog] = useState<string>("");

  function play(card: Card) {
    // 变色 / +4 先定色再提交——定色是客户端模态，不发请求。
    if (isWildCard(card)) setWild(card);
    else setLog(`playCards ${card.id}`);
  }

  return (
    <div className="game-page">
      <Hud
        snapshot={snapshot}
        names={FIXTURE_NAMES}
        onPlay={play}
        onAction={(a) => setLog(JSON.stringify(a))}
        onExpire={() => setLog("claimTimeout")}
      />
      {log && <p className="wrap hint">（fixture 目检：{log}）</p>}
      {wild && (
        <ColorSheet
          card={wild}
          onPick={(color: Color) => {
            setLog(`playCards ${wild.id} chosenColor=${color}`);
            setWild(null);
          }}
          onCancel={() => setWild(null)}
        />
      )}
      {snapshot.phase === "dealing" && <DraftSheet options={fixtureDraft} />}
    </div>
  );
}
