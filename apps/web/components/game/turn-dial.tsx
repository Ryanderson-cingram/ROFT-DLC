"use client";

import type { ClientSnapshot, SnapshotPlayer } from "@roft/engine";
import { type ReactNode, useEffect, useRef } from "react";
import type { NameOf } from "@/lib/hud-copy";
import { skillById } from "@/lib/skills";
import { useBump } from "@/lib/use-bump";

type Props = {
  snapshot: ClientSnapshot;
  nameOf: NameOf;
  /** 技能徽（每个人的都可点）。P3 接技能弹窗，本阶段只把座位号透出去。 */
  onSkillClick?: (seat: number) => void;
  /** 升起面板开着时整条轨关掉（见 `<GameTable>` 的 `inert`）。 */
  inert?: boolean;
  /** 跑马灯：设计稿里 `.ticker` 就长在 `.dial` 的下沿（轨的最后一行）。 */
  children?: ReactNode;
};

/**
 * 轮转轨（design/mockups/game.html 的 `<nav class="dial">`）——顺序 / 当前行动者 /
 * 方向 / 每个人的技能徽全挂在这一条上。
 *
 * 与旧 `.opponents` 的关键差别：**座位含自己**。少了自己那一格，「我在谁后面、
 * 下一个轮到谁」这条最基本的信息就得靠脑补（第 1 条 UI 反馈）。
 *
 * 客户端零规则：这里画的每一项都直接来自快照，抓漏喊按钮的有无一律看 `legalActions`。
 */
export function TurnDial({ snapshot: s, nameOf, onSkillClick, inert, children }: Props) {
  const nowRef = useRef<HTMLLIElement>(null);

  // 窄屏轨是横滚的：当前行动者换人之后把他带回视口，不然「轮到谁」要靠手划才看得见
  useEffect(() => {
    // `?.()`：jsdom 没实现 scrollIntoView，测试环境里静默跳过
    nowRef.current?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [s.currentSeat]);

  return (
    // 方向原本在轨下另起一条「↻ 顺时针」，占掉一整行只说一个词。现在雪佛龙放大到看得清，
    // 方向本身进 `aria-label`——它是这条轨的属性，读屏进来就听得到，不必占版面（spec §7.7
    // 要的是「箭头之外还有文本替代」，可及名同样算）。
    <nav
      className="dial"
      data-dir={s.direction === -1 ? "ccw" : "cw"}
      aria-label={`出牌顺序（${s.direction === 1 ? "顺时针" : "逆时针"}）`}
      inert={inert}
    >
      <ol className="dial__track">
        {s.players.map((p, i) => {
          const sk = skillById(p.skillId);
          const sealed = p.statuses.includes("封印");
          const seatClass = [
            "seat",
            p.seat === s.youSeat && "seat--you",
            p.seat === s.currentSeat && "seat--now",
            sealed && "seat--sealed",
          ]
            .filter(Boolean)
            .join(" ");
          return [
            // 方向雪佛龙夹在座位之间；`data-dir="ccw"` 时令牌里的 scaleX(-1) 整排反向
            i > 0 && <li className="dial__chev" aria-hidden="true" key={`chev-${p.seat}`} />,
            <li className={seatClass} key={p.seat} ref={p.seat === s.currentSeat ? nowRef : undefined}>
              <span className="seat__top">
                <span className="seat__name">{nameOf(p.seat)}</span>
                {p.seat === s.youSeat && <span className="seat__you">你</span>}
                {/* 已喊 UNO 是**这个人身上的一枚记号**，不是一条状态标记：塞进 .seat__tags
                    会跟状态/标记抢那一行的固定宽度（挂满时它先被挤出视野）。 */}
                {/* 徽上只写得下「UNO」，但读屏得听见完整的一句（`title` 触屏与 AT 都拿不到，
                    §7.7 的那条 a11y 测试盯着这个）。 */}
                {p.saidUno && (
                  <span className="badge seat__uno" data-tone="ok">
                    <span className="sr-only">已喊 </span>UNO
                  </span>
                )}
              </span>
              <span className="seat__hand">
                手牌 <HandCount n={p.handCount} />
              </span>
              <button
                type="button"
                className={`skillbadge${sk ? "" : " skillbadge--hidden"}${sealed ? " skillbadge--sealed" : ""}`}
                onClick={() => onSkillClick?.(p.seat)}
              >
                <span className="sigil">{sk?.sigil ?? "?"}</span>
                <span className="nm">{sk?.name ?? p.skillId ?? "未亮出"}</span>
              </button>
              {/* 高度是固定的（globals.css）：标记来了不撑高座位卡，也就不会把整条轨顶出
                  滚动。装不下时这一行自己横滑，页面纹丝不动。 */}
              <span className="seat__tags">
                {statusBadges(p)}
                {markBadges(p)}
                {/* 神化只画 N 颗实心、不预留空位：01-decided-rules G4「主神在场时最多 3；
                    无主神时无此上限」，基础包没有主神，画成「2 实心 + 1 空心」是错的。 */}
                {p.ascensions > 0 && (
                  <span className="badge">
                    神化{" "}
                    <span className="pips">
                      {Array.from({ length: p.ascensions }, (_, k) => (
                        <i className="pip" key={k} />
                      ))}
                    </span>
                  </span>
                )}
              </span>
            </li>,
          ];
        })}
      </ol>
      <div className="dial__scale" aria-hidden="true" />
      {children}
    </nav>
  );
}

/**
 * 03 §4 的状态是公开的（血棘的「封印」…）。快照给什么画什么，组件不认识具体状态名——
 * 唯一的例外是色调：设计稿把「封印」画成朱砂（`data-tone="bad"`），其余状态照旧是警示黄。
 * 这只是显示，能不能用照旧只看 `legalActions`。
 */
function statusBadges(p: SnapshotPlayer) {
  return p.statuses.map((name) => (
    <span className="badge" data-tone={name === "封印" ? "bad" : "warn"} key={name}>
      {name}
    </span>
  ));
}

/** 03 §5 的标记是公开计数（魂 ×3…）。0 的不画。 */
function markBadges(p: SnapshotPlayer) {
  return Object.entries(p.marks)
    .filter(([, n]) => n > 0)
    .map(([mark, n]) => <MarkBadge mark={mark} n={n} key={mark} />);
}

/**
 * 攒了一个 / 花了一个都该被看见，所以标记数变化闪一下（`.is-bump`）。
 *
 * 类挂在**内层**而不是 `.badge` 上：`.is-bump` 带 `display:inline-block`，
 * 直接盖在 `.badge` 的 `inline-flex` 上会把那颗 `::before` 的圆点挤歪。
 * 内层包一层之后 flex 子项还是「圆点 + 一坨文字」两个，间距一像素不变。
 */
function MarkBadge({ mark, n }: { mark: string; n: number }) {
  const bump = useBump(n);
  return (
    <span className="badge">
      <span {...bump}>
        {mark} ×{n}
      </span>
    </span>
  );
}

/** 别人摸了牌 / 打了牌，手牌数闪一下。 */
function HandCount({ n }: { n: number }) {
  return <b {...useBump(n)}>{n}</b>;
}
