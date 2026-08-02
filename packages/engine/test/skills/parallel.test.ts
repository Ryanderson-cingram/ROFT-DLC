// 并列♥4：一次合法多打（01-G2）。规则：04 ♥4（2026-07-30 补齐的三形状）、
// 06-Q35（改出牌规则，不占 V7、不发动）、01-U2（多张收官免喊 UNO）。
// 跟牌目标落在 activeColor + activeFace 上——4 张/6 张打完后跟的不是堆顶那张牌。
import { describe, expect, it } from "vitest";
import { applyAction, legalActions, projectView } from "../../src/index.ts";
import type { Board, Card, Color, GameState } from "../../src/types.ts";
import { card, ctx, ctxAfter, table } from "../helpers.ts";

/** 座位 0 持并列并已亮出；牌顶默认蓝 2。 */
const par = (hands: Card[][], over: Partial<Board> = {}, state: Partial<GameState> = {}) =>
  table(hands, {
    playedPile: [card("B", "2")],
    skills: ["heart-4", null, null],
    revealed: [true, false, false],
    ...over,
  }, state);

const play = (s: GameState, cards: Card[], chosenColor?: Color) =>
  applyAction(s, { type: "playCards", seat: 0, cardIds: cards.map((c) => c.id), chosenColor }, ctx());

/** 某个座位此刻能打的牌 id——走 legalActions，跟客户端拿到的是同一份。 */
const playableIds = (s: GameState, seat: number) =>
  legalActions(s, seat).flatMap((a) => (a.type === "playCards" ? a.cardIds : []));

describe("并列♥4 的三种形状", () => {
  it("2 张同色同数：牌顶蓝 2 → 两张黄 2，下家跟黄 2", () => {
    const [a, b2] = [card("Y", "2"), card("Y", "2")];
    const follow = [card("G", "2"), card("G", "5")];
    const s = par([[a, b2, card("R", "9")], follow, [card("R", "1")]]);
    const r = play(s, [a, b2]);
    expect(r.rejected).toBeUndefined();
    const b = r.state.board!;
    // 整组按提交顺序压入，最后一张在堆顶
    expect(b.playedPile.slice(0, 3).map((c) => c.id)).toEqual([b2.id, a.id, s.board!.playedPile[0].id]);
    expect(b.activeColor).toBe("Y");
    expect(b.activeFace).toBe("2");
    expect(b.hands[0]).toHaveLength(1);
    // 下家跟得上绿 2（同数），跟不上绿 5
    expect(playableIds(r.state, 1)).toEqual([follow[0].id]);
  });

  it("4 张同数：跟色由打出者选（复用 chosenColor）", () => {
    const four = [card("R", "2"), card("G", "2"), card("B", "2"), card("Y", "2")];
    const follow = [card("R", "5"), card("G", "2"), card("G", "5")];
    const s = par([[...four, card("R", "9")], follow, [card("R", "1")]]);
    const r = play(s, four, "R");
    expect(r.rejected).toBeUndefined();
    const b = r.state.board!;
    expect(b.playedPile[0].id).toBe(four[3].id);
    expect(b.activeColor).toBe("R");
    expect(b.activeFace).toBe("2");
    // 跟红（选的色）或跟 2（打的数）都行，绿 5 两头都不沾
    expect(playableIds(r.state, 1)).toEqual([follow[0].id, follow[1].id]);
  });

  it("6 张同色：跟的是六张里最大的那个数", () => {
    const six = ["1", "3", "9", "2", "4", "5"].map((f) => card("B", f as Card["face"]));
    const follow = [card("Y", "9"), card("Y", "5")];
    const s = par([[...six, card("R", "9")], follow, [card("R", "1")]], { playedPile: [card("B", "7")] });
    const r = play(s, six);
    expect(r.rejected).toBeUndefined();
    const b = r.state.board!;
    expect(b.activeColor).toBe("B");
    expect(b.activeFace).toBe("9");
    // 堆顶那张是蓝 5，但跟的是 9——黄 9 可打、黄 5 不可
    expect(b.playedPile[0].face).toBe("5");
    expect(playableIds(r.state, 1)).toEqual([follow[0].id]);
  });
});

