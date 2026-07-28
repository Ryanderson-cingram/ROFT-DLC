import type { Card } from "@roft/engine";
import { cardColorClass, cardFaceLabel, cardLabel } from "@/lib/cards";

type Props = {
  card?: Card;
  /** 可打（legalActions 里有它）。绝不在这里自己判合法性。 */
  legal?: boolean;
  dim?: boolean;
  pulse?: boolean;
  onClick?: () => void;
};

/** 牌面。data-color / data-face 由 tokens.css 的 .card 画。 */
export function CardFace({ card, legal, dim, pulse, onClick }: Props) {
  const className = ["card", legal && "card--legal", dim && "card--dim", pulse && "card--pulse"]
    .filter(Boolean)
    .join(" ");
  // 牌背：没有牌就是牌堆
  if (!card) return <span className="card" data-color="back" />;

  const attrs = { className, "data-color": cardColorClass(card), "data-face": cardFaceLabel(card) };
  if (!onClick) return <span {...attrs} aria-label={cardLabel(card)} />;
  return <button type="button" {...attrs} aria-label={cardLabel(card)} onClick={onClick} />;
}
