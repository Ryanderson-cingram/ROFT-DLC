import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { loadedSkills } from "@roft/engine";
import { skillById } from "@/lib/skills";
import { Emphasis } from "./emphasis";

/**
 * 技能文案里的强调标记。在此之前没有一处渲染它，玩家看到的是字面的
 * `**全场**都吃它的效果`——重点没了，还像文案坏了。
 */
describe("Emphasis", () => {
  const html = (text: string) => render(<Emphasis text={text} />).container.innerHTML;

  it("成对的 ** 变 <strong>，其余原样", () => {
    expect(html("回合开始选一支歌声，**全场**都吃它的效果")).toBe(
      "回合开始选一支歌声，<strong>全场</strong>都吃它的效果",
    );
  });

  it("一句里多处强调各自成对", () => {
    expect(html("**甲**与**乙**")).toBe("<strong>甲</strong>与<strong>乙</strong>");
  });

  it("没有强调的照原样输出，不加任何标签", () => {
    expect(html("弃一张牌，摸一张牌")).toBe("弃一张牌，摸一张牌");
  });

  it("落单的 ** 退化成不加粗，不炸也不吞字", () => {
    expect(render(<Emphasis text="前**后" />).container.textContent).toBe("前后");
  });

  /*
    真正要挡住的回归：文案里写了强调却没人渲染。清单从**引擎的池子**读，
    所以第三批再接技能、文案里带了 `**`，这条自动把它算进来。
  */
  it("池里每个技能的 l0/l1 都渲染得出：屏幕上一个字面的 ** 都不许剩", () => {
    for (const { id } of loadedSkills.pool) {
      const s = skillById(id)!;
      for (const [field, text] of [["l0", s.l0], ["l1", s.l1]] as const) {
        expect(render(<Emphasis text={text} />).container.textContent, `${id}.${field}`).not.toContain("**");
      }
    }
  });
});
