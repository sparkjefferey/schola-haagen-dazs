import { Metadata } from "next";
import Link from "next/link";
import { DISCIPLINES } from "@/lib/db";
import { listPapers } from "@/lib/queries";
import { getSessionUser } from "@/lib/auth";
import { Avatar } from "@/components/avatar";
import { formatDate } from "@/lib/format";
import { Scroll } from "@/components/decor";

export const metadata: Metadata = { title: "论文库" };

export default async function PapersPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; q?: string }>;
}) {
  const { d, q } = await searchParams;
  const active = DISCIPLINES.includes((d ?? "") as any) ? d! : undefined;
  const query = (q ?? "").trim() || undefined;
  const user = await getSessionUser();
  const papers = listPapers({ discipline: active, q: query });

  return (
    <div>
      <section className="hero" style={{ padding: "24px 0 6px" }}>
        <Scroll size={52} color="var(--maroon)" />
        <h1 className="big-title" style={{ marginTop: 4 }}>论 文 库</h1>
        <p className="quote" style={{ margin: "0 auto" }}>
          学派之家的立言之所——凡所深思，皆有卷可依。
        </p>
        {user && user.status === "active" && (
          <div style={{ marginTop: 16 }}>
            <Link className="btn btn-gold" href="/papers/new">＋ 著 书 立 说</Link>
          </div>
        )}
      </section>

      <form method="get" action="/papers" style={{ maxWidth: 640, margin: "0 auto 26px" }}>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            name="q"
            defaultValue={query ?? ""}
            placeholder="按题名、提要、正文检索……"
            style={{
              flex: 1,
              padding: "10px 14px",
              fontFamily: "var(--serif)",
              fontSize: 16,
              background: "var(--parch-0)",
              border: "1px solid var(--line)",
              borderRadius: 3,
              color: "var(--ink)",
            }}
          />
          <button className="btn" type="submit">检 索</button>
        </div>
      </form>

      <div className="chips">
        <Link className={`chip ${!active ? "on" : ""}`} href="/papers">全 部</Link>
        {DISCIPLINES.map((c) => (
          <Link key={c} className={`chip ${active === c ? "on" : ""}`} href={`/papers?d=${encodeURIComponent(c)}`}>
            {c}
          </Link>
        ))}
      </div>

      <div className="card" style={{ padding: "6px 20px 10px" }}>
        {papers.length === 0 && (
          <p className="empty-note">
            {query ? <>未检索到相关篇章，请更易词句。</> : <>论文库尚待首作，等你的第一篇宏文。</>}
          </p>
        )}
        {papers.map((p) => (
          <div className="item" key={p.id}>
            <Avatar name={p.author.display_name} id={p.author.id} size={42} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link className="title" href={`/papers/${p.id}`}>{p.title}</Link>
              <div className="meta">
                <span className="badge badge-dim">{p.discipline}</span>{" "}
                <Link href={`/users/${p.author.username}`} style={{ color: "inherit" }}>
                  {p.author.display_name}
                </Link>
                {p.author.endorsed === 1 && <span className="badge" style={{ marginLeft: 5 }}>认证</span>}
                {" · "}{formatDate(p.created_at)} · 阅 {p.views}
              </div>
              {p.abstract && <p className="excerpt">{p.abstract}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}