import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "schola.db"));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

export type Role = "admin" | "scholar";

export interface User {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: Role;
  motto: string;
  email: string;
  status: "active" | "banned" | "retired";
  endorsed: number;
  banned_reason: string;
  root: number;
  /** 墨银余额（冗余快查；唯一真源是 coin_ledger 账本） */
  coin_balance: number;
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
  /** 累积收到的墨银（投出即焚，此处只是计数，不等于任何人的余额） */
  tips: number;
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
  /** 'human' = 人写的；'ai' = 学正应请出者之请给出的点评（author_id 记请出者）。 */
  kind: "human" | "ai";
  created_at: string;
}

export interface Session {
  id: number;
  user_id: number;
  token: string;
  expires_at: string;
}

export interface Message {
  id: number;
  sender_id: number | null; // NULL 表示系统消息
  receiver_id: number;
  body: string;
  kind: "pm" | "system";
  read: number;
  created_at: string;
}

export interface Notification {
  id: number;
  owner_id: number; // 收件人（论题作者）
  kind: "thread_reply";
  thread_id: number;
  last_reply_id: number | null; // 最新一条回应（被删则 SET NULL）
  last_actor_id: number | null;
  actors: string; // 逗号分隔的回应者名快照（最多 5 个，取最近的）
  count: number; // 本条聚合的回应条数
  excerpt: string; // 最新辩辞摘要
  read: number;
  created_at: string;
  updated_at: string;
}

export interface Certification {
  id: number;
  requester_id: number;
  responder_id: number;
  status: "pending" | "accepted" | "declined";
  created_at: string;
  responded_at: string | null;
}

export interface UsernameChange {
  id: number;
  requester_id: number;
  old_username: string;
  new_username: string;
  reason: string;
  status: "pending" | "approved" | "declined";
  responded_by: number | null;
  responded_at: string | null;
  response_note: string;
  created_at: string;
}

