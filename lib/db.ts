import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "schola.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export type Role = "admin" | "scholar";

export interface User {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: Role;
  motto: string;
  status: "active" | "banned" | "retired";
  endorsed: number;
  banned_reason: string;
  root: number;
  created_at: string;
}

export type PaperStatus =
  | "submitted"
  | "in_review"
  | "revision"
  | "accepted"
  | "published"
  | "rejected";

export interface Paper {
  id: number;
  author_id: number;
  title: string;
  discipline: string;
  abstract: string;
  content: string;
  status: PaperStatus;
  reject_reason: string;
  manuscript_code: string;
  short_title: string;
  keywords: string;
  funding: string;
  cover_letter: string;
  decision_note: string;
  views: number;
  accepted_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaperAuthor {
  id: number;
  paper_id: number;
  display_name: string;
  affiliation: string;
  email: string;
  orcid: string;
  is_corresponding: number;
  author_order: number;
}

export interface ReviewEvent {
  id: number;
  paper_id: number;
  from_status: string | null;
  to_status: string | null;
  note: string;
  actor_id: number | null;
  created_at: string;
}

export interface Invite {
  id: number;
  kind: "admin";
  code: string;
  uses_left: number;
  total_uses: number;
  note: string;
  created_by: number;
  revoked: number;
  expires_at: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  actor_id: number | null;
  action: string;
  target: string;
  detail: string;
  created_at: string;
}

export interface Report {
  id: number;
  kind: "thread" | "reply" | "paper";
  target_id: number;
  reporter_id: number;
  reason: string;
  status: "open" | "resolved";
  resolved_by: number | null;
  resolved_at: string | null;
  created_at: string;
}

export interface Announcement {
  id: number;
  title: string;
  content: string;
  pinned: boolean;
  active: boolean;
  created_by: number;
  created_at: string;
}

export interface Thread {
  id: number;
  author_id: number;
  title: string;
  content: string;
  category: string;
  created_at: string;
}

export interface Reply {
  id: number;
  thread_id: number;
  author_id: number;
  content: string;
  created_at: string;
}

export interface Session {
  id: number;
  user_id: number;
  token: string;
  expires_at: string;
}

export const FORUM_CATEGORIES = [
  "学术交流",
  "冷食哲学",
  "经典导读",
  "考古实录",
  "学派事务",
  "闲话长廊",
] as const;

export const DISCIPLINES = [
  "乳脂哲学",
  "感官美学",
  "美食人类学",
  "冷藏物理学",
  "古文钞本",
  "学派史",
] as const;

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      display_name  TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'scholar' CHECK (role IN ('admin','scholar')),
      motto         TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned','retired')),
      banned_reason TEXT NOT NULL DEFAULT '',
      endorsed      INTEGER NOT NULL DEFAULT 0,
      root          INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS papers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      discipline    TEXT NOT NULL DEFAULT '乳脂哲学',
      abstract      TEXT NOT NULL DEFAULT '',
      content       TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
      reject_reason TEXT NOT NULL DEFAULT '',
      views         INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_papers_author ON papers(author_id);
    CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(status);

