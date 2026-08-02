"use client";

import type { Action, Card, Color } from "@roft/engine";
import { type CSSProperties, type ReactNode, useState } from "react";
import { COLORS, cardFaceLabel } from "@/lib/cards";
import type { DockSlots as Slots, Slot, SlotName } from "@/lib/dock-slots";

/** 待定色的那一手：中槽整个换成四个色块，**不上遮罩**，手牌全程可见（spec §3.4）。 */
export type PickColor = { card: Card; onPick: (color: Color) => void; onCancel: () => void };

/** 倒计时：主按钮外圈的环（`--p`）+ 右上角秒数。数值由 `<Dock>` 按 deadline 实时算。 */
export type Ring = { pct: number; secs: number | null; urgent: boolean };

const TONE_CLASS = { primary: "btn--primary", danger: "btn--danger", ghost: "btn--ghost" } as const;

/**
 * 一个槽的内容。**槽位位置与动作条数无关**（第 5 条 UI 反馈）：
 * 0 条 → 置灰保位、原地写理由；1 条 → 单按钮；>1 条 → 同一个按钮点开菜单
 * （菜单绝对定位在槽上方，槽本身不长高、不换位）。
 */
function SlotButton({
  slot,
  ring,
  onAction,
  children,
}: {
  slot: Slot;
  ring?: Ring | null;
  onAction: (a: Action) => void;
  /** 按钮文字前面的东西（左槽的技能徽记号）。 */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const many = slot.actions.length > 1;
  const className = ["btn", slot.tone && TONE_CLASS[slot.tone], ring && "ring"].filter(Boolean).join(" ");

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={slot.disabled}
        style={ring ? ({ "--p": Math.round(ring.pct) } as CSSProperties) : undefined}
        data-urgent={ring?.urgent ? "" : undefined}
        aria-haspopup={many ? "menu" : undefined}
        aria-expanded={many ? open : undefined}
        onClick={many ? () => setOpen((o) => !o) : () => onAction(slot.actions[0])}
      >
        {/* 秒数是环的读数，不进按钮的可及名字（「8s接着叠」念起来是噪音）；
            进入最后 10 秒的播报是 P5 a11y 那一步的活 */}
        {ring && (
          <span className="ring__secs" aria-hidden="true">
            {ring.secs ?? "—"}s
          </span>
        )}
        {children}
        {slot.label}
      </button>
      {many && open && (
        <div className="slotmenu" role="menu">
          {slot.actions.map((a, i) => (
            <button
              type="button"
              role="menuitem"
              className="btn"
              key={slot.itemLabels![i]}
              onClick={() => {
                setOpen(false);
                onAction(a);
              }}
            >
              {slot.itemLabels![i]}
            </button>
          ))}
        </div>
      )}
      {/* 槽下面原来还有一行「为什么灰」（`.dock__note`）。2026-08-02 撤了：
          三个槽各挂一行，坞底变成三段小字，而它们说的跟手牌旁那句状态文字高度重复。
          `slot.reason` 本身留着——技能弹窗还在用它（`skillModalProps`），只是坞里不画。 */}
    </>
  );
}

/** 定色：色块的底色由 `data-color` 驱动（globals.css），**颜色与文字不会对不上**（spec §2 bug 3）。 */
function ColorSlots({ pick }: { pick: PickColor }) {
  return (
    <>
      <div className="colors" role="group" aria-label={`${cardFaceLabel(pick.card)}：选择颜色`}>
        {COLORS.map((c) => (
          <button type="button" key={c.value} data-color={c.value} onClick={() => pick.onPick(c.value)}>
            {c.label}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn--ghost" onClick={pick.onCancel}>
        先不打这张
      </button>
      {/* 色块下面原来还有一句「选完之后，下家要按这个颜色接牌」。跟三个槽的 `.dock__note`
          一起撤了（2026-08-02 二次确认）：坞里的状态文字只留手牌旁那一句 + 上面那句人话。
          四个色块自己就是四个色名，`.colors` 的 aria-label 也写着「<牌>：选择颜色」。 */}
    </>
  );
}

type Props = {
  slots: Slots;
  /** 左槽的技能徽（自己的那枚，技能卡已经没了）。点击 → P3b 的技能弹窗。 */
  skill?: { sigil: string; name: string };
  sealed?: boolean;
  onSkillClick?: () => void;
  ring?: Ring | null;
  pickColor?: PickColor | null;
  onAction: (a: Action) => void;
  /** 并列多选的控件：本地态，不在 `legalActions` 里，所以跟着主槽走。 */
  mainExtra?: ReactNode;
};

/**
 * 三个**固定**槽位（左=技能 / 中=推进的主操作 / 右=退让与结束）。
 * 归属与文案全部来自纯函数 `dockSlots()`——组件只管画。
 */
export function DockSlots({
  slots,
  skill,
  sealed,
  onSkillClick,
  ring,
  pickColor,
  onAction,
  mainExtra,
}: Props) {
  const slot = (name: SlotName) => slots[name];
  return (
    <div className="dock__row" role="group" aria-label="命令坞">
      {/* 坞里**不再**放技能徽：轮转轨上自己那张座位卡已经有一枚一模一样的，点它同样开详情弹窗。
          同一件东西在一屏里出现两次，占地又让人犹豫点哪个。这一槽只留「发动」这个动作。 */}
      <div className="dock__slot">
        <SlotButton slot={slot("skill")} onAction={onAction} />
      </div>

      <div className="dock__slot dock__slot--main">
        {pickColor ?
          <ColorSlots pick={pickColor} />
        : <>
            <SlotButton slot={slot("main")} ring={ring} onAction={onAction} />
            {mainExtra}
          </>
        }
      </div>

      <div className="dock__slot">
        <SlotButton slot={slot("yield")} onAction={onAction} />
      </div>
    </div>
  );
}
