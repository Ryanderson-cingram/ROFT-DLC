// 喊 UNO 与抓漏喊。规则：01-U6/U7 + 「U6/U7 补充」（2026-08-01 改判：声明的作用域是你的这个回合）。
import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../src/index.ts";
import { UNO_GRACE_MS } from "../src/legal.ts";
import { card, ctx, ctxAfter, NOW, table } from "./helpers.ts";
import type { Board, Card, GameState } from "../src/types.ts";

const R7 = card("R", "7");
const filler = (n: number) => Array.from({ length: n }, () => card("G", "9"));
const wid = (s: GameState) => `w${s.version}:${s.pendingWindow!.type}`;

/** 座位 0 手持两张红牌（打一张就剩 1），座位 1/2 各 1 张。 */
const twoCards = (over: Partial<Board> = {}) =>
  table([[card("R", "3"), card("R", "4")], [card("Y", "1")], [card("Y", "2")]], {
    playedPile: [R7],
    drawPile: filler(30),
    ...over,
  });
/** 座位 1 已经只剩 1 张且未喊——currentSeat 是 0，所以他不在宽限期里。 */
const exposed = (over: Partial<Board> = {}) =>
  table([[card("R", "3"), card("R", "4")], [card("Y", "1")], [card("Y", "2")]], {
    playedPile: [R7],
    drawPile: [card("G", "5"), card("G", "6"), card("G", "7")],
    ...over,
  });

const call = (s: GameState, seat: number) => applyAction(s, { type: "callUno", seat }, ctx());
/**
 * 抓一次。**默认把时间推过 U7b 那 1 秒补喊宽限**——绝大多数用例问的是「抓不抓得着」，
 * 而不是「宽限灵不灵」；不推时间的话交回合后立刻抓一律 `uno_grace`，测的就成了别的东西。
 * 宽限本身有专门的 describe（传 `0` 走原时点）。
 */
const catchIt = (s: GameState, seat: number, target: number, afterMs = 1_500) =>
  applyAction(s, { type: "catchUno", seat, target }, ctxAfter(afterMs));

// ---------------------------------------------------------------- 按下那一刻判

