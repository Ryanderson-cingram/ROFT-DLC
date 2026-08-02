import type { Card } from "@roft/engine";
import { cardColorClass, cardFaceLabel, cardLabel } from "@/lib/cards";

type Props = {
  card?: Card;
  /** 可打（legalActions 里有它）。绝不在这里自己判合法性。 */
  legal?: boolean;
  dim?: boolean;
  pulse?: boolean;
  /**
   * 并列多选里的「选中」。给了值（不是 undefined）就说明这张牌此刻是个开关，
   * 于是带上 `aria-pressed`——测试与屏幕阅读器都靠它认「选了哪几张」。
   */
  picked?: boolean;
  onClick?: () => void;
};

/** 牌面。data-color / data-face 由 tokens.css 的 .card 画。 */
export function CardFace({ card, legal, dim, pulse, picked, onClick }: Props) {
  const className = [
    "card",
    legal && "card--legal",
    dim && "card--dim",
    pulse && "card--pulse",
    picked && "card--picked",
  ]
    .filter(Boolean)
    .join(" ");
  // 牌背：没有牌就是牌堆。它不带信息（张数与堆名都在 `<Pile>` 的 aria-label 上），所以对 AT 隐藏
  if (!card) return <span className="card" data-color="back" aria-hidden="true" />;

  const attrs = { className, "data-color": cardColorClass(card), "data-face": cardFaceLabel(card) };
  // 不可点的牌面要 `role="img"`：多数 AT 会忽略裸 `<span>` 上的 aria-label（spec §7.5）
  if (!onClick) return <span {...attrs} role="img" aria-label={cardLabel(card)} />;
  return (
    <button type="button" {...attrs} aria-label={cardLabel(card)} aria-pressed={picked} onClick={onClick} />
  );
}
