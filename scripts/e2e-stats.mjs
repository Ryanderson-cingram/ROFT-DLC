// 统计 / 成就 / 幂等的端到端冒烟测试。**不在 CI 里跑**——它要 docker + 本地 Supabase。
//
// 跑法：
//   supabase start && supabase db reset --no-seed
//   supabase functions serve --no-verify-jwt &
//   node scripts/e2e-stats.mjs
//
// 为什么单独一个脚本而不是 vitest 用例：它验的是**跨进程**的性质——
// 引擎 → 边缘函数 → RPC → 三张表，中间隔着 Deno 运行时与 PostgREST。
// 单测装不下这条链路，而这条链路上恰好埋着两个只有真跑才看得见的 bug：
//   1. `mergePrior` 少并了 20 多列（52 个单测全绿，profile 页却拿到一屏 undefined）
//   2. 幂等闸在 RPC 里，永远等不到重放（引擎先按已经前进的状态拒了）
//
// 它是**幂等**的：每次先清场，可以反复跑。
// 断言不通过时打印 ✗ 但不退出非零——这是给人看的冒烟，不是门禁。

import { execFileSync } from "node:child_process";

// 端口与密钥都从 `supabase status` 现读——本地实例的端口是按项目名哈希出来的，
// 写死一个就只在我这台机器上对。环境变量给 CI/远端留个口子。
const status = process.env.SVC
  ? null
  : JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }));
const API = process.env.API ?? status.API_URL;
const SVC = process.env.SVC ?? status.SERVICE_ROLE_KEY;
const ANON = process.env.ANON ?? status.ANON_KEY;