describe("U6 按钮常亮，按下只记录（2026-08-02 改判：唯一结算在交回合）", () => {
  it("恰 1 张：声明成立、一张都不摸", () => {
    const s = exposed({ currentSeat: 1 });
    const r = call(s, 1);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.saidUno[1]).toBe(true);
    expect(r.state.board!.hands[1]).toHaveLength(1);
    expect(r.events.map((e) => e.type)).toEqual(["unoCalled"]);
    expect(call(r.state, 1).rejected?.reason).toBe("already_said");
  });

  // 「按下即判、虚喊当场罚 2」是 2026-08-01 的口径，2026-08-02 撤了：按下只记录
  it.each([2, 3])("自己回合里拿着 %i 张先喊：当场不罚、只记下「喊过」", (n) => {
    const many = twoCards({
      hands: [Array.from({ length: n }, (_, i) => card("R", String(i + 3) as Card["face"])),
        [card("Y", "1")], [card("Y", "2")]],
    });
    const r = call(many, 0);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[0]).toHaveLength(n); // 一张都没摸
    expect(r.state.board!.saidUno[0]).toBe(true);    // 回合内不清（syncUno 只管回合外）
    expect(r.events.map((e) => e.type)).toEqual(["unoCalled"]);
    // 已经记下了 → 按钮收回（再按是 already_said）
    expect(legalActions(r.state, 0)).not.toContainEqual({ type: "callUno", seat: 0 });
  });

  it("牌堆枯竭也照喊不误：按下不摸牌，就没有 deck_empty 这条路了", () => {
    const s = twoCards({ drawPile: [], discardPile: [], playedPile: [R7], reshuffles: 2 });
    const r = call(s, 0);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.saidUno[0]).toBe(true);
  });

  it("legalActions：按钮常亮，手牌数不参与——只有已喊才收回", () => {
    const three = twoCards({
      hands: [[card("R", "3"), card("R", "4"), card("R", "5")], [card("Y", "1")], [card("Y", "2")]],
    });
    expect(legalActions(three, 0)).toContainEqual({ type: "callUno", seat: 0 });
    expect(legalActions(three, 1)).toContainEqual({ type: "callUno", seat: 1 });
    const said = twoCards({ saidUno: [true, false, false] });
    expect(legalActions(said, 0)).not.toContainEqual({ type: "callUno", seat: 0 });
  });

  it("正常打法：先出牌、手牌变 1 之后再点喊（喊与出牌是两个互不影响的动作）", () => {
    const s = twoCards();
    const played = applyAction(s, { type: "playCards", seat: 0, cardIds: [s.board!.hands[0][0].id] }, ctx()).state;
    // 出牌把回合也交出去了，所以这一声落在别人的回合里——手牌恰 1 张，不算虚喊
    expect(played.board!.hands[0]).toHaveLength(1);
    expect(played.board!.currentSeat).toBe(1);
    const r = call(played, 0);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.saidUno[0]).toBe(true);
    expect(r.state.board!.hands[0]).toHaveLength(1);
    expect(r.events.map((e) => e.type)).toEqual(["unoCalled"]);
  });

  it("打到剩 1 张却没点喊：saidUno 是 false，交回合后可被抓", () => {
    const s = twoCards();
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [s.board!.hands[0][0].id] }, ctx());
    expect(r.state.board!.saidUno[0]).toBe(false);
    expect(catchIt(r.state, 1, 0).rejected).toBeUndefined();
  });

  it("喊过的人再出一张牌，不会把自己的声明擦掉", () => {
    // 已喊 + 2 张手牌是回合内到得了的局面（司夜②把他从 1 张顶开、或恒心摸了一张）
    const said = twoCards({ saidUno: [true, false, false] });
    const r = applyAction(said, { type: "playCards", seat: 0, cardIds: [said.board!.hands[0][0].id] }, ctx());
    expect(r.state.board!.saidUno[0]).toBe(true);
  });

  it("忘喊可补：回合结束后在别人回合点，成立且不罚", () => {
    const s = exposed(); // currentSeat = 0，座位 1 手上 1 张没喊
    const r = call(s, 1);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.saidUno[1]).toBe(true);
    expect(r.state.board!.hands[1]).toHaveLength(1);
    expect(r.events.map((e) => e.type)).toEqual(["unoCalled"]);
    expect(r.state.version).toBe(s.version + 1);
  });

  it("补喊与抓先到先得：被抓在前，补喊就落空（回合外 3 张，syncUno 当场作废，也不罚）", () => {
    const s = exposed();
    const caught = catchIt(s, 2, 1).state;
    expect(caught.board!.hands[1]).toHaveLength(3);
    const late = call(caught, 1);
    expect(late.rejected).toBeUndefined();
    // 不在自己回合 + 手牌 ≠1 → syncUno 当场清掉；2026-08-02 之后这一下不再罚
    expect(late.state.board!.saidUno[1]).toBe(false);
    expect(late.state.board!.hands[1]).toHaveLength(3);
    expect(late.events.some((e) => e.type === "unoMiscalled")).toBe(false);
  });
});

// ---------------------------------------------------------------- 作用域 = 你的这个回合

