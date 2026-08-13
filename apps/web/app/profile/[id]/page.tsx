import type { PlayerStats } from "@roft/stats";
import { loadedSkills } from "@roft/engine";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Count, Reveal } from "@/components/profile/animate";
import { cardColorClass, cardFaceLabel } from "@/lib/cards";
import { projectProfile, projectRecent, PLATE_TICKS, type DefRow, type RecentRow } from "@/lib/profile-view";
import { createClient } from "@/lib/supabase/server";
import "./profile.css";

export const metadata = { title: "命盘 · ROFT-DLC" };

/**
 * 命盘外圈那 60 齿的顺序 = 引擎里技能定义的书写顺序（★ → ♥♦♠♣ → 神）。
 * 从引擎读而不是在这里抄一份：加了技能这一圈自己就长出来。
 */
const PLATE_SKILLS = [...loadedSkills.byId.keys()];

/** 齿在盘上的角度 → 两个端点。四神那几齿伸长一点，让它们从一圈里跳出来。 */
function tick(i: number, total: number, isGod: boolean) {
  const a = ((i / total) * 360 - 90) * (Math.PI / 180);
  const [r0, r1] = [170, isGod ? 190 : 186];
  return {
    x1: 200 + Math.cos(a) * r0, y1: 200 + Math.sin(a) * r0,
    x2: 200 + Math.cos(a) * r1, y2: 200 + Math.sin(a) * r1,
  };
}

