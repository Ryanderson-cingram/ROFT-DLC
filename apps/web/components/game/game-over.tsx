"use client";

import type { ClientSnapshot } from "@roft/engine";
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { Modal } from "./modal";
import type { NameOf } from "@/lib/hud-copy";

/** 三轮、每轮八条，错开放。角度写死不随机——`Math.random()` 会让 SSR 与水合对不上。 */
const RAYS = 8;
const ROUNDS = 3;
const HUES = ["var(--piao)", "var(--warn)", "var(--zhu)", "var(--card-green)"];

/** 烟花：纯 CSS 粒子，位置由序号算死（`burst` 在 globals.css）。 */
function Fireworks() {
  return (
    <span className="fw" aria-hidden="true">
      {Array.from({ length: ROUNDS * RAYS }, (_, i) => {
        const ray = i % RAYS;
        const round = Math.floor(i / RAYS);
        const angle = (ray / RAYS) * 2 * Math.PI + round * 0.4;
        const dist = 74 + round * 26;
        return (
          <i
            key={i}
            style={
              {
                "--x": `${Math.round(Math.cos(angle) * dist)}px`,
                "--y": `${Math.round(Math.sin(angle) * dist)}px`,
                "--d": `${round * 0.45}s`,
                "--c": HUES[i % HUES.length],
              } as CSSProperties
            }
          />
        );
      })}
    </span>
  );
}

/**
 * 一局收场（`phase === "finished"`）。复用 `<Modal>` 那套原生 `<dialog>`：
 * focus trap / Esc / 背景 inert 全是浏览器给的。
 *
 * **不给 `onClose`**——牌局已经结束，这里没有「继续看牌桌」这条路，只有回大厅。
 * `winner` 缺席 = 平局（U8：洗满 2 次后牌堆再度见底且无人打完），不许写成「某人赢」。
 */
export function GameOver({
  snapshot: s,
  nameOf,
  onRestart,
}: {
  snapshot: ClientSnapshot;
  nameOf: NameOf;
  /** 原房间重开（房间号不变、人不动、上一局的记录清空）。缺席 = 只留「回大厅」那条路。 */
  onRestart?: () => void | Promise<void>;
}) {
  const draw = s.winner == null;
  const youWon = s.winner === s.youSeat;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restart = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRestart?.();
    } catch (e) {
      // 按钮不锁死：重开失败还能再点，也还能走「回大厅」
      setError(e instanceof Error ? e.message : "重开没成功，再试一次或者回大厅。");
      setBusy(false);
    }
  };

  return (
    <Modal className="modal--over" label="本局结束">
      <Fireworks />
      <div className="over">
        <p className="eyebrow">本局结束</p>
        <h2>{draw ? "平局" : youWon ? "你赢了" : `${nameOf(s.winner!)}赢了`}</h2>
        <p className="hint">
          {draw ?
            "牌堆洗满之后又见了底，没有人打完手牌。"
          : youWon ?
            "手牌清空，收工。"
          : "手牌被清空的是别人，下一局再说。"}
        </p>
        {onRestart && (
          <button type="button" className="btn btn--primary btn--block" disabled={busy} onClick={restart}>
            {busy ? "正在重开…" : "再开一局（本房间）"}
          </button>
        )}
        {/* 回大厅是次要出口：同一桌人多半想接着打，换人才需要回大厅重开房间 */}
        <Link className="btn btn--ghost btn--block" href="/">
          回大厅
        </Link>
        {error && (
          <p className="hint" role="alert" style={{ color: "var(--danger-text)" }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