describe("U6 声明的作用域是你的这个回合", () => {
  /** 座位 0 持恒心（弃 1 摸 1）并已亮出，手上只剩 1 张——喊得成立。 */
  const steadfast = () =>
    twoCards({
      hands: [[card("R", "3")], [card("Y", "1"), card("Y", "5")], [card("Y", "2"), card("Y", "6")]],
      skills: ["spade-1", null, null],
      revealed: [true, false, false],
    });

  it("回合内穿越：喊过之后恒心弃 1 摸 1（1→0→1），声明不作废", () => {
    const said = call(steadfast(), 0);
    expect(said.rejected).toBeUndefined();
    const drop = said.state.board!.hands[0][0];
    const used = applyAction(
      said.state, { type: "activateSkill", seat: 0, effectKey: "1", cardIds: [drop.id] }, ctx(),
    );
    expect(used.rejected).toBeUndefined();
    // 中途手牌归 0 又回到 1——回合外的口径在归 0 那一刻就把已喊清掉了
    expect(used.state.board!.hands[0]).toHaveLength(1);
    expect(used.state.board!.saidUno[0]).toBe(true);
    expect(used.state.board!.currentSeat).toBe(0);
    expect(catchIt(used.state, 1, 0).rejected?.reason).toBe("not_catchable");
  });

  it("交回合结算：喊过但回合结束时手牌 2 张 → 声明作废 **且罚摸 2**（2026-08-02 改判）", () => {
    const said = call(steadfast(), 0).state;
    const used = applyAction(
      said, { type: "activateSkill", seat: 0, effectKey: "1", cardIds: [said.board!.hands[0][0].id] }, ctx(),
    ).state;
    // 摸一张（跟不上牌顶 → 回合当场结束），交回合时是 2 张
    const r = applyAction(used, { type: "drawCard", seat: 0 }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.currentSeat).toBe(1);
    // 结算只在交回合那一刻：1（弃1摸1后）+ 1（摸的）= 2 张 ≠ 1 → 作废并罚摸 2 → 4 张
    expect(r.state.board!.hands[0]).toHaveLength(4);
    expect(r.state.board!.saidUno[0]).toBe(false);
    expect(r.events.some((e) => e.type === "unoMiscalled")).toBe(true);
    // 下次到 1 张须重喊——按钮本来就常亮着
    expect(legalActions(r.state, 0)).toContainEqual({ type: "callUno", seat: 0 });
  });

  /*
    结转来的声明（2026-08-08 澄清）。真人局里报上来的那一幕：上一轮喊了 UNO 成立，
    这一轮无牌可出摸 1 张——徽记一直挂着（人以为还护着自己），到回合末还被虚喊结算
    平白罚摸 2。两件事同一个根：「声明此刻有效」与「本回合按过按钮」当成了一件事。
  */
  describe("上一轮成立、结转进来的声明", () => {
    /** 座位 0 手上 1 张跟不上牌顶的牌，`saidUno` 是上一轮结转来的（本回合没按过）。 */
    const carried = (drawPile: Card[]) =>
      table([[card("G", "9")], [card("Y", "1")], [card("Y", "2")]], {
        playedPile: [R7],
        drawPile,
        saidUno: [true, false, false],
      });

    it("摸 1 张顶到 2 张：徽记当场收回，UNO 键重新亮起", () => {
      // 摸到的牌跟得上牌顶 → 停在 play 相位，回合还没交，正是玩家看见「2 张 + 已喊」的那一帧
      const r = applyAction(carried([card("R", "3"), ...filler(3)]), { type: "drawCard", seat: 0 }, ctx());
      expect(r.state.board!.hands[0]).toHaveLength(2);
      expect(r.state.board!.saidUno[0]).toBe(false);
      expect(legalActions(r.state, 0)).toContainEqual({ type: "callUno", seat: 0 });
    });

    it("交回合时不是 1 张也**不罚**：那一声在上一个回合末就结算过了", () => {
      // 摸到的牌打不出 → 回合当场结束，2 张交出去
      const r = applyAction(carried([card("B", "5"), ...filler(3)]), { type: "drawCard", seat: 0 }, ctx());
      expect(r.state.board!.currentSeat).toBe(1);
      expect(r.state.board!.hands[0]).toHaveLength(2); // 摸的那 1 张，没有多出来的罚摸 2
      expect(r.events.some((e) => e.type === "unoMiscalled")).toBe(false);
    });

    it("本回合按过的那一声照旧受保护：手牌顶到 2 张也不清", () => {
      // 同一个牌桌，区别只在这一声是**本回合按的**（`carried` 那份是结转来的）
      const fresh = { ...carried([card("R", "3"), ...filler(3)]) };
      fresh.board = { ...fresh.board!, saidUno: [false, false, false] };
      const said = call(fresh, 0);
      expect(said.rejected).toBeUndefined();
      const drawn = applyAction(said.state, { type: "drawCard", seat: 0 }, ctx()).state;
      expect(drawn.board!.hands[0]).toHaveLength(2);
      expect(drawn.board!.saidUno[0]).toBe(true); // 回合内不清
    });
  });

  it("交回合时手牌恰 1 张：声明跟着那张牌存续，回合外也抓不得", () => {
    // 影歌②花 2 魂跳过：手牌一张没动就把回合交出去了
    const s = twoCards({
      hands: [[card("R", "3")], [card("Y", "1"), card("Y", "5")], [card("Y", "2"), card("Y", "6")]],
      skills: ["diamond-3", null, null],
      revealed: [true, false, false],
      marks: [{ 魂: 2 }, {}, {}],
    });
    const said = call(s, 0).state;
    const skipped = applyAction(said, { type: "activateSkill", seat: 0, effectKey: "2" }, ctx()).state;
    expect(skipped.board!.currentSeat).toBe(1);
    expect(skipped.board!.hands[0]).toHaveLength(1);
    expect(skipped.board!.saidUno[0]).toBe(true);
    expect(catchIt(skipped, 1, 0).rejected?.reason).toBe("not_catchable");
  });

  // 2026-08-02 改判：并列整组一次落地，中途不再有窗口，所以「摆到一半手牌几张」这个
  // 可观察的中间态整个不存在了。剩下的是「整组落完之后手上恰 1 张」这一种局面。
  it("并列整组落地后手牌恰 1 张：窗口挂着也喊得成立，且跨中间态存活", () => {
    const pair = [card("R", "2"), card("R", "2")];
    const raider = card("R", "2");
    const s = table([[...pair, card("R", "9")], [raider, card("B", "5")], [card("Y", "3"), card("Y", "4")]], {
      playedPile: [R7],
      drawPile: filler(30),
      skills: ["heart-4", "diamond-10", null],
      revealed: [true, true, false],
    });
    const opened = applyAction(s, { type: "playCards", seat: 0, cardIds: pair.map((c) => c.id) }, ctx()).state;
    expect(opened.pendingWindow?.type).toBe("interrupt");
    // 两张一次落地 → 手上只剩红 9；回合还是他的，所以抓不得（宽限期）
    expect(opened.board!.hands[0]).toHaveLength(1);
    expect(opened.board!.currentSeat).toBe(0);
    expect(catchIt(opened, 1, 0).rejected?.reason).toBe("not_catchable");

    const said = call(opened, 0);
    expect(said.rejected).toBeUndefined();
    expect(said.state.board!.saidUno[0]).toBe(true);
    // 劫营放弃 → 交回合，此刻恰 1 张 → 声明存续、不罚
    // windowId 取**开窗那一版**：callUno 会 version+1 并把当时的 id 冻进窗口（uno.ts::bump），
    // 拿 `wid(said.state)` 现算就是 stale_window
    const passed = applyAction(
      said.state, { type: "respond", seat: 1, windowId: wid(opened), choice: "pass" }, ctx(),
    );
    expect(passed.state.board!.saidUno[0]).toBe(true);
    expect(passed.state.board!.hands[0]).toHaveLength(1);
    expect(passed.events.some((e) => e.type === "unoMiscalled")).toBe(false);
  });

  it("劫营真的截断：整组已落地，被打断者摸 1 → 2 张，交回合时喊过就要罚", () => {
    const pair = [card("R", "2"), card("R", "2")];
    const raider = card("R", "2");
    const s = table([[...pair, card("R", "9")], [raider, card("B", "5")], [card("Y", "3"), card("Y", "4")]], {
      playedPile: [R7],
      drawPile: filler(30),
      skills: ["heart-4", "diamond-10", null],
      revealed: [true, true, false],
    });
    const opened = applyAction(s, { type: "playCards", seat: 0, cardIds: pair.map((c) => c.id) }, ctx()).state;
    const said = call(opened, 0).state; // 此刻恰 1 张，喊得对
    const cut = applyAction(
      said, { type: "respond", seat: 1, windowId: wid(opened), choice: "raid", cardIds: [raider.id] }, ctx(),
    );
    // 红 9 + G5 的摸 1 = 2 张（逐张模型下这里是 3）
    expect(cut.state.board!.hands[0]).toHaveLength(2 + 2);
    // 交回合时不是 1 张 → 声明作废 + 罚摸 2（U6 2026-08-02）
    expect(cut.state.board!.saidUno[0]).toBe(false);
    expect(cut.events.some((e) => e.type === "unoMiscalled")).toBe(true);
  });

  it("洗牌②摸 1 弃 1：喊过之后声明跨中间态存活（不再靠 ShufflePending.sayUno 透传）", () => {
    const sh = card(null, "shuffle");
    const s = table([[sh], [card("B", "3"), card("B", "4")], [card("Y", "3"), card("Y", "4")]], {
      playedPile: [R7],
      drawPile: filler(30),
    });
    // 手上恰 1 张（就是那张洗牌）→ 先喊成立，然后把它打出去
    const said = call(s, 0);
    expect(said.rejected).toBeUndefined();
    const opened = applyAction(
      said.state,
      { type: "playCards", seat: 0, cardIds: [sh.id], chosenColor: "B", shuffleChoice: "drawDiscard" },
      ctx(),
    ).state;
    // 打出去那一刻手牌为 0（洗牌是功能牌，U5 不判胜），摸 1 之后是 1 张，窗口挂着
    expect(opened.pendingWindow?.type).toBe("drawDiscard");
    expect(opened.board!.saidUno[0]).toBe(true);

    const done = applyAction(
      opened,
      { type: "respond", seat: 0, windowId: wid(opened), choice: "discard", cardIds: [opened.board!.hands[0][0].id] },
      ctx(),
    ).state;
    // 弃完手牌又归 0 → U5 补摸 1 → 交回合时恰 1 张，声明一路活到这里
    expect(done.board!.hands[0]).toHaveLength(1);
    expect(done.board!.saidUno[0]).toBe(true);
    expect(catchIt(done, 1, 0).rejected?.reason).toBe("not_catchable");
  });

  it("回合之外沿用旧口径：喊过之后手牌一离开 1 张就作废", () => {
    const said = call(exposed({ currentSeat: 1 }), 1).state;
    const r = applyAction(said, { type: "drawCard", seat: 1 }, ctx());
    expect(r.rejected).toBeUndefined();
    // 摸完回合就交出去了（摸到的绿 5 跟不上红 7）→ 2 张 → 作废
    expect(r.state.board!.saidUno[1]).toBe(false);
  });
});

