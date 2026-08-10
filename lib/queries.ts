import {
  db,
  userMapper,
  type SafeUser,
  type Paper,
  type PaperAuthor,
  type ReviewEvent,
  type Thread,
  type Reply,
  type Invite,
  type AuditEntry,
  type Report,
  type Announcement,
} from "./db";

export interface ScholarStat extends SafeUser {
  paper_count: number;
  total_views: number;
  score: number;
  last_activity: string;
}

export function getRanking(limit = 50): ScholarStat[] {
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.motto, u.status AS user_status,
              u.banned_reason, u.endorsed, u.root, u.created_at,
              COUNT(p.id) AS paper_count,
              COALESCE(SUM(p.views), 0) AS total_views,
              (COUNT(p.id) * 20 + COALESCE(SUM(p.views), 0)) AS score,
              COALESCE(MAX(p.created_at), u.created_at) AS last_activity
       FROM users u
       LEFT JOIN papers p ON p.author_id = u.id AND p.status = 'published'
       GROUP BY u.id
       ORDER BY score DESC, paper_count DESC, u.id ASC
       LIMIT ?`,
    )
    .all(limit)
    .map((r: any) => ({
      ...toAuthor(r),
      paper_count: r.paper_count,
      total_views: r.total_views,
      score: r.score,
      last_activity: r.last_activity,
    }));
}

export function listPapers(opts: { discipline?: string; q?: string } = {}): (Paper & { author: SafeUser })[] {
  let sql = `SELECT p.*, u.username, u.display_name, u.role, u.motto, u.status AS user_status, u.created_at AS user_created_at
             FROM papers p JOIN users u ON u.id = p.author_id
             WHERE p.status = 'published'`;
  const conds: string[] = [];
  const params: any[] = [];
  if (opts.discipline) {
    conds.push("p.discipline = ?");
    params.push(opts.discipline);
  }
  if (opts.q) {
    conds.push("(p.title LIKE ? OR p.abstract LIKE ? OR p.content LIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  if (conds.length) sql += " AND " + conds.join(" AND ");
  sql += " ORDER BY p.created_at DESC, p.id DESC";
  return db
    .prepare(sql)
    .all(...params)
    .map((r: any) => ({ ...rowToPaper(r), author: toAuthor(r) }));
}

export function listPapersByAuthor(userId: number, opts: { includePending?: boolean } = {}): (Paper & { author: SafeUser })[] {
  let sql = `SELECT p.*, u.username, u.display_name, u.role, u.motto, u.status AS user_status, u.created_at AS user_created_at
             FROM papers p JOIN users u ON u.id = p.author_id
             WHERE p.author_id = ?`;
  if (!opts.includePending) sql += " AND p.status = 'published'";
  sql += " ORDER BY p.created_at DESC, p.id DESC";
  return db
    .prepare(sql)
    .all(userId)
    .map((r: any) => ({ ...rowToPaper(r), author: toAuthor(r) }));
}

function toAuthor(r: any): SafeUser {
  return {
    id: r.author_id ?? r.id,
    username: r.username,
    display_name: r.display_name,
    role: r.role,
    motto: r.motto,
    status: r.user_status ?? r.status ?? "active",
    banned_reason: r.banned_reason || "",
    endorsed: r.endorsed || 0,
    root: r.root || 0,
    created_at: r.user_created_at ?? r.created_at,
  };
}

export function listThreads(opts: { category?: string } = {}): (Thread & { author: SafeUser; reply_count: number })[] {
  let sql = `SELECT t.*, u.username, u.display_name, u.role, u.motto, u.status AS user_status, u.banned_reason, u.endorsed, u.root, u.created_at AS user_created_at,
                    (SELECT COUNT(*) FROM replies r WHERE r.thread_id = t.id) AS reply_count
             FROM threads t JOIN users u ON u.id = t.author_id`;
  const params: any[] = [];
  if (opts.category) {
    sql += " WHERE t.category = ?";
    params.push(opts.category);
  }
  sql += " ORDER BY t.created_at DESC, t.id DESC";
  return db
    .prepare(sql)
    .all(...params)
    .map((r: any) => ({
      id: r.id,
      author_id: r.author_id,
      title: r.title,
      content: r.content,
      category: r.category,
      created_at: r.created_at,
      reply_count: r.reply_count,
      author: toAuthor(r),
    }));
}

export function getThread(id: number): (Thread & { author: SafeUser; replies: (Reply & { author: SafeUser })[] }) | null {
  const t = db.prepare("SELECT * FROM threads WHERE id = ?").get(id) as any;
  if (!t) return null;
  const author = db.prepare("SELECT * FROM users WHERE id = ?").get(t.author_id) as any;
  const replies = db
    .prepare(
      `SELECT r.*, u.username, u.display_name, u.role, u.motto, u.status AS user_status, u.banned_reason, u.endorsed, u.root, u.created_at AS user_created_at
       FROM replies r JOIN users u ON u.id = r.author_id
       WHERE r.thread_id = ? ORDER BY r.created_at ASC, r.id ASC`,
    )
    .all(id);
  return {
    id: t.id,
    author_id: t.author_id,
    title: t.title,
    content: t.content,
    category: t.category,
    created_at: t.created_at,
    author: toAuthor({ ...author, author_id: author.id }),
    replies: replies.map((r: any) => ({
      id: r.id,
      thread_id: r.thread_id,
      author_id: r.author_id,
      content: r.content,
      created_at: r.created_at,
      author: toAuthor(r),
    })),
  };
}

export function getPaper(id: number): (Paper & { author: SafeUser; authors: PaperAuthor[] }) | null {
  const p = db.prepare("SELECT * FROM papers WHERE id = ?").get(id) as any;
  if (!p) return null;
  const a = db.prepare("SELECT * FROM users WHERE id = ?").get(p.author_id) as any;
  return {
    id: p.id,
    author_id: p.author_id,
    title: p.title,
    discipline: p.discipline,
    abstract: p.abstract,
    content: p.content,
    status: p.status,
    reject_reason: p.reject_reason,
    manuscript_code: p.manuscript_code || "",
    short_title: p.short_title || "",
    keywords: p.keywords || "",
    funding: p.funding || "",
    cover_letter: p.cover_letter || "",
    decision_note: p.decision_note || "",
    views: p.views,
    accepted_at: p.accepted_at || null,
    published_at: p.published_at || null,
    created_at: p.created_at,
    updated_at: p.updated_at || p.created_at,
    author: {
      id: a.id,
      username: a.username,
      display_name: a.display_name,
      role: a.role,
      motto: a.motto,
      status: a.status,
      banned_reason: a.banned_reason,
      endorsed: a.endorsed,
      root: a.root,
      created_at: a.created_at,
    },
    authors: paperAuthors(p.id),
  };
}

// ==================== 燕京阁查询 ====================

export function listReviewQueue() {
  return db
    .prepare(
      `SELECT p.*, u.username, u.display_name, u.role, u.motto, u.status AS user_status, u.created_at AS user_created_at
       FROM papers p JOIN users u ON u.id = p.author_id
       WHERE p.status <> 'published' ORDER BY p.created_at ASC`,
    )
    .all()
    .map((r: any) => ({ ...rowToPaper(r), author: toAuthor(r) }));
}

export function listInvites(): (Invite & { creator_name: string })[] {
  return db
    .prepare(
      `SELECT i.*, u.display_name AS creator_name
       FROM invites i JOIN users u ON u.id = i.created_by
       ORDER BY i.id DESC`,
    )
    .all()
    .map((r: any) => ({
      id: r.id,
      kind: r.kind,
      code: r.code,
      uses_left: r.uses_left,
      total_uses: r.total_uses,
      note: r.note,
      created_by: r.created_by,
      revoked: r.revoked,
      expires_at: r.expires_at,
      created_at: r.created_at,
      creator_name: r.creator_name,
    }));
}

export function listAudit(limit = 60): (AuditEntry & { actor: string | null })[] {
  return db
    .prepare(
      `SELECT a.*, u.display_name AS actor_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(limit)
    .map((r: any) => ({
      id: r.id,
      actor_id: r.actor_id,
      action: r.action,
      target: r.target,
      detail: r.detail,
      created_at: r.created_at,
      actor: r.actor_name ?? null,
    }));
}

