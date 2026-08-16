import { createHash } from "node:crypto";
import { db } from "./db";

export interface RateLimitResult {
  limited: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

const consumeWindow = db.transaction(
  (key: string, limit: number, windowMs: number, now: number): RateLimitResult => {
    const row = db
      .prepare("SELECT count, window_end FROM rate_limit_windows WHERE key = ?")
      .get(key) as { count: number; window_end: number } | undefined;

    if (!row || row.window_end <= now) {
      const resetAt = now + windowMs;
      db.prepare(
        `INSERT INTO rate_limit_windows (key, count, window_end) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count = 1, window_end = excluded.window_end`,
      ).run(key, resetAt);
      return { limited: false, limit, remaining: Math.max(0, limit - 1), resetAt };
    }

    if (row.count >= limit) {
      return { limited: true, limit, remaining: 0, resetAt: row.window_end };
    }

    db.prepare("UPDATE rate_limit_windows SET count = count + 1 WHERE key = ?").run(key);
    return {
      limited: false,
      limit,
      remaining: Math.max(0, limit - row.count - 1),
      resetAt: row.window_end,
    };
  },
);

let lastCleanupAt = 0;

/**
 * 消耗一次固定窗口额度。key 只存储用途标签或不可逆摘要，不应存原始 IP。
 */
export function consumeFixedWindow(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("rate limit 必须为正整数");
  if (!Number.isInteger(windowMs) || windowMs <= 0) throw new Error("rate limit 窗口必须为正整数");

  // 低频清理过期桶，避免长期积累过期的客户端记录。
  if (now - lastCleanupAt >= windowMs) {
    db.prepare("DELETE FROM rate_limit_windows WHERE window_end <= ?").run(now);
    lastCleanupAt = now;
  }

  return consumeWindow(key, limit, windowMs, now);
}

/** 清除某桶计数（登录成功后清零全局桶，避免正常用户被历史失败累积误伤）。 */
export function resetFixedWindow(key: string) {
  db.prepare("DELETE FROM rate_limit_windows WHERE key = ?").run(key);
}

/** 只读查看某桶当前计数与窗口结束时间（不消耗额度）。用于登录失败递增退避等。 */
export function peekFixedWindow(
  key: string,
  now = Date.now(),
): { count: number; windowEnd: number } {
  const row = db
    .prepare("SELECT count, window_end FROM rate_limit_windows WHERE key = ?")
    .get(key) as { count: number; window_end: number } | undefined;
  if (!row || row.window_end <= now) return { count: 0, windowEnd: now };
  return { count: row.count, windowEnd: row.window_end };
}

/** 只保存客户端标识的摘要，避免在限流表中长期保留原始 IP。 */
export function rateLimitFingerprint(value: string): string {
  return createHash("sha256").update(value || "unknown").digest("hex").slice(0, 32);
}
