"use client";

import type { Card, ClientSnapshot, Color } from "@roft/engine";
import { useState } from "react";
import { CardFace } from "./card-face";
import { Pile } from "./pile";
import { cardLabel, colorLabel, faceLabel } from "@/lib/cards";
import type { NameOf } from "@/lib/hud-copy";

/** 哪一堆的「全貌」——P3 的弹窗按它决定列哪一堆。 */
export type PileKey = "played" | "discard";

type Props = {
  snapshot: ClientSnapshot;
  nameOf: NameOf;
  /** 展开面板右端那个放大图标。P3 接牌堆全貌弹窗，本阶段只留回调。 */
  onOpenPile?: (which: PileKey) => void;
};

/** 扇形只浮出最近这几张；要整堆走 `.fan__more`。 */
const FAN = 6;

const COLOR_VAR: Record<Color, string> = {
  R: "var(--card-red)",
  B: "var(--card-blue)",
  Y: "var(--card-yellow)",
  G: "var(--card-green)",
};
/** 无色（开局还没定色）就画一段发丝线的灰，别装作有颜色。 */
export const colorSwatch = (c: Color | null | undefined) => (c ? COLOR_VAR[c] : "var(--edge)");

/**
 * 牌河（design/mockups/game.html 的 `.field` + `.piles`）：三堆同构，外加**场上物件**
 * （骰子结果 / 影歌指定的那张牌）——它们摆在牌河里而不是弹窗里，手牌永远不被盖住。
 */
export function CardRiver({ snapshot: s, nameOf, onOpenPile }: Props) {
  // `playedPile[0]` 是牌顶（新 → 旧），`discardPile` 是旧 → 新：两堆方向相反，
  // 所以出牌堆展开前要在客户端 reverse 一次，两堆都按「旧 → 新」呈现。
  const playedFan = s.playedPile.slice(0, FAN).reverse();
  const discardFan = s.discardPile.slice(-FAN);
  const declared = s.soulHarvest?.declared;

  // 至多一堆的扇形开着（窄屏两个 `.fan` 是同一个 fixed 定点，各持一个 open 会叠成两层）
  const [openFan, setOpenFan] = useState<PileKey | null>(null);
  const fanProps = (which: PileKey) => ({
    open: openFan === which,
    onToggle: () => setOpenFan((v) => (v === which ? null : which)),
  });

  return (
    <section className="field">
      {/* 地盘刻度：签名母题，纯装饰 */}
      <span className="plate" aria-hidden="true" />

      {/* 骰子当众掷，点数与「指向谁」都是公开的（spec §5 #6）。
          key = 这一掷的身份：换一掷就重新挂载，`.die` 的 roll 动画跟着重播一次。
          ponytail: 连着两掷点数、掷者、窗口全一样时不重播——三面骰重复很常见，
          但那两掷之间必然隔着一次结算（`dice` 会先清空再出现），所以够用了。 */}
      {s.dice && (
        <div
          className="field__aside"
          key={`${s.dice.seat}:${s.dice.reason}:${s.dice.values.join(",")}:${s.windowId ?? ""}`}
        >
          <div className="dice" aria-label={`${nameOf(s.dice.seat)}掷出 ${s.dice.values.join("、")}`}>
            {s.dice.values.map((v, i) => (
              <span className="die" key={i}>
                {v}
              </span>
            ))}
          </div>
          <span className="pile__label">
            {nameOf(s.dice.seat)}掷出 <b>{s.dice.values.join("、")}</b>
            {/* 摸几张由引擎结算（恩惠会减免），客户端不自己乘也不自己加 */}
            {s.dice.target != null && ` · ${nameOf(s.dice.target)}按点数摸牌`}
            {" · 三面骰只有 0 / 1 / 2"}
          </span>
        </div>
      )}

      {/* 影歌①宣言是当众的：被指定的那张牌就摆在牌河里 */}
      {declared && s.soulHarvest && (
        <div className="field__aside">
          <div className="pile pile--top">
            <span className="pile__stack">
              <CardFace card={declaredCard(declared)} />
            </span>
            <span className="pile__label">
              {nameOf(s.soulHarvest.seat)}指定 · <b>{cardLabel(declaredCard(declared))}</b>
            </span>
          </div>
        </div>
      )}

      <div className="piles" aria-label="牌河">
        {/* 摸牌堆是暗信息：永远不给展开入口（不是 button、无 .fan、无 .fan__more） */}
        <Pile label="摸牌堆" count={s.drawPileCount} />

        <Pile
          label="出牌堆"
          sub={s.playedTop ? cardLabel(s.playedTop) : undefined}
          count={s.playedPile.length}
          top={s.playedTop}
          big
          fan={playedFan.length ? playedFan : undefined}
          {...fanProps("played")}
          onOpen={onOpenPile && (() => onOpenPile("played"))}
        >
          {/* 跟色跟数直接读快照：并列打完后 followFace 不等于顶牌面，别自己从堆顶推 */}
          <span className="follow">
            <i className="swatch" style={{ background: colorSwatch(s.activeColor) }} />
            跟色 {colorLabel(s.activeColor)} · 跟数 {faceLabel(s.followFace)}
          </span>
        </Pile>

        <Pile
          label="弃牌堆"
          count={s.discardPile.length}
          top={s.discardPile[s.discardPile.length - 1] ?? null}
          fan={discardFan.length ? discardFan : undefined}
          {...fanProps("discard")}
          onOpen={onOpenPile && (() => onOpenPile("discard"))}
        />
      </div>
    </section>
  );
}

/** 宣言给的是「色 + 数」不是一张真牌，补个 id 好让 `<CardFace>` 照常画。 */
const declaredCard = (d: { color: Color; face: Card["face"] }): Card => ({
  id: `declared-${d.color}-${d.face}`,
  color: d.color,
  face: d.face,
});
