import { Metadata } from "next";
import Link from "next/link";
import { FORUM_CATEGORIES } from "@/lib/db";
import { listThreads } from "@/lib/queries";
import { getSessionUser } from "@/lib/auth";
import { createThreadAction } from "@/lib/actions";
import { Avatar } from "@/components/avatar";
import { timeAgo } from "@/lib/format";
import { renderMarkdown } from "@/lib/md";
import { Scroll } from "@/components/decor";

export const metadata: Metadata = { title: "学术论坛" };

export default async function ForumPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; e?: string }>;
}) {
  const { cat, e } = await searchParams;
  const active = FORUM_CATEGORIES.includes((cat ?? "") as any) ? cat! : undefined;
  const user = await getSessionUser();
  const threads = listThreads({ category: active });

  const forumError =
    e === "title" ? "论题标题须在 4–80 字之间。" :
    e === "body" ? "正文至少 10 字。" :
    e === "rate" ? "一小时之内已立十题，且歇且论。" : null;

  return (
    <div>
      <section className="hero" style={{ padding: "24px 0 6px" }}>
        <Scroll size={52} color="var(--maroon)" />
        <h1 className="big-title" style={{ marginTop: 4 }}>学 术 论 坛</h1>
        <p className="quote" style={{ margin: "0 auto" }}>
          以言立学，以辨明理——诸子百家，尽可在门下争鸣。
        </p>
      </section>

      {forumError && (
        <p className="notice" style={{ color: "var(--maroon-deep)", maxWidth: 780, margin: "0 auto 14px" }}>
          ✗ {forumError}
        </p>
      )}

      {user && user.status === "active" && (
        <section className="section" style={{ marginBottom: 34 }}>
          <div style={{ maxWidth: 780, margin: "0 auto" }}>
            <h2 className="section-title" style={{ fontSize: 20 }}>开 新 论 题</h2>
            <form action={createThreadAction} className="card" style={{ padding: 20 }}>
              <div className="row-inputs">
                <div className="field">
                  <label htmlFor="f-title">论题</label>
                  <input id="f-title" name="title" required maxLength={80} placeholder="以一言立题（4–80 字）" />
                </div>
                <div className="field">
                  <label htmlFor="f-cat">门类</label>
                  <select id="f-cat" name="category" defaultValue="学术交流">
                    {FORUM_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="f-body">正文</label>
                <textarea
                  id="f-body"
                  name="content"
                  required
                  style={{ minHeight: 100 }}
                  placeholder="陈述你的主张、问题或待议之稿。支持 ## 小标题与 > 引语。"
                />
              </div>
              <button className="btn btn-gold" type="submit">悬 帖 立 论</button>
            </form>
          </div>
        </section>
      )}

      <div className="chips">
        <Link className={`chip ${!active ? "on" : ""}`} href="/forum">全文</Link>
        {FORUM_CATEGORIES.map((c) => (
          <Link key={c} className={`chip ${active === c ? "on" : ""}`} href={`/forum?cat=${encodeURIComponent(c)}`}>
            {c}
          </Link>
        ))}
      </div>

      <div className="card" style={{ padding: "6px 20px 10px" }}>
        {threads.length === 0 && <p className="empty-note">此栏尚无墨迹，恭候第一帖。</p>}
        {threads.map((t) => (
          <div className="item" key={t.id}>
            <Avatar name={t.author.display_name} id={t.author.id} size={42} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link className="title" href={`/forum/thread/${t.id}`}>
                {t.title}
              </Link>
              <div className="meta">
                <span className="badge badge-dim">{t.category}</span>{" "}
                <Link href={`/users/${t.author.username}`} style={{ color: "inherit" }}>
                  {t.author.display_name}
                </Link>
                {t.author.endorsed === 1 && <span className="badge" style={{ marginLeft: 5 }}>认证</span>}
                {" · "}{timeAgo(t.created_at)} · {t.reply_count} 复
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}