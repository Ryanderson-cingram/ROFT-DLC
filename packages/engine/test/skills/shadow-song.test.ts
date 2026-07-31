// 影歌♦3：①一次性攒魂（宣言一张色+数，其他人依次三选一）、②花 2 魂跳过回合。
// 规则：01-S15、04 ♦3（2026-07-30 补齐的①流程）、06-Q10/Q39/Q46/Q54/Q56。
import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../../src/index.ts";
import { markCount } from "../../src/skills/primitives/marks.ts";
import type { Action, Board, Card, GameState } from "../../src/types.ts";
import { card, ctx, table } from "../helpers.ts";

const R7 = card("R", "7");
const filler = (n: number) => Array.from({ length: n }, () => card("G", "9"));

/** 3 人局：座位 0 持影歌并已亮出（V3），牌顶红 7——与宣言的「蓝 2」毫无关系。 */
const seated = (over: Partial<Board> = {}, hands?: Card[][]) =>
  table(hands ?? [[card("R", "3")], [card("B", "2"), card("Y", "5")], [card("B", "7"), card("Y", "2")]], {
    skills: ["diamond-3", null, null],
    revealed: [true, false, false],
    playedPile: [R7],
    drawPile: filler(30),
    ...over,
  });

const BLUE2 = { color: "B", face: "2" } as const;
const harvest = (s: GameState, declared: unknown = BLUE2) =>
  applyAction(
    s,
    { type: "activateSkill", seat: 0, effectKey: "1", declared } as Action,
    ctx(),
  );
const wid = (s: GameState) => `w${s.version}:${s.pendingWindow!.type}`;
const respond = (s: GameState, seat: number, choice: string, cardIds?: string[], c = ctx()) =>
  applyAction(s, { type: "respond", seat, windowId: wid(s), choice, ...(cardIds && { cardIds }) }, c);

// ---------------------------------------------------------------- ① 宣言

describe("影歌① 的宣言", () => {
  it("宣言进 public，窗口从下家开始按 direction 轮一圈（不含发动者）", () => {
    const r = harvest(seated());
    expect(r.rejected).toBeUndefined();
    expect(r.state.pendingWindow!.type).toBe("soulHarvest");
    expect(r.state.pendingWindow!.actors).toEqual([1]);
    expect(r.state.board!.soulHarvest!.queue).toEqual([1, 2]);
    const started = r.events.find((e) => e.type === "soulHarvestStarted")!;
    expect(started.public).toEqual({ seat: 0, declared: BLUE2, actors: [1, 2] });
  });

  it("逆时针局面里顺序跟着 direction 走", () => {
    const r = harvest(seated({ direction: -1 }));
    expect(r.state.board!.soulHarvest!.queue).toEqual([2, 1]);
  });

  it("不带宣言就发动不了", () => {
    const r = applyAction(seated(), { type: "activateSkill", seat: 0, effectKey: "1" }, ctx());
    expect(r.rejected?.reason).toBe("declaration_required");
  });

  it("宣言限数字牌：功能牌与无色都不行", () => {
    expect(harvest(seated(), { color: "B", face: "+2" }).rejected?.reason).toBe("bad_declaration");
    expect(harvest(seated(), { color: null, face: "2" }).rejected?.reason).toBe("bad_declaration");
  });

  it("发动者手里没有那张牌照样可以指定（2026-07-30 更正）", () => {
    const s = seated();
    expect(s.board!.hands[0].some((c) => c.color === "B" && c.face === "2")).toBe(false);
    expect(harvest(s).rejected).toBeUndefined();
  });

  it("比对对象是宣言，不是牌顶：牌顶红 7 与整个流程无关", () => {
    const opened = harvest(seated()).state;
    // 座位 1 手里的蓝 2 与牌顶红 7 半点关系没有，却是完美匹配
    expect(legalActions(opened, 1)).toContainEqual({
      type: "respond",
      seat: 1,
      windowId: wid(opened),
      choice: "show-exact",
      cardIds: [opened.board!.hands[1][0].id],
    });
  });

  // 2026-07-31 裁定：不替玩家做取舍，所有亮得出去的组合都摆出来，UI 照单高亮
  it("完美匹配的牌两条都给：走②多摸 1 张虽然纯亏，也由玩家自己选", () => {
    const opened = harvest(seated()).state;
    const perfect = opened.board!.hands[1][0].id; // 蓝 2，对宣言「蓝 2」是完美匹配
    const acts = legalActions(opened, 1);
    for (const choice of ["show-exact", "show-partial"])
      expect(acts).toContainEqual({ type: "respond", seat: 1, windowId: wid(opened), choice, cardIds: [perfect] });
    // 摸 3 永远在
    expect(acts).toContainEqual({ type: "respond", seat: 1, windowId: wid(opened), choice: "draw3" });
  });
});

