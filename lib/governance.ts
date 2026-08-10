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
  const row = db
    .prepare("SELECT id, uses_left, revoked, expires_at FROM invites WHERE code = ? AND kind = ?")
    .get(code.trim(), kind) as any;
  if (!row) return false;
  if (row.revoked) return false;
  if (row.expires_at && row.expires_at < new Date().toISOString()) return false;
  if (row.uses_left <= 0) return false;
  db.prepare("UPDATE invites SET uses_left = uses_left - 1 WHERE id = ?").run(row.id);
  return true;
}