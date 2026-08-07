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
export const faceLabel = (f: Face) => FACE_LABEL[f] ?? f;
export const cardFaceLabel = (c: Card) => faceLabel(c.face);

export const COLORS: { value: Color; label: string }[] = [
  { value: "R", label: "红" },
  { value: "B", label: "蓝" },
  { value: "Y", label: "黄" },
  { value: "G", label: "绿" },
];

export const colorLabel = (c: Color | null) => COLORS.find((x) => x.value === c)?.label ?? "无色";
export const cardLabel = (c: Card) => `${colorLabel(c.color)} ${cardFaceLabel(c)}`;

/** 牌面色 → CSS 变量。无色（开局还没定色）画一段发丝线的灰，别装作有颜色。 */
const COLOR_VAR: Record<Color, string> = {
  R: "var(--card-red)",
  B: "var(--card-blue)",
  Y: "var(--card-yellow)",
  G: "var(--card-green)",
};
export const colorSwatch = (c: Color | null | undefined) => (c ? COLOR_VAR[c] : "var(--edge)");

/**
 * 这个字符串是不是一个颜色码。`Board.chosen` 那个槽**既装色也装选项名**
 * （专精♥9 是亮出时定死的色，吟游♣5 是玩家选的歌），画徽之前得先分开。
 */
export const asColor = (v: string): Color | null => (v in COLOR_VAR ? (v as Color) : null);
/** 变色 / +4 提交前要先定色（契约把 chosenColor 挂在 playCards 上，不开服务端窗口）。 */
export const isWildCard = (c: Card) => c.color === null;
