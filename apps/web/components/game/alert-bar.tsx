"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  text: string;
  deadline: string;
  /** 反应窗口（非惩罚）用紫色一档，跟惩罚区分开。 */
  tone?: "punish" | "react";
  /** 到点自动催促服务端按 defaultChoice 结算（spec §7）。 */
  onExpire?: () => void;
};

const secondsLeft = (deadline: string) => Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1000));

export function AlertBar({ text, deadline, tone = "punish", onExpire }: Props) {
  // 服务端预渲染时秒数必然和客户端对不上（时间在走），所以挂载前不显示数字。
  const [left, setLeft] = useState<number | null>(null);
  // 进度条的分母 = 第一次看到这个窗口时的剩余秒数（中途进来也有个像样的比例）
  const total = useRef(Math.max(1, secondsLeft(deadline)));
  const fired = useRef<string | null>(null);
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    total.current = Math.max(1, secondsLeft(deadline));
    setLeft(secondsLeft(deadline));
    const tick = setInterval(() => {
      const n = secondsLeft(deadline);
      setLeft(n);
      // 每个窗口只催一次；谁先到谁生效，服务端有乐观锁兜底
      if (n === 0 && fired.current !== deadline) {
        fired.current = deadline;
        expire.current?.();
      }
    }, 250);
    return () => clearInterval(tick);
  }, [deadline]);

  return (
    <div className={`alertbar${tone === "react" ? " alertbar--react" : ""}`}>
      <p>
        {text} · <span className="secs">{left ?? "—"}s</span>
      </p>
      <div className="timer">
        <i style={{ width: `${left === null ? 100 : Math.min(100, (left / total.current) * 100)}%` }} />
      </div>
    </div>
  );
}
