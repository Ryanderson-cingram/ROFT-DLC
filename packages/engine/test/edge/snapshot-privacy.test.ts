/**
 * 快照隐私的**穷举轴**（spec §1：客户端永远看不见别人的手牌）。
 *
 * 逐字段断言值钱，但会腐烂——加了字段的人不改这里也照样绿。所以这一批的主力是
 * **反向白名单**：把整张快照序列化成字符串，断言里面**不出现**任何一张别人手牌 /
 * 摸牌堆的牌 id。以后新增字段若不慎带出暗信息，这一条自动红。
 *
 * 每个中间态都同时含着暗信息与公开信息，所以场景表按「引擎里存在的挂起态」铺开：
 * 抽 3 选 1 / 惩罚窗口 / 司夜②换牌 / 洗牌②弃牌 / 影歌①攒魂 / 掷骰接管 /
 * 并列被劫营截断 / 单张待结算 / 终局 / 2 座位。
 */
import { describe, expect, it } from "vitest";
import { applyAction, projectView } from "../../src/index.ts";
import { card, ctx, lobby, table } from "../helpers.ts";
import type { Card, GameState } from "../../src/types.ts";

const R7 = card("R", "7");
const filler = (n: number) => Array.from({ length: n }, () => card("G", "9"));
/** 牌 id 在 JSON 里恒为字符串值，加引号比对才是精确匹配（`R7#t1` 是 `R7#t12` 的前缀）。 */
const quoted = (id: string) => `"${id}"`;
const wire = (s: GameState, seat: number) => JSON.stringify(projectView(s, seat));

const three = () => [[card("R", "3"), card("R", "8")], [card("Y", "1"), card("Y", "5")], [card("Y", "2"), card("B", "6")]];

/** 并列♥4 整组落地后挂着劫营♦10 的窗口（`parallelPending`：这一组是哪几张）。 */
function parallelInterrupted(): GameState {
  const pair = [card("R", "2"), card("R", "2")];
  const s = table([[...pair, card("R", "9")], [card("R", "2"), card("B", "5")], [card("Y", "3"), card("Y", "4")]], {
    playedPile: [R7],
    drawPile: filler(30),
    skills: ["heart-4", "diamond-10", null],
    revealed: [true, true, false],
  });
  return applyAction(s, { type: "playCards", seat: 0, cardIds: pair.map((c) => c.id) }, ctx()).state;
}

/** 单张落地、结算之前挂着劫营窗口（`playPending`）。 */
function singleInterrupted(): GameState {
  const r2 = card("R", "2");
  const s = table([[r2, card("R", "9")], [card("R", "2"), card("B", "5")], [card("Y", "3"), card("Y", "4")]], {
    playedPile: [R7],
    drawPile: filler(30),
    skills: [null, "diamond-10", null],
    revealed: [false, true, false],
  });
  return applyAction(s, { type: "playCards", seat: 0, cardIds: [r2.id] }, ctx()).state;
}

function punishOpened(): GameState {
  const p2 = card("R", "+2");
  const s = table([[p2, card("R", "1")], [card("Y", "+2"), card("Y", "3")], [card("Y", "2"), card("B", "4")]], {
    playedPile: [R7],
    drawPile: filler(30),
  });
  return applyAction(s, { type: "playCards", seat: 0, cardIds: [p2.id] }, ctx()).state;
}

function won(): GameState {
  const last = card("R", "3");
  const s = table([[last], [card("Y", "1")], [card("Y", "2")]], { playedPile: [R7] });
  return applyAction(s, { type: "playCards", seat: 0, cardIds: [last.id] }, ctx()).state;
}

const stolen = card("B", "5");
const drawnSecret = card("G", "7");

