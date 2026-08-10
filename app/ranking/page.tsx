import { Metadata } from "next";
import Link from "next/link";
import { getRanking } from "@/lib/queries";
import { Avatar } from "@/components/avatar";
import { schoolYear, formatDate } from "@/lib/format";
import { LaurelWreath } from "@/components/decor";

export const metadata: Metadata = { title: "作者学榜" };

export default async function RankingPage() {
  const ranking = getRanking(100);
  const year = schoolYear();

  const medal = (i: number) => {
    if (i === 0) return <span className="rank-medal r1">Ⅰ</span>;
    if (i === 1) return <span className="rank-medal r2">Ⅱ</span>;
    if (i === 2) return <span className="rank-medal r3">Ⅲ</span>;
    return <span className="rank-medal">{String(i + 1).padStart(2, "0")}</span>;
  };

  return (
    <div>
      <section className="hero" style={{ padding: "24px 0 6px" }}>
        <LaurelWreath size={52} color="var(--maroon)" />
        <h1 className="big-title" style={{ marginTop: 4 }}>作 者 学 榜</h1>
        <p className="quote" style={{ margin: "0 auto" }}>
          抱负录于榜中：每文一功（+20），每读一进。第 {year} 学年，观诸公劳续如何。
        </p>
      </section>

      <table className="rank-table">
        <thead>
          <tr>
            <th>位次</th>
            <th>学者</th>
            <th>入馆</th>
            <th>论著数</th>
            <th>总阅量</th>
            <th>学绩分</th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((s, i) => (
            <tr key={s.id}>
              <td>{medal(i)}</td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Avatar name={s.display_name} id={s.id} size={40} />
                  <div>
                    <Link href={`/users/${s.username}`} style={{ fontWeight: 700, color: "var(--ink)" }}>
                      {s.display_name}
                    </Link>
                    {s.role === "admin" && (
                      <span className="badge badge-admin" style={{ marginLeft: 8 }}>管理者</span>
                    )}
                    {s.motto && (
                      <div className="meta" style={{ fontSize: 13 }}>「{s.motto}」</div>
                    )}
                  </div>
                </div>
              </td>
              <td style={{ color: "var(--ink-soft)", fontSize: 14 }}>{formatDate(s.created_at)}</td>
              <td>{s.paper_count}</td>
              <td>{s.total_views}</td>
              <td>
                <b style={{ color: "var(--maroon-deep)", fontFamily: "var(--display)" }}>{s.score}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {ranking.length === 0 && <p className="empty-note">学榜虚位，以待首篇宏文开启。</p>}

      <div className="ornament-divider">≋</div>
      <p className="meta" style={{ textAlign: "center" }}>
        学绩分 = 论著数 × 20 + 总阅读量。排行榜每日更新，所记唯学。
      </p>
    </div>
  );
}