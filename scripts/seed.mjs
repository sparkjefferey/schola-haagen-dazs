import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync } from "node:crypto";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "schola.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

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
  CREATE TABLE IF NOT EXISTS threads (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT '学术交流',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS replies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id  INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS invites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL DEFAULT 'admin' CHECK (kind IN ('admin','scholar')),
    code        TEXT NOT NULL UNIQUE,
    uses_left   INTEGER NOT NULL DEFAULT 1,
    total_uses  INTEGER NOT NULL DEFAULT 1,
    note        TEXT NOT NULL DEFAULT '',
    created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    revoked     INTEGER NOT NULL DEFAULT 0,
    expires_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
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
    active     INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
CREATE TABLE IF NOT EXISTS login_attempts (
    ip         TEXT NOT NULL,
    username   TEXT NOT NULL,
    count      INTEGER NOT NULL DEFAULT 1,
    window_end TEXT NOT NULL,
    PRIMARY KEY (ip, username)
  );
`);

const hash = (pw) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
};

const cols = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const addCol = (table, col, ddl) => {
  if (!cols(table).includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
};
addCol("users", "status", "status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned','retired'))");
addCol("users", "banned_reason", "banned_reason TEXT NOT NULL DEFAULT ''");
addCol("users", "endorsed", "endorsed INTEGER NOT NULL DEFAULT 0");
addCol("users", "root", "root INTEGER NOT NULL DEFAULT 0");
addCol("papers", "status", "status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('pending','published','rejected'))");
addCol("papers", "reject_reason", "reject_reason TEXT NOT NULL DEFAULT ''");
db.prepare("UPDATE users SET root = 1 WHERE id = (SELECT MIN(id) FROM users) AND root = 0").run();

const ago = (days) =>
  new Date(Date.now() - days * 86400_000).toISOString().slice(0, 19).replace("T", " ");

const seedPassword = (name) => {
  const value = process.env[name];
  if (!value || value.length < 16) {
    throw new Error(`${name} 必须通过环境变量提供，且至少 16 个字符；不会使用公开默认口令。`);
  }
  return value;
};

const seedUsers = [
  { username: "rector", display_name: "馆长大人", role: "admin", pw: seedPassword("SEED_ADMIN_PW"), motto: "以乳求真，以勺存证", root: 1 },
  { username: "sokrates", display_name: "苏格拉雪", role: "scholar", pw: seedPassword("SEED_SOKRATES_PW"), motto: "我唯一所知，是我不甚知", root: 0 },
  { username: "plato", display_name: "柏拉图方", role: "scholar", pw: seedPassword("SEED_PLATO_PW"), motto: "甜可即席而尽，美则存乎一构", root: 0 },
];

const insertUser = db.prepare(
  "INSERT OR IGNORE INTO users (username, display_name, password_hash, role, motto, root, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
);

let created = 0;
for (const u of seedUsers) {
  const info = insertUser.run(u.username, u.display_name, hash(u.pw), u.role, u.motto, u.root === 1 ? 1 : 0, ago(3));
  created += info.changes;
  if (u.root === 1) {
    db.prepare("UPDATE users SET root = 1, role = 'admin' WHERE username = ?").run(u.username);
  }
}

const count = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
console.log(`✓ 用户：现有 ${count} 位（本轮新增 ${created}）`);

const papersOnly = db.prepare("SELECT COUNT(*) AS c FROM papers").get().c;
if (papersOnly === 0) {
  const ins = db.prepare(
    "INSERT INTO papers (author_id, title, discipline, abstract, content, status, views, created_at) VALUES (?, ?, ?, ?, ?, 'published', ?, ?)",
  );
  const insAuthor = db.prepare(
    "INSERT INTO paper_authors (paper_id, display_name, affiliation, email, orcid, is_corresponding, author_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const uid = (u) => db.prepare("SELECT id FROM users WHERE username = ?").get(u).id;
  const seedPapers = [
    {
      u: "sokrates",
      title: "论冷食之甜与知性之甘",
      disc: "乳脂哲学",
      abs: "本文试以冰淇淋的甜觉为喻，论证求知过程的『回甘』特性。",
      body: `## 一、缘起\n\n甜，是味觉中的哲学：它不欺人，也不可被长期欺骗。冷食之甜，尤其如此——从舌尖的凛冽到喉间的温存，呼吸之间完成一场小小的辨证。\n\n## 二、论证\n\n- 第一命题：凡有所刻苦，必有所回甘。\n- 第二命题：知识如冷食，须冷藏以待，出库即食为佳，久置则失其味。\n- 结论：治学与吃冰，皆不可急，亦不可缓。\n\n> 宇宙间最冷的地方，不是冷藏室，而是未思之脑。`,
      views: 132,
      days: 20,
    },
    {
      u: "plato",
      title: "一勺之间：柏拉图论感官的洞穴",
      disc: "感官美学",
      abs: "洞穴喻再释：若洞中人只见过甜，他如何理解苦？",
      body: `## 一、洞喻的冷食版\n\n柏拉图以洞穴喻感官之蔽。今余尝冰淇淋一匣，终夜不眠，乃知：感官的洞穴里，冰冻与甜味亦是可见的「影」。\n\n## 二、要旨\n\n- 甜是影子，回甘是正午的阳光。\n- 众人只见第一勺之甜，唯有哲人等到融化之后。\n\n故曰：论味而不论融，是只见影而不见光。`,
      views: 65,
      days: 11,
    },
    {
      u: "rector",
      title: "学派立学纪念文：从一罐到一馆",
      disc: "学派史",
      abs: "回忆立学之夜：两位好友、一罐悲殇与一页便签。",
      body: `## 立学之始\n\n一切始于一个夏天的夜晚。我们买了两支甜筒，站在路灯下，忽然谈起：若是知识也能如此绵密、如此分享……於是白纸黑字，立学派于纸上。\n\n## 学派之名\n\nHäagen-Dazs 本无祖地，却拥有世界共识的甘美。学派亦如是：名字是哑谜，理义是明证。我们不来自任何地方，但我们向真理开放。\n\n## 今日\n\n今日学派已成：有论坛、有论文、有榜单。愿甜意长存，余味不绝。`,
      views: 64,
      days: 5,
    },
  ];
  for (const p of seedPapers) {
    const pid = ins.run(uid(p.u), p.title, p.disc, p.abs, p.body, p.views, ago(p.days)).lastInsertRowid;
    insAuthor.run(pid, db.prepare("SELECT display_name FROM users WHERE username = ?").get(p.u).display_name, "", "", "", 1, 0);
  }
  console.log("✓ 论文库：播种 3 篇示范论著（含署名）");
}

