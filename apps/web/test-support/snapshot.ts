import type { Card, ClientSnapshot } from "@roft/engine";

/**
 * 测试用的一份基准快照（原 `fixtures/snapshot.ts`；P4 起只有测试消费它，所以整体
 * 搬进 `test-support/`）。设计稿 game.html 的 A 态，改写成受 `ClientSnapshot` 驱动的数据。
 *
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
export const HAND = [R3, R7, B7, G0, Y2, WILD, W4];

const TOP = c("R7#1", "R", "7");

/** 快照里只有 userId；昵称由客户端从 room_seats join profiles 自己映射。 */
export const FIXTURE_NAMES: Record<string, string> = {
  "u-lin": "凛",
  "u-chai": "阿柴",
  "u-man": "小满",
  "u-bai": "老白",
};

/** `skillId` 是**引擎 id**（`spade-1`…），不是中文名——快照里就是这个，抄中文名等于假数据。 */
export const PLAYERS: ClientSnapshot["players"] = [
  { seat: 0, userId: "u-lin", handCount: 7, saidUno: false, skillId: "spade-1", revealed: true, marks: {}, marksSpent: {}, statuses: [], activatedThisTurn: false, sealedBy: null, ascensions: 0 },
  { seat: 1, userId: "u-chai", handCount: 2, saidUno: true, skillId: "diamond-10", revealed: true, marks: {}, marksSpent: {}, statuses: [], activatedThisTurn: false, sealedBy: null, ascensions: 0 },
  // 小满被老白（座位 3）的血棘封印着——`sealedBy` 与 `statuses` 里的「封印」同进同出
  { seat: 2, userId: "u-man", handCount: 4, saidUno: false, skillId: null, revealed: false, marks: {}, marksSpent: {}, statuses: ["封印"], activatedThisTurn: false, sealedBy: 3, ascensions: 0 },
  { seat: 3, userId: "u-bai", handCount: 11, saidUno: false, skillId: "diamond-2", revealed: true, marks: {}, marksSpent: {}, statuses: [], activatedThisTurn: true, sealedBy: null, ascensions: 2 },
];

const BASE = {
  version: 12,
  youSeat: 0,
  yourHand: HAND,
  players: PLAYERS,
  direction: 1,
  activeColor: "R",
  playedTop: TOP,
  // `[0]` 是牌顶，与 discardPile 的方向相反（引擎原样给，正序显示的自己 reverse）
  playedPile: [TOP, c("R4#p1", "R", "4"), c("B4#p2", "B", "4"), c("B9#p3", "B", "9")],
  // 标记上限从技能定义来（影歌的魂 6）。没上限的标记不在表里——盗缺席就是「无上限」
  marksCap: { 魂: 6 },
  followFace: TOP.face,
  // 凛持恒心，不是并列——入口按钮不该露出来（引擎算好给 UI，客户端不判技能）
  canPlayMultiple: false,
  // 基准态没人锁色：定色时四个色块都画得出来。要演锁色的用例自己覆盖成一个 Color
  // （专精♥9 的专属色 / 五彩 / 行进曲三个来源在引擎里已经合成这一个值）
  wildColorLock: null,
  discardPile: [c("G2#d0", "G", "2"), c("Y9#d1", "Y", "9"), c("B5#d2", "B", "5")],
  drawPileCount: 38,
  // Q26 未裁定前引擎不发 callUno 提示，fixture 也不装作有——
  // 否则设计稿一直摆着一个真实产品里不存在的按钮。
  disabledReasons: {},
} satisfies Partial<ClientSnapshot>;

/** 基准态 · 我的回合：可打的牌来自 legalActions，无色牌任何时候都能打。 */
const fixtureA: ClientSnapshot = {
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

/** 每一层都可选（`makeSnapshot({ pendingWindow: { type: "interrupt" } })`）。数组整体替换，不逐项合。 */
type DeepPartial<T> = T extends readonly unknown[] | Date
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** 只合并「普通对象」；数组、Card、null 一律整体替换——合并数组的语义太容易猜错。 */
function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge((base as Record<string, unknown>)[k], v);
  return out as T;
}
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 测试用快照工厂：默认是 fixture A（你的回合、7 张手牌、无窗口），只写差异。
 *
 * 返回值标成引擎导出的 `ClientSnapshot`——这是唯一挡得住契约漂移的东西（这份 fixture
 * 当初就是因为没人跑而烂掉的）。手写整份快照的，改回来用这个。
 *
 * 数组不深合并：要改某个玩家就 `players: PLAYERS.map(p => p.seat === 0 ? { ...p, saidUno: true } : p)`。
 */
export function makeSnapshot(overrides: DeepPartial<ClientSnapshot> = {}): ClientSnapshot {
  return deepMerge(fixtureA, overrides);
}
