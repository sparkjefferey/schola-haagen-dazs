import { Metadata } from "next";
import Link from "next/link";
import { Medallion } from "@/components/emblem";
import { IonicColumn, Scroll, LaurelWreath, Lyre } from "@/components/decor";
import { Avatar } from "@/components/avatar";
import { listPapers, listThreads, getRanking } from "@/lib/queries";
import { formatShort, timeAgo, schoolYear } from "@/lib/format";

export const metadata: Metadata = { title: "首府之户" };

export default async function HomePage() {
  const [papers, threads, ranking] = await Promise.all([
    listPapers(),
    listThreads(),
    getRanking(8),
  ]);
  const year = schoolYear();

  return (
    <div>
      {/* ======= 英雄区 ======= */}
      <section className="hero">
        <Medallion size={110} />
        <div className="hero-heading" style={{ marginTop: 6 }}>
          <small>MMXXIV · 建学</small>
          <h1 className="big-title">SCHOLA HÄAGEN-DAZS</h1>
        </div>
        <p className="motto">“In Lacte, Veritas.”</p>
        <p className="motto-trans">真 理 存 于 乳 膏 之 中</p>
        <p className="quote">
          Häagen-Dazs（沙氏）学派，由两位好友于初夏之夜立学。此馆为学派同侪论学、
          刊文、互证的栖身之所——以冰淇淋之甘甜，喻求知之欢愉；以学霸之严谨，
          立学人之风骨。凡入学派者，皆为同僚学者；凡发一论者，皆为学派之荣光。
        </p>
        <div style={{ marginTop: 26, display: "flex", gap: 14, justifyContent: "center" }}>
          <Link className="btn btn-gold" href="/register">入学入派</Link>
          <Link className="btn" href="/about">观学派志</Link>
        </div>
        <div className="pillar-row" aria-hidden>
          <IonicColumn height={72} />
          <IonicColumn height={56} flopped />
          <Scroll size={44} />
          <IonicColumn height={56} />
          <IonicColumn height={72} />
        </div>
      </section>

      {/* ======= 学派三义 ======= */}
      <section className="section">
        <h2 className="section-title">学 派 三 义</h2>
        <div className="grid3">
          <div className="card" style={{ textAlign: "center" }}>
            <LaurelWreath size={56} color="var(--maroon)" />
            <h3>求真 · Veritas</h3>
            <p style={{ color: "var(--ink-soft)" }}>
              学术是一生的承诺。凡发表于此之文，须经自家验证与诚实论证；学派以
              「无引不立论，无思不落笔」为训。
            </p>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <Scroll size={56} color="var(--maroon)" />
            <h3>著书 · Scripta</h3>
            <p style={{ color: "var(--ink-soft)" }}>
              论文库兼收长文短论、手记心得。学行以篇章计：每一篇正式论著都记入
              作者学录，为学派立言存证。
            </p>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <Lyre size={56} color="var(--maroon)" />
            <h3>共娱 · Convivium</h3>
            <p style={{ color: "var(--ink-soft)" }}>
              学术论坛之外，还设闲话长廊、冷食哲学等栏，可谈学理、可谈冰物——
              学派也从不是苦修的寺院，而是甘美的学园。
            </p>
          </div>
        </div>
      </section>

      {/* ======= 三列最新 ======= */}
      <section className="section">
        <h2 className="section-title">庭 院 即 报</h2>
        <div className="grid3">
          <div className="card">
            <h3>新刊论著</h3>
            {papers.slice(0, 3).map((p) => (
              <div className="item" key={p.id} style={{ padding: "10px 0" }}>
                <div>
                  <Link className="title" href={`/papers/${p.id}`} style={{ fontSize: 16 }}>
                    {p.title}
                  </Link>
                  <div className="meta">
                    {p.author.display_name} · {formatShort(p.created_at)} · 阅 {p.views}
                  </div>
                </div>
              </div>
            ))}
            {papers.length === 0 && <p className="empty-note">论文库尚待首作。</p>}
            <Link className="btn btn-sm" href="/papers" style={{ marginTop: 10 }}>
              入论文库 →
            </Link>
          </div>

          <div className="card">
            <h3>论坛新话</h3>
            {threads.slice(0, 3).map((t) => (
              <div className="item" key={t.id} style={{ padding: "10px 0" }}>
                <div>
                  <Link className="title" href={`/forum/thread/${t.id}`} style={{ fontSize: 16 }}>
                    {t.title}
                  </Link>
                  <div className="meta">
                    {t.category} · {t.author.display_name} · {timeAgo(t.created_at)}
                  </div>
                </div>
              </div>
            ))}
            {threads.length === 0 && <p className="empty-note">尚无论题开栏。</p>}
            <Link className="btn btn-sm" href="/forum" style={{ marginTop: 10 }}>
              入学术论坛 →
            </Link>
          </div>

          <div className="card">
            <h3>学榜首五席</h3>
            {ranking.slice(0, 5).map((s, i) => (
              <div className="item" key={s.id} style={{ padding: "8px 0", alignItems: "center" }}>
                <span className={`rank-medal r${i + 1}`}>{(i + 1).toString().padStart(2, "0")}</span>
                <Avatar name={s.display_name} id={s.id} size={34} />
                <div style={{ minWidth: 0 }}>
                  <Link href={`/users/${s.username}`} className="title" style={{ fontSize: 15, fontWeight: 600 }}>
                    {s.display_name}
                  </Link>
                  <div className="meta">稿 {s.paper_count} · 阅 {s.total_views}</div>
                </div>
              </div>
            ))}
            {ranking.length === 0 && <p className="empty-note">学榜待首次论著开启。</p>}
            <Link className="btn btn-sm" href="/ranking" style={{ marginTop: 10 }}>
              阅全榜 →
            </Link>
          </div>
        </div>
      </section>

      {/* ======= 学术公约 ======= */}
      <section className="section" style={{ textAlign: "center" }}>
        <div className="ornament-divider">◇</div>
        <h2 className="big-title" style={{ fontSize: 28 }}>学派之约</h2>
        <p className="lead" style={{ maxWidth: 720, margin: "0 auto" }}>
          予当治学，如治甜点：选料纯正，火候不欺；且尝且议，好友共席。
          Schola Häagen-Dazs 建学第 {year} 年，门墙常开，欢迎新学士入驻。
        </p>
        <div style={{ marginTop: 22 }}>
          <Link className="btn btn-gold" href="/register">注 册 入 学</Link>
          <Link className="btn" href="/about" style={{ marginLeft: 12 }}>学派章程</Link>
        </div>
      </section>
    </div>
  );
}