const threadsOnly = db.prepare("SELECT COUNT(*) AS c FROM threads").get().c;
if (threadsOnly === 0) {
  const uid = (u) => db.prepare("SELECT id FROM users WHERE username = ?").get(u).id;
  const insThread = db.prepare(
    "INSERT INTO threads (author_id, title, content, category, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const insReply = db.prepare(
    "INSERT INTO replies (thread_id, author_id, content, created_at) VALUES (?, ?, ?, ?)",
  );
  const t1 = insThread.run(
    uid("sokrates"),
    "诸位道友用何物下勺？",
    "近来读书，唯以甜筒为伴。想问问学派同侪：诸子治学之时，有何惯用「下勺之物」？\n我以双球为主，犹豫时加一球。",
    "闲话长廊",
    ago(8),
  ).lastInsertRowid;
  insReply.run(t1, uid("plato"), "我以碗底为先，后勺不离；此乃苏格拉底式辩证。", ago(7));
  insReply.run(t1, uid("rector"), "寡人治学只喝水。冰！那是治学间隙的犒赏。", ago(6));

  insThread.run(
    uid("plato"),
    "关于「真理存于乳膏之中」的注疏",
    "校训 In Lacte, Veritas 最近被反复引用。我考证：乳膏喻思想之原料，冷藏喻沉淀——若思想不经过冷凝静置，便不成其真。欢迎辨析。",
    "学术交流",
    ago(9),
  );
  console.log("✓ 论坛：播种 2 个论题及回帖");
}

console.log("\n✅ 种子完成。已播种本地演示账户（rector / sokrates / plato）。");
console.log("ℹ️  口令仅来自 SEED_ADMIN_PW / SEED_SOKRATES_PW / SEED_PLATO_PW 环境变量。");