// ---------------------------------------------------------------- 宽限期（U7 的硬门闩）

describe("U7 宽限期 = 你自己的回合", () => {
  /** 座位 0 只剩 1 张、没喊，而且正轮到他；持影歌②以便原样把回合交出去。 */
  const inTurn = () =>
    table([[card("R", "3")], [card("Y", "1"), card("Y", "5")], [card("Y", "2"), card("Y", "6")]], {
      playedPile: [R7],
      drawPile: filler(30),
      skills: ["diamond-3", null, null],
      revealed: [true, false, false],
      marks: [{ 魂: 2 }, {}, {}],
    });

  it("自己回合内持 1 张未喊：谁都抓不得，legalActions 里也没有这条", () => {
    const s = inTurn();
    expect(s.board!.saidUno[0]).toBe(false);
    expect(catchIt(s, 1, 0).rejected?.reason).toBe("not_catchable");
    expect(catchIt(s, 2, 0).rejected?.reason).toBe("not_catchable");
    expect(legalActions(s, 1)).not.toContainEqual({ type: "catchUno", seat: 1, target: 0 });
    // 他自己看得到补喊
    expect(legalActions(s, 0)).toContainEqual({ type: "callUno", seat: 0 });
  });

  it("回合交出去满 1 秒之后可抓", () => {
    const passed = applyAction(inTurn(), { type: "activateSkill", seat: 0, effectKey: "2" }, ctx()).state;
    expect(passed.board!.currentSeat).toBe(1);
    expect(legalActions(passed, 1)).toContainEqual({ type: "catchUno", seat: 1, target: 0 });
    const caught = catchIt(passed, 1, 0);
    expect(caught.rejected).toBeUndefined();
    expect(caught.state.board!.hands[0]).toHaveLength(3);
  });

  it("在别人回合里被顶到 1 张没有宽限期：劫营打断者满 1 秒后可抓", () => {
    const r2 = card("R", "2");
    const raider = card("R", "2");
    const s = table([[r2, card("R", "9")], [raider, card("B", "5")], [card("Y", "3"), card("Y", "4")]], {
      playedPile: [R7],
      drawPile: filler(30),
      skills: [null, "diamond-10", null],
      revealed: [false, true, false],
    });
    const opened = applyAction(s, { type: "playCards", seat: 0, cardIds: [r2.id] }, ctx()).state;
    const cut = applyAction(
      opened,
      { type: "respond", seat: 1, windowId: wid(opened), choice: "raid", cardIds: [raider.id] },
      ctx(),
    ).state;
    // 打断者手上只剩 1 张且没喊，而回合已经交给他的下家（G5）
    expect(cut.board!.hands[1]).toHaveLength(1);
    expect(cut.board!.currentSeat).toBe(2);
    expect(catchIt(cut, 0, 1).rejected).toBeUndefined();
  });
});

