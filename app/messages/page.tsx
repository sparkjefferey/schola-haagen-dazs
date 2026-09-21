import Link from "next/link";
import { requireLogin } from "@/lib/actions";
import { getConversations, getThread, getSystemMessages } from "@/lib/messages";
import { db } from "@/lib/db";
import {
  listContacts,
  listPendingCertRequests,
  listSentCertRequests,
  isMutuallyCertified,
  pmQuotaUsed,
  pmDailyLimit,
} from "@/lib/certification";
import { searchUsers, type UserSearchResult } from "@/lib/user-search";
import { Avatar } from "@/components/avatar";
import { timeAgo } from "@/lib/format";
import { ChatPanel } from "@/components/chat-panel";
import { SystemPanel } from "@/components/system-panel";
import { NotificationPanel } from "@/components/notification-panel";
import { CertPanel } from "@/components/cert-panel";
import { UserSearchResults } from "@/components/user-search-results";
import { getUnreadNoticeCount, listNotifications, markNotificationsRead } from "@/lib/notifications";

export const metadata = { title: "讯息" };

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ with?: string; e?: string; ok?: string; sent?: string; find?: string }>;
}) {
  const me = await requireLogin();
  const sp = await searchParams;
  const withParam = sp.with ?? "";
  const isSystem = withParam === "system";
  const isNotices = withParam === "notices";
  const isTips = withParam === "tips";
  const isCerts = withParam === "certs";
  const findQuery = (sp.find ?? "").trim();

  // 检索态优先于会话态：一旦有检索词，主面板就归检索结果（否则从结果点申请回来
  // 会落回某个会话，得重搜一遍）。限流与「只搜在籍者」都在 searchUsers 内处理。
  const search: UserSearchResult | null = findQuery ? searchUsers(me.id, findQuery) : null;

  // 名单门禁：管理员另见一份全员名录（查人用的便册，与学友名录分开标名）；其余只见自己的学友
  const isAdmin = me.role === "admin";
  const contacts = listContacts(me.id);
  const roster = isAdmin
    ? (db
        .prepare(
          "SELECT id, username, display_name, role, endorsed FROM users WHERE status='active' AND id <> ? ORDER BY display_name",
        )
        .all(me.id) as any[])
    : [];
  // 管理者同样收发学友申请（从前被排除在外：馆长账号上这栏恒空、申请按钮一处也见不着）
  const pendingCerts = listPendingCertRequests(me.id);
  const sentCerts = listSentCertRequests(me.id);
  // 角标不做「看过即清零」：申请要回应了才算完，看过一眼仍挂着——
  // 与顶部铃铛（getUnreadCount 同样计入待应允申请）口径一致，两处不会各说各话。
  const pendingCertCount = pendingCerts.length;

  // 正在查看的那一栏直接算已读，角标立刻归零；否则「点开了角标还挂着」，
  // 用户会以为没生效，非刷新一次不可。
  const systemUnread = isSystem
    ? 0
    : (
        db
          .prepare(
            "SELECT COUNT(*) AS c FROM messages WHERE kind='system' AND receiver_id=? AND read=0",
          )
          .get(me.id) as any
      ).c;

  // 列表务必在标记已读之前取：本次渲染仍能看到哪几条是刚看过的（高亮），
  // 标记随后落库，刷新即归零。
  // 两类提醒各占一栏、各算各的未读：混在一栏里「三枚墨银」与「三条跟帖」会共用
  // 同一个数字，用户根本看不出哪边有新东西。
  const notices = isNotices ? listNotifications(me.id, { kind: "thread_reply" }) : [];
  const noticeUnread = isNotices ? 0 : getUnreadNoticeCount(me.id, "thread_reply");
  if (isNotices) markNotificationsRead(me.id, "thread_reply");

  const tips = isTips ? listNotifications(me.id, { kind: "paper_tip" }) : [];
  const tipUnread = isTips ? 0 : getUnreadNoticeCount(me.id, "paper_tip");
  if (isTips) markNotificationsRead(me.id, "paper_tip");

  let other: any = null;
  let thread: any[] = [];
  if (withParam && !isSystem && !isNotices && !isTips && !isCerts) {
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

  // 申请/应允办完回哪儿：检索态回检索结果，否则回申请栏。actions 侧会再做
  // 站内路径白名单校验，这里只管把当前上下文如实传过去。
  const backPath = search
    ? `/messages?find=${encodeURIComponent(search.query)}`
    : "/messages?with=certs";

  return (
    <div className="msg-layout">
      <aside className="msg-side">
        <h2 className="section-title" style={{ fontSize: 18, margin: "4px 0 14px" }}>
          讯 息
        </h2>

        <form method="get" action="/messages" className="user-search">
          <input
            name="find"
            type="search"
            autoComplete="off"
            maxLength={24}
            defaultValue={findQuery}
            placeholder="学号 #7 · 雅名 · 用户名"
            aria-label="检索同窗"
          />
          <button className="btn btn-sm" type="submit">
            检 索
          </button>
        </form>

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

        <Link
          href="/messages?with=notices"
          className={`conv-item ${isNotices ? "conv-active" : ""}`}
        >
          <div className="conv-avatar reply">辩</div>
          <div className="conv-meta">
            <div className="conv-name">论辩回应</div>
            <div className="conv-last">你的论题收到的新跟帖</div>
          </div>
          {noticeUnread > 0 && <span className="msg-badge">{noticeUnread}</span>}
        </Link>

        <Link
          href="/messages?with=tips"
          className={`conv-item ${isTips ? "conv-active" : ""}`}
        >
          <div className="conv-avatar coin">銀</div>
          <div className="conv-meta">
            <div className="conv-name">论著得币</div>
            <div className="conv-last">你的论著收到的墨银</div>
          </div>
          {tipUnread > 0 && <span className="msg-badge">{tipUnread}</span>}
        </Link>

        <Link
          href="/messages?with=certs"
          className={`conv-item ${isCerts ? "conv-active" : ""}`}
        >
          <div className="conv-avatar friend">友</div>
          <div className="conv-meta">
            <div className="conv-name">学友申请</div>
            <div className="conv-last">
              {pendingCertCount > 0 ? "有申请待你应允" : "找同窗申请 · 应允后可无限私信"}
            </div>
          </div>
          {pendingCertCount > 0 && <span className="msg-badge">{pendingCertCount}</span>}
        </Link>

        <div style={{ height: 1, background: "var(--line)", margin: "10px 0" }} />

        {conversations.length === 0 && (
          <p className="empty-note" style={{ padding: "12px 6px", fontSize: 13 }}>
            尚无私聊。用上方检索找人发出学友申请，或赴他人名册页申请；应允后即可畅谈。
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
          <summary>＋ 学友名录（{contacts.length}）</summary>
          <div className="pm-userlist">
            {contacts.map((u) => (
              <Link key={u.id} href={`/messages?with=${u.id}`} className="pm-user">
                {u.display_name}
              </Link>
            ))}
            {contacts.length === 0 && (
              <p className="empty-note" style={{ padding: "8px 4px", fontSize: 12 }}>
                尚无学友。赴「学友申请」栏或他人名册页发出申请，应允后即列于此。
              </p>
            )}
          </div>
        </details>

        {/* 管理者查人用的便册。从前它顶着「学友名录」的名字列全员——名字与内容对不上，
            看着就像「谁都是我的学友、根本不用申请」。分开标名，各是各的。 */}
        {isAdmin && (
          <details className="new-pm" style={{ marginTop: 10 }}>
            <summary>＋ 全员名录（{roster.length} · 管理者）</summary>
            <div className="pm-userlist">
              {roster.map((u) => (
                <Link key={u.id} href={`/messages?with=${u.id}`} className="pm-user">
                  {u.display_name}
                </Link>
              ))}
            </div>
          </details>
        )}
      </aside>

      <section className="msg-main">
        {sp.e === "empty" && <div className="msg-note err">私信内容不可为空。</div>}
        {sp.e === "self" && <div className="msg-note err">不能给自己发私信。</div>}
        {sp.e === "nouser" && <div className="msg-note err">该用户不存在或已离馆。</div>}
        {sp.e === "limit" && (
          <div className="msg-note err">
            今日未互证私信已达限额（{pmDailyLimit()} 条）。赴对方名册页申请学友，应允后可无限畅谈。
          </div>
        )}
        {sp.e === "admin_gate" && (
          <div className="msg-note err">
            为保护管理者收件箱，未获认证或未结为学友的账号不能主动私信管理者。管理者先联系你后可直接回复。
          </div>
        )}
        {sp.e === "admin_limit" && (
          <div className="msg-note err">你向该管理者发送私信的个人额度已满，请稍后再试。</div>
        )}
        {sp.e === "cert_rate" && <div className="msg-note err">学友申请过于频繁，请稍后再试。</div>}
        {sp.e === "cert_none" && <div className="msg-note err">没有待你回应的学友申请（可能已被处理）。</div>}
        {sp.e === "cert_nouser" && <div className="msg-note err">该用户不存在或已离馆。</div>}
        {sp.e === "cert_self" && <div className="msg-note err">不能与自己结为学友。</div>}
        {sp.sent === "1" && <div className="msg-note ok">已送达。</div>}
        {sp.ok === "cert_sent" && <div className="msg-note ok">已发出学友申请，待对方应允。</div>}
        {sp.ok === "cert_mutual" && (
          <div className="msg-note ok">对方已先发起申请，你们已互为学友，可无限私信。</div>
        )}
        {sp.ok === "cert_accepted" && <div className="msg-note ok">已应允，你们现为学友，可无限私信。</div>}
        {sp.ok === "cert_declined" && <div className="msg-note ok">已婉拒该申请。</div>}

        {search ? (
          search.ok ? (
            <UserSearchResults
              query={search.query}
              hits={search.hits}
              meRole={me.role}
              backPath={backPath}
            />
          ) : (
            <div className="card" style={{ padding: "22px 20px" }}>
              <p className="empty-note" style={{ padding: 0 }}>
                检索过于频繁（每 10 分钟 30 次），请稍后再试。
                若确有需要，可径赴对方名册页。
              </p>
            </div>
          )
        ) : isNotices ? (
          <NotificationPanel items={notices} kind="thread_reply" />
        ) : isTips ? (
          <NotificationPanel items={tips} kind="paper_tip" />
        ) : isSystem ? (
          <SystemPanel messages={sysMsgs} />
        ) : isCerts ? (
          <CertPanel received={pendingCerts} sent={sentCerts} backPath={backPath} />
        ) : other ? (
          <ChatPanel
            other={other}
            myId={me.id}
            initialThread={thread}
            unlimited={!!unlimitedWithOther}
            remainingQuota={remainingQuota}
          />
        ) : (
          <div className="chat-empty">
            <p style={{ textAlign: "center", padding: "0 20px" }}>
              选择左侧会话，或用上方检索找人开启私聊。
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
