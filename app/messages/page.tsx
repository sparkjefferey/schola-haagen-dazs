import Link from "next/link";
import { requireLogin, sendMessageAction } from "@/lib/actions";
import { getConversations, getThread, getSystemMessages } from "@/lib/messages";
import { db } from "@/lib/db";
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

  const activeUsers = db
    .prepare(
      "SELECT id, username, display_name, role, endorsed FROM users WHERE status='active' AND id <> ? ORDER BY display_name",
    )
    .all(me.id) as any[];

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
        };
        thread = getThread(me.id, otherId);
      }
    }
  }

  const sysMsgs = isSystem ? getSystemMessages(me.id) : [];
  const conversations = getConversations(me.id);

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

        {conversations.length === 0 && (
          <p className="empty-note" style={{ padding: "12px 6px", fontSize: 13 }}>
            尚无私聊。从下方「新私聊」挑选同侪交谈。
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
          </div>
        </details>
      </aside>

      <section className="msg-main">
        {sp.e === "empty" && <div className="msg-note err">私信内容不可为空。</div>}
        {sp.e === "self" && <div className="msg-note err">不能给自己发私信。</div>}
        {sp.e === "nouser" && <div className="msg-note err">该用户不存在或已离馆。</div>}
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
