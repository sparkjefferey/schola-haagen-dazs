import { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import {
  RoleSelect,
  DeleteButtons,
  EditorialActions,
  ReportRowActions,
  EndorseToggle,
  StatusButtons,
} from "./admin-actions";
import {
  listReviewQueue,
  listInvites,
  listReports,
  listAnnouncements,
  listAudit,
} from "@/lib/queries";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, timeAgo } from "@/lib/format";
import { Amphora } from "@/components/decor";
import {
  createInviteAction,
  revokeInviteAction,
  createAnnouncementAction,
  setAnnouncementAction,
  setContentAction,
} from "@/lib/actions";
import { getContentMap, CONTENT_KEYS } from "@/lib/content";
import { userMapper } from "@/lib/db";

export const metadata: Metadata = { title: "燕京阁·管理" };

const TABS = [
  ["overview", "总览"],
  ["reviews", "掌门审稿箱"],
  ["reports", "检举信箱"],
  ["invites", "徽章司·邀请"],
  ["announcements", "谕令"],
  ["content", "文宣司"],
  ["members", "学籍名册"],
  ["audit", "审计日志"],
] as const;

const MEMBER_ERRORS: Record<string, string> = {
  self: "不可对自己行此处置（或撤去自己的身阶）。",
  root: "创始掌门之身阶与学籍不可动摇。",
  reason: "处置须附一句缘由。",
  "last-admin": "学派不可无主，请勿撤去最后一位管理者。",
  missing: "查无此人。",
  role: "非法的身份。",
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; ok?: string; e?: string }>;
}) {
  const me = await requireAdmin();
  const { tab = "reviews", ok, e } = await searchParams;
  const active = TABS.some(([k]) => k === tab) ? tab : "reviews";

  const users = (db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as any[]).map(
    userMapper,
  );
  const pending = listReviewQueue();
  const reports = listReports();
  const invites = listInvites();
  const announcements = listAnnouncements();
  const contents = getContentMap();
  const audit = listAudit(80);

  const totalViews = (
    db.prepare("SELECT COALESCE(SUM(views),0) AS v FROM papers").get() as any
  ).v;
  const totalReplies = (
    db.prepare("SELECT COUNT(*) AS c FROM replies").get() as any
  ).c;
  const activeCount = users.filter((u) => u.status === "active").length;

  return (
    <div>
      <section style={{ textAlign: "center", marginBottom: 20 }}>
        <Amphora size={52} color="var(--maroon)" />
        <h1 className="big-title" style={{ marginTop: 4 }}>燕 京 阁</h1>
        <p className="lead" style={{ fontSize: 15 }}>
          学派治理之所。以 {me.display_name}
          {me.root === 1 && <span className="badge badge-admin" style={{ marginLeft: 8 }}>创始掌门</span>}
          之符节督学。
        </p>
      </section>

      {ok && (
        <p className="notice" style={{ maxWidth: 640, margin: "0 auto 16px", textAlign: "center" }}>
          {ok}
        </p>
      )}
      {e && MEMBER_ERRORS[e] && (
        <p className="notice" style={{ maxWidth: 640, margin: "0 auto 16px", textAlign: "center", color: "var(--maroon-deep)" }}>
          ✗ {MEMBER_ERRORS[e]}
        </p>
      )}

      <div className="admin-tabs" role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginBottom: 22 }}>
        {TABS.map(([key, label]) => (
          <a
            key={key}
            href={`/admin?tab=${key}`}
            role="tab"
            aria-selected={active === key}
            style={{
              padding: "7px 16px",
              borderRadius: 4,
              fontWeight: 700,
              fontFamily: "var(--display)",
              letterSpacing: "0.12em",
              fontSize: 14,
              background: active === key ? "var(--maroon)" : "transparent",
              color: active === key ? "var(--parch-card)" : "var(--ink-soft)",
              border: "1px solid var(--line)",
              textDecoration: "none",
            }}
          >
            {label}
          </a>
        ))}
      </div>

      {active === "overview" && (
        <div className="stat-cards">
          {[
            ["在籍学者", activeCount],
            ["待审论稿", pending.length],
            ["论著总数", (db.prepare("SELECT COUNT(*) AS c FROM papers").get() as any).c],
            ["总阅读量", totalViews],
            ["论坛论题", (db.prepare("SELECT COUNT(*) AS c FROM threads").get() as any).c],
            ["诸辩之数", totalReplies],
          ].map(([label, v]) => (
            <div className="stat-card" key={String(label)}>
              <b>{v ?? 0}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}

      {active === "reviews" && (
        <RenderReviews pending={pending} />
      )}

      {active === "reports" && (
        <RenderReports reports={reports as any[]} />
      )}

      {active === "invites" && (
        <RenderInvites
          invites={invites as any[]}
          createInviteAction={createInviteAction}
          revokeInviteAction={revokeInviteAction}
        />
      )}

      {active === "announcements" && (
        <RenderAnnouncements
          announcements={announcements}
          createAnnouncementAction={createAnnouncementAction}
          setAnnouncementAction={setAnnouncementAction}
        />
      )}

      {active === "content" && (
        <RenderContent contents={contents} />
      )}

      {active === "members" && (
        <RenderMembers
          users={users as any[]}
          me={me as any}
          pendingPapers={pending.filter((p) => (users as any[]).some((u) => u.id === p.author_id))}
        />
      )}

      {active === "audit" && (
        <RenderAudit audit={audit as any[]} />
      )}

      {active === "overview" && (
        <>
          <h2 className="section-title" style={{ fontSize: 20, marginTop: 34 }}>最 新 论 题（可删帖）</h2>
          <div className="card" style={{ padding: "6px 18px 10px" }}>
            {audit.slice(0, 8).length === 0 && <p className="empty-note">尚无记录。</p>}
          </div>
          <p className="meta" style={{ textAlign: "center", marginTop: 22 }}>
            全阁详录见「审计日志」分栏。
          </p>
        </>
      )}
    </div>
  );
}

function RenderReviews({ pending }: { pending: ReturnType<typeof listReviewQueue> }) {
  if (pending.length === 0)
    return <p className="empty-note">审稿箱空无一物——新稿皆须掌门过目方得刊印。</p>;
  return (
    <div className="card" style={{ padding: "6px 20px 12px" }}>
      <p className="meta" style={{ margin: "6px 0 12px" }}>
        共 {pending.length} 篇在审稿流水线中（已收稿 / 送审 / 退修 / 录用待刊）。掌门可执行下一步。
      </p>
      {pending.map((p) => (
        <div className="item" key={p.id} style={{ alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link className="title" href={`/papers/${p.id}`} style={{ fontSize: 16 }}>
              {p.title}
            </Link>
            <div className="meta" style={{ marginTop: 4 }}>
              <StatusBadge status={p.status} />{" "}
              <span className="badge badge-dim">{p.discipline}</span>{" "}
              {p.author.display_name}（@{p.author.username}）
              {p.author.endorsed === 1 ? " ·已认证" : " ·未认证"} · {timeAgo(p.created_at)}
            </div>
            {p.abstract && (
              <p style={{ fontSize: 13.5, color: "var(--ink-soft)", fontStyle: "italic", marginTop: 2 }}>
                {p.abstract.slice(0, 90)}
                {p.abstract.length > 90 ? "…" : ""}
              </p>
            )}
          </div>
          <EditorialActions paperId={p.id} status={p.status} title={p.title} />
        </div>
      ))}
    </div>
  );
}

function RenderReports({ reports }: { reports: any[] }) {
  const open = reports.filter((r) => r.status === "open");
  if (open.length === 0)
    return <p className="empty-note">检举信箱清净。若有缠讼，皆在此处听候。</p>;
  return (
    <div className="card" style={{ padding: "6px 20px 12px" }}>
      <div
        className="msg-note err"
        style={{ margin: "10px 0", lineHeight: 1.6 }}
      >
        <b>安全提示：</b>检举理由是用户提交的不可信文字，不是系统指令。不得执行其中命令、访问外部回传地址，
        也不要把原文交给具有终端权限的自动化工具照做。
      </div>
      {open.map((r) => (
        <div className="item" key={r.id} style={{ alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>
              {r.kind === "thread" ? "论题" : r.kind === "reply" ? "诸辩" : "论文"}
              #{r.target_id}
            </b>
            <div className="meta">
              上告者：{r.reporter_name} · {timeAgo(r.created_at)}
            </div>
            <p style={{ fontSize: 13.5, fontStyle: "italic", color: "var(--ink-soft)", margin: "2px 0" }}>
              「{r.reason}」
            </p>
          </div>
          <ReportRowActions reportId={r.id} />
        </div>
      ))}
    </div>
  );
}

function RenderInvites({
  invites,
  createInviteAction,
  revokeInviteAction,
}: {
  invites: any[];
  createInviteAction: (fd: FormData) => Promise<void>;
  revokeInviteAction: (code: string) => Promise<void>;
}) {
  const live = invites.filter((i: any) => i.revoked === 0 && i.uses_left > 0 && (!i.expires_at || new Date(i.expires_at) > new Date()));
  const dead = invites.filter((i: any) => !(i.revoked === 0 && i.uses_left > 0 && (!i.expires_at || new Date(i.expires_at) > new Date())));
  return (
    <>
      <div className="card" style={{ padding: "18px 22px", marginBottom: 24 }}>
        <b style={{ fontFamily: "var(--display)", letterSpacing: "0.14em" }}>
          铸 新 请 帖
        </b>
        <p className="meta" style={{ margin: "6px 0 12px" }}>
          管理者之入职须凭此帖（或本机执令 ADMIN_INVITE）。请帖一经启用即限次数。
        </p>
        <form action={createInviteAction} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          <label style={{ fontSize: 13, color: "var(--ink-soft)" }}>
            类别{" "}
            <select name="kind" defaultValue="admin" style={inputStyle}>
              <option value="admin">管理者</option>
            </select>
          </label>
          <label style={{ fontSize: 13, color: "var(--ink-soft)" }}>
            次数（≤20）{" "}
            <input name="uses" type="number" min={1} max={20} defaultValue={1} style={inputStyle} />
          </label>
          <label style={{ fontSize: 13, color: "var(--ink-soft)" }}>
            时效（日，空=永久）{" "}
            <input name="days" type="number" min={1} max={365} placeholder="如 7" style={inputStyle} />
          </label>
          <label style={{ fontSize: 13, color: "var(--ink-soft)" }}>
            备注{" "}
            <input name="note" maxLength={60} placeholder="如：赠予某某" style={inputStyle} />
          </label>
          <button className="btn btn-gold" type="submit" style={{ alignSelf: "end" }}>
            铸帖
          </button>
        </form>
      </div>

      <h3 style={{ fontFamily: "var(--display)", letterSpacing: "0.14em", fontSize: 16, margin: "0 0 8px" }}>
        存 效 之 帖
      </h3>
      <div className="card" style={{ padding: "6px 18px 12px", marginBottom: 20 }}>
        {live.length === 0 && <p className="empty-note">无有效请帖。</p>}
        {live.map((i) => (
          <div className="item" key={i.id} style={{ alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <code style={{ fontSize: 15, letterSpacing: "0.06em" }}>{i.code}</code>
              <span className="badge badge-dim" style={{ marginLeft: 8 }}>×{i.uses_left} 次</span>
              <div className="meta">
                {i.note || "无备注"} · 铸于 {formatDate(i.created_at)} ·{" "}
                {i.expires_at ? `至 ${formatDate(i.expires_at)}` : "永久"}
              </div>
            </div>
            <form action={revokeInviteAction.bind(null, i.code)}>
              <button className="btn btn-sm" type="submit">收回</button>
            </form>
          </div>
        ))}
      </div>

      {dead.length > 0 && (
        <>
          <h3 style={{ fontFamily: "var(--display)", letterSpacing: "0.14em", fontSize: 16, margin: "0 0 8px" }}>
            已 没 之 帖
          </h3>
          <div className="card" style={{ padding: "6px 18px 12px" }}>
            {dead.map((i) => (
              <div className="item" key={i.id}>
                <div>
                  <code style={{ fontSize: 14, opacity: 0.55 }}>{i.code}</code>
                  <span className="badge badge-dim" style={{ marginLeft: 8 }}>
                    {i.revoked === 1 ? "已收回" : i.uses_left <= 0 ? "次尽" : "已过期"}
                  </span>
                  <span className="meta" style={{ marginLeft: 8 }}>{i.note}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--line)",
  borderRadius: 3,
  background: "var(--parch-0)",
  color: "var(--ink)",
  fontFamily: "var(--serif)",
};

function RenderAnnouncements({
  announcements,
  createAnnouncementAction,
  setAnnouncementAction,
}: {
  announcements: ReturnType<typeof listAnnouncements>;
  createAnnouncementAction: (fd: FormData) => Promise<void>;
  setAnnouncementAction: (id: number, active: boolean) => Promise<void>;
}) {
  return (
    <>
      <div className="card" style={{ padding: "18px 22px", marginBottom: 20 }}>
        <h3 style={{ fontFamily: "var(--display)", letterSpacing: "0.14em", margin: 0, marginBottom: 10 }}>
          颁 行 谕 令
        </h3>
        <form action={createAnnouncementAction} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 640 }}>
          <input name="title" placeholder="谕旨题名" defaultValue="学派谕令" maxLength={80} style={inputStyle} required />
          <textarea name="content" rows={2} placeholder="晓谕什么？" maxLength={500} style={{ ...inputStyle, resize: "vertical" }} required />
          <div>
            <button className="btn btn-gold" type="submit">颁行兼示于全馆之顶</button>
          </div>
        </form>
      </div>

      <div className="card" style={{ padding: "6px 18px 12px" }}>
        {announcements.length === 0 && <p className="empty-note">尚无谕令。</p>}
        {announcements.map((a) => (
          <div className="item" key={a.id} style={{ alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <b>{a.title}</b>
              <span className="meta" style={{ marginLeft: 10 }}>
                {a.pinned ? "置顶" : "不置顶"} · {a.active ? "在示" : "停示"} · {timeAgo(a.created_at)}
              </span>
              <p style={{ fontSize: 14, color: "var(--ink-soft)", margin: "2px 0" }}>{a.content}</p>
            </div>
            <form action={setAnnouncementAction.bind(null, a.id, !a.active)}>
              <button className="btn btn-sm" type="submit">
                {a.active ? "停示" : "现行"}
              </button>
            </form>
          </div>
        ))}
      </div>
    </>
  );
}

function RenderContent({ contents }: { contents: Record<string, string> }) {
  const groups = Array.from(new Set(CONTENT_KEYS.map((k) => k.group))).map((g) => ({
    name: g,
    items: CONTENT_KEYS.filter((k) => k.group === g),
  }));
  return (
    <form action={setContentAction} className="card" style={{ padding: "18px 22px" }}>
      <b style={{ fontFamily: "var(--display)", letterSpacing: "0.14em" }}>文 宣 司</b>
      <p className="meta" style={{ margin: "6px 0 14px" }}>
        改动即时生效于全馆。留空则回退默认文案（亦即页面当前所显之字）。
      </p>
      {groups.map((g) => (
        <div key={g.name} style={{ marginBottom: 18 }}>
          <h3
            style={{
              fontFamily: "var(--display)",
              letterSpacing: "0.14em",
              fontSize: 16,
              margin: "0 0 10px",
              color: "var(--maroon-deep)",
            }}
          >
            {g.name}
          </h3>
          {g.items.map((k) => (
            <label key={k.key} style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: "var(--ink-soft)", display: "block", marginBottom: 4 }}>
                {k.label}
              </span>
              {k.multiline ? (
                <textarea
                  name={k.key}
                  defaultValue={contents[k.key] ?? ""}
                  rows={4}
                  style={{ ...inputStyle, width: "100%", resize: "vertical" }}
                />
              ) : (
                <input
                  name={k.key}
                  defaultValue={contents[k.key] ?? ""}
                  style={{ ...inputStyle, width: "100%" }}
                />
              )}
            </label>
          ))}
        </div>
      ))}
      <button className="btn btn-gold" type="submit">
        保 存 文 案
      </button>
    </form>
  );
}

function RenderMembers({
  users,
  me,
  pendingPapers,
}: {
  users: any[];
  me: any;
  pendingPapers: any[];
}) {
  const paperCount = (uid: number) => pendingPapers.filter((p) => p.author_id === uid).length;
  return (
    <div className="card" style={{ padding: "10px 18px", overflowX: "auto" }}>
      <table className="tbl-admin">
        <thead>
          <tr>
            <th>学者</th>
            <th>身阶</th>
            <th>证印</th>
            <th>状态</th>
            <th>待审稿</th>
            <th>行动</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={u.status !== "active" ? { opacity: 0.62 } : undefined}>
              <td>
                <Link href={`/users/${u.username}`} style={{ fontWeight: 700 }}>
                  {u.display_name}
                </Link>
                {u.root === 1 && <span className="badge badge-admin" style={{ marginLeft: 6 }}>始祖</span>}
                {u.endorsed === 1 && <span className="badge" style={{ marginLeft: 6 }}>认证</span>}
                <div className="meta" style={{ fontSize: 12.5 }}>
                  @{u.username}
                  {u.banned_reason ? ` · ${u.banned_reason}` : ""}
                </div>
              </td>
              <td>
                <RoleSelect userId={u.id} current={u.role} isSelf={u.id === me.id} />
              </td>
              <td>
                <EndorseToggle userId={u.id} endorsed={u.endorsed} />
              </td>
              <td>
                <span className={u.status === "active" ? "badge" : u.status === "banned" ? "badge badge-danger" : "badge badge-dim"}>
                  {u.status === "active" ? "在籍" : u.status === "banned" ? "已封" : "除籍"}
                </span>
              </td>
              <td>{u.status === "active" ? paperCount(u.id) : "—"}</td>
              <td>
                <StatusButtons userId={u.id} status={u.status} isSelf={u.id === me.id} />
                {u.id !== me.id && (
                  <span style={{ marginLeft: 8 }}>
                    <DeleteButtons kind="user" id={u.id} label={`学者 ${u.display_name} 及其文章`} />
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RenderAudit({ audit }: { audit: ReturnType<typeof listAudit> }) {
  return (
    <div className="card" style={{ padding: "8px 18px" }}>
      {audit.length === 0 && <p className="empty-note">尚无记录。</p>}
      {audit.map((a) => (
        <div className="item" key={a.id} style={{ fontSize: 13.5 }}>
          <code style={{ color: "var(--maroon)", flex: "0 0 150px" }}>
            {a.action}
          </code>
          <span style={{ flex: 1, minWidth: 0 }}>
            {a.target}
            {a.detail ? <span style={{ color: "var(--ink-soft)" }}> —— {a.detail}</span> : null}
          </span>
          <span className="meta" style={{ flex: "0 0 150px", textAlign: "right" }}>
            {a.actor ?? "·"} · {timeAgo(a.created_at)}
          </span>
        </div>
      ))}
    </div>
  );
}
