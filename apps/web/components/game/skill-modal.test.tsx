import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CREED, CREED_FOOTNOTE } from "@/lib/skills";
import { SkillModal } from "./skill-modal";

const base = {
  revealed: true,
  activatedThisTurn: false,
  marks: {},
  onClose: () => {},
};

const marksText = (container: ParentNode) => container.querySelector(".marks") as HTMLElement;

describe("SkillModal · 技能详情", () => {
  it("头部：沿印 · 技能名 · 计数徽 · 已亮出徽（沿印与名字都读引擎定义）", () => {
    const { container } = render(<SkillModal {...base} skillId="diamond-3" />);
    expect(container.querySelector(".sk__sigil")?.textContent).toBe("♦3");
    expect(screen.getByRole("heading", { name: "影歌" })).toBeTruthy();
    // 影歌在引擎定义里是两条子效果 → 「主动 ×2」（design/mockups/game-status.html）
    expect([...container.querySelectorAll(".sk__head .badge")].map((b) => b.textContent)).toEqual([
      "主动 ×2",
      "已亮出",
    ]);
  });

  it("只有一条子效果时不写 ×1；条数来自引擎定义，不是本地文案表", () => {
    // 司夜在引擎里是三条子效果（①on_play + ②③meta_rule），玩家版分类是「被动」
    const ye = render(<SkillModal {...base} skillId="club-3" />);
    expect(ye.container.querySelector(".sk__head .badge")?.textContent).toBe("被动 ×3");
    // 恩惠只有一条
    const en = render(<SkillModal {...base} skillId="heart-1" />);
    expect(en.container.querySelector(".sk__head .badge")?.textContent).toBe("被动");
  });

  it("中文名不再是主键：换名桥接删掉之后，只认引擎 id", () => {
    const { container } = render(<SkillModal {...base} skillId="影歌" />);
    expect(container.textContent).toContain("这局你没有技能。");
  });

  it("有上限的标记：3/6 · 已花 2，pips 按上限补空", () => {
    const { container } = render(
      <SkillModal {...base} skillId="diamond-3" marks={{ 魂: 3 }} marksSpent={{ 魂: 2 }} marksCap={{ 魂: 6 }} />,
    );
    const marks = marksText(container);
    expect(marks.querySelector(".marks__n")?.textContent).toBe("3");
    expect(marks.querySelector(".marks__cap")?.textContent).toBe("/6");
    expect(marks.querySelector(".marks__spent")?.textContent).toBe("· 已花 2");
    expect(marks.querySelectorAll(".pip")).toHaveLength(6);
    expect(marks.querySelectorAll(".pip--empty")).toHaveLength(3);
  });

  it("无上限的标记（司夜的「盗」不在 marksCap 里）：不显示上限，更不显示成 0", () => {
    const { container } = render(
      // marksCap 里只有别人的「魂」——「盗」缺席 = 无上限
      <SkillModal {...base} skillId="club-3" marks={{ 盗: 2 }} marksSpent={{ 盗: 1 }} marksCap={{ 魂: 6 }} />,
    );
    const marks = marksText(container);
    expect(marks.querySelector(".marks__cap")).toBeNull();
    expect(marks.textContent).not.toContain("/");
    expect(marks.textContent).not.toContain("0");
    expect(marks.querySelectorAll(".pip")).toHaveLength(2);
    expect(marks.querySelector(".marks__spent")?.textContent).toBe("· 已花 1");
  });

  it("没有标记的技能写「此技能没有标记」，本回合主动读 activatedThisTurn", () => {
    const { container } = render(<SkillModal {...base} skillId="spade-1" activatedThisTurn />);
    expect(container.querySelector(".marks")).toBeNull();
    expect(screen.getByText("此技能没有标记")).toBeTruthy();
    expect(container.querySelector(".sk__meta .num")?.textContent).toBe("1 / 1");
  });

  it("状态写得出「被谁封的」与解封条件（sealedBy + nameOf）", () => {
    render(<SkillModal {...base} skillId="heart-1" revealed={false} sealedBy={3} nameOf={() => "老白"} />);
    expect(screen.getByText("被老白的血棘封印了 · 解封条件：老白改封别人")).toBeTruthy();
    expect(screen.getByText("未亮出")).toBeTruthy();
  });

  it("未亮出且没被封 → 状态是「未亮出 · 亮出来才会生效」", () => {
    render(<SkillModal {...base} skillId="heart-1" revealed={false} />);
    expect(screen.getByText("未亮出 · 亮出来才会生效")).toBeTruthy();
  });

  it("发动按钮 0–2 条，全部来自传入的 actions；点了就回调", async () => {
    const onActivate = vi.fn();
    render(
      <SkillModal
        {...base}
        skillId="diamond-3"
        actions={[
          { key: "1", label: "攒 1 个魂（最多 6）", primary: true, onActivate },
          { key: "2", label: "花 2 魂跳过这一回合", disabled: true, onActivate: () => {} },
        ]}
      />,
    );
    const acts = screen.getAllByRole("button", { name: /魂/ });
    expect(acts).toHaveLength(2);
    expect((acts[1] as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(acts[0]);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  /**
   * 防越权：**别人的**技能徽点开的是同一个弹窗，只是 `actions` 为空。
   * 弹窗里没有任何一条从 `skillId` 推出发动入口的路径——有了那条路径，
   * 点别人的技能徽就能发动别人的技能。
   */
  it("actions 为空 → 就算是主动技能也长不出发动入口，信息照旧给全", () => {
    const { container } = render(
      <SkillModal {...base} skillId="diamond-3" marks={{ 魂: 3 }} marksCap={{ 魂: 6 }} />,
    );
    // 页签是 role=tab，所以这里只剩关闭那一个真按钮
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["关闭"]);
    expect(container.querySelector(".sk__acts")).toBeNull();
    // 信息那一半一格不少：L0 / L1 / 标记 / 状态
    expect(container.querySelector(".sk__l0")?.textContent).toBeTruthy();
    expect(container.querySelector(".sk__l1")?.textContent).toBeTruthy();
    expect(marksText(container).querySelector(".marks__cap")?.textContent).toBe("/6");
    expect(screen.getByText("正常 · 未被封印")).toBeTruthy();
  });

  it("纯被动没有发动按钮，改成一行说明；L2 写不可用原因", () => {
    const { container } = render(
      <SkillModal {...base} skillId="heart-1" reason="被血棘封印：技能连被动一起关着" />,
    );
    expect(container.querySelector(".sk__acts")).toBeNull();
    expect(screen.getByText("被动技能：不用手动发动")).toBeTruthy();
    expect(container.querySelector(".sk__l2")?.textContent).toBe("被血棘封印：技能连被动一起关着");
  });

  it("第二个页签「四句总则」逐字取自 lib/skills.ts", async () => {
    const { container } = render(<SkillModal {...base} skillId="spade-1" />);
    await userEvent.click(screen.getByRole("tab", { name: "四句总则" }));
    const panel = container.querySelectorAll('[role="tabpanel"]')[1];
    expect(panel.hasAttribute("hidden")).toBe(false);
    expect([...panel.querySelectorAll(".creed li")].map((li) => li.textContent)).toEqual(CREED);
    expect(panel.querySelector("p")?.textContent).toBe(CREED_FOOTNOTE.text + CREED_FOOTNOTE.aside);
  });

  it("aria-labelledby 指向真实存在的 id（useId，不硬编码）", () => {
    render(<SkillModal {...base} skillId="diamond-3" />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.tagName).toBe("DIALOG");
    const id = dialog.getAttribute("aria-labelledby") ?? "";
    expect(id).not.toBe("");
    expect(document.getElementById(id)?.textContent).toBe("影歌");
    // 页签也一样：aria-controls 必须落在真实面板上
    for (const tab of screen.getAllByRole("tab")) {
      expect(document.getElementById(tab.getAttribute("aria-controls") ?? "")).toBeTruthy();
    }
  });

  it("点关闭 → onClose", async () => {
    const onClose = vi.fn();
    render(<SkillModal {...base} skillId="spade-1" onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
