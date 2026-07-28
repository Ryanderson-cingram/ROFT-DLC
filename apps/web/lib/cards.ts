import type { Card, Color, Face } from "@roft/engine";

// 设计稿的 .card 用 data-color / data-face 两个属性画牌面（tokens.css）。
const COLOR_CLASS: Record<Color, string> = { R: "red", B: "blue", Y: "yellow", G: "green" };
const FACE_LABEL: Partial<Record<Face, string>> = {
  skip: "停",
  rev: "转",
  wild: "变色",
  poison: "毒",
  shuffle: "洗牌",
};

export const cardColorClass = (c: Card) => (c.color ? COLOR_CLASS[c.color] : "wild");
export const cardFaceLabel = (c: Card) => FACE_LABEL[c.face] ?? c.face;

export const COLORS: { value: Color; label: string }[] = [
  { value: "R", label: "红" },
  { value: "B", label: "蓝" },
  { value: "Y", label: "黄" },
  { value: "G", label: "绿" },
];

export const colorLabel = (c: Color | null) => COLORS.find((x) => x.value === c)?.label ?? "无色";
export const cardLabel = (c: Card) => `${colorLabel(c.color)} ${cardFaceLabel(c)}`;
/** 变色 / +4 提交前要先定色（契约把 chosenColor 挂在 playCards 上，不开服务端窗口）。 */
export const isWildCard = (c: Card) => c.color === null;
