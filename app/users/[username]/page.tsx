import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { userMapper } from "@/lib/db";
import { listPapersByAuthor, listThreads } from "@/lib/queries";
import { getSessionUser } from "@/lib/auth";
import { discardPaperAction, resubmitPaperAction, submitRevisionAction, claimAdminAction, changePasswordAction, requestCertificationAction, respondCertificationAction } from "@/lib/actions";
import { getCertRelation } from "@/lib/certification";
import { Avatar } from "@/components/avatar";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, timeAgo } from "@/lib/format";
import { IonicColumn } from "@/components/decor";

export const metadata: Metadata = { title: "学者名册" };

// 动态路由参数在个别部署/代理场景下会以「百分号编码」形式到达（例如用户名含中文时
// 变成 %E4%B8%80...），直接拿去查库会查不到 → 触发 notFound() 显示 404。
// 这里做一次安全的百分号解码：无百分号直接返回；含百分号再解码；解码失败（如用户名
// 本身含字面量 % 且非合法转义）则回退原始值，避免误伤 ASCII / 含 % 的用户名。
function safeDecodeSegment(input: string): string {
  if (input.indexOf("%") === -1) return input;
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ e?: string; ok?: string }>;
}) {
  const { username: rawUsername } = await params;
  const username = safeDecodeSegment(rawUsername);
  const sp = await searchParams;
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
  if (!row) notFound();
  const user = userMapper(row);
  const me = await getSessionUser();
  const isSelf = !!me && me.id === user.id;

  const papers = listPapersByAuthor(user.id, { includePending: true });
  const threads = listThreads().filter((t) => t.author_id === user.id);
  const published = papers.filter((p) => p.status === "published");
  const totalViews = published.reduce((s, p) => s + p.views, 0);
  const score = published.length * 20 + totalViews;

  // 同侪互证关系（仅双方均活跃且非管理者时展示）
  const certRel =
    !isSelf && me?.status === "active" && user.status === "active" && me.role !== "admin" && user.role !== "admin"
      ? getCertRelation(me.id, user.id)
      : null;

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <div className="card" style={{ padding: 30, textAlign: "center", marginBottom: 30 }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, color: "var(--gold-deep)" }}>
          <IonicColumn height={60} />
          <IonicColumn height={60} />
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
          <Avatar name={user.display_name} id={user.id} size={84} />
        </div>
        <h1 style={{ margin: "14px 0 4px" }}>{user.display_name}</h1>
        <div>
          <span className="badge">@{user.username}</span>{" "}
          {user.role === "admin" ? (
            <span className="badge badge-admin">学派管理者</span>
          ) : (
            <span className="badge">学者</span>
          )}
          {user.root === 1 && <span className="badge badge-admin">创始掌门</span>}
          {user.endorsed === 1 && <span className="badge">认证学者</span>}
          {user.status !== "active" && (
            <span className={user.status === "banned" ? "badge badge-danger" : "badge badge-dim"}>
              {user.status === "banned" ? "学籍已封" : "已辞别门派"}
            </span>
          )}
        </div>
        {user.motto && <p style={{ fontStyle: "italic", color: "var(--ink-soft)" }}>「{user.motto}」</p>}
        <p className="meta">
          入馆于 {formatDate(user.created_at)} · 刊文 {published.length} 篇 · 总阅 {totalViews} · 学绩 {score}
        </p>
        {isSelf && user.status === "active" && (
          <>
          <p className="meta">
            <Link href="/papers/new" className="btn btn-sm btn-gold">著新文</Link>
            {" "}<Link href="/forum" className="btn btn-sm">起论题</Link>
          </p>
          <details style={{ marginTop: 18, textAlign: "left", maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
            <summary style={{ cursor: "pointer", textAlign: "center", color: "var(--maroon)", fontFamily: "var(--display)", letterSpacing: "0.06em" }}>
              修改口令
            </summary>
            <form action={changePasswordAction} style={{ marginTop: 12 }}>
              <div className="field" style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 13 }}>当前口令</label>
                <input
                  name="current"
                  type="password"
                  autoComplete="current-password"
                  style={{ fontFamily: "var(--serif)", color: "var(--ink)", background: "var(--parch-0)", border: "1px solid var(--line)", borderRadius: 3, padding: "8px 12px", width: "100%" }}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 13 }}>新口令（至少 6 位）</label>
                <input
                  name="next"
                  type="password"
                  autoComplete="new-password"
                  style={{ fontFamily: "var(--serif)", color: "var(--ink)", background: "var(--parch-0)", border: "1px solid var(--line)", borderRadius: 3, padding: "8px 12px", width: "100%" }}
                />
              </div>
              <button type="submit" className="btn btn-sm btn-gold" style={{ width: "100%" }}>更 新 口 令</button>
              <p className="meta" style={{ marginTop: 8, fontSize: 12, textAlign: "center" }}>
                改密后将注销你其他设备的登录，以防账号被盗用。
                {sp?.e === "pwd" && <span style={{ color: "var(--maroon)" }}> · 当前口令错误</span>}
                {sp?.e === "pwdlen" && <span style={{ color: "var(--maroon)" }}> · 新口令至少 6 位</span>}
                {sp?.e === "pwdsame" && <span style={{ color: "var(--maroon)" }}> · 新口令不能与旧口令相同</span>}
                {sp?.ok === "pwd" && <span style={{ color: "var(--gold-deep)" }}> · 口令已更新</span>}
              </p>
            </form>
          </details>
          </>
        )}
        {isSelf && user.status === "active" && user.role !== "admin" && (
          <form action={claimAdminAction} style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <input
                name="invite"
                placeholder="管理者邀请函 R-XXXX"
                autoComplete="off"
                style={{
                  fontFamily: "var(--display)",
                  letterSpacing: "0.08em",
                  padding: "8px 12px",
                  width: 220,
                  color: "var(--ink)",
                  background: "var(--parch-0)",
                  border: "1px solid var(--line)",
                  borderRadius: 3,
                }}
              />
              <button type="submit" className="btn btn-sm btn-gold">凭函就任管理者</button>
            </div>
            <p className="meta" style={{ marginTop: 8, fontSize: 13 }}>
              持掌门签发的 <span className="badge">R-xxxx</span> 邀请函，可于此宣誓就任学派管理者。
              {sp?.e === "invite" && (
                <span style={{ color: "var(--maroon)" }}> · 邀请函无效或已用尽</span>
              )}
              {sp?.ok === "就任" && (
                <span style={{ color: "var(--gold-deep)" }}> · 已就任管理者</span>
              )}
            </p>
          </form>
        )}
        {!isSelf && me && me.status === "active" && user.status === "active" && (
          <p className="meta" style={{ marginTop: 14 }}>
            <Link href={`/messages?with=${user.id}`} className="btn btn-sm btn-gold">
              私 信
            </Link>
          </p>
        )}

        {certRel && (
          <p className="meta" style={{ marginTop: 12 }}>
            {certRel === "none" && (
              <form action={requestCertificationAction.bind(null, user.id)} style={{ display: "inline" }}>
                <button className="btn btn-sm" type="submit">请 求 同 侪 互 证</button>
              </form>
            )}
            {certRel === "pending_sent" && (
              <span className="badge badge-dim">已请求互证，待对方应允</span>
            )}
            {certRel === "pending_received" && (
              <>
                <span className="badge" style={{ marginRight: 8 }}>对方请求与你互证</span>
                <form action={respondCertificationAction.bind(null, user.id, true)} style={{ display: "inline" }}>
                  <button className="btn btn-sm btn-gold" type="submit">应 允</button>
                </form>{" "}
                <form action={respondCertificationAction.bind(null, user.id, false)} style={{ display: "inline" }}>
                  <button className="btn btn-sm" type="submit">婉 拒</button>
                </form>
              </>
            )}
            {certRel === "certified" && <span className="badge">同侪互证 · 可无限私信</span>}
            {certRel === "declined" && (
              <>
                <span className="badge badge-dim" style={{ marginRight: 8 }}>对方曾婉拒</span>
                <form action={requestCertificationAction.bind(null, user.id)} style={{ display: "inline" }}>
                  <button className="btn btn-sm" type="submit">再 次 请 求</button>
                </form>
              </>
            )}
          </p>
        )}

        {sp?.ok === "cert_sent" && <p className="meta" style={{ color: "var(--gold-deep)" }}>已发出互证请求，待对方应允。</p>}
        {sp?.ok === "cert_mutual" && <p className="meta" style={{ color: "var(--gold-deep)" }}>对方已先发起互证，你们已互相应允，可无限私信。</p>}
        {sp?.ok === "cert_accepted" && <p className="meta" style={{ color: "var(--gold-deep)" }}>已应允互证，你们现可无限私信。</p>}
        {sp?.ok === "cert_declined" && <p className="meta">已婉拒互证请求。</p>}
        {sp?.e === "cert_rate" && <p className="meta" style={{ color: "var(--maroon)" }}>互证请求过于频繁，请稍后再试。</p>}
        {sp?.e === "cert_admin" && <p className="meta" style={{ color: "var(--maroon)" }}>管理者无需同侪互证。</p>}
        {sp?.e === "cert_self" && <p className="meta" style={{ color: "var(--maroon)" }}>不能与自己互证。</p>}
        {sp?.e === "cert_nouser" && <p className="meta" style={{ color: "var(--maroon)" }}>该用户不存在或已离馆。</p>}
        {sp?.e === "cert_none" && <p className="meta" style={{ color: "var(--maroon)" }}>没有待你回应的互证请求。</p>}
      </div>

      <h2 className="section-title" style={{ fontSize: 21 }}>论 著</h2>
      <div className="card" style={{ padding: "6px 20px 10px", marginBottom: 34 }}>
        {papers.length === 0 && <p className="empty-note" style={{ padding: 20 }}>此君尚无刊文。</p>}
        {papers.map((p) => {
          const isPublic =
            p.status === "published" ||
            (isSelf && me?.status === "active") ||
            (me?.role === "admin" && me.status === "active");
          if (!isPublic) return null;
          const mine = isSelf && user.status === "active";
          return (
            <div className="item" key={p.id} style={{ alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link className="title" href={`/papers/${p.id}`} style={{ fontSize: 17 }}>
                  {p.title}
                </Link>
                {" "}
                <span className="badge badge-dim">{p.discipline}</span>{" "}
                {p.status !== "published" && <StatusBadge status={p.status} />}
                <div className="meta">
                  {formatDate(p.created_at)} · 阅 {p.views}{" "}
                  {p.status === "rejected" && p.reject_reason && (
                    <span style={{ fontStyle: "italic" }}>· 掌门批：{p.reject_reason}</span>
                  )}
                </div>
              </div>
              {mine && p.status === "submitted" && (
                <form action={discardPaperAction.bind(null, p.id)}>
                  <button className="btn btn-sm" type="submit">弃 稿</button>
                </form>
              )}
              {mine && (p.status === "submitted" || p.status === "revision" || p.status === "rejected") && (
                <Link href={`/papers/${p.id}/edit`} className="btn btn-sm btn-gold">修订</Link>
              )}
              {mine && p.status === "revision" && (
                <form action={submitRevisionAction.bind(null, p.id)}>
                  <button className="btn btn-sm" type="submit">重投</button>
                </form>
              )}
              {mine && p.status === "rejected" && (
                <form action={resubmitPaperAction.bind(null, p.id)}>
                  <button className="btn btn-sm" type="submit">重投</button>
                </form>
              )}
            </div>
          );
        })}
      </div>

      <h2 className="section-title" style={{ fontSize: 21 }}>论 坛 墨 迹</h2>
      <div className="card" style={{ padding: "6px 20px 10px" }}>
        {threads.length === 0 && <p className="empty-note" style={{ padding: 20 }}>此君尚未立题。</p>}
        {threads.map((t) => (
          <div className="item" key={t.id}>
            <div>
              <Link className="title" href={`/forum/thread/${t.id}`} style={{ fontSize: 17 }}>{t.title}</Link>
              <div className="meta">
                <span className="badge badge-dim">{t.category}</span> · {timeAgo(t.created_at)} · {t.reply_count} 复
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}