// ---------------------------------------------------------------- U7b 补喊宽限（2026-08-02）

describe("U7b 交回合后 1 秒补喊宽限", () => {
  /** 座位 0 只剩 1 张、没喊，轮到他；持影歌②以便原样把回合交出去。 */
  const passed = () =>
    applyAction(
      table([[card("R", "3")], [card("Y", "1"), card("Y", "5")], [card("Y", "2"), card("Y", "6")]], {
        playedPile: [R7],
        drawPile: filler(30),
        skills: ["diamond-3", null, null],
        revealed: [true, false, false],
        marks: [{ 魂: 2 }, {}, {}],
      }),
      { type: "activateSkill", seat: 0, effectKey: "2" },
      ctx(),
    ).state;

  it("宽限里抓 → uno_grace，局面纹丝不动（version 不涨、手牌不变）", () => {
    const s = passed();
    for (const at of [0, 500, 999]) {
      const r = catchIt(s, 1, 0, at);
      expect(r.rejected?.reason).toBe("uno_grace");
      expect(r.state.version).toBe(s.version);
      expect(r.state.board!.hands[0]).toHaveLength(1);
    }
  });

  it("满 1 秒之后照常抓得着", () => {
    const s = passed();
    expect(catchIt(s, 1, 0, 1_000).rejected).toBeUndefined();
    expect(catchIt(s, 1, 0, 5_000).rejected).toBeUndefined();
  });

  it("宽限里他自己补喊得成：这正是这 1 秒的用处", () => {
    const r = call(passed(), 0);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.saidUno[0]).toBe(true);
    expect(r.state.board!.hands[0]).toHaveLength(1);
  });

  it("宽限**只保护刚交出回合的那个座位**，别人照抓不误", () => {
    // 座位 0 交出回合（拿宽限），座位 2 手上也是 1 张没喊却没交过回合
    const s = passed();
    const other = { ...s, board: { ...s.board!, hands: [s.board!.hands[0], s.board!.hands[1], [card("Y", "2")]] } };
    expect(other.board.unoGrace!.seat).toBe(0);
    expect(catchIt(other, 1, 2, 0).rejected).toBeUndefined();
  });

  it("快照带着宽限的截止时刻，UI 才画得出「还不能抓」", () => {
    const s = passed();
    expect(projectView(s, 1).unoGrace).toEqual(s.board!.unoGrace);
    expect(Date.parse(s.board!.unoGrace!.until) - Date.parse(NOW)).toBe(UNO_GRACE_MS);
  });
});