/** 场景表。每一项都要有非空的摸牌堆与至少两个人的手牌，否则反向白名单没得搜。 */
const SCENARIOS: { name: string; state: GameState }[] = [
  { name: "开局抽 3 选 1（draftOptions 挂着）", state: applyAction(lobby(4), { type: "startGame", seat: 0 }, ctx()).state },
  { name: "惩罚窗口挂着", state: punishOpened() },
  {
    name: "司夜②换牌窗口（cardId 是暗信息）",
    state: table([[stolen, card("R", "3")], [card("Y", "1"), card("Y", "7")], [card("Y", "2"), card("B", "8")]], {
      drawPile: filler(20),
      swap: { seat: 0, target: 1, cardId: stolen.id },
    }),
  },
  {
    name: "洗牌②弃牌窗口（drawnId 是暗信息）",
    state: table([[drawnSecret, card("R", "3")], [card("Y", "1"), card("Y", "7")], [card("Y", "2"), card("B", "8")]], {
      drawPile: filler(20),
      shufflePending: { seat: 0, choice: "drawDiscard", drawnId: drawnSecret.id },
    }),
  },
  {
    name: "影歌①攒魂窗口（queue/effectKey 是内部记账）",
    state: table(three(), {
      drawPile: filler(20),
      soulHarvest: { seat: 0, declared: { color: "R", face: "5" }, queue: [1, 2], drawn: 3, effectKey: "1" },
    }),
  },
  {
    name: "掷骰接管窗口（resume 是引擎的续跑指令）",
    state: table(three(), { drawPile: filler(20) }, {
      pendingDice: { seat: 0, reason: "bloodthorn-drain", values: [2], resume: { kind: "bloodthorn", seat: 0, target: 2 } },
    }),
  },
  { name: "并列整组落地后挂着劫营窗口", state: parallelInterrupted() },
  { name: "单张落地待结算（playPending）", state: singleInterrupted() },
  { name: "终局（有赢家）", state: won() },
  { name: "2 座位的牌桌（投影与人数无关）", state: table([[card("R", "3"), card("R", "8")], [card("Y", "1"), card("Y", "5")]], { drawPile: filler(20) }) },
];

const seatsOf = (s: GameState) => s.board!.hands.map((_h, i) => i);

// ---------------------------------------------------------------- 反向白名单

describe("反向白名单：别人的手牌一个字节都不进快照", () => {
  // 场景没走到目标中间态的话，下面那两条 it.each 就是在空转（搜索一个不存在的秘密恒为真）。
  // 这一条把每个场景的「秘密确实在牌桌上」钉住，是整批断言的地基。
  it("场景表确实到达了各自的挂起态", () => {
    const at = (prefix: string) => SCENARIOS.find((x) => x.name.startsWith(prefix))!.state;
    expect(at("开局").board!.draftOptions).toBeDefined();
    expect(at("惩罚").pendingWindow!.type).toBe("punishStack");
    expect(at("司夜").board!.swap!.cardId).toBe(stolen.id);
    expect(at("洗牌").board!.shufflePending!.drawnId).toBe(drawnSecret.id);
    expect(at("影歌").board!.soulHarvest!.queue).toEqual([1, 2]);
    expect(at("掷骰").pendingDice!.resume).toBeDefined();
    expect(at("并列").board!.parallelPending!.cards).toHaveLength(2);
    expect(at("单张").board!.playPending).toBeDefined();
    expect(at("终局").phase).toBe("finished");
    expect(at("2 座位").board!.hands).toHaveLength(2);
  });

  it.each(SCENARIOS)("$name", ({ state }) => {
    const b = state.board!;
    for (const seat of seatsOf(state)) {
      const w = wire(state, seat);
      for (const [i, h] of b.hands.entries()) {
        if (i === seat) continue;
        for (const c of h) expect(w, `座位 ${seat} 的快照里出现了座位 ${i} 的 ${c.id}`).not.toContain(quoted(c.id));
      }
      // 正向对照：同一个搜索找得到自己的每一张牌，所以上面的「找不到」不是搜索坏了
      for (const c of b.hands[seat]) expect(w, `座位 ${seat} 看不见自己的 ${c.id}`).toContain(quoted(c.id));
    }
  });

  it.each(SCENARIOS)("$name：摸牌堆的内容一律不给，只给张数", ({ state }) => {
    const b = state.board!;
    expect(b.drawPile.length, "场景的摸牌堆是空的，这条断言等于没跑").toBeGreaterThan(0);
    for (const seat of seatsOf(state)) {
      const w = wire(state, seat);
      for (const c of b.drawPile) expect(w, `摸牌堆的 ${c.id} 泄露给了座位 ${seat}`).not.toContain(quoted(c.id));
      expect(projectView(state, seat).drawPileCount).toBe(b.drawPile.length);
    }
  });
});

// ---------------------------------------------------------------- 逐字段

