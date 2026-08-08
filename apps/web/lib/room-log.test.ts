import type { Card } from "@roft/engine";
import { describe, expect, it } from "vitest";
import { humanize, type LogEvent } from "./room-log";
import { engineEventTypes } from "@/test-support/engine-vocab";

/**
 * `humanize()` 是**唯一**把引擎事件翻成玩家语言的地方，性质与 `humanReason`、`CHOICE_LABEL`
 * 的覆盖率测试完全相同：引擎加了一种事件而这里没跟上，行动记录就会当着玩家的面
 * 打出 `farstarUsed` 这样的裸事件名。
 *
 * 所以全集**从引擎源码 grep**（`engineEventTypes`），不手抄一张表——手抄的表跟着实现一起腐烂：
 * 引擎新增事件、前端漏了人话、抄来的表里也没有那一条，测试照样绿。
 */

const nameOf = (seat: number) => ["凛", "阿柴", "小满", "老白"][seat] ?? `座位 ${seat + 1}`;
const c = (id: string, color: Card["color"], face: Card["face"]): Card => ({ id, color, face });
const R7 = c("R7#0", "R", "7");
const Y2 = c("Y+2#0", "Y", "+2");

/** 每种事件一份**够用的** public payload：缺字段会让人话里出现 undefined，那也是 bug。 */
const PAYLOAD: Record<string, Record<string, unknown>> = {
  gameStarted: { seats: 4, handSize: 7 },
  handDealt: { seat: 0, count: 7 },
  draftStarted: {},
  draftOptionsDealt: { seat: 0 },
  skillChosen: { seat: 1 },
  draftFinished: {},
  cardPlayed: { seat: 1, cards: [R7], chosenColor: "B" },
  cardsDrawn: { seat: 2, count: 2 },
  turnEnded: { seat: 0 },
  turnSkipped: { seat: 3 },
  deckReshuffled: { count: 31 },
  statusGranted: { seat: 0, status: "五彩", skillId: "spade-8" },
  drawOfferOpened: { seat: 1, picks: 2 },
  allianceWindowOpened: { seat: 2, by: 0 },
  handOverOpened: { seat: 1, target: 0, max: 2 },
  optionChosen: { seat: 0, skillId: "club-5", key: "战争序" },
  cardsHandedOver: { seat: 1, target: 0, count: 2 },
  handOverKept: { seat: 1 },
  allianceFormed: { seats: [0, 2] },
  allianceRefused: { seat: 2 },
  handsSwapped: { seats: [0, 2], counts: [3, 5] },
  drawOfferDeclined: { seat: 1 },
  gameDrawn: {},
  punishWindowOpened: { actors: [2], total: 6 },
  punishStackChosen: { seat: 2 },
  punishAccepted: { seat: 2, total: 6 },
  farstarUsed: { seat: 0, discarded: [Y2], as: "+4", color: "Y" },
  skillRevealed: { seat: 0, skillId: "spade-1" },
  skillActivated: { seat: 0, skillId: "diamond-3" },
  cardsDiscarded: { seat: 0, cards: [R7] },
  soulHarvestStarted: { seat: 0, declared: { color: "R", face: "5" } },
  soulHarvestResponse: { seat: 1, card: R7 },
  soulHarvestEnded: { seat: 0, gained: 2, souls: 3 },
  diceRolled: { seat: 1, reason: "assault", values: [2] },
  diceTakeoverOpened: { actors: [0] },
  sealed: { seat: 2, by: 3 },
  sealLifted: { seat: 2, reason: "replaced" },
  marksGained: { seat: 0, n: 1, mark: "魂", total: 3 },
  marksSpent: { seat: 0, n: 2, mark: "魂", total: 1 },
  stealSwapDrawn: { seat: 0, target: 1 },
  stealSwapReturned: { seat: 0, target: 1 },
  stealSwapPeek: { seat: 0 },
  raidWindowOpened: { actors: [1], seat: 0, cards: [R7] },
  raided: { by: 1, card: R7, target: 3 },
  handsShuffled: { seat: 3, counts: [7, 2, 4, 11] },
  drawDiscardOpened: { seat: 3, picks: 2 },
  dissentUsed: { seat: 1, direction: -1 },
  shuffleCancelWindowOpened: { seat: 3, actors: [0, 1] },
  shuffleCancelled: { by: 0, card: R7, color: "R", target: 3 },
  unoCalled: { seat: 1 },
  unoMiscalled: { seat: 1 },
  unoCaught: { seat: 0, target: 2 },
};

