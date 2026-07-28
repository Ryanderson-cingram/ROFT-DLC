// 技能定义的类型契约。字段模型见 docs/knowledge-base/02-methodology.md §1。
// 这里只声明「已经从知识库可靠提取到的」字段；effects[] / reveal_window / sealable
// 等尚未在文档里逐条标注，故不出现在类型里——等文档结构化后再由生成脚本补。
// 注意：这是 skills 子模块自己的类型，不是 src/types.ts 那份引擎↔前端共享契约。

export type SkillStatus = '✅' | '❓' | '⚠️' | '✅/❓';

export interface SkillDef {
  /** 稳定 ID，如 `heart-3` / `star-grandeur`（02-methodology §1） */
  id: string;
  /** 中文名 */
  name: string;
  /** 花色与点数，如 `♥3` / `★` */
  suit_rank: string;
  /** 知识库标注的裁定状态 */
  status: SkillStatus | string;
  /** 04-skills-catalog 的「摘要」栏，L0 自然语言，含 markdown 强调 */
  summary: string;
  /** 「疑点」栏；文档写 `—` 时为 null */
  caveats: string | null;
  /** 其他被记录的行内说明（如 ★ 条目的「类型」「注」），无则省略 */
  notes?: string;
  /**
   * 是否已结构化为机器可执行的字段（effects[]/window/layer/targeting…）。
   * 目前全部为 false：知识库只有自然语言摘要，硬猜结构化字段会造成假精度。
   */
  structured: boolean;
}

export interface SkillDefsDoc {
  rulesetVersion: string;
  /** 生成来源，改规则先改文档 */
  source: string;
  generator: string;
  skills: SkillDef[];
}