// ---------------------------------------------------------------- ① 三选一

describe("影歌① 的三选一", () => {
  const opened = () => harvest(seated()).state;

  it("同色且同数：亮出不摸牌，牌留在手里", () => {
    const s = opened();
    const blue2 = s.board!.hands[1][0];
    const r = respond(s, 1, "show-exact", [blue2.id]);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[1]).toHaveLength(2);
    expect(r.state.board!.soulHarvest!.drawn).toBe(0);
  });

  it("同色或同数：亮出并摸 1（数值来自定义的 draws_partial）", () => {
    const s = opened();
    const r = respond(s, 1, "show-partial", [s.board!.hands[1][0].id]);
    expect(r.state.board!.hands[1]).toHaveLength(3);
    expect(r.state.board!.soulHarvest!.drawn).toBe(1);
  });

  it("同数不同色也算半匹配（座位 2 的黄 2）", () => {
    const s = opened();
    const yellow2 = s.board!.hands[2][1];
    const r = respond(respond(s, 1, "draw3").state, 2, "show-partial", [yellow2.id]);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[2]).toHaveLength(3);
  });

  it("不亮：摸 3（数值来自定义的 draws）", () => {
    const r = respond(opened(), 1, "draw3");
    expect(r.state.board!.hands[1]).toHaveLength(5);
    expect(r.state.board!.soulHarvest!.drawn).toBe(3);
  });

  it("手里有完美匹配也可以选摸 3——不强制选得最优", () => {
    const r = respond(opened(), 1, "draw3");
    expect(r.rejected).toBeUndefined();
  });

  it("亮的牌与宣言对不上：拒，局面一点没动，可以重选", () => {
    const s = opened();
    const yellow5 = s.board!.hands[1][1];
    const r = respond(s, 1, "show-exact", [yellow5.id]);
    expect(r.rejected?.reason).toBe("bad_choice");
    expect(r.state).toBe(s);
    expect(respond(s, 1, "draw3").rejected).toBeUndefined();
  });

  it("亮一张不在手里的牌", () => {
    expect(respond(opened(), 1, "show-exact", ["没有这张"]).rejected?.reason).toBe("not_in_hand");
  });

  it("窗口里只有当前 actor 能响应，下一个还轮不到", () => {
    expect(respond(opened(), 2, "draw3").rejected?.reason).toBe("not_your_window");
  });

  it("亮出的那张进 public（展示给所有人），摸到的牌只有自己看得见", () => {
    const s = opened();
    const blue2 = s.board!.hands[1][0];
    const shown = respond(s, 1, "show-partial", [blue2.id]).events;
    expect(shown.find((e) => e.type === "soulHarvestResponse")!.public)
      .toEqual({ seat: 1, choice: "show-partial", card: blue2 });
    const drawn = shown.find((e) => e.type === "cardsDrawn")!;
    expect(drawn.private?.seat).toBe(1);
    expect(drawn.public.cards).toBeUndefined();
  });
});