const event = (type: string): LogEvent => ({
  id: 1,
  seq: 1,
  type,
  public_payload: PAYLOAD[type] ?? {},
});

/** 这几条**故意**不进日志：暗信息或纯噪音，`humanize` 返回 null 是对的。 */
const SILENT = new Set(["handDealt", "draftOptionsDealt", "stealSwapPeek"]);

describe("humanize（引擎事件 → 玩家语言）的覆盖率", () => {
  const types = engineEventTypes();

  it("正则没烂掉：引擎里至少这么多种事件", () => {
    // 2026-08-02 实测 40 种。下限只为拦住「正则失灵 → 空集 → 全绿」的假阳性
    expect(types.length).toBeGreaterThanOrEqual(38);
    expect(types).toContain("cardPlayed");
    expect(types).toContain("drawDiscardOpened");
  });

  it("每种事件都有人话——没写的会原样露出事件名给玩家看", () => {
    const naked = types.filter((t) => !SILENT.has(t) && humanize(event(t), nameOf)?.what === t);
    expect(naked).toEqual([]);
  });

  it("测试自己的 payload 表也得跟上引擎（缺一条就等于在测空壳）", () => {
    expect(types.filter((t) => !(t in PAYLOAD))).toEqual([]);
  });

  it("人话里不许漏 undefined / NaN / [object Object]", () => {
    for (const t of types) {
      const line = humanize(event(t), nameOf);
      if (SILENT.has(t)) {
        expect(line, t).toBeNull();
        continue;
      }
      expect(line, t).not.toBeNull();
      expect(`${line!.who}${line!.what}`, t).not.toMatch(/undefined|NaN|\[object Object\]/);
      expect(line!.what.length, t).toBeGreaterThan(0);
    }
  });

  /*
    payload 表是**手抄**的，所以它跟引擎一起腐烂过一次：引擎把 `raidWindowOpened` 的
    `card` 改名成 `cards`，表里也还写着 `card`，上面那几条断言全绿——线上开一次劫营窗口
    就白屏（`humanize` 在 render 里跑，抛一次整棵树就没了，服务端一条错都不会有）。
    所以再钉一条**不依赖那张表**的：字段全缺时可以说得难听，但绝不许抛。
  */
  it("payload 全缺也不许抛——翻译层抛一次就是整页白屏", () => {
    for (const t of types)
      expect(() => humanize({ id: 1, seq: 1, type: t, public_payload: {} }, nameOf), t).not.toThrow();
  });

  it("认不出的事件类型有保底：原样显示，不炸也不留空行", () => {
    expect(humanize(event("somethingBrandNew"), nameOf)).toEqual({
      who: "牌桌",
      what: "somethingBrandNew",
      kind: "system",
    });
  });

  it("几条容易写错的逐字钉住", () => {
    expect(humanize(event("cardPlayed"), nameOf)).toEqual({ who: "阿柴", what: "打出 红 7，定色蓝" });
    expect(humanize(event("sealed"), nameOf)?.what).toBe("被老白封印了技能");
    // 远星：代价牌与「视为的那一段」都是公开的，摸的 2 张另有 cardsDrawn 事件
    expect(humanize(event("farstarUsed"), nameOf)?.what).toBe("远星：弃 黄 +2，视为跟着叠了一张黄 +4");
    // 劫营窗口：引擎发的是整组 `cards`。读成单数 `card` 时这里是 `cardLabel(undefined)`，
    // 线上一开窗口全场白屏（2026-08-08 修）
    expect(humanize(event("raidWindowOpened"), nameOf)?.what).toBe("可以用同色同数的牌打断红 7");
    // 并列♥4 之前的单张写法（`card` 而不是 `cards`）：老事件还在库里，不能翻成空白
    expect(humanize({ id: 2, seq: 2, type: "cardPlayed", public_payload: { seat: 0, card: R7 } }, nameOf)).toEqual({
      who: "凛",
      what: "打出 红 7",
    });
  });
});
