import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PLAYERS, makeSnapshot } from "@/test-support/snapshot";
import { renderGame } from "@/test-support/render-game";

/**
 * 牌桌壳（轮转轨 / 牌河 / 惩罚叠链）。仍然只断言「快照里的东西画出来了没有」——
 * 「该不该有这条动作」是引擎测试的活。
 */

const labels = (root: HTMLElement, sel: string) =>
  [...root.querySelectorAll(sel)].map((el) => el.getAttribute("aria-label"));

describe("轮转轨（第 1 条 UI 反馈：座位含自己）", () => {
  it("四个座位全在轨上，自己那张标「你」", () => {
    const { container } = renderGame(makeSnapshot());
    const seats = [...container.querySelectorAll(".dial__track .seat")];
    expect(seats).toHaveLength(PLAYERS.length);
    expect(seats.map((s) => s.querySelector(".seat__name")?.textContent)).toEqual([
      "凛",
      "阿柴",
      "小满",
      "老白",
    ]);
    // 旧 .opponents 明确 filter 掉自己，「我在谁后面」只能靠脑补
    const you = container.querySelectorAll(".seat--you");
    expect(you).toHaveLength(1);
    expect(you[0].querySelector(".seat__you")?.textContent).toBe("你");
  });

  it("座位之间夹方向雪佛龙，逆时针时整条轨 data-dir=ccw", () => {
    const { container } = renderGame(makeSnapshot({ direction: -1 }));
    expect(container.querySelectorAll(".dial__chev")).toHaveLength(PLAYERS.length - 1);
    expect(container.querySelector(".dial")?.getAttribute("data-dir")).toBe("ccw");
    // 轨下那条「↻ 顺时针」撤了，方向的文字进了轨的可及名（a11y.test.tsx 盯着两个方向）
    expect(container.querySelector(".dial__dir")).toBeNull();
  });

  it("当前行动者拿 .seat--now，且只有一个", () => {
    const { container } = renderGame(makeSnapshot({ currentSeat: 2 }));
    const now = [...container.querySelectorAll(".seat--now")];
    expect(now).toHaveLength(1);
    expect(now[0].querySelector(".seat__name")?.textContent).toBe("小满");
  });

  it("技能徽：未亮出画虚线徽，被封印画朱砂徽", () => {
    const { container } = renderGame(makeSnapshot());
    // 小满未亮出（skillId 为 null）且被血棘封着
    const man = container.querySelectorAll(".seat")[2];
    expect(man.querySelector(".skillbadge")?.className).toContain("skillbadge--hidden");
    expect(man.className).toContain("seat--sealed");
    expect(man.querySelector('.badge[data-tone="bad"]')?.textContent).toBe("封印");
  });

  it("神化只画 N 颗实心、不预留空位（G4：基础包无主神即无上限）", () => {
    const { container } = renderGame(makeSnapshot());
    const bai = container.querySelectorAll(".seat")[3]; // 老白 ascensions: 2
    expect(bai.querySelectorAll(".pips .pip")).toHaveLength(2);
    expect(bai.querySelectorAll(".pip--empty")).toHaveLength(0);
  });

  /**
   * 座位卡手机与桌面同一套排版（窄屏只收字号）。**一项内容都不许掉**——尤其标记：
   * 它是「攒了几个 / 花了几个」的唯一去处。这条把一张挂满东西的卡逐项点名。
   * 已喊 UNO 是名字旁的一枚徽（`.seat__uno`），不占标记行。
   */
  it("座位卡挂满时，状态 / 标记 / 神化 / UNO / 技能徽一项都不少", () => {
    const { container } = renderGame(
      makeSnapshot({
        players: PLAYERS.map((p) =>
          p.seat === 3 ?
            { ...p, marks: { 魂: 3, 盗: 1 }, statuses: ["封印"], ascensions: 2, saidUno: true }
          : p,
        ),
      }),
    );
    const seat = container.querySelectorAll(".seat")[3];
    const texts = [...seat.querySelectorAll(".seat__tags .badge")].map((b) => b.textContent?.trim());
    expect(texts).toEqual(expect.arrayContaining(["封印", "魂 ×3", "盗 ×1"]));
    expect(seat.querySelector(".seat__top .seat__uno")?.textContent).toBe("已喊 UNO");
    expect(seat.querySelectorAll(".pips .pip")).toHaveLength(2);
    expect(seat.querySelector(".skillbadge")).not.toBeNull();
    expect(seat.querySelector(".seat__hand b")?.textContent).toBe("11");
    expect(seat.querySelector(".seat__name")?.textContent).toBe("老白");
  });

  // 轨上一个按钮都没有（技能徽除外）：抓漏喊搬去了 UNO 旁边，见 dock.test.tsx
  it("座位卡里除了技能徽没有别的按钮", () => {
    const { container } = renderGame(
      makeSnapshot({
        currentSeat: 1,
        legalActions: [{ type: "catchUno", seat: 0, target: 2 }],
      }),
    );
    const btns = [...container.querySelectorAll(".seat button")];
    expect(btns.every((b) => b.classList.contains("skillbadge"))).toBe(true);
  });
});