describe("并列的形状校验", () => {
  const badShape = (cards: Card[], chosenColor?: Color) => {
    const s = par([[...cards, card("R", "9")], [card("R", "1")], [card("R", "1")]]);
    return play(s, cards, chosenColor).rejected?.reason;
  };

  it("2 张异色同数不成形状", () => {
    expect(badShape([card("Y", "2"), card("G", "2")])).toBe("bad_shape");
  });

  it("4 张里有一张不同数不成形状", () => {
    expect(badShape([card("R", "2"), card("G", "2"), card("B", "2"), card("Y", "3")])).toBe("bad_shape");
  });

  it("6 张里有一张不同色不成形状", () => {
    const six = [card("B", "1"), card("B", "3"), card("B", "9"), card("B", "2"), card("B", "4"), card("G", "5")];
    expect(badShape(six)).toBe("bad_shape");
  });

  it("功能牌不参与并列，哪怕同色同数", () => {
    expect(badShape([card("B", "+2"), card("B", "+2")])).toBe("bad_shape");
  });

  it("张数不对（3 张同色同数）也不成形状", () => {
    expect(badShape([card("Y", "2"), card("Y", "2"), card("Y", "2")])).toBe("bad_shape");
  });

  it("4 张形状必须带 chosenColor", () => {
    expect(badShape([card("R", "2"), card("G", "2"), card("B", "2"), card("Y", "2")])).toBe("color_required");
  });

  it("首张接不上牌顶就整组打不出（牌顶蓝 2，两张黄 5）", () => {
    expect(badShape([card("Y", "5"), card("Y", "5")])).toBe("illegal_card");
  });

  // 04 ♥4：「三种合法多打，**首张**都必须按常规接得上牌顶」。逐张摆之后哪张先落地
  // 是可观察事实，所以校验的是 cards[0]，不是「组里随便哪张接得上」。
  it("六张同色里能接的那张排在最后 → 拒：先落地的接不上牌顶", () => {
    const six = ["1", "2", "3", "4", "6", "5"].map((f) => card("R", f as Card["face"]));
    const s = par([[...six, card("Y", "9")], [card("R", "1")], [card("R", "1")]], {
      playedPile: [card("B", "5")],
    });
    expect(play(s, six).rejected?.reason).toBe("illegal_card");
  });

  it("同一组把接得上的红 5 排到首位就合法", () => {
    const six = ["5", "1", "2", "3", "4", "6"].map((f) => card("R", f as Card["face"]));
    const s = par([[...six, card("Y", "9")], [card("R", "1")], [card("R", "1")]], {
      playedPile: [card("B", "5")],
    });
    const r = play(s, six);
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.activeFace).toBe("6"); // 六张同色跟最大的数
  });

  it("同一张牌报两遍等于报了手上没有的牌", () => {
    const a = card("Y", "2");
    const s = par([[a, card("R", "9")], [card("R", "1")], [card("R", "1")]]);
    const r = applyAction(s, { type: "playCards", seat: 0, cardIds: [a.id, a.id] }, ctx());
    expect(r.rejected?.reason).toBe("not_in_hand");
  });
});

