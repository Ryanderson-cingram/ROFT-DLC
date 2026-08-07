import Link from "next/link";
import { CREED, CREED_FOOTNOTE, SUITS, allSkills } from "@/lib/skills";
import { Emphasis } from "@/components/emphasis";
import "./encyclopedia.css";

// 纯静态：没有 "use client"，展开靠原生 <details>，所以这条路由零客户端 JS。
export const metadata = { title: "玩家百科 · ROFT-DLC" };

export default function EncyclopediaPage() {
  return (
    <>
      <header className="topbar">
        <Link href="/">← 大厅</Link>
        <b>玩家百科</b>
        <span className="hint">v4.1</span>
      </header>

      <main className="wrap stack">
        <div className="head">
          <p className="eyebrow">由规则知识库生成</p>
          <h1>怎么玩，技能怎么算</h1>
          <p>这里的每一条都跟桌上生效的规则同源。规则改了，这页也会跟着改。</p>
        </div>

        <section className="panel creed">
          <p className="eyebrow">四句总则</p>
          <ol>
            {CREED.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <p className="footnote">
            {CREED_FOOTNOTE.text}
            <span className="dim">{CREED_FOOTNOTE.aside}</span>
          </p>
        </section>

        <nav className="anchors" aria-label="按花色跳转">
          {SUITS.map((s) => (
            <a href={`#${s.id}`} key={s.id}>
              <span className="sigil">{s.sigil}</span>
              {s.name}
            </a>
          ))}
        </nav>

        {SUITS.map((suit) => {
          const skills = allSkills().filter((s) => s.suit === suit.id);
          return (
            <section className="suit" id={suit.id} key={suit.id}>
              <h2>
                <span className="sigil">{suit.sigil}</span>
                {suit.name}
                <span className="count">{skills.length} 个</span>
              </h2>
              <hr className="rail" />
              <div className="skills">
                {skills.map((s) => (
                  <article className="skill" key={s.id}>
                    <div className="name">
                      <span className="sigil">{s.sigil}</span>
                      <h3>{s.name}</h3>
                      <span className="kind">{s.kind}</span>
                    </div>
                    <p className="l0"><Emphasis text={s.l0} /></p>
                    <details>
                      <summary>细则</summary>
                      <p><Emphasis text={s.l1} /></p>
                    </details>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}