    CREATE TABLE IF NOT EXISTS threads (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL,
      category   TEXT NOT NULL DEFAULT '学术交流',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_threads_category ON threads(category);

    CREATE TABLE IF NOT EXISTS replies (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id  INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invites (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT NOT NULL DEFAULT 'admin' CHECK (kind IN ('admin','scholar')),
      code       TEXT NOT NULL UNIQUE,
      uses_left  INTEGER NOT NULL DEFAULT 1,
      total_uses INTEGER NOT NULL DEFAULT 1,
      note       TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL REFERENCES users(id),
      revoked    INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action     TEXT NOT NULL,
      target     TEXT NOT NULL DEFAULT '',
      detail     TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reports (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      kind         TEXT NOT NULL CHECK (kind IN ('thread','reply','paper')),
      target_id    INTEGER NOT NULL,
      reporter_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
      resolved_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      resolved_at  TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL,
      pinned     INTEGER NOT NULL DEFAULT 0,
      active     INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS site_content (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL DEFAULT '',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      ip         TEXT NOT NULL,
      username   TEXT NOT NULL,
      count      INTEGER NOT NULL DEFAULT 1,
      window_end TEXT NOT NULL,
      PRIMARY KEY (ip, username)
    );
  `);

  // ---- 轻量迁移（老库补列） ----
  const cols = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name);

  const addCol = (table: string, col: string, ddl: string) => {
    if (!cols(table).includes(col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  };
  addCol("users", "status", "status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned','retired'))");
  addCol("users", "banned_reason", "banned_reason TEXT NOT NULL DEFAULT ''");
  addCol("users", "endorsed", "endorsed INTEGER NOT NULL DEFAULT 0");
  addCol("users", "root", "root INTEGER NOT NULL DEFAULT 0");
  addCol("papers", "status", "status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('pending','published','rejected'))");
  addCol("papers", "reject_reason", "reject_reason TEXT NOT NULL DEFAULT ''");

  // 将旧论文表升级为专业期刊模型（补列 + 扩展状态机），一次性重建
  if (!cols("papers").includes("manuscript_code")) {
    db.exec(`DROP TABLE IF EXISTS papers_new;`);
    db.exec(`
      CREATE TABLE papers_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title           TEXT NOT NULL,
        discipline      TEXT NOT NULL DEFAULT '乳脂哲学',
        abstract        TEXT NOT NULL DEFAULT '',
        content         TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'submitted'
                          CHECK (status IN ('submitted','in_review','revision','accepted','published','rejected')),
        reject_reason   TEXT NOT NULL DEFAULT '',
        manuscript_code TEXT NOT NULL DEFAULT '',
        short_title     TEXT NOT NULL DEFAULT '',
        keywords        TEXT NOT NULL DEFAULT '',
        funding         TEXT NOT NULL DEFAULT '',
        cover_letter    TEXT NOT NULL DEFAULT '',
        decision_note   TEXT NOT NULL DEFAULT '',
        views           INTEGER NOT NULL DEFAULT 0,
        accepted_at     TEXT,
        published_at    TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.exec(`
      INSERT INTO papers_new
        (id, author_id, title, discipline, abstract, content, status, reject_reason, views, created_at)
      SELECT id, author_id, title, discipline, abstract, content,
             CASE WHEN status = 'pending' THEN 'submitted' ELSE status END,
             reject_reason, views, created_at
      FROM papers;
    `);
    db.exec(`DROP TABLE papers;`);
    db.exec(`ALTER TABLE papers_new RENAME TO papers;`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_papers_author ON papers(author_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(status);`);
  }

  // 多作者署名 + 审稿事件时间线
  db.exec(`
    CREATE TABLE IF NOT EXISTS paper_authors (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id        INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      display_name    TEXT NOT NULL,
      affiliation     TEXT NOT NULL DEFAULT '',
      email           TEXT NOT NULL DEFAULT '',
      orcid           TEXT NOT NULL DEFAULT '',
      is_corresponding INTEGER NOT NULL DEFAULT 0,
      author_order    INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id    INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status   TEXT,
      note        TEXT NOT NULL DEFAULT '',
      actor_id    INTEGER,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_paper_authors ON paper_authors(paper_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_review_events ON review_events(paper_id, created_at);`);

  // 幂等回填：旧稿无 manuscript_code 者补编号（用于稿号展示与引用块）
  db.exec(
    `UPDATE papers SET manuscript_code = 'MS-' || substr(created_at,1,4) || '-' || printf('%04d', id)
     WHERE (manuscript_code IS NULL OR manuscript_code = '') AND id > 0;`,
  );

  // login_attempts 结构以本文件为准（旧版种子创建了异形表时重建）
  const laCols = cols("login_attempts");
  if (laCols.length > 0 && !laCols.includes("count")) {
    db.exec("DROP TABLE login_attempts");
  }

  // 老库中已有论文视为已认证直刊（出生即正典）
  db.prepare("UPDATE users SET root = 1 WHERE id = (SELECT MIN(id) FROM users) AND root = 0").run();
}

initSchema();

export type SafeUser = Omit<User, "password_hash">;

export function toSafeUser(u: User): SafeUser {
  const { password_hash: _pw, ...rest } = u;
  return rest;
}

export const userMapper = (row: any): SafeUser => ({
  id: row.id,
  username: row.username,
  display_name: row.display_name,
  role: row.role,
  motto: row.motto,
  status: row.status,
  banned_reason: row.banned_reason,
  endorsed: row.endorsed,
  root: row.root,
  created_at: row.created_at,
});

/** 生成稿件编号：SCHOLA-年份-当年序号（如 SCHOLA-2026-0007） */
export function nextManuscriptCode(year: number): string {
  const cnt = (
    db.prepare("SELECT COUNT(*) AS c FROM papers WHERE strftime('%Y', created_at) = ?").get(String(year)) as any
  ).c;
  return `SCHOLA-${year}-${String(cnt + 1).padStart(4, "0")}`;
}