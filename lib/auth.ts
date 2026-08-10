import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, toSafeUser, userMapper, type SafeUser } from "./db";

const SESSION_COOKIE = "schola_session";
const SESSION_DAYS = 7;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

// ---------------- 口令 ----------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---------------- 登录限流 ----------------

export function isLocked(ip: string, username: string): boolean {
  const row = db
    .prepare("SELECT count, window_end FROM login_attempts WHERE ip = ? AND username = ?")
    .get(ip, username) as { count: number; window_end: string } | undefined;
  if (!row) return false;
  if (row.window_end < new Date().toISOString()) {
    db.prepare("DELETE FROM login_attempts WHERE ip = ? AND username = ?").run(ip, username);
    return false;
  }
  return row.count >= MAX_FAILS;
}

export function recordFailedAttempt(ip: string, username: string) {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString();
  db.prepare(
    `INSERT INTO login_attempts (ip, username, count, window_end) VALUES (?, ?, 1, ?)
     ON CONFLICT(ip, username) DO UPDATE SET count = count + 1, window_end = ?`,
  ).run(ip, username, windowEnd, windowEnd);
}

export function clearFailedAttempts(ip: string, username: string) {
  db.prepare("DELETE FROM login_attempts WHERE ip = ? AND username = ?").run(ip, username);
}

// ---------------- 会话 ----------------

function expireAt(days: number): string {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
}

export function createSession(userId: number): string {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)").run(
    userId,
    token,
    expireAt(SESSION_DAYS),
  );
  return token;
}

export function destroySession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/** 吊销某成员的全部会话（封禁/除籍时调用） */
export function destroyAllSessions(userId: number) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

const lookupUserSql = "SELECT * FROM users WHERE id = ?";

function lookupUser(id: number): SafeUser | null {
  const row = db.prepare(lookupUserSql).get(id);
  return row ? userMapper(row) : null;
}

export async function getSessionUser(): Promise<SafeUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = db
    .prepare("SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?")
    .get(token, new Date().toISOString()) as { user_id: number } | undefined;
  if (!session) return null;
  return lookupUser(session.user_id);
}

/** 状态拦截：封禁/除籍者一律视为未登录，并清除其会话。 */
export async function requireUser(): Promise<SafeUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.status !== "active") {
    destroySessionByCookie();
    redirect(`/banned?u=${encodeURIComponent(user.username)}`);
  }
  return user;
}

export async function requireAdmin(): Promise<SafeUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

async function destroySessionByCookie() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}