// ---------------------------------------------------------------- ① 结算

describe("影歌① 的结算", () => {
  it("一圈走完：按实际摸到的总张数攒魂，窗口与上下文都清干净", () => {
    const s = harvest(seated()).state;
    const one = respond(s, 1, "show-exact", [s.board!.hands[1][0].id]).state; // 摸 0
    const r = respond(one, 2, "draw3"); // 摸 3
    expect(r.state.pendingWindow).toBeUndefined();
    expect(r.state.board!.soulHarvest).toBeUndefined();
    expect(markCount(r.state.board!, 0, "魂")).toBe(3);
    expect(r.events.find((e) => e.type === "soulHarvestEnded")!.public)
      .toEqual({ seat: 0, gained: 3, souls: 3 });
  });

  it("结算后回到发动者的 turnStart：他还能出牌，但主动额度用掉了（V7）", () => {
    const s = harvest(seated()).state;
    const done = respond(respond(s, 1, "draw3").state, 2, "draw3").state;
    expect(done.phase).toBe("turnStart");
    expect(done.board!.currentSeat).toBe(0);
    expect(done.board!.activatedThisTurn[0]).toBe(true);
    expect(legalActions(done, 0).some((a) => a.type === "activateSkill")).toBe(false);
  });

  it("06-Q56：这些摸牌是「他人技能」，响应者的恩惠减得掉，魂按实际摸到的算", () => {
    const s = harvest(
      seated(
        { skills: ["diamond-3", "heart-1", null], revealed: [true, true, false] },
        [[card("R", "3")], [card("B", "2"), card("Y", "5")], [card("B", "2"), card("Y", "2")]],
      ),
    ).state;
    const one = respond(s, 1, "draw3").state; // 3 − 2 = 1
    expect(one.board!.hands[1]).toHaveLength(3); // 原本 2 张 + 1
    const r = respond(one, 2, "show-exact", [one.board!.hands[2][0].id]); // 完美匹配，不摸
    expect(markCount(r.state.board!, 0, "魂")).toBe(1);
  });

  it("S15：魂上限 6，上限从定义的 values.max 读", () => {
    // 4 人局，三个人各摸 3 = 9 张，攒到 6 就封顶
    const four = seated(
      { skills: ["diamond-3", null, null, null], revealed: [true, false, false, false] },
      [[card("R", "3")], filler(1), filler(1), filler(1)],
    );
    let s = harvest(four).state;
    for (const seat of [1, 2, 3]) s = respond(s, seat, "draw3").state;
    expect(markCount(s.board!, 0, "魂")).toBe(6);
  });

  it("06-Q46：牌堆见底摸不足时，魂按**实际**摸到的张数算", () => {
    const s = harvest(seated({ drawPile: filler(1), discardPile: [], playedPile: [R7] })).state;
    const r = respond(respond(s, 1, "draw3").state, 2, "draw3");
    // 摸牌堆只有 1 张，出牌堆只剩牌顶、弃牌堆空 → 洗不回来，总共只摸到 1 张
    expect(markCount(r.state.board!, 0, "魂")).toBe(1);
  });

  it("超时只结当前 actor（默认摸 3），轮到下一个而不是整窗关闭", () => {
    const s = harvest(seated()).state;
    const late = ctx(undefined, "2026-07-28T12:01:00.000Z");
    const r = applyAction(s, { type: "claimTimeout", seat: 0, windowId: wid(s) }, late);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.hands[1]).toHaveLength(5); // 按 draw3 结了
    expect(r.state.pendingWindow!.actors).toEqual([2]);
    // deadline 顺延：下一个人重新拿到 30s
    expect(r.state.pendingWindow!.deadline).toBe("2026-07-28T12:01:30.000Z");
  });

  it("没到点不能催", () => {
    const s = harvest(seated()).state;
    expect(applyAction(s, { type: "claimTimeout", seat: 0, windowId: wid(s) }, ctx()).rejected?.reason)
      .toBe("not_yet_expired");
  });

  it("窗口挂着时其他动作都被挡住", () => {
    const s = harvest(seated()).state;
    expect(applyAction(s, { type: "drawCard", seat: 0 }, ctx()).rejected?.reason).toBe("pending_window");
  });
});

