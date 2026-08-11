-- 由 scripts/gen-achievement-defs.ts 生成，勿手改。改成就请改 packages/stats/src/achievements.ts 再重跑。
-- achievement_defs 表建于 0006_stats_and_achievements.sql；这里只灌数据，按 id 幂等 upsert。
-- unlock_rate 不在 upsert 的更新列里：那一列归日更作业写，重跑 seed 不该把它抹掉。
with doc as (select $achievement_defs${
  "source": "packages/stats/src/achievements.ts",
  "generator": "scripts/gen-achievement-defs.ts",
  "achievements": [
    {
      "id": "first-game",
      "tier": "凡",
      "mark": "初",
      "name": "初登盘",
      "descr": "打完你的第一局。",
      "stat_key": "games",
      "stat_goal": 1,
      "sort": 0
    },
    {
      "id": "first-uno",
      "tier": "凡",
      "mark": "唤",
      "name": "开口",
      "descr": "第一次喊出 UNO。",
      "stat_key": "unoCalled",
      "stat_goal": 1,
      "sort": 1
    },
    {
      "id": "first-reveal",
      "tier": "凡",
      "mark": "露",
      "name": "亮相",
      "descr": "第一次亮出技能。",
      "stat_key": "skillsRevealed",
      "stat_goal": 1,
      "sort": 2
    },
    {
      "id": "first-god",
      "tier": "凡",
      "mark": "神",
      "name": "见神",
      "descr": "拿到四神中的任意一位。",
      "stat_key": "godsPlayed",
      "stat_goal": 1,
      "sort": 3
    },
    {
      "id": "catch-hunter",
      "tier": "玄",
      "mark": "捕",
      "name": "抓漏喊猎人",
      "descr": "抓到别人漏喊 25 次。",
      "stat_key": "unoCaught",
      "stat_goal": 25,
      "sort": 4
    },
    {
      "id": "streak-3",
      "tier": "玄",
      "mark": "叁",
      "name": "三连",
      "descr": "连胜 3 局。",
      "stat_key": "streakBest",
      "stat_goal": 3,
      "sort": 5
    },
    {
      "id": "dice-addict",
      "tier": "玄",
      "mark": "骰",
      "name": "骰徒",
      "descr": "累计掷骰 100 次。",
      "stat_key": "diceRolled",
      "stat_goal": 100,
      "sort": 6
    },
    {
      "id": "allies",
      "tier": "玄",
      "mark": "盟",
      "name": "合纵连横",
      "descr": "达成结盟 10 次。",
      "stat_key": "alliancesFormed",
      "stat_goal": 10,
      "sort": 7
    },
    {
      "id": "soul-reaper",
      "tier": "玄",
      "mark": "魂",
      "name": "收魂人",
      "descr": "生涯累计获得 100 枚标记。",
      "stat_key": "marksGained",
      "stat_goal": 100,
      "sort": 8
    },
    {
      "id": "color-sweep",
      "tier": "玄",
      "mark": "彩",
      "name": "满堂彩",
      "descr": "单局内四色各打出 8 张以上。",
      "stat_key": null,
      "stat_goal": null,
      "sort": 9
    },
    {
      "id": "deflect",
      "tier": "天",
      "mark": "反",
      "name": "反手",
      "descr": "把总量 12 张以上的惩罚链整条转给别人。",
      "stat_key": null,
      "stat_goal": null,
      "sort": 10
    },
    {
      "id": "bare-blade",
      "tier": "天",
      "mark": "刃",
      "name": "空手接白刃",
      "descr": "全程不喊 UNO、也没被抓到，并赢下这一局。",
      "stat_key": null,
      "stat_goal": null,
      "sort": 11
    },
    {
      "id": "swift",
      "tier": "天",
      "mark": "速",
      "name": "速通",
      "descr": "12 回合之内取胜。",
      "stat_key": null,
      "stat_goal": null,
      "sort": 12
    },
    {
      "id": "faceless",
      "tier": "天",
      "mark": "无",
      "name": "无相胜",
      "descr": "全程不亮技能取胜。",
      "stat_key": null,
      "stat_goal": null,
      "sort": 13
    },
    {
      "id": "lone-wolf",
      "tier": "天",
      "mark": "狼",
      "name": "独狼",
      "descr": "拒绝掉结盟邀请、一次都没结成，并取胜。",
      "stat_key": null,
      "stat_goal": null,
      "sort": 14
    },
    {
      "id": "reckoning",
      "tier": "天",
      "mark": "算",
      "name": "清算",
      "descr": "独自吃下总量 16 张的惩罚链。",
      "stat_key": "punishMax",
      "stat_goal": 16,
      "sort": 15
    },
    {
      "id": "night-watch",
      "tier": "天",
      "mark": "夜",
      "name": "守夜人",
      "descr": "在悉尼时间 00:00–04:00 之间打完一局。",
      "stat_key": null,
      "stat_goal": null,
      "sort": 16
    },
    {
      "id": "one-breath",
      "tier": "天",
      "mark": "气",
      "name": "一口气",
      "descr": "单回合打出 6 张以上的牌。",
      "stat_key": "mostCardsOneTurn",
      "stat_goal": 6,
      "sort": 17
    },
    {
      "id": "pantheon",
      "tier": "神",
      "mark": "殿",
      "name": "万神殿",
      "descr": "用四神各赢下至少一局。",
      "stat_key": null,
      "stat_goal": null,
      "sort": 18
    },
    {
      "id": "bestiary",
      "tier": "神",
      "mark": "志",
      "name": "博物志",
      "descr": "60 个技能全部至少用过一局。",
      "stat_key": null,
      "stat_goal": null,
      "sort": 19
    },
    {
      "id": "flawless",
      "tier": "神",
      "mark": "漏",
      "name": "无漏",
      "descr": "累计喊出 UNO 100 次，且一次都没被抓到过。",
      "stat_key": null,
      "stat_goal": null,
      "sort": 20
    },
    {
      "id": "defiant",
      "tier": "神",
      "mark": "逆",
      "name": "逆流",
      "descr": "在被封印过的一局里取胜。",
      "stat_key": null,
      "stat_goal": null,
      "sort": 21
    },
    {
      "id": "spotless",
      "tier": "神",
      "mark": "净",
      "name": "零封之局",
      "descr": "一局内没摸过一张牌、也没吃过惩罚，并取胜。",
      "stat_key": null,
      "stat_goal": null,
      "sort": 22
    },
    {
      "id": "abyss",
      "tier": "神",
      "mark": "墟",
      "name": "归墟",
      "descr": "牌堆洗满两次之后仍然取胜。",
      "stat_key": null,
      "stat_goal": null,
      "sort": 23
    }
  ]
}
$achievement_defs$::jsonb as d)
insert into public.achievement_defs (id, tier, mark, name, descr, stat_key, stat_goal, sort)
select a->>'id', a->>'tier', a->>'mark', a->>'name', a->>'descr',
       a->>'stat_key', (a->>'stat_goal')::int, (a->>'sort')::int
from doc, jsonb_array_elements(d->'achievements') as a
on conflict (id) do update set
  tier = excluded.tier, mark = excluded.mark, name = excluded.name,
  descr = excluded.descr, stat_key = excluded.stat_key,
  stat_goal = excluded.stat_goal, sort = excluded.sort;
