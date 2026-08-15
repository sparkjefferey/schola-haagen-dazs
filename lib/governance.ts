import { randomBytes } from "node:crypto";
import { db } from "./db";

export function logAudit(actorId: number | null, action: string, target: string, detail = "") {
  db.prepare("INSERT INTO audit_log (actor_id, action, target, detail) VALUES (?, ?, ?, ?)").run(
    actorId,
    action,
    target,
    detail.slice(0, 500),
  );
}

export function createInviteCode(kind: "admin" | "scholar", uses: number, note: string, createdBy: number, expiresInDays: number | null) {
  const code = (kind === "admin" ? "R-" : "S-") + randomBytes(6).toString("hex").toUpperCase();
  db.prepare(
    "INSERT INTO invites (kind, code, uses_left, total_uses, note, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    kind,
    code,
    uses,
    uses,
    note,
    createdBy,
    expiresInDays ? new Date(Date.now() + expiresInDays * 86400_000).toISOString() : null,
  );
  return code;
}

export function consumeInvite(code: string, kind: "admin" | "scholar"): boolean {
  const normalized = code.trim();
  if (!normalized) return false;

  // 校验与扣减必须在同一条 SQL 内完成；并发请求中最多只有 uses_left 个能成功。
  const result = db
    .prepare(
      `UPDATE invites
       SET uses_left = uses_left - 1
       WHERE code = ?
         AND kind = ?
         AND revoked = 0
         AND uses_left > 0
         AND (expires_at IS NULL OR expires_at >= ?)`,
    )
    .run(normalized, kind, new Date().toISOString());
  return result.changes === 1;
}