// ---------------------------------------------------------------- ① 一次性

describe("影歌① 是整局一次的（S15 / once: once）", () => {
  const spent = () => {
    const s = harvest(seated()).state;
    return respond(respond(s, 1, "draw3").state, 2, "draw3").state;
  };

  it("同回合再发动一次先撞上 V7 的额度", () => {
    expect(harvest(spent()).rejected?.reason).toBe("already_activated");
  });

  it("跨回合仍然拒，且 legalActions 里不再出现它", () => {
    const done = spent();
    // 把回合还给座位 0：额度已重置，但一次性的账不随回合清
    const nextTurn: GameState = {
      ...done,
      board: { ...done.board!, activatedThisTurn: [false, false, false] },
    };
    expect(harvest(nextTurn).rejected?.reason).toBe("already_used");
    expect(legalActions(nextTurn, 0).filter((a) => a.type === "activateSkill").map((a) => a.effectKey))
      .toEqual(["2"]);
  });

  it("宣言不合法时不记账：改对了还能发", () => {
    const bad = harvest(seated(), { color: "B", face: "+2" });
    expect(bad.state.board!.usedOnce).toBeUndefined();
    expect(harvest(bad.state).rejected).toBeUndefined();
  });
});

// ---------------------------------------------------------------- ② 花魂跳过

describe("影歌②：花 2 魂跳过本回合", () => {
  const withSouls = (n: number, over: Partial<Board> = {}) =>
    seated({ marks: [{ 魂: n }, {}, {}], ...over });
  const skip = (s: GameState) => applyAction(s, { type: "activateSkill", seat: 0, effectKey: "2" }, ctx());

  it("扣 2 魂、回合交给下家（数值来自定义的 values.marks）", () => {
    const r = skip(withSouls(3));
    expect(r.rejected).toBeUndefined();
    expect(markCount(r.state.board!, 0, "魂")).toBe(1);
    expect(r.state.board!.currentSeat).toBe(1);
    expect(r.state.phase).toBe("turnStart");
    expect(r.events.map((e) => e.type)).toEqual(["skillActivated", "turnSkipped"]);
  });

  it("06-Q54：魂不够就发动不了，且发动机会不消耗", () => {
    const s = withSouls(1);
    const r = skip(s);
    expect(r.rejected?.reason).toBe("cost_unpayable");
    expect(r.state).toBe(s);
    expect(r.state.board!.activatedThisTurn[0]).toBe(false);
  });

  it("魂不够时 legalActions **不给**②的入口（付不起的按钮不该渲染）", () => {
    const key = { type: "activateSkill", seat: 0, effectKey: "2" };
    expect(legalActions(withSouls(1), 0)).not.toContainEqual(key);
    expect(legalActions(withSouls(2), 0)).toContainEqual(key);
  });

  it("V7：跳过占掉主动额度，所以同回合两条主动只能选一条", () => {
    const twice = harvest(withSouls(3)).state;
    expect(applyAction(twice, { type: "activateSkill", seat: 0, effectKey: "2" }, ctx()).rejected?.reason)
      .toBe("pending_window");
    const done = respond(respond(twice, 1, "draw3").state, 2, "draw3").state;
    expect(skip(done).rejected?.reason).toBe("already_activated");
  });
});

// ---------------------------------------------------------------- ② 惩罚回合

