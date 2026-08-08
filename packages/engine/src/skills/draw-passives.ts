/**
 * 把「谁的定义声明了改摸牌数」翻译成 `resolveDrawCount` 吃的修正列表。
 *
 * 这里**没有一行是恩惠专属的**：它扫全场已亮出的技能，凡是定义里 `modifies` 含
 * `draw_count` 的子效果，就按它自己声明的 `layer` 逐层产出修正，数值从参数表读。
 * 所以「再来一个改摸牌数的技能」= 改 JSON + 加一行数值，这个文件不动。
 *
 * 摆在 `skills/` 而不是 `actions/`，是因为它依赖定义与参数；`drawCards` 反过来调它，
 * 一个方向，没有环。规则：01-V3（亮出才生效）、01-P9/02 §2（封印）、02 §7。
 */
import { paramsOfEffect } from "./params.ts";
import { skills } from "./registry.ts";
import { optionLive } from "./bard.ts";
import { PROCEDURES } from "./primitives/draw-modifier.ts";
import { suppressionOf } from "./primitives/suppression.ts";
import type { EffectParams } from "./params.ts";
import type { DrawLayer, SkillDef, SkillEffect } from "./types.ts";
import type { DrawModifier, DrawRequest } from "./primitives/draw-modifier.ts";
import type { Board } from "../types.ts";

/** 定义（数值就在定义里）。生产用的那一份是 `SKILL_DATA`；测试与「改数据看行为」注入自己的。 */
export interface SkillData {
  byId: ReadonlyMap<string, SkillDef>;
}

/**
 * `byId` 用 getter 惰性取，不在模块顶层读。
 * registry → handlers → actions/draw → draw-passives → registry 是一个环：顶层直接读
 * `skills.byId` 时，registry 可能还在初始化中，拿到的是 undefined。谁先被 import 决定
 * 会不会炸——本地全量跑侥幸没事，CI 单独跑 registry.test.ts 就炸了。
 * 惰性化之后模块初始化不再依赖环内顺序，环存在也无害。
 */
export const SKILL_DATA: SkillData = {
  get byId() {
    return skills.byId;
  },
};

/** 一层修正的形状：`values` 里那个数按层各有各的含义（加减 / 倍率 / 覆盖 / 下限 / 程序参数）。 */
function toModifier(layer: DrawLayer, source: string, n: number | undefined, e: SkillEffect): DrawModifier {
  // 计划 §1：数据点名了一层，引擎给不出它的值——静默失效比报错难查得多，宁可炸。
  if (n === undefined) throw new Error(`${source}: 定义声明了 ${layer}，但 values 里没有它的数值`);
  switch (layer) {
    case "L2":
      return { layer, source, delta: n };
    case "L3":
      return { layer, source, factor: n };
    case "L4":
      // 02 §7：`self` 胜过 `global`；歌声是全场的，时神那支永久樱时雨才是 self
      return { layer, source, scope: e.targeting === "self" ? "self" : "global", value: n };
    case "L5":
      return { layer, source, min: n };
    case "L6": {
      // L6 不改数字，只改执行方式，所以名字才是它的全部内容（02 §6 的 `procedure`）。
      // 认不出的名字 = 消费者会静默跳过，同上，宁可炸。
      const procedure = e.procedure;
      if (!procedure || !PROCEDURES.has(procedure))
        throw new Error(`${source}: L6 的 procedure「${procedure ?? "缺席"}」引擎没有实现`);
      // 带整张 values（02 §6）：这支程序要几个参数由它自己说，采集器不挑
      return { layer, source, procedure, values: e.values ?? {} };
    }
    default:
      // L1 在上面就被跳过了（值由调用方给），L0 从来不是修正——真走到这里就是数据坏了
      throw new Error(`${source}: ${layer} 不是修正层`);
  }
}

/**
 * 这条子效果此刻是否作用于 `req` 这次摸牌。
 * `targeting: "self"` = 只改自己那次摸牌（恩惠救不了别人）。
 * 技能摸牌还要过 06-Q56 那一关：`applies_to` 里的 `skill` 指的是**他人**技能造成的摸牌，
 * 所以发起者就是摸牌者本人（含缺席 = 自己）时不生效——恒心自己弃 1 摸 1 不该被自己的恩惠减掉。
 */
