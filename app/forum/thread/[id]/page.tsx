import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getThread } from "@/lib/queries";
import { getSessionUser } from "@/lib/auth";
import { replyAction, deleteThreadAction, deleteReplyAction, retryAiCallAction } from "@/lib/actions";
import ReportButton from "@/components/report-button";
import { Avatar } from "@/components/avatar";
import AiRunner from "@/components/ai-runner";
import { renderMarkdown } from "@/lib/md";
import { AI_NAME, aiConfigured, aiPerUserLimit, aiRemainingFor } from "@/lib/ai";
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
    e === "short"
      ? "回复至少 2 字。"
      : e === "rate"
        ? "发言过频，稍候再续。"
        : e === "ai_rate"
          ? `请${AI_NAME}的次数已用尽（每人每 24 小时 ${aiPerUserLimit()} 次），稍后再来。`
          : e === "ai_global"
            ? `全站请${AI_NAME}的次数已用尽，稍后再来。`
            : e === "ai_ask"
              ? `只写了 @${AI_NAME}：请写明要他做什么，或引一篇论著（如「@${AI_NAME} 点评 SCHOLA-2026-0004」）。`
              : e === "ai_nopaper" || e === "ai_noperm"
                ? // 稿号不存在与「未刊之稿不外送」回同一句话：分开说，@学正 就成了一个
                  // 比 /papers/<id> 更省事的「这篇存不存在 / 是否未刊」探测器。
                  "所引之稿不可评议（未刊之稿不外送，或稿号有误）。"
                : null;

  const canDelete = (authorId: number) => !!user && (user.role === "admin" || user.id === authorId);
  const canSummon = aiConfigured && !!user && user.status === "active";
  const remaining = user ? aiRemainingFor(user) : null;

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
            <form action={deleteThreadAction.bind(null, thread.id)} style={{ marginLeft: "auto" }}>
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
      {thread.replies.length === 0 && thread.aiCalls.length === 0 && (
        <p className="empty-note" style={{ padding: 20 }}>尚无人辩难，静待高论。</p>
      )}
      {thread.replies.map((r) =>
        r.kind === "ai" ? (
          // 学正的点评：说话人是 AI，落款注明是谁请的 —— 谁请的谁负责，也由他（或管理者）删除。
          // author_id 存的是请出者，故这里仍链到真人名册页，不是虚构的账号。
          <div className="card reply-card ai-reply" key={r.id} id={`r${r.id}`} style={{ marginBottom: 16, padding: 18 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
              <span className="ai-avatar" aria-hidden>正</span>
              <div>
                <span style={{ fontWeight: 700 }}>{AI_NAME}</span>
                <span className="badge badge-ai" style={{ marginLeft: 6 }}>AI 生成</span>
                <span className="meta" style={{ marginLeft: 10 }}>{timeAgo(r.created_at)}</span>
              </div>
              {canDelete(r.author_id) && (
                <form action={deleteReplyAction.bind(null, r.id)} style={{ marginLeft: "auto" }}>
                  <button className="btn btn-danger" type="submit">删</button>
                </form>
              )}
            </div>
            <div className="prose" style={{ maxWidth: "none", fontSize: 16 }}>{renderMarkdown(r.content)}</div>
            <p className="meta" style={{ marginTop: 10, fontSize: 12 }}>
              AI 生成，或有讹误，请自行核对 · 由{" "}
              <Link href={`/users/${r.author.username}`}>{r.author.display_name}</Link> 请出
            </p>
          </div>
        ) : (
          <div
            className="card reply-card"
            key={r.id}
            id={`r${r.id}`}
            style={{ marginBottom: 16, padding: 18 }}
          >
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
                <form action={deleteReplyAction.bind(null, r.id)} style={{ marginLeft: "auto" }}>
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
        ),
      )}

      {/* 已召唤、尚未落地的点评：正在思索（挂执行件去领）或失败（可再请一次）。
          一小时后自隐（见 getThread 的口径），不把帖子堆满陈年旧账。 */}
      {thread.aiCalls.map((c) => (
        <div className="card reply-card ai-reply" key={`aicall${c.id}`} style={{ marginBottom: 16, padding: 18 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
            <span className="ai-avatar" aria-hidden>正</span>
            <div>
              <span style={{ fontWeight: 700 }}>{AI_NAME}</span>
              <span className="badge badge-ai" style={{ marginLeft: 6 }}>AI 生成</span>
              <span className="meta" style={{ marginLeft: 10 }}>应 {c.requester_name} 之请</span>
            </div>
          </div>
          {c.status === "pending" || c.status === "running" ? (
            <p className="meta ai-thinking">学正 正在思索……约需半分钟，不必守着，稍后回来自见。</p>
          ) : (
            <>
              <p className="meta" style={{ marginBottom: c.status === "failed" ? 10 : 0 }}>
                {c.error || (c.status === "refused" ? "所引之稿不可评议。" : "学正未能应答。")}
                {c.status === "failed" && "（这一次不计入你的次数）"}
              </p>
              {/* 只有 failed 给重试：refused 是口径所限（未刊稿不外送之类），点一百次也一样 */}
              {c.status === "failed" && user && (user.role === "admin" || user.id === c.requester_id) && (
                <form action={retryAiCallAction.bind(null, c.id)}>
                  <button className="btn btn-sm" type="submit">再 请 一 次</button>
                </form>
              )}
            </>
          )}
          {/* 执行件只挂给「还在跑」的、且只给登录者：失败态挂了会刷新成环；
              未登录访客发了也是白跑一趟，徒然在控制台报红。 */}
          {(c.status === "pending" || c.status === "running") && canSummon && <AiRunner callId={c.id} />}
        </div>
      ))}

      {/* 回复表单 */}
      {replyError && (
        <p className="notice" style={{ color: "var(--maroon-deep)", marginTop: 28 }}>✗ {replyError}</p>
      )}
      {user && user.status === "active" ? (
        <>
          <form action={replyAction} className="card" style={{ marginTop: 28 }}>
            <input type="hidden" name="thread_id" value={thread.id} />
            <div className="field" style={{ marginBottom: 10 }}>
              <label htmlFor="r-body">以 {user.display_name} 之名发言</label>
              <textarea id="r-body" name="content" required style={{ minHeight: 90 }} placeholder="写下你的辩辞或附和……" />
            </div>
            <button className="btn" type="submit">应 帖</button>
          </form>
          {canSummon && (
            <p className="meta ai-hint" style={{ marginTop: 10, fontSize: 12.5 }}>
              在回复里写 <b>@{AI_NAME}</b> 即可请 AI 点评所引论著、或就本帖讲解（如「@{AI_NAME} 点评
              SCHOLA-2026-0004」）；同一帖再召唤一次便是追问。召唤时本帖内容与所引论著的正文会发给模型服务。
              {remaining === null
                ? ""
                : remaining > 0
                  ? `24 小时内还可请 ${remaining} 次。`
                  : `次数已用尽（每人每 24 小时 ${aiPerUserLimit()} 次），稍后再来。`}
            </p>
          )}
        </>
      ) : (
        <p className="notice" style={{ marginTop: 28 }}>
          欲加入辩论，请先<Link href="/login">登学</Link>，或<Link href="/register">注册入派</Link>。
        </p>
      )}
    </div>
  );
}
