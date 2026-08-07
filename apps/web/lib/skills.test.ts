import { describe, expect, it } from "vitest";
import { loadedSkills } from "@roft/engine";
import { makeSnapshot } from "@/test-support/snapshot";
import { effectLabel, globalPicks, seatPicks, skillById, SKILLS } from "./skills";

/**
 * 玩家版文案的覆盖率闩。**清单从引擎读**，不手抄：
 * 引擎接线了一个新技能（进抽 3 选 1 的池），这里没写文案，抽 3 选 1 的面板就会
 * 摆出一张没有说明的卡、发动按钮写着「发动技能：发动技能」。
 */
describe("技能文案跟得上引擎的可抽池", () => {
  const pool = loadedSkills.pool.map((s) => s.id);

  it("正则没烂：池子不是空的", () => {
    expect(pool.length).toBeGreaterThanOrEqual(10);
  });

  it("池里每个技能都有玩家版文案（l0 / l1）", () => {
    expect(pool.filter((id) => !SKILLS[id])).toEqual([]);
    for (const id of pool) {
      const s = skillById(id)!;
      expect(s.l0.length, id).toBeGreaterThan(4);
      expect(s.l1.length, id).toBeGreaterThan(20);
    }
  });

  /*
    一条主动的技能回落到 l0 就够；**多条**主动不逐条写的话，两个按钮字面完全一样。

    「多条」要连**选项分支**一起算（`option_of`）：吟游♣5 只有一条 `kind: active`，
    四支歌声是挂在它下面的选项，玩家点的是那四个 key。只按 `kind === "active"` 数的话
    吟游算「单主动」，四个按钮会一齐回落到 l0——四条一模一样的「回合开始选一支歌声」，
    点哪个都不知道自己在唱什么。心火♥Q 的三选一、宝藏★ 的四分支将来照样落这条。
  */
  it("有多条可发动分支的技能，每条都要有自己的按钮文案（含选项分支）", () => {
    for (const id of pool) {
      const effects = loadedSkills.byId.get(id)?.effects ?? [];
      const branches = effects.filter((e) => e.kind === "active" || e.option_of !== undefined);
      if (branches.length < 2) continue;
      const labels = branches.map((e) => effectLabel(id, e.key));
      expect(new Set(labels).size, `${id} 的发动按钮文案重复：${labels.join(" / ")}`).toBe(labels.length);
    }
  });

  it("文案表里不许有池子外的死条目（技能改了 id 就会漏在这里）", () => {
    expect(Object.keys(SKILLS).filter((id) => !loadedSkills.byId.has(id))).toEqual([]);
  });
});

/**
 * `Board.chosen` 那一个槽里既装**全场生效**的选项（吟游♣5 的歌声）也装**个人**的
 * （专精♥9 亮出时定死的色），两者画在牌桌的两个地方。分法必须来自数据
 * （`targeting: global`）而不是技能 id，否则第三批每加一个「选一支」的技能都要改一次前端。
 */
describe("chosen 的分流：全场的上牌桌，个人的上座位卡", () => {
  const withChosen = (chosen: Record<string, { key: string; seat: number }>) =>
    makeSnapshot({ chosen });

  it("吟游♣5 的歌声是全场的（四支都标 targeting: global）", () => {
    for (const song of ["活泼板", "战争序", "樱时雨", "行进曲"]) {
      const s = withChosen({ "club-5": { key: song, seat: 2 } });
      expect(globalPicks(s), song).toEqual([{ skillId: "club-5", key: song, seat: 2 }]);
      expect(seatPicks(s, 2), song).toEqual([]);
    }
  });

  it("专精♥9 的色是个人的：它压根不是某条子效果的 key（亮出钩子直接写进槽），查不到即归个人", () => {
    const s = withChosen({ "heart-9": { key: "R", seat: 1 } });
    expect(globalPicks(s)).toEqual([]);
    expect(seatPicks(s, 1)).toEqual([{ skillId: "heart-9", key: "R", seat: 1 }]);
    // 别人的座位不该拿到它
    expect(seatPicks(s, 0)).toEqual([]);
  });

  it("两条同时在场时各归各处，互不牵连", () => {
    const s = withChosen({ "heart-9": { key: "G", seat: 0 }, "club-5": { key: "樱时雨", seat: 3 } });
    expect(globalPicks(s).map((p) => p.skillId)).toEqual(["club-5"]);
    expect(seatPicks(s, 0).map((p) => p.key)).toEqual(["G"]);
    expect(seatPicks(s, 3)).toEqual([]);
  });

  it("`chosen` 缺席（刚开局 / 没人选过）时两边都是空的，不画任何徽", () => {
    const s = makeSnapshot();
    expect(s.chosen).toBeUndefined();
    expect(globalPicks(s)).toEqual([]);
    expect(seatPicks(s, 0)).toEqual([]);
  });

  it("认不出的技能 id 保守归个人（个人那一档画错地方也不会误导全场）", () => {
    const s = withChosen({ "no-such-skill": { key: "x", seat: 1 } });
    expect(globalPicks(s)).toEqual([]);
    expect(seatPicks(s, 1).map((p) => p.key)).toEqual(["x"]);
  });
});
