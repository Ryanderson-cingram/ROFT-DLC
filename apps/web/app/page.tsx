import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LobbyForms from "./lobby-forms";
import { SignOutButton } from "./sign-out";
import "./lobby.css";

export default async function LobbyPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", data.claims.sub)
    .maybeSingle();
  if (!profile) redirect("/login");

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <b>ROFT-DLC</b>
          <span>诸神降临 4.1</span>
        </div>
        <div className="me">
          <span className="dot" />
          {/* 名字就是进自己命盘的入口——顶栏已经满了，不再单开一个按钮 */}
          <Link className="me__name" href={`/profile/${data.claims.sub}`}>
            {profile.username}
          </Link>
          <SignOutButton />
        </div>
      </header>

      <main className="wrap">
        <section className="hero">
          <div className="cardfan" aria-hidden="true">
            <span className="card" data-color="green" data-face="7" />
            <span className="card" data-color="yellow" data-face="+2" />
            <span className="card" data-color="wild" data-face="+4" />
            <span className="card" data-color="red" data-face="停" />
            <span className="card" data-color="blue" data-face="3" />
          </div>
          <h1>今晚坐哪一桌？</h1>
          <p>3–4 人，一人一个技能，亮出来才生效。</p>
        </section>

        <LobbyForms />

        <Link className="more" href="/encyclopedia">
          <span>
            玩家百科
            <small className="opt-note" style={{ margin: 0 }}>
              四句总则、20 个技能的细则与例子。
            </small>
          </span>
          <span className="arrow">→</span>
        </Link>

        <Link className="more" href="/leaderboard">
          <span>
            榜单
            <small className="opt-note" style={{ margin: 0 }}>
              胜率、抓漏喊、最长连胜三条榜，外加你自己第几。
            </small>
          </span>
          <span className="arrow">→</span>
        </Link>
      </main>
    </>
  );
}