describe("影歌② 在惩罚回合（S15 / 06-Q39 / 06-Q10）", () => {
  /** 座位 1 打出 +2 指向座位 2（持影歌，已亮出，攒了 2 魂）。 */
  const facing = (over: Partial<Board> = {}) =>
    table([[card("Y", "1")], [card("Y", "3")], [card("R", "3"), card("R", "4")]], {
      skills: [null, null, "diamond-3"],
      revealed: [false, false, true],
      marks: [{}, {}, { 魂: 2 }],
      playedPile: [R7],
      drawPile: filler(30),
      punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2 }], total: 2 },
      currentSeat: 1,
      ...over,
    }, {
      phase: "afterPlay",
      pendingWindow: {
        type: "punishStack",
        actors: [2],
        deadline: "2026-07-28T12:00:30.000Z",
        defaultChoice: "accept",
        resume: "play",
      },
    });

  const soulSkip = (s: GameState) => respond(s, 2, "soul-skip");

  it("惩罚窗口里多出 soul-skip 这个选项（P1 的例外由 suppression_exempt 承载）", () => {
    const acts = legalActions(facing(), 2).filter((a) => a.type === "respond").map((a) => a.choice);
    expect(acts).toContain("soul-skip");
  });

  it("跳过：扣 2 魂、自己一张牌都没摸，链原样顺延给下家", () => {
    const r = soulSkip(facing());
    expect(r.rejected).toBeUndefined();
    expect(markCount(r.state.board!, 2, "魂")).toBe(0);
    expect(r.state.board!.hands[2]).toHaveLength(2);
    expect(r.state.board!.punish!.total).toBe(2);
    expect(r.state.board!.punish!.segments).toHaveLength(1);
    expect(r.state.pendingWindow!.actors).toEqual([0]); // 座位 2 的下家成了新的受罚者
    expect(r.events.map((e) => e.type)).toEqual(["turnSkipped", "punishWindowOpened"]);
  });

  it("下一家照常吃下整条链——链没有因为跳过而缩水", () => {
    const passed = soulSkip(facing()).state;
    const r = respond(passed, 0, "accept");
    expect(r.state.board!.hands[0]).toHaveLength(3); // 原本 1 张 + 吃下 2 张
    expect(r.state.board!.punish).toBeUndefined();
  });

  it("魂不够就没有这个选项，也结算不了（06-Q54）", () => {
    const broke = facing({ marks: [{}, {}, { 魂: 1 }] });
    expect(legalActions(broke, 2).map((a) => (a.type === "respond" ? a.choice : ""))).not.toContain("soul-skip");
    expect(soulSkip(broke).rejected?.reason).toBe("suppressed");
  });

  it("01-P9：封印不可例外——被封印的影歌在惩罚窗口里没有这个选项", () => {
    const sealed = facing({ statuses: [[], [], ["封印"]] });
    expect(legalActions(sealed, 2).map((a) => (a.type === "respond" ? a.choice : ""))).not.toContain("soul-skip");
    expect(soulSkip(sealed).rejected?.reason).toBe("suppressed");
  });

  it("没亮出的影歌不给这个选项（V3）", () => {
    const hidden = facing({ revealed: [false, false, false] });
    expect(legalActions(hidden, 2).map((a) => (a.type === "respond" ? a.choice : ""))).not.toContain("soul-skip");
  });

  it("没有豁免声明的技能照旧被压制：恒心在惩罚窗口里没有额外选项（P1）", () => {
    const other = facing({ skills: [null, null, "spade-1"] });
    expect(legalActions(other, 2).filter((a) => a.type === "respond").map((a) => a.choice))
      .toEqual(["accept"]);
  });
});

// ---------------------------------------------------------------- ②在一条链上跳两次