// ---------------------------------------------------------------- 司夜②与已喊状态（04 ♣3）

describe("司夜②换牌与已喊（04 ♣3 2026-07-31 裁定，改判后仍成立）", () => {
  const nightlord = (over: Partial<Board> = {}) =>
    table([[card("R", "3")], [card("Y", "1")], [card("Y", "2"), card("Y", "6")]], {
      playedPile: [R7],
      drawPile: filler(30),
      skills: ["club-3", null, null],
      revealed: [true, false, false],
      marks: [{ 盗: 1 }, {}, {}],
      ...over,
    });

  it("把目标顶离 1 张 → 目标的已喊作废，还完牌须重喊、当场可抓", () => {
    const s = nightlord({ saidUno: [false, true, false] });
    const drawn = applyAction(s, { type: "stealSwap", seat: 0, target: 1 }, ctx()).state;
    expect(drawn.board!.hands[1]).toHaveLength(0);
    expect(drawn.board!.saidUno[1]).toBe(false);

    const back = applyAction(
      drawn,
      { type: "respond", seat: 0, windowId: wid(drawn), choice: "stolen" },
      ctx(),
    ).state;
    expect(back.board!.hands[1]).toHaveLength(1);
    expect(back.board!.saidUno[1]).toBe(false);
    expect(catchIt(back, 2, 1).rejected).toBeUndefined();
  });

  it("不作废**司夜自己**的已喊：他在自己的回合里，手牌 1→2→1 都不管", () => {
    // 「回合内不清」保护的是**本回合按过按钮**的那一声，所以 unoThisTurn 要跟着立
    const s = nightlord({ saidUno: [true, false, false], unoThisTurn: [true, false, false] });
    const drawn = applyAction(s, { type: "stealSwap", seat: 0, target: 2 }, ctx()).state;
    expect(drawn.board!.hands[0]).toHaveLength(2);
    expect(drawn.board!.saidUno[0]).toBe(true);

    const back = applyAction(
      drawn,
      { type: "respond", seat: 0, windowId: wid(drawn), choice: "stolen" },
      ctx(),
    ).state;
    expect(back.board!.hands[0]).toHaveLength(1);
    expect(back.board!.saidUno[0]).toBe(true);
  });

  it("换牌窗口挂着时目标手上的 1 张是假象，抓不得", () => {
    const s = nightlord({ hands: [[card("R", "3")], [card("Y", "1"), card("Y", "5")], [card("Y", "2")]] as Card[][] });
    const drawn = applyAction(s, { type: "stealSwap", seat: 0, target: 1 }, ctx()).state;
    expect(drawn.board!.hands[1]).toHaveLength(1);
    expect(catchIt(drawn, 2, 1).rejected?.reason).toBe("not_catchable");
  });
});