const applies = (e: SkillEffect, holder: number, req: DrawRequest, p: EffectParams) =>
  (e.targeting !== "self" || holder === req.seat) && matchesEvent(p.appliesTo, req);

/**
 * `applies_to` 与这次摸牌事件对不对得上（02 §6）。
 * `skill_others` 是**限定**而不是事件类型：他人技能造成的摸牌才算（06-Q56 给恩惠♥1 的口径）。
 * 从前这条限定写死在采集器里、套在**所有**效果上，于是活泼板的「所有摸牌 +1」
 * 会漏掉自己发动造成的那些——限定归数据之后就没这回事了。
 */
const matchesEvent = (appliesTo: EffectParams["appliesTo"], req: DrawRequest) =>
  !appliesTo ||
  appliesTo.some((f) =>
    f === "skill_others"
      ? req.kind === "skill" && (req.initiator ?? req.seat) !== req.seat
      : f === req.kind,
  );

export function drawModifiersFor(b: Board, req: DrawRequest, data: SkillData = SKILL_DATA): DrawModifier[] {
  const mods: DrawModifier[] = [];
  b.skills.forEach((id, seat) => {
    // V3：没亮出的技能对局面毫无影响
    if (!id || !b.revealed[seat]) return;
    const def = data.byId.get(id);
    // 部分标注的条目（狂欢/伤逝/吟游…只搬了 §7 的 layer）声称不了自己机器可执行，
    // 跟着它们的 layer 走只会撞上没有数值的层。它们本来也进不了抽 3 选 1 的池。
    if (!def || def.structured !== true) return;
    // P9/02 §2：封印把这个技能整个关掉（`sealable` 缺席 = 默认可封，02 §1）。
    // 这里只看 `sealed` 一个源，不用 `isSuppressed`：`punishTurn` 那一源按 P1/T3 关的是
    // **主动**技能，而被动照常结算（V8）——拿它压被动会让恩惠在每一次惩罚里都失效。
    if (def.sealable !== false && suppressionOf(b, seat).includes("sealed")) return;
    for (const e of def.effects ?? []) {
      // 改数字的（L0–L5，`draw_count`）与只改执行方式的（L6，`draw_procedure`）走同一条采集：
      // 02 §7 的层级机器把两者一起算完，L6 落在 `resolution.procedures` 里交给调用方执行
      if (!e.modifies?.some((m) => m === "draw_count" || m === "draw_procedure") || !e.layer) continue;
      // 02 §6 的选项分支（吟游♣5 的四支歌声）：**被选中的那一支**才生效
      if (!optionLive(b, def, e)) continue;
      const p = paramsOfEffect(e);
      // **按标记计价的不从这里产**（异议②的弃异：`values.L2` 是每枚的值，−1 × 实弃数才是 delta）。
      // 这个函数是纯的、也拿不到「玩家这次实付了几枚」，跟 L1 是同一条理由：由调用方算好
      // 走 `drawCards` 的 `mods` 传进来（见 `skills/dissent.ts::payDissent`）。
      // ponytail: 判据是「有 values.marks」。将来若出现「固定代价 + 固定改摸数」的技能会被误跳，
      // 那时给 04 加个显式字段（如 `per_mark: true`）再改这一行即可。
      if (p.counts.marks) continue;
      if (!applies(e, seat, req, p)) continue;
      for (const layer of e.layer) {
        // **L1 不从这里产**。替换层的值可能是掷出来的（伤逝按链上张数掷骰求和），
        // 而这个函数是纯的、拿不到 rng——所以 L1 一律由调用方先算好、走 `drawCards` 的
        // `mods` 参数传进来（见 `skills/damnation.ts` 与 draw-modifier.ts 的顶注）。
        // 跳过而不是报错：定义里标 `layer: [L1]` 是对的，只是它的值不走这条路。
        if (layer === "L1") continue;
        mods.push(toModifier(layer, def.name, p.draw[layer], e));
      }
    }
  });
  return mods;
}
