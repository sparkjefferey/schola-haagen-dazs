import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getThread } from "@/lib/queries";
import { getSessionUser } from "@/lib/auth";
import { replyAction, deleteThreadAction, deleteReplyAction } from "@/lib/actions";
import ReportButton from "@/components/report-button";
import { Avatar } from "@/components/avatar";
import { renderMarkdown } from "@/lib/md";
import { formatDate, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "论题" };

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  const { id } = await params;
  const threadId = Number(id);
  if (!Number.isInteger(threadId)) notFound();
  const thread = getThread(threadId);
  if (!thread) notFound();
  const user = await getSessionUser();
  const { e } = await searchParams;
  const replyError =
    e === "short" ? "回复至少 2 字。" : e === "rate" ? "发言过频，稍候再续。" : null;

  const canDelete = (authorId: number) => !!user && (user.role === "admin" || user.id === authorId);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <p className="meta" style={{ marginBottom: 4 }}>
        <Link href="/forum" style={{ color: "var(--ink-soft)" }}>← 返论坛</Link>
        {" · "}<span className="badge badge-dim">{thread.category}</span>
      </p>
      <h1 style={{ margin: "4px 0 18px" }}>{thread.title}</h1>

      {/* 主帖 */}
      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16 }}>
          <Avatar name={thread.author.display_name} id={thread.author.id} size={46} />
          <div>
            <Link href={`/users/${thread.author.username}`} style={{ fontWeight: 700, fontSize: 17 }}>
              {thread.author.display_name}
            </Link>
            {thread.author.role === "admin" && <span className="badge badge-admin" style={{ marginLeft: 8 }}>管理者</span>}
            {thread.author.endorsed === 1 && <span className="badge" style={{ marginLeft: 8 }}>认证学者</span>}
            <div className="meta">{formatDate(thread.created_at)} · 主帖</div>
          </div>
          {canDelete(thread.author_id) && (
            <form action={deleteThreadAction.bind(null, thread.id, thread.author_id)} style={{ marginLeft: "auto" }}>
              <button className="btn btn-danger" type="submit">焚帖</button>
            </form>
          )}
          {user?.role === "admin" && canDelete(thread.author_id) === false && (
            <span style={{ marginLeft: "auto" }}>
              <ReportButton kind="thread" targetId={thread.id} />
            </span>
          )}
        </div>
        <div className="prose" style={{ maxWidth: "none" }}>{renderMarkdown(thread.content)}</div>
      </div>

      {/* 回复 */}
      <h2 style={{ fontSize: 22, margin: "34px 0 14px", color: "var(--maroon-deep)" }} className="display">
        诸 贤 之 辩
      </h2>
      {thread.replies.length === 0 && <p className="empty-note" style={{ padding: 20 }}>尚无人辩难，静待高论。</p>}
      {thread.replies.map((r) => (
        <div className="card" key={r.id} style={{ marginBottom: 16, padding: 18 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
            <Avatar name={r.author.display_name} id={r.author.id} size={36} />
            <div>
              <Link href={`/users/${r.author.username}`} style={{ fontWeight: 700 }}>
                {r.author.display_name}
              </Link>
              {r.author.role === "admin" && <span className="badge badge-admin" style={{ marginLeft: 6 }}>管理者</span>}
              {r.author.endorsed === 1 && <span className="badge" style={{ marginLeft: 6 }}>认证学者</span>}
              <span className="meta" style={{ marginLeft: 10 }}>{timeAgo(r.created_at)}</span>
            </div>
            {canDelete(r.author_id) && (
              <form action={deleteReplyAction.bind(null, r.id, r.author_id)} style={{ marginLeft: "auto" }}>
                <button className="btn btn-danger" type="submit">删</button>
              </form>
            )}
            {!canDelete(r.author_id) && (
              <span style={{ marginLeft: "auto" }}>
                <ReportButton kind="reply" targetId={r.id} />
              </span>
            )}
          </div>
          <div className="prose" style={{ maxWidth: "none", fontSize: 16 }}>{renderMarkdown(r.content)}</div>
        </div>
      ))}

      {/* 回复表单 */}
      {replyError && (
        <p className="notice" style={{ color: "var(--maroon-deep)", marginTop: 28 }}>✗ {replyError}</p>
      )}
      {user && user.status === "active" ? (
        <form action={replyAction} className="card" style={{ marginTop: 28 }}>
          <input type="hidden" name="thread_id" value={thread.id} />
          <div className="field" style={{ marginBottom: 10 }}>
            <label htmlFor="r-body">以 {user.display_name} 之名发言</label>
            <textarea id="r-body" name="content" required style={{ minHeight: 90 }} placeholder="写下你的辩辞或附和……" />
          </div>
          <button className="btn" type="submit">应 帖</button>
        </form>
      ) : (
        <p className="notice" style={{ marginTop: 28 }}>
          欲加入辩论，请先<Link href="/login">登学</Link>，或<Link href="/register">注册入派</Link>。
        </p>
      )}
    </div>
  );
}