// ---------------------------------------------------------------- 抓漏喊

describe("U7 抓漏喊", () => {
  it("任何人不限回合可抓：被抓摸 2 张", () => {
    const s = exposed();
    const r = catchIt(s, 2, 1);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[1]).toHaveLength(3);
    expect(r.state.board!.saidUno[1]).toBe(false);
    expect(r.events.map((e) => e.type)).toEqual(["unoCaught", "cardsDrawn"]);
  });

  it("U7 的 2 张不是惩罚：目标亮着恩惠照样摸满 2 张", () => {
    const s = exposed({ skills: [null, "heart-1", null], revealed: [false, true, false] });
    expect(catchIt(s, 0, 1).state.board!.hands[1]).toHaveLength(3);
  });

  it("喊过的抓不到；自己不能抓自己；手牌不是 1 张抓不到", () => {
    const said = call(exposed(), 1).state;
    expect(catchIt(said, 0, 1).rejected?.reason).toBe("not_catchable");
    const s = exposed();
    expect(catchIt(s, 1, 1).rejected?.reason).toBe("bad_target");
    expect(catchIt(s, 1, 0).rejected?.reason).toBe("not_catchable");
  });

  it("legalActions：目标自己看到 callUno，其他人看到 catchUno——不轮到谁都一样", () => {
    const s = exposed(); // currentSeat = 0
    expect(legalActions(s, 1)).toContainEqual({ type: "callUno", seat: 1 });
    expect(legalActions(s, 2)).toContainEqual({ type: "catchUno", seat: 2, target: 1 });
    expect(legalActions(s, 0)).toContainEqual({ type: "catchUno", seat: 0, target: 1 });
  });

  it("反应窗口不挡补喊与抓（U7 明文含窗口期间）", () => {
    const s = exposed({ punish: { initiator: 0, segments: [{ seat: 0, face: "+2", draw: 2 }], total: 2 } });
    const withWindow = {
      ...s,
      phase: "afterPlay" as const,
      pendingWindow: {
        type: "punishStack", actors: [2], deadline: "2026-07-28T12:00:30.000Z",
        defaultChoice: "accept", resume: "play" as const,
      },
    };
    const r = catchIt(withWindow, 2, 1);
    expect(r.rejected).toBeUndefined();
    expect(r.state.pendingWindow).toBeDefined(); // 窗口原样保留
    expect(legalActions(withWindow, 0)).toContainEqual({ type: "catchUno", seat: 0, target: 1 });
  });
});