describe("牌河三堆", () => {
  it("摸牌堆是暗信息：不是按钮，没有 .fan / data-fan / .fan__more", () => {
    const { container } = renderGame(makeSnapshot());
    const draw = container.querySelectorAll(".piles .pile")[0];
    expect(draw.tagName).toBe("DIV");
    expect(draw.hasAttribute("data-fan")).toBe(false);
    expect(draw.querySelector(".fan")).toBeNull();
    expect(draw.querySelector(".fan__more")).toBeNull();
    expect(draw.querySelector(".pile__count")?.textContent).toBe("38");
  });

  it("出牌堆展开是「旧 → 新」：playedPile[0] 是牌顶，客户端要 reverse", () => {
    const { container } = renderGame(makeSnapshot());
    // fixture 的 playedPile = [红7(顶), 红4, 蓝4, 蓝9]
    expect(labels(container, ".pile--top .fan .card")).toEqual(["蓝 9", "蓝 4", "红 4", "红 7"]);
  });

  it("弃牌堆本来就是旧 → 新，原样给", () => {
    const { container } = renderGame(makeSnapshot());
    const discard = container.querySelectorAll(".piles .pile")[2];
    expect(labels(discard as HTMLElement, ".fan .card")).toEqual(["绿 2", "黄 9", "蓝 5"]);
  });

  // 窄屏两个 `.fan` 是同一个 fixed 定点，各持一个 open 就会叠成两层（第 5 条 UI 反馈）
  it("至多一堆的扇形开着：点开弃牌堆，出牌堆自己收起来", async () => {
    const { container } = renderGame(makeSnapshot());
    const [, played, discard] = [...container.querySelectorAll<HTMLElement>(".piles .pile")];
    const openOnes = () => [...container.querySelectorAll(".piles [data-open]")];

    expect(openOnes()).toHaveLength(0);
    await userEvent.click(played);
    expect(openOnes()).toEqual([played]);
    await userEvent.click(discard);
    expect(openOnes()).toEqual([discard]);
    // 再点一次是收起
    await userEvent.click(discard);
    expect(openOnes()).toHaveLength(0);
  });

  it("跟色跟数直接读快照（并列打完后 followFace ≠ 顶牌面）", () => {
    const { container } = renderGame(makeSnapshot({ activeColor: "B", followFace: "9" }));
    expect(container.querySelector(".follow")?.textContent).toBe("跟色 蓝 · 跟数 9");
  });

  it("骰子与影歌指定的牌摆在牌河里，不做弹窗", () => {
    const { container } = renderGame(
      makeSnapshot({
        dice: { seat: 3, reason: "bloodthorn", values: [2], target: 2 },
        soulHarvest: { seat: 3, declared: { color: "R", face: "5" }, drawn: 0 },
      }),
    );
    expect(container.querySelector(".dice .die")?.textContent).toBe("2");
    const asides = container.querySelectorAll(".field__aside");
    expect(asides).toHaveLength(2);
    expect(asides[0].textContent).toContain("小满");
    expect(asides[1].textContent).toContain("老白指定 · 红 5");
  });
});

describe("惩罚叠链", () => {
  it("每段一个色块（吃 PunishSegment.color，不从牌河回推）+ 累计张数", () => {
    const { container } = renderGame(
      makeSnapshot({
        punish: {
          initiator: 1,
          segments: [
            { seat: 1, face: "+2", draw: 2, color: "Y" },
            { seat: 3, face: "+4", draw: 4, color: "R" },
          ],
          total: 6,
        },
      }),
    );
    const swatches = [...container.querySelectorAll(".chain .swatch")] as HTMLElement[];
    expect(swatches.map((s) => s.style.background)).toEqual([
      "var(--card-yellow)",
      "var(--card-red)",
    ]);
    expect(container.querySelector(".chain .total")?.textContent).toBe("累计 6 张");
  });
});
