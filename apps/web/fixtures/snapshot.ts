import type { Card, ClientSnapshot } from "@roft/engine";

/**
 * 设计稿 game.html 的五个状态，改写成受 `ClientSnapshot` 驱动的数据。
 * 页面已经接上真快照（Task 5），这份 fixture 留着当**契约的编译期验证**：
 * `pnpm --filter web typecheck` 过了，就说明契约装得下 HUD 要画的全部东西。

 * 类型标注是重点：它是引擎契约的编译期验证，fixture 编译不过就说明契约有洞。
 * 人物与张数照搬设计稿（凛 7 张、阿柴 2 张已喊 UNO、小满 4 张、老白 11 张神化 2）。
 *
 * 唯一没照搬的是「哪几张高亮」：设计稿把黄 +2 也点亮了，但牌顶是红 7、
 * 当前色红，黄 +2 既不同色也不同面。可打与否一律来自 legalActions，
 * 所以这里按规则给，不按设计稿的示意给。
 */

const c = (id: string, color: Card["color"], face: Card["face"]): Card => ({ id, color, face });

// 你（凛）的 7 张手牌，五态共用
const R3 = c("R3#0", "R", "3");
const R7 = c("R7#0", "R", "7");
const B7 = c("B7#1", "B", "7");
const G0 = c("G0#0", "G", "0");
const Y2 = c("Y+2#0", "Y", "+2");
const WILD = c("Wwild#1", null, "wild");
const W4 = c("W+4#2", null, "+4");
const HAND = [R3, R7, B7, G0, Y2, WILD, W4];

const TOP = c("R7#1", "R", "7");

/** 快照里只有 userId；昵称由客户端从 room_seats join profiles 自己映射。 */
export const FIXTURE_NAMES: Record<string, string> = {
  "u-lin": "凛",
  "u-chai": "阿柴",
  "u-man": "小满",
  "u-bai": "老白",
};

const PLAYERS: ClientSnapshot["players"] = [
  { seat: 0, userId: "u-lin", handCount: 7, saidUno: false, skillId: "恒心", ascensions: 0 },
  { seat: 1, userId: "u-chai", handCount: 2, saidUno: true, skillId: "劫营", ascensions: 0 },
  { seat: 2, userId: "u-man", handCount: 4, saidUno: false, skillId: null, ascensions: 0 },
  { seat: 3, userId: "u-bai", handCount: 11, saidUno: false, skillId: "血棘", ascensions: 2 },
];

const BASE = {
  version: 12,
  youSeat: 0,
  yourHand: HAND,
  players: PLAYERS,
  direction: 1,
  activeColor: "R",
  discardTop: TOP,
  drawPileCount: 38,
  disabledReasons: { callUno: "剩 2 张牌时才需要喊" },
} satisfies Partial<ClientSnapshot>;

/** A · 我的回合：可打的牌来自 legalActions，无色牌任何时候都能打。 */
export const fixtureA: ClientSnapshot = {
  ...BASE,
  phase: "turnStart",
  currentSeat: 0,
  legalActions: [
    { type: "playCards", seat: 0, cardIds: [R3.id] },
    { type: "playCards", seat: 0, cardIds: [R7.id] },
    { type: "playCards", seat: 0, cardIds: [B7.id] },
    { type: "playCards", seat: 0, cardIds: [WILD.id] },
    { type: "playCards", seat: 0, cardIds: [W4.id] },
    { type: "drawCard", seat: 0 },
  ],
};

/**
 * B · 惩罚叠链：阿柴 +2 → 老白 +4，累计 6 张，轮到你决定叠还是吃。
 * 契约里这是两步——先 respond{stack}，下一个快照才让你打那张 +4。
 */
export const fixtureB: ClientSnapshot = {
  ...BASE,
  version: 13,
  phase: "afterPlay",
  currentSeat: 3,
  punish: {
    initiator: 1,
    segments: [
      { seat: 1, face: "+2", draw: 2 },
      { seat: 3, face: "+4", draw: 4 },
    ],
    total: 6,
  },
  pendingWindow: {
    type: "punishStack",
    actors: [0],
    deadline: new Date(Date.now() + 12_000).toISOString(),
    defaultChoice: "accept",
    resume: "play",
  },
  windowId: "w13:punishStack",
  legalActions: [
    { type: "respond", seat: 0, windowId: "w13:punishStack", choice: "stack" },
    { type: "respond", seat: 0, windowId: "w13:punishStack", choice: "accept" },
  ],
};

/**
 * C · 反应窗口：小满打出蓝 7，你手里也有蓝 7，可以劫营打断。
 * 引擎本轮只实现 punishStack 一种窗口，interrupt 是给 UI 用的示例——
 * HUD 对窗口是通用的：横幅文案与按钮都从 pendingWindow + legalActions 来。
 */
export const fixtureC: ClientSnapshot = {
  ...BASE,
  version: 14,
  phase: "afterPlay",
  currentSeat: 2,
  discardTop: c("B7#0", "B", "7"),
  activeColor: "B",
  pendingWindow: {
    type: "interrupt",
    actors: [0],
    deadline: new Date(Date.now() + 8_000).toISOString(),
    defaultChoice: "pass",
    resume: "play",
  },
  windowId: "w14:interrupt",
  legalActions: [
    { type: "respond", seat: 0, windowId: "w14:interrupt", choice: "interrupt" },
    { type: "respond", seat: 0, windowId: "w14:interrupt", choice: "pass" },
  ],
};

/** D · 选颜色：定色是提交前的客户端模态（chosenColor 随 playCards 走），不发请求。 */
export const fixtureD: ClientSnapshot = fixtureA;
/** 页面用它决定 ?fixture=d 一进来就把定色模态打开在哪张牌上。 */
export const fixtureDWild = W4;

/**
 * E · 开局抽技能：契约里没有 draft 的表达（没有 draft 动作，快照也不带候选），
 * 所以只有 phase=dealing 是真数据，三个候选是本地静态 UI —— 本轮范围内就是静态的。
 */
export const fixtureE: ClientSnapshot = {
  ...BASE,
  phase: "dealing",
  currentSeat: null,
  yourHand: [],
  players: PLAYERS.map((p) => ({ ...p, skillId: null, handCount: 7, ascensions: 0 })),
  discardTop: null,
  activeColor: null,
  legalActions: [],
  disabledReasons: {},
};

export const FIXTURES = { a: fixtureA, b: fixtureB, c: fixtureC, d: fixtureD, e: fixtureE };
export type FixtureKey = keyof typeof FIXTURES;
