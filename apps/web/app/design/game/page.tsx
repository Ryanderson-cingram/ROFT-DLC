"use client";

import { LogPanelView } from "@/components/game/log-panel";
import { Hud } from "@/components/game/hud";
import { fixtureA } from "@/fixtures/snapshot";
import "../../game/[code]/game.css";

/**
 * 设计对照页：真组件 + fixture 数据，与 design/mockups/game-log.html 逐块对齐。
 * 不接 supabase，纯静态；LogPanelView 与真实数据层共用同一份 DOM 与样式。
 */
const NAMES = { "u-lin": "小林", "u-chai": "阿柴", "u-man": "小满", "u-bai": "老白" };

const LINES = [
  { id: 12, line: { who: "老白", what: "抓了阿柴没喊 UNO——摸 2 张", kind: "uno" as const } },
  { id: 11, line: { who: "小满", what: "发动 恒心", kind: "skill" as const } },
  { id: 10, line: { who: "小满", what: "弃了 蓝 5", kind: "skill" as const } },
  { id: 9, line: { who: "阿柴", what: "打出 红 7" } },
  { id: 8, line: { who: "小满", what: "吃下惩罚 4 张", kind: "punish" as const } },
  { id: 7, line: { who: "老白", what: "打出 +4，定色蓝", kind: "punish" as const } },
  { id: 6, line: { who: "阿柴", what: "打出 黄 +2", kind: "punish" as const } },
  { id: 5, line: { who: "小满", what: "亮出技能 恩惠", kind: "skill" as const } },
  { id: 4, line: { who: "老白", what: "摸了 1 张" } },
  { id: 3, line: { who: "牌桌", what: "洗回 14 张进摸牌堆", kind: "system" as const } },
  { id: 2, line: { who: "阿柴", what: "喊了 UNO！", kind: "uno" as const } },
  { id: 1, line: { who: "牌桌", what: "全员选完技能，开打", kind: "system" as const } },
];

export default function DesignGamePage() {
  return (
    <div className="game-page">
      <div className="layout">
        <Hud snapshot={fixtureA} names={NAMES} onPlay={() => {}} onPlayMany={() => {}} onAction={() => {}} />
        <LogPanelView lines={LINES} />
      </div>
    </div>
  );
}