export function listReports(): (Report & { reporter_name: string })[] {
  return db
    .prepare(
      `SELECT r.*, u.display_name AS reporter_name
       FROM reports r JOIN users u ON u.id = r.reporter_id
       ORDER BY (r.status = 'open') DESC, r.id DESC LIMIT 50`,
    )
    .all()
    .map((r: any) => ({
      id: r.id,
      kind: r.kind,
      target_id: r.target_id,
      reporter_id: r.reporter_id,
      reporter_name: r.reporter_name,
      reason: r.reason,
      status: r.status,
      resolved_by: r.resolved_by,
      resolved_at: r.resolved_at,
      created_at: r.created_at,
    }));
}

export function getAnnouncement(): Announcement | null {
  const row = db
    .prepare("SELECT * FROM announcements WHERE active = 1 ORDER BY id DESC LIMIT 1")
    .get() as any;
  return row ?? null;
}

export function listAnnouncements(): Announcement[] {
  return db
    .prepare("SELECT * FROM announcements ORDER BY id DESC")
    .all() as any[];
}

function rowToPaper(r: any) {
  return {
    id: r.id,
    author_id: r.author_id,
    title: r.title,
    discipline: r.discipline,
    abstract: r.abstract,
    content: r.content,
    status: r.status,
    reject_reason: r.reject_reason,
    manuscript_code: r.manuscript_code || "",
    short_title: r.short_title || "",
    keywords: r.keywords || "",
    funding: r.funding || "",
    cover_letter: r.cover_letter || "",
    decision_note: r.decision_note || "",
    views: r.views,
    accepted_at: r.accepted_at || null,
    published_at: r.published_at || null,
    created_at: r.created_at,
    updated_at: r.updated_at || r.created_at,
  };
}

export function paperAuthors(paperId: number): PaperAuthor[] {
  return db
    .prepare(
      "SELECT * FROM paper_authors WHERE paper_id = ? ORDER BY author_order ASC, id ASC",
    )
    .all(paperId) as PaperAuthor[];
}

export function listReviewEvents(paperId: number): ReviewEvent[] {
  return db
    .prepare(
      "SELECT * FROM review_events WHERE paper_id = ? ORDER BY created_at ASC, id ASC",
    )
    .all(paperId) as ReviewEvent[];
}

export function reviewEventsWithActor(paperId: number): (ReviewEvent & { actor_name: string | null })[] {
  return db
    .prepare(
      `SELECT e.*, u.display_name AS actor_name
       FROM review_events e LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.paper_id = ? ORDER BY e.created_at ASC, e.id ASC`,
    )
    .all(paperId) as any[];
}