describe("中间态只投公开的那一半（字段白名单）", () => {
  const s = table(three(), {
    drawPile: filler(20),
    swap: { seat: 0, target: 1, cardId: stolen.id },
    shufflePending: { seat: 0, choice: "drawDiscard", drawnId: drawnSecret.id },
    soulHarvest: { seat: 0, declared: { color: "R", face: "5" }, queue: [1, 2], drawn: 3, effectKey: "1" },
  }, {
    pendingDice: { seat: 0, reason: "bloodthorn-drain", values: [2], resume: { kind: "bloodthorn", seat: 0, target: 2 } },
  });

  it.each([
    { field: "swap", keys: ["seat", "target"], hidden: ["cardId"] },
    { field: "shufflePending", keys: ["seat", "choice"], hidden: ["drawnId"] },
    { field: "soulHarvest", keys: ["seat", "declared", "drawn"], hidden: ["queue", "effectKey"] },
    { field: "dice", keys: ["seat", "reason", "values", "target"], hidden: ["resume"] },
  ] as const)("$field 只有 $keys，$hidden 一律不投", ({ field, keys, hidden }) => {
    for (const seat of [0, 1, 2]) {
      const snap = projectView(s, seat) as unknown as Record<string, Record<string, unknown>>;
      expect(Object.keys(snap[field]), `座位 ${seat}`).toEqual([...keys]);
      for (const h of hidden) expect(JSON.stringify(snap[field])).not.toContain(h);
    }
  });
});

describe("未亮出的技能对别人是暗牌（V3）", () => {
  const s = table(three(), {
    skills: ["heart-1", "diamond-2", "club-3"],
    revealed: [true, false, false],
  });

  it.each([0, 1, 2])("座位 $0 的视角：自己的技能自己看得见，别人的要亮出才给", (viewer) => {
    const snap = projectView(s, viewer);
    expect(snap.players.map((p) => p.skillId)).toEqual([
      "heart-1",
      viewer === 1 ? "diamond-2" : null,
      viewer === 2 ? "club-3" : null,
    ]);
    for (const [i, id] of ["heart-1", "diamond-2", "club-3"].entries())
      if (i !== 0 && i !== viewer) expect(JSON.stringify(snap)).not.toContain(id);
  });
});

describe("draftOptions 只给自己（别人抽到什么是暗信息）", () => {
  const dealt = applyAction(lobby(4), { type: "startGame", seat: 0 }, ctx()).state;

  it.each([0, 1, 2, 3])("座位 $0 只拿得到自己的候选", (viewer) => {
    const all = dealt.board!.draftOptions!;
    const snap = projectView(dealt, viewer);
    expect(snap.draftOptions).toEqual(all[viewer]);
    const others = all.flatMap((o, i) => (i === viewer ? [] : o));
    expect(others.length).toBeGreaterThan(0);
    for (const id of others) expect(JSON.stringify(snap)).not.toContain(quoted(id));
  });
});

describe("没有牌桌的大厅照样投得出来", () => {
  it("lobby：手牌为空、没有当前座位、没有可做的事", () => {
    const snap = projectView(lobby(3), 1);
    expect(snap.yourHand).toEqual([]);
    expect(snap.currentSeat).toBeNull();
    expect(snap.drawPileCount).toBe(0);
    expect(snap.legalActions).toEqual([]);
    expect(snap.players.map((p) => p.handCount)).toEqual([0, 0, 0]);
  });
});

// ---------------------------------------------------------------- 事件流的私密面

describe("事件的 public 面不带牌，牌走 private", () => {
  it("摸牌事件：public 只有张数，牌只发给摸的人", () => {
    const secret: Card[] = [card("G", "1"), card("G", "2")];
    const s = table(three(), { playedPile: [R7], drawPile: [...secret, ...filler(10)] });
    const p2 = card("R", "+2");
    const withChain = {
      ...s,
      board: { ...s.board!, hands: s.board!.hands.map((h, i) => (i === 0 ? [p2, ...h] : h)) },
    };
    const opened = applyAction(withChain, { type: "playCards", seat: 0, cardIds: [p2.id] }, ctx()).state;
    const r = applyAction(
      opened,
      { type: "respond", seat: 1, windowId: `w${opened.version}:punishStack`, choice: "accept" },
      ctx(),
    );
    const drew = r.events.find((e) => e.type === "cardsDrawn")!;
    expect(drew.public).toEqual({ seat: 1, count: 2 });
    expect(drew.private!.seat).toBe(1);
    for (const c of drew.private!.payload.cards as Card[]) expect(JSON.stringify(drew.public)).not.toContain(c.id);
  });
});