describe("并列的权利（V3 / 压制 / 出牌时机）", () => {
  const two = () => [card("Y", "2"), card("Y", "2")];
  const tryMulti = (over: Partial<Board>) => {
    const cards = two();
    const s = par([[...cards, card("R", "9")], [card("R", "1")], [card("R", "1")]], over);
    return play(s, cards).rejected?.reason;
  };

  it("未亮出不生效（V3）", () => {
    expect(tryMulti({ revealed: [false, false, false] })).toBe("single_card_only");
  });

  it("被封印时不生效（P9 / 02 §2 压制层）", () => {
    expect(tryMulti({ statuses: [["封印"], [], []] })).toBe("single_card_only");
  });

  it("惩罚链挂着时不能多打——惩罚轮只认叠链的单张（P3）", () => {
    expect(tryMulti({ punish: { initiator: 1, segments: [{ seat: 1, face: "+2", draw: 2 }], total: 2 } }))
      .toBe("must_stack");
  });

  it("刚摸到可打的牌时只能打那一张（U1）", () => {
    expect(tryMulti({ drawnPlayable: card("B", "5") })).toBe("must_play_drawn_or_end");
  });

  it("legalActions 不枚举多打组合——UI 靠多选提交，服务端校验", () => {
    const cards = two();
    const s = par([[...cards, card("R", "9")], [card("R", "1")], [card("R", "1")]]);
    expect(legalActions(s, 0).filter((a) => a.type === "playCards").every((a) => a.cardIds.length === 1)).toBe(true);
  });
});

describe("并列收官（U2 / U6）", () => {
  it("多张打空手牌就获胜，且无需喊 UNO", () => {
    const cards = [card("Y", "2"), card("Y", "2")];
    const s = par([cards, [card("R", "1")], [card("R", "1")]]);
    const r = play(s, cards);
    expect(r.state.phase).toBe("finished");
    expect(r.state.board!.winner).toBe(0);
    expect(r.state.board!.saidUno[0]).toBe(false);
    // 手牌 0 不满足 U7 的「持 1 张」，抓不着
    expect(applyAction(r.state, { type: "catchUno", seat: 1, target: 0 }, ctx()).rejected?.reason).toBe("wrong_phase");
  });

  it("多打到只剩 1 张又没喊，照样会被抓（U6/U7）", () => {
    const cards = [card("Y", "2"), card("Y", "2")];
    const s = par([[...cards, card("R", "9")], [card("R", "1")], [card("R", "1")]]);
    const r = play(s, cards);
    expect(r.state.board!.saidUno[0]).toBe(false);
    // ctxAfter：交回合后有 1 秒补喊宽限（U7b），当场抓是 uno_grace
    const caught = applyAction(r.state, { type: "catchUno", seat: 1, target: 0 }, ctxAfter(1_500));
    expect(caught.rejected).toBeUndefined();
    expect(caught.state.board!.hands[0]).toHaveLength(3);
  });

  it("多打到剩 1 张之后再点喊（U6：喊与出牌是两个动作，多打不占喊的机会）", () => {
    const cards = [card("Y", "2"), card("Y", "2")];
    const s = par([[...cards, card("R", "9")], [card("R", "1")], [card("R", "1")]]);
    const played = play(s, cards).state;
    expect(played.board!.hands[0]).toHaveLength(1);
    const r = applyAction(played, { type: "callUno", seat: 0 }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.saidUno[0]).toBe(true);
    expect(r.events.map((e) => e.type)).toEqual(["unoCalled"]);
  });
});

describe("并列不占 V7，也不是一条主动（06-Q35）", () => {
  it("多打之后没有 skillActivated 事件，cardPlayed 带的是整组牌", () => {
    const cards = [card("Y", "2"), card("Y", "2")];
    const s = par([[...cards, card("R", "9")], [card("R", "1")], [card("R", "1")]]);
    const r = play(s, cards);
    expect(r.events.map((e) => e.type)).toEqual(["cardPlayed"]);
    expect(r.events[0].public.cards).toEqual(cards);
  });

  it("本回合已发动过别的主动，并列照样能打", () => {
    const cards = [card("Y", "2"), card("Y", "2")];
    const s = par([[...cards, card("R", "9")], [card("R", "1")], [card("R", "1")]], {
      activatedThisTurn: [true, false, false],
    });
    expect(play(s, cards).rejected).toBeUndefined();
  });
});

