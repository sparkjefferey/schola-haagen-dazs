#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomBytes, scryptSync } from "node:crypto";
import Database from "better-sqlite3";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

// ---- 始祖口令重置（与站点 lib/auth.ts 同格式：salt:scrypt-hash）----
// 设计要点：口令绝不落盘、不进仓库（本仓库公开）。只支持两种模式：
//   1. --reset-founder-password <口令>：操作者现场在 SSH 终端指定（须 12+ 位、含三类字符）；
//   2. --reset-founder-password（不带值）：自动生成随机强口令，仅在终端打印一次，请立即抄录。
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordWeakness(pw) {
  if (pw.length < 12) return "口令至少 12 位";
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(pw)).length;
  if (kinds < 3) return "口令须包含大小写、数字、符号中的至少三类";
  return null;
}

const GENERATED_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
function generatePassword(length = 20) {
  const bytes = randomBytes(length);
  let pw = "";
  for (let i = 0; i < length; i++) pw += GENERATED_ALPHABET[bytes[i] % GENERATED_ALPHABET.length];
  return pw;
}

const resetPwRequested = process.argv.includes("--reset-founder-password");
const explicitPwRaw = valueAfter("--reset-founder-password");
const hasExplicitPw = explicitPwRaw !== undefined && !explicitPwRaw.startsWith("--");
if (resetPwRequested && hasExplicitPw) {
  const weakness = passwordWeakness(explicitPwRaw);
  if (weakness) {
    console.error(`拒绝执行：--reset-founder-password 口令过弱（${weakness}）。`);
    console.error("建议改用不带值的模式，由脚本生成强口令并仅打印一次。");
    process.exit(2);
  }
}
const founderPassword = resetPwRequested
  ? hasExplicitPw
    ? explicitPwRaw
    : generatePassword()
  : null;

const confirmed = process.argv.includes("--confirm-reset-access");
const keepAdmins = process.argv.includes("--keep-admins");
const dbPath = path.resolve(valueAfter("--db") ?? "data/schola.db");

if (!confirmed) {
  console.error("拒绝执行：请在已重装的干净服务器上加 --confirm-reset-access 明确确认。");
  process.exit(2);
}

if (!fs.existsSync(dbPath)) {
  console.error(`数据库不存在：${dbPath}`);
  process.exit(2);
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

try {
  const integrity = db.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") {
    throw new Error(`数据库完整性检查失败：${integrity}`);
  }

  const requiredTables = ["users", "sessions", "invites", "audit_log"];
  const existingTables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
  );
  const missing = requiredTables.filter((name) => !existingTables.has(name));
  if (missing.length > 0) {
    throw new Error(`数据库缺少必要数据表：${missing.join(", ")}`);
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = `${dbPath}.before-access-reset-${timestamp}.bak`;
  await db.backup(backupPath);

  const reset = db.transaction(() => {
    const founder = db.prepare(`
      SELECT id
      FROM users
      ORDER BY CASE WHEN username = 'rector' THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `).get();

    const removedSessions = db.prepare("DELETE FROM sessions").run().changes;
    const revokedInvites = db.prepare("UPDATE invites SET revoked = 1 WHERE revoked = 0").run().changes;
    let clearedFounders = 0;

    if (founder) {
      clearedFounders = db.prepare("UPDATE users SET root = 0 WHERE id != ? AND root != 0").run(founder.id).changes;
      db.prepare("UPDATE users SET root = 1, role = 'admin' WHERE id = ?").run(founder.id);
    }

    // 始祖口令重置：仅在显式请求时执行；新口令不落盘（生成模式下仅终端打印一次）。
    let passwordReset = false;
    if (founder && resetPwRequested && founderPassword) {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
        hashPassword(founderPassword),
        founder.id,
      );
      passwordReset = true;
    }

    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_root ON users(root) WHERE root = 1");

    // W3：攻击者 root 期可能植入/提权过「非创始人管理员」账号——重装后若不清除，
    // 对方仍可凭自己设定的口令登录行使管理权。默认将全部非创始人管理员降为学者，
    // 除非显式 --keep-admins（此时必须人工逐一对账并轮换口令）。
    const admins = db
      .prepare("SELECT id, username, root FROM users WHERE role = 'admin'")
      .all();
    let demotedAdmins = 0;
    if (!keepAdmins && founder) {
      for (const a of admins) {
        if (a.root) continue;
        demotedAdmins += db
          .prepare("UPDATE users SET role = 'scholar' WHERE id = ? AND root = 0")
          .run(a.id).changes;
      }
    }

    db.prepare(`
      INSERT INTO audit_log (actor_id, action, target, detail)
      VALUES (NULL, 'security.incident_access_reset', 'system', ?)
    `).run(
      `吊销 ${removedSessions} 个会话、${revokedInvites} 个邀请码，清除 ${clearedFounders} 个多余始祖标记` +
        (keepAdmins ? "" : `，降权 ${demotedAdmins} 个非创始人管理员`) +
        (passwordReset ? "，重置始祖口令" : ""),
    );

    return {
      removedSessions,
      revokedInvites,
      clearedFounders,
      founderId: founder?.id ?? null,
      demotedAdmins,
      keptAdmins: admins.map((a) => a.username),
      passwordReset,
    };
  });

  const result = reset();
  db.pragma("wal_checkpoint(TRUNCATE)");
  console.log(JSON.stringify({ ok: true, dbPath, backupPath, ...result }, null, 2));

  if (result.passwordReset && !hasExplicitPw) {
    console.log("\n══════════════════════════════════════════════════════════");
    console.log("始祖新口令（仅在本次终端显示一次，请立即抄录保存）：");
    console.log(`   ${founderPassword}`);
    console.log("口令未写入任何文件。抄录后建议尽快登录后台并再次改密。");
    console.log("══════════════════════════════════════════════════════════");
  }
} finally {
  db.close();
}