const ARC = 2 * Math.PI * 150;

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) redirect("/login");

  // 五条读并发跑。RLS 对这几张表是 select 全开（成就与统计里没有暗信息），
  // 所以看别人的命盘走的是同一条路径，不需要分支。
  const [me, statsRow, ownedRows, defRows, recentRows] = await Promise.all([
    supabase.from("profiles").select("id, username, created_at").eq("id", id).maybeSingle(),
    supabase.from("player_stats").select("stats").eq("user_id", id).maybeSingle(),
    supabase.from("player_achievements").select("achievement_id").eq("user_id", id),
    supabase.from("achievement_defs").select("id, tier, mark, name, descr, stat_key, stat_goal, sort, unlock_rate"),
    // 近 20 场：新 → 旧（`projectRecent` 自己翻成旧 → 新）。截断是查询的事
    supabase
      .from("player_recent")
      .select("finished_at, won, skill_id, turns, hand_left")
      .eq("user_id", id)
      .order("finished_at", { ascending: false })
      .limit(20),
  ]);
  if (!me.data) notFound();

  const v = projectProfile(
    (statsRow.data?.stats ?? null) as Partial<PlayerStats> | null,
    (ownedRows.data ?? []).map((r) => r.achievement_id as string),
    (defRows.data ?? []) as DefRow[],
  );
  const recent = projectRecent((recentRows.data ?? []) as RecentRow[]);

  // 宿敌与盟友只有 id，名字要另外查一次（两个人，一条 in 查询）
  const relIds = [v.nemesis?.userId, v.ally?.userId].filter((x): x is string => !!x);
  const { data: relRows } = relIds.length
    ? await supabase.from("profiles").select("id, username").in("id", relIds)
    : { data: [] };
  const nameOf = (uid: string) =>
    (relRows ?? []).find((r) => r.id === uid)?.username ?? "某位对手";

  const isSelf = auth.claims.sub === id;
  const collected = new Set(
    v.mastery.length || !v.empty ? Object.keys((statsRow.data?.stats as PlayerStats)?.bySkill ?? {}) : [],
  );

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <b>ROFT</b>
          <span>诸神降临 4.1</span>
        </div>
        <Link className="btn btn--ghost" href="/">← 大厅</Link>
      </header>

      <main className="page">
        {/* ================= 一、命盘 ================= */}
        <section className="hero">
          <div className="plate-wrap" data-in>
            <svg
              className="plate-svg"
              viewBox="0 0 400 400"
              role="img"
              aria-label={`命盘：胜率 ${v.winRate.pct ?? "暂无"}%，技能收集 ${v.collected} / ${PLATE_TICKS}`}
            >
              <circle className="pl-ring" cx="200" cy="200" r="192" strokeDasharray="2 6" />
              <g id="ticks">
                {PLATE_SKILLS.map((sid, i) => {
                  const isGod = sid.startsWith("god-");
                  const on = collected.has(sid);
                  return (
                    <line
                      key={sid}
                      {...tick(i, PLATE_SKILLS.length, isGod)}
                      className={`pl-tick${on ? " is-on" : ""}${isGod ? " is-god" : ""}`}
                      style={{ ["--i" as string]: i }}
                    />
                  );
                })}
              </g>

              <circle className="pl-arc-bg" cx="200" cy="200" r="150" />
              <circle
                className="pl-arc"
                cx="200" cy="200" r="150"
                transform="rotate(-90 200 200)"
                strokeDasharray={ARC}
                // 弧长直接写成最终值：CSS 从「整圈藏起来」过渡到这里，
                // JS 没跑也是对的（同 <Count> 的思路）
                style={{ ["--arc" as string]: ARC, strokeDashoffset: ARC * (1 - (v.winRate.pct ?? 0) / 100) }}
              />

              <circle className="pl-ring" cx="200" cy="200" r="128" strokeDasharray="1 4" />
              <circle className="pl-hub" cx="200" cy="200" r="112" />
            </svg>

            <div className="plate-core">
              <p className="eyebrow">生涯胜率</p>
              <div className="wr">
                <Count value={v.winRate.pct} dec={1} />
                {v.winRate.pct === null ? null : <sub>%</sub>}
              </div>
              <p className="wl">
                <b>{v.wins}</b> 胜 · <i>{v.losses}</i> 负 · {v.draws} 平
              </p>
            </div>

            <span className="plate-tag plate-tag--coll">
              技能收集 <b>{v.collected}</b> / {PLATE_TICKS}
            </span>
            <span className="plate-tag plate-tag--god">
              四神 <b>{v.godsCollected}</b> / 4
            </span>
          </div>

          <div className="ident">
            <div>
              <div className="ident__name">
                <h1>{me.data.username}</h1>
                {isSelf ? <span className="title-chip">这是你</span> : null}
              </div>
              <div className="ident__meta">
                <span>入盘于 <span className="code">{me.data.created_at.slice(0, 10)}</span></span>
                <span>对局 <span className="code">{v.games}</span></span>
              </div>
            </div>

            <div className="ladder panel">
              <div className="ladder__top">
                <span className="ladder__rank">封泥</span>
                <span className="ladder__pts">
                  <b>{v.achievementsOwned}</b> / {v.achievements.length}
                </span>
              </div>
              <div className="ladder__bar">
                <i
                  className="ladder__fill"
                  style={{
                    width: v.achievements.length
                      ? `${(v.achievementsOwned / v.achievements.length) * 100}%`
                      : "0%",
                  }}
                />
              </div>
              <div className="ladder__next">
                <span>{(["凡", "玄", "天", "神"] as const)
                  .map((t) => `${t} ${v.achievements.filter((a) => a.owned && a.tier === t).length}`)
                  .join(" · ")}</span>
                {v.nextUp ? (
                  <span>下一枚：{v.nextUp.name} {v.nextUp.progress![0]} / {v.nextUp.progress![1]}</span>
                ) : null}
              </div>
            </div>

            <div className="quad">
              <div className="qcell"><b className="num--lead"><Count value={v.games} /></b><small>总对局</small></div>
              <div className="qcell qcell--hot"><b className="num--lead"><Count value={v.streakCur} /></b><small>当前连胜</small></div>
              <div className="qcell"><b className="num--lead"><Count value={v.streakBest} /></b><small>最长连胜</small></div>
              <div className="qcell"><b className="num--lead"><Count value={v.avgTurns} dec={1} /></b><small>场均回合</small></div>
            </div>
          </div>
        </section>

        {v.empty ? (
          <section className="panel emptystate">
            <p className="eyebrow">这张盘还是空的</p>
            <h2>{isSelf ? "打完第一局，这里就有东西了" : "他还没打完过一局"}</h2>
            <p className="hint">
              统计从每一局的终局那一刻沉淀下来。下面 {v.achievements.length} 枚封泥是接下来的目标。
            </p>
            {isSelf ? <Link className="btn btn--primary" href="/">去开一桌</Link> : null}
          </section>
        ) : (
          <>
            {/* ================= 二、关键数据 ================= */}
            <Reveal>
              <section>
                <div className="sec-head">
                  <p className="eyebrow">Ⅰ</p><h2>关键数据</h2>
                </div>
                <div className="stats">
                  <div className="stat">
                    <p className="k">先手胜率</p>
                    <p className="v"><b><Count value={v.firstRate.pct} dec={1} /></b><span>%</span></p>
                    <p className="d">先手 {v.firstRate.n} 局 · 后手 <em>{v.laterRate.pct ?? "—"}%</em></p>
                  </div>
                  <div className="stat">
                    <p className="k">场均出牌</p>
                    <p className="v"><b><Count value={v.avgCardsPlayed} dec={1} /></b><span>张</span></p>
                    <p className="d">生涯累计 <em>{v.records.cardsDrawn}</em> 张摸牌</p>
                  </div>
                  <div className="stat">
                    <p className="k">场均被惩罚</p>
                    <p className="v"><b><Count value={v.avgPunishTaken} dec={1} /></b><span>张</span></p>
                    <p className="d">单条最长 <em className="down">{v.punish.max}</em> 张</p>
                  </div>
                  <div className="stat">
                    <p className="k">技能发动</p>
                    <p className="v"><b><Count value={v.avgActivations} dec={1} /></b><span>次 / 局</span></p>
                    <p className="d">被封印 <em>{v.misc.sealed}</em> 次</p>
                  </div>
                </div>
              </section>
            </Reveal>

            {/* ================= 三、近况 ================= */}
            {recent ? (
              <Reveal>
                <section>
                  <div className="sec-head">
                    <p className="eyebrow">Ⅱ</p><h2>近况</h2>
                    <span className="hint">最近 {recent.runs.length} 场 · 滚动胜率</span>
                  </div>
                  <div className="panel spark">
                    {/* 曲线是**累计**胜率：最左边是这一截里最旧的一场，最右边是最近一场。
                        路径由 projectRecent 算好（那儿有用例钉着方向与平局的口径） */}
                    <svg viewBox="0 0 560 108" preserveAspectRatio="none" role="img"
                      aria-label={`最近 ${recent.runs.length} 场的滚动胜率，胜 ${recent.wins} 场`}>
                      <defs>
                        {/* 颜色写死成字面量，不写 var(--piao)：presentation attribute 里的
                            自定义属性不是所有引擎都认，设计稿里也是字面量 */}
                        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="rgba(99,210,195,0.28)" />
                          <stop offset="100%" stopColor="rgba(99,210,195,0)" />
                        </linearGradient>
                      </defs>
                      <line className="base" x1="0" y1="54" x2="560" y2="54" />
                      <path className="ar" d={recent.area} />
                      <path className="ln" d={recent.line} />
                    </svg>
                    <div className="spark__cap">
                      <span>{recent.runs.length} 场前</span><span>50% 基准</span><span>最近一场</span>
                    </div>
                    {/* 每场一个点。摘要是 title 而不是自绘的浮层——原生 tooltip 键盘与读屏都认，
                        而且不会在窄屏上被裁掉（.run__tip 那套是设计稿里的做法，落地时换掉） */}
                    <div className="runs">
                      {recent.runs.map((r, i) => (
                        <span key={i} className="run" data-r={r.result} title={r.tip}>
                          {r.result}
                          <span className="sr-only">：{r.tip}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </section>
              </Reveal>
            ) : null}

            {/* ================= 四、本命神职 ================= */}
            {v.mastery.length ? (
              <Reveal>
                <section>
                  <div className="sec-head">
                    <p className="eyebrow">Ⅲ</p><h2>本命神职</h2>
                    <span className="hint">用过 ≥ 8 局 · 按胜率排</span>
                  </div>
                  <div className="mastery">
                    {v.mastery.map((m) => (
                      <div className={`mrow${m.winPct < 50 ? " mrow--cold" : ""}`} key={m.id}>
                        <p className="mrow__nm"><span className="sigil">{m.sigil}</span>{m.name}</p>
                        <div className="mrow__bar"><i className="mrow__fill" style={{ width: `${m.winPct}%` }} /></div>
                        <p className="mrow__num"><b>{m.winPct}%</b><span>{m.games} 局</span></p>
                      </div>
                    ))}
                  </div>
                </section>
              </Reveal>
            ) : null}

            {(v.nemesis || v.ally) ? (
              <Reveal>
                <div className="rel">
                  {v.nemesis ? (
                    <div className="panel relcard relcard--foe">
                      <div>
                        <p className="eyebrow">宿敌</p>
                        <p className="who">{nameOf(v.nemesis.userId)}</p>
                      </div>
                      <div className="fig">
                        <b>{v.nemesis.n - v.nemesis.lost} - {v.nemesis.lost}</b>
                        <small>同桌 {v.nemesis.n} 局</small>
                      </div>
                    </div>
                  ) : null}
                  {v.ally ? (
                    <div className="panel relcard relcard--ally">
                      <div>
                        <p className="eyebrow">最佳盟友</p>
                        <p className="who">{nameOf(v.ally.userId)}</p>
                      </div>
                      <div className="fig">
                        <b>{v.ally.winPct}%</b>
                        <small>结盟 {v.ally.n} 局的胜率</small>
                      </div>
                    </div>
                  ) : null}
                </div>
              </Reveal>
            ) : null}

            {/* ================= 四、趣味数据 ================= */}
            <Reveal>
              <section>
                <div className="sec-head">
                  <p className="eyebrow">Ⅳ</p><h2>趣味数据</h2>
                  <span className="hint">生涯累计</span>
                </div>
                <div className="fun">
                  <div className="panel funcard">
                    <h3>UNO</h3>
                    <p className="fl"><span>喊出</span><b>{v.uno.called}</b></p>
                    <p className="fl"><span>抓到别人漏喊</span><b data-tone="ok">{v.uno.caught}</b></p>
                    <p className="fl"><span>被别人抓到</span><b data-tone="bad">{v.uno.gotCaught}</b></p>
                    <p className="fl"><span>误喊（罚摸 2）</span><b>{v.uno.miscalled}</b></p>
                  </div>

                  <div className="panel funcard">
                    <h3>惩罚叠链</h3>
                    <p className="fl"><span>最长承受</span><b data-tone="bad">{v.punish.max}</b></p>
                    <p className="fl"><span>转嫁出去</span><b data-tone="ok">{v.punish.deflected}</b></p>
                    <p className="fl"><span>单次最大转嫁</span><b>{v.punish.deflectedMax}</b></p>
                    <p className="fl"><span>累计吃下</span><b>{v.punish.taken}</b></p>
                  </div>

                  {v.dice.total > 0 ? (
                    <div className="panel funcard">
                      <h3>强袭掷骰</h3>
                      <div className="dice">
                        {v.dice.hist.map((n, i) => (
                          <i
                            key={i}
                            data-l={`×${i}`}
                            style={{ height: `${(n / Math.max(...v.dice.hist)) * 100}%` }}
                          />
                        ))}
                      </div>
                      <p className="dice-cap">
                        共掷 <b className="code">{v.dice.total}</b> 次 · ×2 占 <b className="code">{v.dice.twoPct}%</b>
                        （期望 33.3%）
                      </p>
                    </div>
                  ) : null}

                  {v.favCard ? (
                    <div className="panel funcard">
                      <h3>最常打出的一张</h3>
                      <div className="favcard">
                        <span
                          className="card"
                          data-color={cardColorClass({ id: "fav", color: v.favCard.color, face: v.favCard.face })}
                          data-face={cardFaceLabel({ id: "fav", color: v.favCard.color, face: v.favCard.face })}
                        />
                        <div className="fig">
                          <b>{v.favCard.n}</b>
                          <small>次</small>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="panel funcard">
                    <h3>盘外事</h3>
                    <p className="fl"><span>结盟达成 / 拒绝</span><b>{v.misc.alliancesFormed} / {v.misc.alliancesRefused}</b></p>
                    <p className="fl"><span>发起劫营</span><b>{v.misc.raids}</b></p>
                    <p className="fl"><span>获得标记</span><b data-tone="ok">{v.misc.marks}</b></p>
                    <p className="fl"><span>被封印</span><b data-tone="bad">{v.misc.sealed}</b></p>
                  </div>

                  <div className="panel funcard">
                    <h3>纪录</h3>
                    <p className="fl"><span>最快取胜</span><b data-tone="ok">{v.records.fastestWin ?? "—"} <small>回合</small></b></p>
                    <p className="fl"><span>最长鏖战</span><b>{v.records.longestGame} <small>回合</small></b></p>
                    <p className="fl"><span>单回合最多出牌</span><b>{v.records.mostCardsOneTurn} <small>张</small></b></p>
                    <p className="fl"><span>平局</span><b>{v.draws} <small>局</small></b></p>
                  </div>
                </div>
              </section>
            </Reveal>
          </>
        )}

        {/* ================= 五、封泥 ================= */}
        <Reveal>
          <section>
            <div className="sec-head">
              <p className="eyebrow">{v.empty ? "Ⅰ" : "Ⅴ"}</p><h2>封泥</h2>
              <span className="hint"><b className="code">{v.achievementsOwned}</b> / {v.achievements.length} 已得</span>
            </div>
            <div className="ach">
              {v.achievements.map((a, i) => (
                <article
                  className="seal"
                  key={a.id}
                  data-tier={a.tier}
                  data-state={a.owned ? "on" : "off"}
                  style={{ ["--i" as string]: i }}
                >
                  <div className="seal__mark">{a.owned ? a.mark : "▢"}</div>
                  <h3 className="seal__nm">{a.name}</h3>
                  <p className="seal__desc">{a.descr}</p>
                  {a.progress ? (
                    <>
                      <div className="seal__prog">
                        <i style={{ width: `${(a.progress[0] / a.progress[1]) * 100}%` }} />
                      </div>
                      <span className="seal__pn">{a.progress[0]} / {a.progress[1]}</span>
                    </>
                  ) : null}
                  <p className="seal__foot">
                    <span className="seal__rar">{a.tier} 品</span>
                    {/* 稀有度由日更作业写；还没跑过就不显示，别拿 0% 骗人 */}
                    {a.rate === null ? null : <span>{(a.rate * 100).toFixed(1)}% 的人拥有</span>}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </Reveal>
      </main>
    </>
  );
}