describe("activeFace 的生命周期", () => {
  it("下家打完单张后 activeFace 归位到堆顶那张", () => {
    const six = ["1", "3", "9", "2", "4", "5"].map((f) => card("B", f as Card["face"]));
    const y9 = card("Y", "9");
    const s = par([[...six, card("R", "9")], [y9, card("R", "1")], [card("R", "1")]], {
      playedPile: [card("B", "7")],
    });
    const after = play(s, six).state;
    const r = applyAction(after, { type: "playCards", seat: 1, cardIds: [y9.id] }, ctx());
    expect(r.rejected).toBeUndefined();
    expect(r.state.board!.activeFace).toBeNull();
    expect(r.state.board!.activeColor).toBe("Y");
  });

  it("精英♥3 加的点数也要跟上 activeFace，不是堆顶那张", () => {
    const six = ["1", "3", "9", "2", "4", "5"].map((f) => card("B", f as Card["face"]));
    const y8 = card("Y", "8");
    const s = par([[...six, card("R", "9")], [y8, card("R", "1")], [card("R", "1")]], {
      playedPile: [card("B", "7")],
      skills: ["heart-4", "heart-3", null],
      revealed: [true, true, false],
    });
    const after = play(s, six).state; // activeFace = "9"，堆顶是蓝 5
    const r = applyAction(after, { type: "playCards", seat: 1, cardIds: [y8.id], useSkill: true }, ctx());
    expect(r.rejected).toBeUndefined();
  });

  it("并列后摸到的牌按 activeFace 判可打（U1）", () => {
    const six = ["1", "3", "9", "2", "4", "5"].map((f) => card("B", f as Card["face"]));
    const s = par([[...six, card("R", "9")], [card("R", "1")], [card("R", "1")]], {
      playedPile: [card("B", "7")],
      // 座位 1 摸到黄 9：色不对，但跟得上 activeFace 的 9
      drawPile: [card("Y", "9")],
    });
    const after = play(s, six).state;
    const r = applyAction(after, { type: "drawCard", seat: 1 }, ctx());
    expect(r.state.board!.drawnPlayable?.face).toBe("9");
  });
});

// UI 的两个信号：多张组合不进 legalActions，所以「能不能多打」与「要跟什么牌面」
// 都得由引擎算好放进快照——否则客户端只能自己判技能，那就破了「客户端零规则」。
describe("快照给 UI 的能力位与跟牌目标", () => {
  const six = [
    card("B", "1"), card("B", "3"), card("B", "9"),
    card("B", "2"), card("B", "4"), card("B", "5"),
  ];

  it("canPlayMultiple：只有亮出并列的人是 true", () => {
    const s = par([six, [card("Y", "1")], [card("Y", "2")]]);
    expect(projectView(s, 0).canPlayMultiple).toBe(true);
    expect(projectView(s, 1).canPlayMultiple).toBe(false);
    expect(projectView(s, 2).canPlayMultiple).toBe(false);
  });

  it("canPlayMultiple：持有但没亮出 → false（V3）", () => {
    const s = par([six, [card("Y", "1")], [card("Y", "2")]], { revealed: [false, false, false] });
    expect(projectView(s, 0).canPlayMultiple).toBe(false);
  });

  it("canPlayMultiple：被封印 → false", () => {
    const s = par([six, [card("Y", "1")], [card("Y", "2")]], { statuses: [["封印"], [], []] });
    expect(projectView(s, 0).canPlayMultiple).toBe(false);
  });

  it("followFace：平时等于堆顶牌面；6 张同色打完后是其中最大的数", () => {
    const s = par([six, [card("Y", "1")], [card("Y", "2")]]);
    expect(projectView(s, 0).followFace).toBe("2"); // 堆顶蓝 2
    const after = play(s, six).state;
    expect(after.board!.playedPile[0].face).toBe("5"); // 堆顶是最后摆的那张
    expect(projectView(after, 1).followFace).toBe("9"); // 但要跟的是最大的 9
  });
});
