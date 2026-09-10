import { db } from "./db";

/**
 * 论辩回应提醒
 * ---------------------------------------------------------------
 * 自己的论题被人跟帖时，往 notifications 里留一条提醒，讯息栏顶部
 * 「讯息」红点与讯息页「论辩回应」一栏都能看到，点进去直达那一层楼。
 *
 * 合并策略：同一帖「未读」期间只保留一条，count 累加、actors 记名。
 * 作者读过之后再来的新回复才另起一条 —— 热帖不会把讯息栏刷屏。
 */

const EXCERPT_MAX = 60; // 摘要字数
const ACTOR_MAX = 5; // 名字最多记几个（超出丢最早的，保留最近的）

export interface NoticeItem {
  id: number;
  thread_id: number;
  thread_title: string;
  last_reply_id: number | null;
  actors: string[];
  count: number;
  excerpt: string;
  read: number;
  created_at: string;
  updated_at: string;
}

/** 辩辞压成一行摘要（去空白、超长截断）。 */
export function excerptOf(text: string, max = EXCERPT_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * 论题被回复 → 记一条提醒。
 * 调用方需自行排除「作者回复自己帖子」的情况。
 */
export function notifyThreadReply(opts: {
  threadId: number;
  ownerId: number;
  actorId: number;
  actorName: string;
  replyId: number;
  content: string;
}): void {
  const excerpt = excerptOf(opts.content);

  const pending = db
    .prepare(
      `SELECT id, actors FROM notifications
       WHERE owner_id = ? AND thread_id = ? AND kind = 'thread_reply' AND read = 0
       ORDER BY id DESC LIMIT 1`,
    )
    .get(opts.ownerId, opts.threadId) as { id: number; actors: string } | undefined;

  if (pending) {
    const names = pending.actors ? pending.actors.split(",").filter(Boolean) : [];
    if (!names.includes(opts.actorName)) {
      names.push(opts.actorName);
      if (names.length > ACTOR_MAX) names.splice(0, names.length - ACTOR_MAX);
    }
    db.prepare(
      `UPDATE notifications
       SET last_reply_id = ?, last_actor_id = ?, actors = ?, count = count + 1,
           excerpt = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(opts.replyId, opts.actorId, names.join(","), excerpt, pending.id);
    return;
  }

  db.prepare(
    `INSERT INTO notifications (owner_id, kind, thread_id, last_reply_id, last_actor_id, actors, count, excerpt)
     VALUES (?, 'thread_reply', ?, ?, ?, ?, 1, ?)`,
  ).run(opts.ownerId, opts.threadId, opts.replyId, opts.actorId, opts.actorName, excerpt);
}

/** 未读提醒条数（顶部红点用）。 */
export function getUnreadNoticeCount(userId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM notifications WHERE owner_id = ? AND read = 0")
    .get(userId) as { c: number };
  return row.c;
}

/** 提醒列表：未读在前，其余按时间倒序。论题已删的提醒随外键级联一起消失。 */
export function listNotifications(userId: number, limit = 60): NoticeItem[] {
  const rows = db
    .prepare(
      `SELECT n.*, t.title AS thread_title
       FROM notifications n JOIN threads t ON t.id = n.thread_id
       WHERE n.owner_id = ?
       ORDER BY n.read ASC, n.updated_at DESC, n.id DESC
       LIMIT ?`,
    )
    .all(userId, limit) as any[];

  return rows.map((r) => ({
    id: r.id,
    thread_id: r.thread_id,
    thread_title: r.thread_title,
    last_reply_id: r.last_reply_id ?? null,
    actors: String(r.actors || "").split(",").filter(Boolean),
    count: r.count,
    excerpt: r.excerpt,
    read: r.read,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

/** 进入「论辩回应」栏即视为读完（与系统通知的做法一致）。 */
export function markNotificationsRead(userId: number): void {
  db.prepare("UPDATE notifications SET read = 1 WHERE owner_id = ? AND read = 0").run(userId);
}
