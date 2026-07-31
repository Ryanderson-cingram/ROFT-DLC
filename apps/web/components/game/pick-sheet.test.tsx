import type { Card } from "@roft/engine";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HAND } from "@/fixtures/snapshot";
import { DECLARABLE, PickSheet } from "./pick-sheet";

/**
 * 三个原先只存在于 `app/game/[code]/page.tsx` 里的全屏面板，抽出来之后共用 `PickSheet`：
 * 恒心♠1 弃 1、影歌♦3①宣言、司夜♣3②还牌（洗牌②弃牌逐字相同）。
 *
 * 面板只管「点了哪张」；把那张牌拼成动作是 page 的一行 props（那一行没测，见交接报告）。
 */

const [R3] = HAND;

describe("恒心♠1：发动前挑一张弃掉", () => {
  it("手牌全部可点，点一张就把那一张交回去（page 拿它拼 cardIds: [id]）", async () => {
    const onPick = vi.fn();
    const { container } = render(
      <PickSheet
        eyebrow="发动技能"
        title="挑一张牌弃掉"
        lead="弃掉的牌进弃牌堆，不改牌顶、不改跟色。"
        cards={HAND}
        onPick={onPick}
        onCancel={() => {}}
      />,
    );
    expect(container.querySelectorAll(".hand .card--legal")).toHaveLength(HAND.length);
    await userEvent.click(screen.getByRole("button", { name: "红 3" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(R3);
  });

  it("提交前的本地选择能反悔", async () => {
    const onCancel = vi.fn();
    render(
      <PickSheet eyebrow="发动技能" title="挑一张牌弃掉" lead="…" cards={HAND} onPick={() => {}} onCancel={onCancel} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "先不发动" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("司夜♣3②：还牌（服务端窗口）", () => {
  it("可点的是哪几张由调用方给（来自 legalActions），且没有取消键", async () => {
    const onPick = vi.fn();
    const offered = HAND.slice(0, 3);
    const { container } = render(
      <PickSheet
        eyebrow="司夜 · 花盗换牌"
        title="挑一张还给对方"
        lead="还哪张只有你和对方知道。"
        cards={offered}
        onPick={onPick}
      />,
    );
    expect(container.querySelectorAll(".hand .card--legal")).toHaveLength(3);
    // 窗口开着的时候没有退出键：不还牌只有超时一条路
    expect(screen.queryByRole("button", { name: "先不发动" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "蓝 7" }));
    expect(onPick).toHaveBeenCalledWith(offered[2]);
  });
});

describe("影歌♦3①：当众宣言一张色 + 数", () => {
  it("候选是四色 × 0–9 的假牌，点中那张的 color/face 就是 payload 里的 declared", async () => {
    const onPick = vi.fn<(card: Card) => void>();
    const { container } = render(
      <PickSheet
        eyebrow="发动技能"
        title="当众指定一张牌"
        lead="你手里有没有这张牌都可以指定。"
        cards={DECLARABLE}
        layout="declare"
        onPick={onPick}
        onCancel={() => {}}
      />,
    );
    expect(DECLARABLE).toHaveLength(40);
    expect(container.querySelectorAll(".declare .card")).toHaveLength(40);
    await userEvent.click(screen.getByRole("button", { name: "红 3" }));
    const picked = onPick.mock.calls[0][0];
    expect({ color: picked.color, face: picked.face }).toEqual({ color: "R", face: "3" });
  });
});