export interface UsernameClaim {
  userId: number;
  currentUsername: string;
  source: "current" | "history";
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
      coin_balance  INTEGER NOT NULL DEFAULT 0,
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
      tips          INTEGER NOT NULL DEFAULT 0,
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
      -- 'human' 为人写的回复；'ai' 为学正（AI）应某人之请给出的点评。
      -- AI 回复的 author_id 记「请出者」（发起召唤的真人），故仍指向真实用户行，
      -- getThread 的 INNER JOIN 天然成立，也不必为用户表添一个合成账号。
      kind       TEXT NOT NULL DEFAULT 'human' CHECK (kind IN ('human','ai')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_replies_thread ON replies(thread_id, created_at);

    -- 学正（AI）点评任务：召唤时先落一条 pending，由客户端小件触发 /api/ai/run 领取执行，
    -- 跑完再写一条 kind='ai' 的回复并把结果回填到本表（answer/用量）。
    -- 异步而非同步：一次点评要 20–40 秒，而 Cloudflare 隧道对长请求约 100 秒上限。
    CREATE TABLE IF NOT EXISTS ai_calls (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id     INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      -- reply_id = 学正写出的那条回复（跑完回填）；source_reply_id = 召唤它的那条人类回复（留痕用）
      reply_id      INTEGER REFERENCES replies(id) ON DELETE SET NULL,
      source_reply_id INTEGER REFERENCES replies(id) ON DELETE SET NULL,
      requester_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      paper_id      INTEGER REFERENCES papers(id) ON DELETE SET NULL,
      question      TEXT NOT NULL DEFAULT '',
      -- failed = 可重试（上游故障/超时）；refused = 不可重试（未刊之稿不外送之类，
      -- 点一百次也一样）。两者分开，界面才不会给用户一个永远点不成的「再请一次」。
      status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','done','failed','refused')),
      answer        TEXT NOT NULL DEFAULT '',
      error         TEXT NOT NULL DEFAULT '',
      model         TEXT NOT NULL DEFAULT '',
      prompt_tokens     INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_calls_thread ON ai_calls(thread_id, status, created_at);

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

    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body        TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'pm' CHECK (kind IN ('pm','system')),
      read        INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, read);
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(sender_id, receiver_id, created_at);

    -- 论辩回应提醒：自己的论题被人回复时生成一条（kind 目前仅 'thread_reply'，
    -- 刻意不加 CHECK —— 日后要加 'mention' / 'cite' 之类新类别时无需重建表）。
    -- 未读期间同一帖只留一条：count 累加、actors 记名、excerpt 更新为最新辩辞；
    -- 作者读过之后再来的新回复才另起一条，免得热帖把讯息栏刷屏。
    CREATE TABLE IF NOT EXISTS notifications (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind          TEXT NOT NULL DEFAULT 'thread_reply',
      thread_id     INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      last_reply_id INTEGER REFERENCES replies(id) ON DELETE SET NULL,
      last_actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actors        TEXT NOT NULL DEFAULT '',
      count         INTEGER NOT NULL DEFAULT 1,
      excerpt       TEXT NOT NULL DEFAULT '',
      read          INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_owner ON notifications(owner_id, read, updated_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_thread ON notifications(thread_id);

    -- 同侪互证：类似互相关注的成对关系。两人互证（存在 accepted 的 (A,B) 或 (B,A)）方可无限私信。
    CREATE TABLE IF NOT EXISTS certifications (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      responder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      responded_at TEXT,
      UNIQUE (requester_id, responder_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cert_responder ON certifications(responder_id, status);
    CREATE INDEX IF NOT EXISTS idx_cert_requester ON certifications(requester_id, status);

    CREATE TABLE IF NOT EXISTS login_attempts (
      ip         TEXT NOT NULL,
      username   TEXT NOT NULL,
      count      INTEGER NOT NULL DEFAULT 1,
      window_end TEXT NOT NULL,
      PRIMARY KEY (ip, username)
    );

    -- 通用固定窗口限流。存入 SQLite，避免进程重启或重新部署后计数清零。
    CREATE TABLE IF NOT EXISTS rate_limit_windows (
      key        TEXT PRIMARY KEY,
      count      INTEGER NOT NULL DEFAULT 1,
      window_end INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rate_limit_window_end ON rate_limit_windows(window_end);

    -- 用户名改名：用户提交申请，掌门审核通过后执行改名（申请审核制）
    CREATE TABLE IF NOT EXISTS username_changes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      old_username  TEXT NOT NULL,
      new_username  TEXT NOT NULL,
      reason        TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
      responded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      responded_at  TEXT,
      response_note TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_username_changes_requester ON username_changes(requester_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_username_changes_status ON username_changes(status, id);

    -- 曾用名：改名后旧链接（/users/旧名）可重定向到新名册
    CREATE TABLE IF NOT EXISTS username_history (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      old_username TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_username_history_old ON username_history(old_username);
    CREATE INDEX IF NOT EXISTS idx_username_history_old_nocase ON username_history(lower(old_username));
  `);

  // ---- 轻量迁移（老库补列） ----
  const cols = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name);

  const hasTable = (table: string) =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

  const addCol = (table: string, col: string, ddl: string) => {
    // 表还没建就跳过：PRAGMA table_info 对不存在的表返回空数组，照原逻辑会去
    // ALTER 一张不存在的表 → 抛 no such table → 整个 initSchema 中断，后段所有
    // 建表/迁移全部不执行（全新库部署时踩过：附件表补列写在了建表语句之前）。
    // 跳过是安全的——本函数后段以 CREATE TABLE IF NOT EXISTS 建完整表兜底。
    if (!hasTable(table)) return;
    if (!cols(table).includes(col)) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
      } catch (e: any) {
        // 容忍并发/重复执行时的「duplicate column name」（如 Next 构建期多路由并发导入本模块，
        // 各自开连接跑迁移，一方提交后另一方再 ALTER 即报重复）。已是幂等安全，忽略即可。
        if (!/duplicate column/i.test(e?.message ?? "")) throw e;
      }
    }
  };
  addCol("users", "status", "status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned','retired'))");
  addCol("users", "banned_reason", "banned_reason TEXT NOT NULL DEFAULT ''");
  addCol("users", "endorsed", "endorsed INTEGER NOT NULL DEFAULT 0");
  addCol("users", "root", "root INTEGER NOT NULL DEFAULT 0");
  addCol("users", "email", "email TEXT NOT NULL DEFAULT ''");
  addCol("users", "coin_balance", "coin_balance INTEGER NOT NULL DEFAULT 0");
  addCol("papers", "status", "status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('pending','published','rejected'))");
  addCol("papers", "reject_reason", "reject_reason TEXT NOT NULL DEFAULT ''");
  // 墨银「获币数」。注意：本行写在下方 papers 表重建之前，故**重建用的 papers_new
  // DDL 里也必须带 tips 列**——否则全新库会先补列、再被重建抹掉，运行时 no such column。
  addCol("papers", "tips", "tips INTEGER NOT NULL DEFAULT 0");
  // 学正（AI）回复标记：老库的 replies 无此列（seed.mjs 亦以旧形 DDL 建表），缺则补
  addCol("replies", "kind", "kind TEXT NOT NULL DEFAULT 'human'");

  // ---- 迁移：用户名不区分大小写唯一 ----
  // 原 UNIQUE 约束区分大小写（"Rector" 与 "rector" 可并存），有人可借大小写变体取
  // 他人同名卡名/冒名。先给历史库中后注册的大小写同名账号追加 #N 后缀去重，
  // 再建 lower(username) 唯一索引（SQLite lower() 仅折叠 ASCII，中文名不受影响）。
  const caseDups = db
    .prepare("SELECT lower(username) AS lu FROM users GROUP BY lu HAVING COUNT(*) > 1")
    .all() as { lu: string }[];
  for (const d of caseDups) {
    const rows = db
      .prepare("SELECT id, username FROM users WHERE lower(username) = ? ORDER BY id")
      .all(d.lu) as { id: number; username: string }[];
    for (let i = 1; i < rows.length; i++) {
      const base = rows[i].username.slice(0, 16);
      let n = i + 1;
      let name = `${base}#${n}`;
      while (
        db.prepare("SELECT 1 FROM users WHERE lower(username) = lower(?)").get(name)
      ) {
        n += 1;
        name = `${base}#${n}`;
      }
      db.prepare("UPDATE users SET username = ? WHERE id = ?").run(name, rows[i].id);
    }
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users(lower(username))");

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
        tips            INTEGER NOT NULL DEFAULT 0,
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
  // 论文附件：文件本体落盘 data/attachments/（持久卷），此处存元数据。
  // stored_name 为服务端生成的随机名（att_<hex>.<ext>），展示名与 MIME 存库。
  db.exec(`
    CREATE TABLE IF NOT EXISTS paper_attachments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id     INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      file_name    TEXT NOT NULL,
      stored_name  TEXT NOT NULL UNIQUE,
      ext          TEXT NOT NULL,
      mime         TEXT NOT NULL,
      size         INTEGER NOT NULL,
      uploaded_by  INTEGER NOT NULL REFERENCES users(id),
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_paper_attachments ON paper_attachments(paper_id);`);
  // 附件表护栏（须在建表之后）：scripts/seed.mjs 可能以旧形 DDL 先建表
  // （全新库先 seed 后首启），此处缺列即补，防两处 DDL 漂移后运行时「no such column」。
  addCol("paper_attachments", "file_name", "file_name TEXT NOT NULL DEFAULT ''");
  addCol("paper_attachments", "stored_name", "stored_name TEXT NOT NULL DEFAULT ''");
  addCol("paper_attachments", "ext", "ext TEXT NOT NULL DEFAULT ''");
  addCol("paper_attachments", "mime", "mime TEXT NOT NULL DEFAULT ''");
  addCol("paper_attachments", "size", "size INTEGER NOT NULL DEFAULT 0");
  addCol("paper_attachments", "uploaded_by", "uploaded_by INTEGER NOT NULL DEFAULT 0");
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

  // 墨银账本：一张表同时承担「领取记录」「投币明细」「余额流水」三职（轻量化：不另建表）。
  // 余额另以 users.coin_balance 冗余存一份供快查，本表是唯一真源。
  db.exec(`
    CREATE TABLE IF NOT EXISTS coin_ledger (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,
      amount     INTEGER NOT NULL,
      paper_id   INTEGER REFERENCES papers(id) ON DELETE SET NULL,
      day        TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // 每日领取的硬闸：同一人同一天至多一条 daily 记录——靠数据库唯一索引保证，
  // 不靠前端禁用、也不靠先查后写（并发下先查后写必漏）。kind 刻意不加 CHECK 约束，
  // 日后加新类型（如「评议赠币」）无需迁移。
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_coin_daily ON coin_ledger(user_id, day) WHERE kind = 'daily'`,
  );
  // 「我在某篇稿上已投几枚」与「某篇稿收了多少」两处查法
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_coin_tip ON coin_ledger(user_id, paper_id) WHERE kind = 'tip'`,
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_coin_paper ON coin_ledger(paper_id);`);

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

  // 创始人归一化：历史曾因列默认值异常导致全员 root=1（青衫事件暴露）。
  // 优先锁定 rector；老库没有 rector 时才退回最早注册者。修复与唯一索引在
  // 同一事务内完成，避免部署过程中短暂出现多个受保护账号。
  const repairSingleFounder = db.transaction(() => {
    const founder = db.prepare(`
      SELECT id
      FROM users
      ORDER BY CASE WHEN username = 'rector' THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `).get() as { id: number } | undefined;

    if (!founder) {
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_root ON users(root) WHERE root = 1");
      return;
    }

    const cleared = db.prepare("UPDATE users SET root = 0 WHERE id != ? AND root != 0").run(founder.id);
    const restored = db.prepare("UPDATE users SET root = 1, role = 'admin' WHERE id = ? AND (root != 1 OR role != 'admin')").run(founder.id);
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_root ON users(root) WHERE root = 1");

    if (cleared.changes > 0 || restored.changes > 0) {
      db.prepare(`
        INSERT INTO audit_log (actor_id, action, target, detail)
        VALUES (NULL, 'security.root_repair', 'users', ?)
      `).run(`清除 ${cleared.changes} 个多余始祖标记，恢复唯一始祖 user#${founder.id}`);
    }
  });
  repairSingleFounder();
}

initSchema();

/**
 * Find who owns a username, including retained former usernames.
 * Current names take precedence only for compatibility with legacy data that may
 * already contain a collision; new registrations and renames prevent new ones.
 */
export function findUsernameClaim(username: string): UsernameClaim | null {
  const current = db
    .prepare("SELECT id, username FROM users WHERE lower(username) = lower(?) LIMIT 1")
    .get(username) as { id: number; username: string } | undefined;
  if (current) {
    return {
      userId: current.id,
      currentUsername: current.username,
      source: "current",
    };
  }

  // The earliest history entry is the original owner. This also makes legacy
  // duplicate history rows deterministic instead of letting a later row hijack it.
  const historical = db
    .prepare(
      `SELECT h.user_id, u.username
       FROM username_history h
       JOIN users u ON u.id = h.user_id
       WHERE lower(h.old_username) = lower(?)
       ORDER BY h.id ASC
       LIMIT 1`,
    )
    .get(username) as { user_id: number; username: string } | undefined;
  if (!historical) return null;
  return {
    userId: historical.user_id,
    currentUsername: historical.username,
    source: "history",
  };
}

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
  email: row.email ?? "",
  status: row.status,
  banned_reason: row.banned_reason,
  endorsed: row.endorsed,
  root: row.root,
  coin_balance: row.coin_balance ?? 0,
  created_at: row.created_at,
});

/** 生成稿件编号：SCHOLA-年份-当年序号（如 SCHOLA-2026-0007） */
export function nextManuscriptCode(year: number): string {
  const prefix = `SCHOLA-${year}-`;
  const row = db
    .prepare(
      "SELECT MAX(CAST(substr(manuscript_code, ?) AS INTEGER)) AS max_seq FROM papers WHERE manuscript_code GLOB ?",
    )
    .get(prefix.length + 1, `${prefix}[0-9]*`) as { max_seq: number | null };
  const next = (row.max_seq ?? 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}