const svcHeaders = { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" };
const rest = async (path, init = {}) => {
  const r = await fetch(`${API}/rest/v1/${path}`, { ...init, headers: { ...svcHeaders, ...(init.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`REST ${path} → ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};
const del = (path) => rest(path, { method: "DELETE" });
const ins = (table, body) => rest(table, { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=minimal" } });

const ROOM = "33333333-3333-3333-3333-333333333333";
const U = ["1", "2", "3"].map((n) => `${n.repeat(8)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(12)}`);
const NAMES = ["无咎", "照野", "青塘"];
const card = (color, face, tag) => ({ id: `${color ?? "W"}${face}#${tag}`, color, face });

// —— 清场 ——
await del(`rooms?id=eq.${ROOM}`);
await del(`player_achievements?user_id=in.(${U.join(",")})`);
await del(`player_stats?user_id=in.(${U.join(",")})`);
await del(`player_recent?user_id=in.(${U.join(",")})`);
for (const id of U) {
  await fetch(`${API}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: svcHeaders }).catch(() => {});
}

// —— 三个人 ——
const tokens = [];
for (const [i, id] of U.entries()) {
  const email = `p${i}@roft.test`;
  const mk = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST", headers: svcHeaders,
    body: JSON.stringify({ id, email, password: "pw-test-123456", email_confirm: true }),
  });
  if (!mk.ok) throw new Error(`createUser ${await mk.text()}`);
  await ins("profiles", { id, username: NAMES[i] });
  const si = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "pw-test-123456" }),
  });
  const sess = await si.json();
  if (!sess.access_token) throw new Error(`signIn ${JSON.stringify(sess)}`);
  tokens.push(sess.access_token);
}

// —— 一个「差一张就赢」的牌桌 ——
// 座位 0 手上只剩 R5、牌顶 R7 → 打出去就收场。
// 0 号从没喊过 UNO、也没被抓过（空手接白刃）；拿的是四神之一（见神）；
// 牌堆已洗满两次（归墟）；这一局只走了 6 个回合（速通）；没摸过牌、没吃过惩罚（零封）。
const state = {
  version: 7,
  phase: "turnStart",
  seats: U.map((userId) => ({ userId })),
  config: { rulePack: "base", skillDraft: "draft3" },
  board: {
    rulePack: "base",
    drawPile: Array.from({ length: 20 }, (_, i) => card("B", "7", `d${i}`)),
    playedPile: [card("R", "7", "top")],
    discardPile: [],
    hands: [[card("R", "5", "a")], [card("B", "3", "b")], [card("G", "9", "c")]],
    activeColor: "R",
    currentSeat: 0,
    direction: 1,
    saidUno: [false, false, false],
    skills: ["god-fade", "heart-1", null],
    revealed: [false, false, false],
    activatedThisTurn: [false, false, false],
    marks: [{}, {}, {}],
    statuses: [[], [], []],
    reshuffles: 2,
  },
};

await ins("rooms", {
  id: ROOM, code: "E2E001", status: "playing", created_by: U[0], version: 7,
  config: { rulePack: "base", skillDraft: "draft3" },
});
await ins("room_seats", U.map((user_id, seat) => ({ room_id: ROOM, seat, user_id, ready: true })));
await ins("room_state_private", { room_id: ROOM, state });
await ins("room_events", [
  { room_id: ROOM, seq: 1, room_version: 1, type: "gameStarted", public_payload: { seats: 3, handSize: 7, starter: 0, drawPile: 60 } },
  ...Array.from({ length: 6 }, (_, i) => ({
    room_id: ROOM, seq: 2 + i, room_version: 1, type: "turnEnded", public_payload: { seat: i % 3 },
  })),
]);

const act = (key) => fetch(`${API}/functions/v1/room-action`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens[0]}`, apikey: ANON },
  body: JSON.stringify({
    roomId: ROOM, expectedVersion: 7, idempotencyKey: key,
    action: { type: "playCards", cardIds: ["R5#a"] },
  }),
});

// —— 打出最后一张 ——
const res = await act("e2e-final");
console.log("room-action →", res.status, await res.text());

// —— 验收 ——
let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `  实得 ${JSON.stringify(got)}，应为 ${JSON.stringify(want)}`}`);
};

const rows = await rest(`player_stats?user_id=in.(${U.join(",")})&select=user_id,stats`);
const statsOf = Object.fromEntries(rows.map((r) => [NAMES[U.indexOf(r.user_id)], r.stats]));
const me = statsOf["无咎"];

console.log("\n—— 统计 ——");
check("无咎 games", me.games, 1);
check("无咎 wins", me.wins, 1);
check("无咎 streakCur", me.streakCur, 1);
check("无咎 cardsPlayed（打出最后一张）", me.cardsPlayed, 1);
check("无咎 turnsTotal（库里 6 条 turnEnded）", me.turnsTotal, 6);
check("无咎 fastestWinTurns", me.fastestWinTurns, 6);
check("无咎 gamesFirst（gameStarted.starter = 0）", me.gamesFirst, 1);
check("无咎 bySkill（只能从终局 state 读）", me.bySkill, { "god-fade": { n: 1, w: 1 } });
check("无咎 byCard", me.byCard, { R5: 1 });
check("无咎 vsPlayer 两个对手", Object.keys(me.vsPlayer).length, 2);
check("照野 wins", statsOf["照野"].wins, 0);
check("照野 bySkill", statsOf["照野"].bySkill, { "heart-1": { n: 1, w: 0 } });
// 一列都不能少：mergePrior 漏并过 20 多列，单测全绿而这里会红
check("统计键数（PlayerStats 全量）", Object.keys(me).length, 35);
const nans = Object.entries(me).filter(([, v]) => typeof v === "number" && Number.isNaN(v));
check("没有 NaN", nans, []);

console.log("\n—— 成就 ——");
const ach = await rest(`player_achievements?user_id=in.(${U.join(",")})&select=user_id,achievement_id`);
const got = {};
for (const a of ach) (got[NAMES[U.indexOf(a.user_id)]] ??= []).push(a.achievement_id);

/*
  「守夜人」判的是**悉尼时间**的终局钟点（00:00–04:00），全局统一、不看玩家当地。
  所以它成不成立取决于你什么时候跑这个脚本——断言跟着同一个时区走，
  否则悉尼的半夜跑必红，那是脚本的毛病不是代码的。
*/
const sydneyHour = Number(new Intl.DateTimeFormat("en-GB",
  { timeZone: "Australia/Sydney", hour: "2-digit", hour12: false }).format(new Date())) % 24;
const nightly = sydneyHour < 4 ? ["night-watch"] : [];
const expect = (...ids) => [...ids, ...nightly].sort();
if (nightly.length) console.log(`  （悉尼时间 ${sydneyHour} 点，守夜人计入预期）`);

// 这一局是照着这几条摆的：见脚本上方牌桌那段注释
check("无咎", (got["无咎"] ?? []).sort(),
  expect("abyss", "bare-blade", "faceless", "first-game", "first-god", "spotless", "swift"));
check("照野 只有初登盘", (got["照野"] ?? []).sort(), expect("first-game"));
check("青塘 只有初登盘", (got["青塘"] ?? []).sort(), expect("first-game"));

const evs = await rest(`room_events?room_id=eq.${ROOM}&select=seq,type,public_payload&order=seq`);
const unlockEvents = evs.filter((e) => e.type === "achievementUnlocked");
check("achievementUnlocked 三条（每人一条）", unlockEvents.length, 3);
check("终局事件带 winner", evs.find((e) => e.type === "gameEnded")?.public_payload, { winner: 0 });

/*
  近 20 场（0009 的 `player_recent`）。这张表**只有在终局那一帧搭上 p_stats 的车**才会有行，
  所以它验的是「边缘函数把 recent 填对了」+「RPC 那条 insert 走通了」，两头都在别的进程里。
*/
console.log("\n—— 近 20 场 ——");
const recent = await rest(`player_recent?user_id=in.(${U.join(",")})&select=user_id,won,skill_id,turns,hand_left`);
const recentOf = Object.fromEntries(recent.map((r) => [NAMES[U.indexOf(r.user_id)], r]));
check("一人一行", recent.length, 3);
check("赢家 won = true", recentOf["无咎"]?.won, true);
check("输的那两个 won = false（不是 null——null 是平局）", [recentOf["照野"]?.won, recentOf["青塘"]?.won], [false, false]);
check("技能 id 落库", recentOf["无咎"]?.skill_id, "god-fade");
check("回合数与统计里的同一个数", recentOf["无咎"]?.turns, me.turnsTotal);
check("赢家收场手牌 0 张", recentOf["无咎"]?.hand_left, 0);
check("没赢的人手上还剩牌", recentOf["照野"]?.hand_left, 1);
// 没抽到技能的座位不许写成空字符串（页面按 null 走「没有技能」那条分支）
check("青塘没有技能 → null", recentOf["青塘"]?.skill_id, null);

/*
  榜单（0008 的 `leaderboards()`）。这一段**必须用玩家的 token 打**，不是 service_role：
  「我排第几」走的是 `auth.uid()`，用 service_role 跑它恒为 null，等于什么都没验。
  名次不写死成 1——本地库里可能还躺着别的对局，验的是「榜上那一行」与「我的名次」对得上。
*/
console.log("\n—— 榜单 ——");
const boards = await (await fetch(`${API}/rest/v1/rpc/leaderboards`, {
  method: "POST",
  headers: { apikey: ANON, Authorization: `Bearer ${tokens[0]}`, "Content-Type": "application/json" },
  body: "{}",
})).json();
const mineStreak = boards.streak?.rows?.find((r) => r.userId === U[0]);
check("连胜榜上有赢家（streakBest = 1）", mineStreak?.value, 1);
check("「我排第几」= 榜上那一行的名次", boards.streak?.mine?.rank, mineStreak?.rank);
// 空榜整格缺席（不是空数组）——页面按这个口径写的
check("胜率榜的 50 局门槛：这一局谁都不够 → 整条榜缺席", boards.winRate, undefined);
check("这一局没人抓漏喊 → 抓漏喊榜缺席", boards.caught, undefined);

console.log("\n—— 幂等 ——");
const replay = await act("e2e-final");
const body = JSON.parse(await replay.text());
check("同 key 重放 → 200", replay.status, 200);
check("同 key 重放 → idempotent", body.idempotent, true);
check("同 key 重放 → 还回第一次的 version", body.version, 8);
const after = await rest(`player_stats?user_id=eq.${U[0]}&select=stats`);
check("重放不重复计数", after[0].stats.games, 1);
// player_recent 是 insert（不是 upsert），重放要是走到了那条语句就会多出一行
const afterRecent = await rest(`player_recent?user_id=in.(${U.join(",")})&select=id`);
check("重放不多插一行近况", afterRecent.length, 3);
// 换一个 key 重发同一个动作：这才该被引擎拒
const fresh = await act("e2e-different-key");
check("换 key 重发 → 400", fresh.status, 400);
check("换 key 重发 → wrong_phase", JSON.parse(await fresh.text()).reason, "wrong_phase");

console.log(bad === 0 ? "\n全部通过。" : `\n${bad} 条没过。`);
