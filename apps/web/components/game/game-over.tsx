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
  onLeave,
  roomHref,
}: {
  snapshot: ClientSnapshot;
  nameOf: NameOf;
  /** 原房间重开（房间号不变、人不动、上一局的记录清空）。缺席 = 只留「回大厅」那条路。 */
  onRestart?: () => void | Promise<void>;
  /** 返回大厅 = **退出房间**（座位交还服务端，防幽灵座位），然后由它自己导航。缺席 = 退化成纯导航。 */
  onLeave?: () => void | Promise<void>;
  /** 返回房间（等候室）的链接。缺席 = 不给这条路。 */
  roomHref?: string;
}) {
  const draw = s.winner == null;
  const youWon = s.winner === s.youSeat;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 重开与退出共用一套 busy/error：两个都是「打一次服务端再走」，同时只会点一个
  const run = (fn?: () => void | Promise<void>, failText = "没成功，再试一次。") => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn?.();
    } catch (e) {
      // 按钮不锁死：失败还能再点，也还能走别的出口
      setError(e instanceof Error ? e.message : failText);
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
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={busy}
            onClick={run(onRestart, "重开没成功，再试一次或者回大厅。")}
          >
            再开一局（本房间）
          </button>
        )}
        {/* 返回房间 = 回等候室但**座位不动**：等别人决定重开，或在那边自己点重开 */}
        {roomHref && (
          <Link className="btn btn--ghost btn--block" href={roomHref}>
            返回房间（等候室）
          </Link>
        )}
        {/* 返回大厅 = 退出房间：座位交还服务端，防幽灵座位 */}
        {onLeave ? (
          <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={run(onLeave)}>
            返回大厅（退出房间）
          </button>
        ) : (
          <Link className="btn btn--ghost btn--block" href="/">
            回大厅
          </Link>
        )}
        {error && (
          <p className="hint" role="alert" style={{ color: "var(--danger-text)" }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