describe("影歌② 不是一次性：同一条链绕回来还能再跳", () => {
  /** 3 人局：座位 1 链首打了 +2 指向座位 2（影歌，4 魂）；座位 0/1 手里各有一张 +2 可叠。 */
  const chain = (over: Partial<Board> = {}) =>
    table(
      [[card("R", "+2"), card("Y", "1")], [card("R", "+2"), card("Y", "3")], [card("R", "3"), card("R", "4")]],
      {
        skills: [null, "diamond-2", "diamond-3"],
        revealed: [false, true, true],
        marks: [{}, {}, { 魂: 4 }],
        playedPile: [R7],
        drawPile: filler(30),
        punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2 }], total: 2 },
        currentSeat: 1,
        ...over,
      },
      {
        phase: "afterPlay",
        pendingWindow: {
          type: "punishStack", actors: [2], deadline: "2026-07-28T12:00:30.000Z",
          defaultChoice: "accept", resume: "play",
        },
      },
    );

  /** 座位 2 跳过 → 0 叠一张 → 1 叠一张 → 窗口又回到座位 2。 */
  const roundTrip = (s: GameState) => {
    const skipped = respond(s, 2, "soul-skip").state;
    expect(skipped.pendingWindow!.actors).toEqual([0]);
    const stacked = respond(skipped, 0, "stack").state;
    const played = applyAction(
      stacked, { type: "playCards", seat: 0, cardIds: [stacked.board!.hands[0][0].id] }, ctx(),
    ).state;
    expect(played.pendingWindow!.actors).toEqual([1]);
    const again = respond(played, 1, "stack").state;
    return applyAction(again, { type: "playCards", seat: 1, cardIds: [again.board!.hands[1][0].id] }, ctx()).state;
  };

  it("链转一圈回来：魂够就再跳一次（②是 unlimited，不占次数账）", () => {
    const back = roundTrip(chain());
    expect(back.pendingWindow!.actors).toEqual([2]);
    expect(markCount(back.board!, 2, "魂")).toBe(2);

    const twice = respond(back, 2, "soul-skip");
    expect(twice.rejected).toBeUndefined();
    expect(markCount(twice.state.board!, 2, "魂")).toBe(0);
    expect(twice.events.map((e) => e.type)).toEqual(["turnSkipped", "punishWindowOpened"]);
    // 链一张没缩水：三段 +2 全在
    expect(twice.state.board!.punish!.segments).toHaveLength(3);
  });

  it("跳过把链推回**链首本人**：他吃下自己发起的链，血棘不封印自己（04 ♦2 2026-07-31）", () => {
    const skipped = respond(chain(), 2, "soul-skip").state;
    const stacked = respond(skipped, 0, "stack").state;
    const played = applyAction(
      stacked, { type: "playCards", seat: 0, cardIds: [stacked.board!.hands[0][0].id] }, ctx(),
    ).state;
    // 座位 2 跳过 + 座位 0 叠一张 → 窗口落回链首座位 1 自己头上
    expect(played.pendingWindow!.actors).toEqual([1]);

    const eaten = respond(played, 1, "accept");
    expect(eaten.rejected).toBeUndefined();
    expect(eaten.events.map((e) => e.type)).not.toContain("sealed");
    expect(eaten.state.board!.statuses.flat()).toEqual([]);
    // 两段 +2 = 吃 4 张（链没因为跳过而缩水）
    expect(eaten.state.board!.hands[1]).toHaveLength(2 + 4);
  });
});

// ---------------------------------------------------------------- 快照

describe("快照与暗信息", () => {
  it("03 §5：魂是公开计数，别人也看得到", () => {
    const s = seated({ marks: [{ 魂: 4 }, {}, {}] });
    expect(projectView(s, 1).players[0].marks).toEqual({ 魂: 4 });
  });

  it("攒魂窗口不泄露任何人的手牌", () => {
    const opened = harvest(seated()).state;
    for (const seat of [0, 1, 2]) {
      const wire = JSON.stringify(projectView(opened, seat));
      for (const c of opened.board!.hands.flatMap((h, i) => (i === seat ? [] : h)))
        expect(wire).not.toContain(c.id);
    }
  });
});
