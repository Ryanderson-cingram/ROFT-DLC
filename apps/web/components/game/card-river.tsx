"use client";

import type { Card, ClientSnapshot, Color } from "@roft/engine";
import { useId, useState } from "react";
import { CardFace } from "./card-face";
import { Pile } from "./pile";
import { cardLabel, colorLabel, colorSwatch, faceLabel } from "@/lib/cards";
import type { NameOf } from "@/lib/hud-copy";
import { type ChosenPick, effectLabel, globalPicks, skillById } from "@/lib/skills";

/** 哪一堆的「全貌」——P3 的弹窗按它决定列哪一堆。 */
export type PileKey = "played" | "discard";

/** 牌桌上能浮出一层说明的东西：三堆的扇形，加上全场生效的那几条。同一时刻只开一个。 */
type OpenKey = PileKey | "pick";

type Props = {
  snapshot: ClientSnapshot;
  nameOf: NameOf;
  /** 展开面板右端那个放大图标。P3 接牌堆全貌弹窗，本阶段只留回调。 */
  onOpenPile?: (which: PileKey) => void;
};

/** 扇形只浮出最近这几张；要整堆走 `.fan__more`。 */
const FAN = 6;

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

  // 至多一层浮出来（窄屏两个 `.fan` 是同一个 fixed 定点，各持一个 open 会叠成两层）。
  // 全场生效那条的说明浮窗也挂在这一个开关上——它与扇形是同一类东西，天然互斥。
  const [openFan, setOpenFan] = useState<OpenKey | null>(null);
  const fanProps = (which: OpenKey) => ({
    open: openFan === which,
    onToggle: () => setOpenFan((v) => (v === which ? null : which)),
  });

  return (
    <section className="field">
      {/* 地盘刻度：签名母题，纯装饰 */}
      <span className="plate" aria-hidden="true" />

      {/* 全场生效的技能分支（吟游♣5 的歌声）：**摆在牌桌上**，不挂在谁的座位卡上——
          它改的是全场的账（战争序让所有惩罚 ×2、行进曲锁全场的定色），对手也吃。
          `targeting: global` 是它上桌的唯一判据，不认技能 id。

          位置在牌河**之上**，与惩罚链同一档（两者都是「此刻全桌都要吃的一个条件」）。
          摆在牌河下面量过：320px 的机器上它会被从坞里探头的 UNO 定点压住；
          排在 `.field` 第一个还顺带保证了骰子/宣言那两块出现时它不会被顶下去。 */}
      {globalPicks(s).map((pick) => (
        <GlobalPick key={pick.skillId} snapshot={s} pick={pick} nameOf={nameOf} {...fanProps("pick")} />
      ))}

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

/**
 * 牌桌上那枚「现在全场吃着哪一条」的牌，点开有一句说明。
 *
 * 交互与牌堆的扇形**同构**：`data-open` 管触屏点击、CSS 的 `(hover: hover)` 管桌面悬停，
 * 开合状态与三堆共用 `<CardRiver>` 那一个（同一时刻只浮出一层）。
 *
 * 说明那句直接用发动按钮的文案（`effectLabel`）——同一条子效果不写第二份文案，
 * 两处迟早会对不上。封印期间（06-Q65 只压制不清值）牌**不撤**，只退成灰并改口说暂停生效。
 */
function GlobalPick({
  snapshot: s,
  pick,
  nameOf,
  open,
  onToggle,
}: {
  snapshot: ClientSnapshot;
  pick: ChosenPick;
  nameOf: NameOf;
  open: boolean;
  onToggle: () => void;
}) {
  const popId = useId();
  const skill = skillById(pick.skillId);
  const who = nameOf(pick.seat);
  const sealed = !!s.players.find((p) => p.seat === pick.seat)?.statuses.includes("封印");
  const state = sealed ? "被封印，暂停生效" : "全场生效";

  return (
    <button
      type="button"
      className={`songmark${sealed ? " songmark--sealed" : ""}`}
      data-open={open || undefined}
      aria-expanded={open}
      aria-controls={popId}
      /* 名字写全在这里：不给 aria-label 的话按钮的可及名会把整个浮窗的字都吞进去 */
      aria-label={`${skill?.name ?? pick.skillId}：${pick.key}，${who}选的（${state}）`}
      onClick={onToggle}
    >
      <span className="sigil">{skill?.sigil ?? "?"}</span>
      <span className="nm">{pick.key}</span>
      <span className="who">{who}</span>

      {/* 关着的时候 `display: none`，压根不在 a11y 树里；开着才读得到。
          按钮上那句 aria-label 已经把要点说全了，所以这里**不**再 aria-hidden——
          浏览模式下把这几行读出来是加分的，藏起来才是减分。 */}
      <span className="songpop" id={popId} role="note">
        <span className="songpop__head">
          <span className="sigil">{skill?.sigil ?? "?"}</span>
          <b>{skill?.name ?? pick.skillId}</b>
          <span className="badge" data-tone={sealed ? "bad" : "ok"}>
            {state}
          </span>
        </span>
        <span className="songpop__line">{effectLabel(pick.skillId, pick.key)}</span>
        <span className="songpop__foot">
          {sealed ? `${who}被封印：解封后回到这一条` : `${who}选的 · 他的回合开始可以换`}
        </span>
      </span>
    </button>
  );
}

/** 宣言给的是「色 + 数」不是一张真牌，补个 id 好让 `<CardFace>` 照常画。 */
const declaredCard = (d: { color: Color; face: Card["face"] }): Card => ({
  id: `declared-${d.color}-${d.face}`,
  color: d.color,
  face: d.face,
});
