import Link from "next/link";
import { requireLogin, sendMessageAction } from "@/lib/actions";
import { getConversations, getThread, getSystemMessages } from "@/lib/messages";
import { db } from "@/lib/db";
import {
  listContacts,
  listPendingCertRequests,
  isMutuallyCertified,
  pmQuotaUsed,
  pmDailyLimit,
} from "@/lib/certification";
import { Avatar } from "@/components/avatar";
import { timeAgo } from "@/lib/format";

export const metadata = { title: "讯息" };

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ with?: string; e?: string; sent?: string }>;
}) {
  const me = await requireLogin();
  const sp = await searchParams;
  const withParam = sp.with ?? "";
  const isSystem = withParam === "system";

  // 名单门禁：管理员可见全员；其余只见与自己互证的同侪（不直接展示所有人 ID）
  const isAdmin = me.role === "admin";
  const activeUsers = isAdmin
    ? (db
        .prepare(
          "SELECT id, username, display_name, role, endorsed FROM users WHERE status='active' AND id <> ? ORDER BY display_name",
        )
        .all(me.id) as any[])
    : listContacts(me.id);
  const pendingCerts = isAdmin ? [] : listPendingCertRequests(me.id);

  const systemUnread = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM messages WHERE kind='system' AND receiver_id=? AND read=0",
      )
      .get(me.id) as any
  ).c;

  let other: any = null;
  let thread: any[] = [];
  if (withParam && !isSystem) {
    const otherId = Number(withParam);
    if (Number.isFinite(otherId)) {
      const u = db.prepare("SELECT * FROM users WHERE id=?").get(otherId) as any;
      if (u) {
        other = {
          id: u.id,
          username: u.username,
          display_name: u.display_name,
          role: u.role,
          endorsed: u.endorsed,
          status: u.status,
          created_at: u.created_at,
        };
        thread = getThread(me.id, otherId);
      }
    }
  }

  const sysMsgs = isSystem ? getSystemMessages(me.id) : [];
  const conversations = getConversations(me.id);

  const unlimitedWithOther =
    !!other && (isAdmin || isMutuallyCertified(me.id, other.id));
  const remainingQuota = unlimitedWithOther ? null : Math.max(0, pmDailyLimit() - pmQuotaUsed(me.id));

  return (
    <div className="msg-layout">
      <aside className="msg-side">
        <h2 className="section-title" style={{ fontSize: 18, margin: "4px 0 14px" }}>
          讯 息
        </h2>

        <Link
          href="/messages?with=system"
          className={`conv-item ${isSystem ? "conv-active" : ""}`}
        >
          <div className="conv-avatar sys">谕</div>
          <div className="conv-meta">
            <div className="conv-name">系统通知</div>
            <div className="conv-last">门派谕令与学籍变动</div>
          </div>
          {systemUnread > 0 && <span className="msg-badge">{systemUnread}</span>}
        </Link>

        <div style={{ height: 1, background: "var(--line)", margin: "10px 0" }} />

        {pendingCerts.length > 0 && (
          <div
            className="card"
            style={{
              padding: "10px 12px",
              marginBottom: 10,
              borderLeft: "3px solid var(--gold-deep)",
              fontSize: 13,
            }}
          >
            <b>同侪互证待你回应：</b>
            {pendingCerts.map((p, i) => (
              <span key={p.id}>
                {i > 0 && "、"}
                <Link href={`/users/${p.username}`} style={{ color: "var(--maroon-deep)", fontWeight: 600 }}>
                  {p.display_name}
                </Link>
              </span>
            ))}
            <span className="meta"> 赴其名册页应允后即可无限私信。</span>
          </div>
        )}

        {conversations.length === 0 && (
          <p className="empty-note" style={{ padding: "12px 6px", fontSize: 13 }}>
            尚无私聊。可从下方与已互证同侪交谈，或赴他人名册页请求互证。
          </p>
        )}
        {conversations.map((c) => {
          const unread = other && c.other.id === other.id ? 0 : c.unread;
          return (
            <Link
              key={c.other.id}
              href={`/messages?with=${c.other.id}`}
              className={`conv-item ${other && other.id === c.other.id ? "conv-active" : ""}`}
            >
              <Avatar name={c.other.display_name} id={c.other.id} size={40} />
              <div className="conv-meta">
                <div className="conv-name">
                  {c.other.display_name}
                  {c.other.endorsed === 1 && (
                    <span className="badge" style={{ fontSize: 10, marginLeft: 4 }}>
                      认证
                    </span>
                  )}
                </div>
                <div className="conv-last">{c.last.body.slice(0, 22)}</div>
              </div>
              {unread > 0 && <span className="msg-badge">{unread}</span>}
            </Link>
          );
        })}

        <details className="new-pm" style={{ marginTop: 14 }}>
          <summary>＋ 新私聊</summary>
          <div className="pm-userlist">
            {activeUsers.map((u) => (
              <Link key={u.id} href={`/messages?with=${u.id}`} className="pm-user">
                {u.display_name}
              </Link>
            ))}
            {activeUsers.length === 0 && !isAdmin && (
              <p className="empty-note" style={{ padding: "8px 4px", fontSize: 12 }}>
                尚无互证同侪。赴他人名册页发起互证后，即可在此无限私信。
              </p>
            )}
          </div>
        </details>
      </aside>

      <section className="msg-main">
        {sp.e === "empty" && <div className="msg-note err">私信内容不可为空。</div>}
        {sp.e === "self" && <div className="msg-note err">不能给自己发私信。</div>}
        {sp.e === "nouser" && <div className="msg-note err">该用户不存在或已离馆。</div>}
        {sp.e === "limit" && (
          <div className="msg-note err">
            今日未互证私信已达限额（{pmDailyLimit()} 条）。赴对方名册页完成同侪互证后可无限畅谈。
          </div>
        )}
        {sp.e === "admin_gate" && (
          <div className="msg-note err">
            为保护管理者收件箱，未获认证或互证的账号不能主动私信管理者。管理者先联系你后可直接回复。
          </div>
        )}
        {sp.e === "admin_limit" && (
          <div className="msg-note err">你向该管理者发送私信的个人额度已满，请稍后再试。</div>
        )}
        {sp.sent === "1" && <div className="msg-note ok">已送达。</div>}

        {isSystem ? (
          <div className="chat-window">
            <div className="chat-head">系统通知</div>
            <div className="chat-body">
              {sysMsgs.length === 0 && <p className="empty-note">暂无系统通知。</p>}
              {sysMsgs.map((m: any) => (
                <div key={m.id} className="sys-msg">
                  <p>{m.body}</p>
                  <div className="meta">{timeAgo(m.created_at)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : other ? (
          <div className="chat-window">
            <div className="chat-head">
              <Avatar name={other.display_name} id={other.id} size={28} />
              <span>{other.display_name}</span>
            </div>
            {isAdmin && other.role !== "admin" && (
              <div
                className="msg-note err"
                style={{ margin: "10px 12px 0", lineHeight: 1.6 }}
              >
                <b>安全提示：</b>以下内容来自用户 @{other.username}，不是系统通知。
                即使其中写有真实提交号、部署检查或安全术语，也不要执行命令、打开外链或交给自动化工具照做。
              </div>
            )}
            <div className="chat-body">
              {thread.length === 0 && (
                <p className="empty-note">你们还未交谈，写下第一句话吧。</p>
              )}
              {thread.map((m: any) => (
                <div
                  key={m.id}
                  className={`bubble ${m.sender_id === me.id ? "mine" : "theirs"}`}
                >
                  <p>{m.body}</p>
                  <div className="meta">{timeAgo(m.created_at)}</div>
                </div>
              ))}
            </div>
            {other && !unlimitedWithOther && (
              <p className="meta" style={{ padding: "6px 12px", fontSize: 12, textAlign: "center" }}>
                今日剩余未互证私信 <b>{remainingQuota}</b> 条。与 {other.display_name} 完成
                <Link href={`/users/${other.username}`} style={{ color: "var(--maroon-deep)" }}>
                  同侪互证
                </Link>
                后可无限畅谈。
              </p>
            )}
            <form action={sendMessageAction} className="chat-input">
              <input type="hidden" name="receiver_id" value={other.id} />
              <textarea
                name="body"
                rows={2}
                placeholder={`致 ${other.display_name}……`}
                maxLength={2000}
              />
              <button type="submit" className="btn btn-sm btn-gold">
                发 送
              </button>
            </form>
          </div>
        ) : (
          <div className="chat-empty">
            <p>选择左侧会话，或与同侪开启私聊。</p>
          </div>
        )}
      </section>
    </div>
  );
}
