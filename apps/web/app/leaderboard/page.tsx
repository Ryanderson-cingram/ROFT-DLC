import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import "./leaderboard.css";

export const metadata = { title: "榜单 · ROFT-DLC" };

/** `leaderboards()` 的一条榜（migration 0008）。整条榜没人上就**整格缺席**，不是空数组。 */
interface Board {
  total: number;
  rows: { userId: string; name: string; value: number; games: number; rank: number }[];
  mine: { rank: number; value: number } | null;
}

/**
 * 三条榜，排序键就是 `player_stats` 里的一格（spec §6：不做合成分数）。
 * 名次与门槛都在 SQL 里算完，这一页只管画。
 */
const BOARDS = [
  {
    key: "winRate",
    name: "胜率",
    hint: "满 50 局才上榜",
    fmt: (v: number) => `${(v * 100).toFixed(1)}%`,
    /** 胜率榜的第二行小字：分母有多大，胜率才有多可信。 */
    sub: (games: number) => `${games} 局`,
  },
  { key: "caught", name: "抓漏喊", hint: "抓到别人漏喊 UNO 的次数", fmt: (v: number) => `${v} 次` },
  { key: "streak", name: "最长连胜", hint: "生涯最长的一串", fmt: (v: number) => `${v} 连` },
] as const;

export default async function LeaderboardPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) redirect("/login");

  // 一次 RPC 拿三条榜 + 我在每条榜上的名次（PostgREST 按 jsonb 排序是按文本排的，见 0008）
  const { data } = await supabase.rpc("leaderboards");
  const boards = (data ?? {}) as Partial<Record<(typeof BOARDS)[number]["key"], Board>>;
  const me = auth.claims.sub;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <b>ROFT</b>
          <span>诸神降临 4.1</span>
        </div>
        <Link className="btn btn--ghost" href="/">← 大厅</Link>
      </header>

      <main className="lb">
        <section className="lb__head">
          <p className="eyebrow">榜单</p>
          <h1>谁在这一桌上面</h1>
          {/* 存量玩家没有历史数据（spec §7④），一上来三条榜多半都是空的——说清楚，
              免得看起来像坏了 */}
          <p className="hint">
            统计从每一局的终局那一刻沉淀下来，只算这套系统上线之后的对局。榜上每个数都能自己验算：
            排序键就是命盘里的那一格，没有天梯分。
          </p>
        </section>

        <div className="lb__grid">
          {BOARDS.map((b) => {
            const board = boards[b.key];
            const rows = board?.rows ?? [];
            return (
              <section key={b.key} className="lb__board panel">
                <div className="lb__top">
                  <h2>{b.name}</h2>
                  <span className="hint">{b.hint}</span>
                </div>

                {rows.length === 0 ?
                  <p className="hint lb__empty">还没有人上这条榜。</p>
                : <ol className="lb__rows">
                    {rows.map((r) => (
                      <li key={r.userId} className="lb__row" data-me={r.userId === me ? "" : undefined}>
                        <span className="lb__rk">{r.rank}</span>
                        <Link className="lb__nm" href={`/profile/${r.userId}`}>
                          {r.name}
                        </Link>
                        <span className="lb__v">
                          {b.fmt(r.value)}
                          {"sub" in b && <small>{b.sub(r.games)}</small>}
                        </span>
                      </li>
                    ))}
                  </ol>
                }

                {/* 「我排第几」：榜上前 100 之外的人，这一行是他们唯一看得到自己的地方 */}
                <p className="lb__me">
                  {board?.mine ?
                    <>
                      你第 <b>{board.mine.rank}</b> / {board.total}（{b.fmt(board.mine.value)}）
                    </>
                  : "你还没上这条榜。"}
                </p>
              </section>
            );
          })}
        </div>
      </main>
    </>
  );
}
