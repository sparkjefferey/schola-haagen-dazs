import { db } from "./db";

/**
 * 提醒（论辩回应 / 墨银得币）
 * ---------------------------------------------------------------
 * 自己的论题被人跟帖、自己的论著被人投币时，往 notifications 里留一条提醒，
 * 讯息页对应的那一栏与顶部红点都能看到。
 *
 * 合并策略：同一目标「未读」期间只保留一条，count 累加、actors 记名。
 * 主人读过之后再来的新记录才另起一条 —— 热门目标不会把讯息栏刷屏。
 *
 * 两种提醒共用一张表：`thread_reply` 指向 thread_id，`paper_tip` 指向 paper_id，
 * 两个目标列互斥且都可空。（thread_id 原本是 NOT NULL，为墨银提醒放开了——
 * 详见 lib/db.ts 里那段重建迁移。）
 */

const EXCERPT_MAX = 60; // 摘要字数
const ACTOR_MAX = 5; // 名字最多记几个（超出丢最早的，保留最近的）

export type NoticeKind = "thread_reply" | "paper_tip";

export interface NoticeItem {
  id: number;
  kind: NoticeKind;
  /** 论题 id（墨银提醒为 null） */
  thread_id: number | null;
  /** 论著 id（跟帖提醒为 null） */
  paper_id: number | null;
  /** 论题标题，跟帖提醒才有 */
  thread_title: string;
  /** 论著标题，墨银提醒才有 */
  paper_title: string;
  last_reply_id: number | null;
  actors: string[];
  count: number;
  excerpt: string;
  read: number;
  created_at: string;
  updated_at: string;
}

/** 正文压成一行摘要（去空白、超长截断）。 */
export function excerptOf(text: string, max = EXCERPT_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** 把新名字并进既有的名字快照：去重、只留最近的 ACTOR_MAX 个。 */
function mergeActors(actors: string, name: string): string {
  const names = actors ? actors.split(",").filter(Boolean) : [];
  if (!names.includes(name)) {
    names.push(name);
    if (names.length > ACTOR_MAX) names.splice(0, names.length - ACTOR_MAX);
  }
  return names.join(",");
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
    db.prepare(
      `UPDATE notifications
       SET last_reply_id = ?, last_actor_id = ?, actors = ?, count = count + 1,
           excerpt = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      opts.replyId,
      opts.actorId,
      mergeActors(pending.actors, opts.actorName),
      excerpt,
      pending.id,
    );
    return;
  }

  db.prepare(
    `INSERT INTO notifications (owner_id, kind, thread_id, last_reply_id, last_actor_id, actors, count, excerpt)
     VALUES (?, 'thread_reply', ?, ?, ?, ?, 1, ?)`,
  ).run(opts.ownerId, opts.threadId, opts.replyId, opts.actorId, opts.actorName, excerpt);
}

/**
 * 论著收到墨银 → 记一条提醒。同一篇稿未读期间合并为一条，count 记人数。
 *
 * 摘要写「此稿已获 N 枚墨银」而不是投币者说了什么——投币本来就没有附言，
 * 作者真正想知道的是「这篇稿现在有多少份量」，顺带才是「谁投的」。
 */
export function notifyPaperTip(opts: {
  paperId: number;
  ownerId: number;
  actorId: number;
  actorName: string;
  /** 该稿当前获币总数 */
  tips: number;
}): void {
  // 自投已在前置逻辑挡掉，这里只作保险：真漏过来也不该给作者发「自己给自己投币」
  if (opts.ownerId === opts.actorId) return;

  const excerpt = `此稿已获 ${opts.tips} 枚墨银`;

  const pending = db
    .prepare(
      `SELECT id, actors FROM notifications
       WHERE owner_id = ? AND paper_id = ? AND kind = 'paper_tip' AND read = 0
       ORDER BY id DESC LIMIT 1`,
    )
    .get(opts.ownerId, opts.paperId) as { id: number; actors: string } | undefined;

  if (pending) {
    db.prepare(
      `UPDATE notifications
       SET last_actor_id = ?, actors = ?, count = count + 1, excerpt = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(opts.actorId, mergeActors(pending.actors, opts.actorName), excerpt, pending.id);
    return;
  }

  db.prepare(
    `INSERT INTO notifications (owner_id, kind, paper_id, last_actor_id, actors, count, excerpt)
     VALUES (?, 'paper_tip', ?, ?, ?, 1, ?)`,
  ).run(opts.ownerId, opts.paperId, opts.actorId, opts.actorName, excerpt);
}

/** 未读提醒条数（顶部红点用）。给 kind 则只算那一栏。 */
export function getUnreadNoticeCount(userId: number, kind?: NoticeKind): number {
  const row = (
    kind
      ? db
          .prepare(
            "SELECT COUNT(*) AS c FROM notifications WHERE owner_id = ? AND read = 0 AND kind = ?",
          )
          .get(userId, kind)
      : db
          .prepare("SELECT COUNT(*) AS c FROM notifications WHERE owner_id = ? AND read = 0")
          .get(userId)
  ) as { c: number };
  return row.c;
}

/**
 * 提醒列表：未读在前，其余按时间倒序。目标（论题 / 论著）已删的提醒随外键级联一起消失。
 *
 * 两个 JOIN 都必须是 LEFT：墨银提醒没有 thread_id，一处 INNER JOIN threads
 * 就会把它们整批滤掉——而且是静默滤掉，页面上只表现为「一条都没有」。
 */
export function listNotifications(
  userId: number,
  opts: { kind?: NoticeKind; limit?: number } = {},
): NoticeItem[] {
  let sql = `SELECT n.*, t.title AS thread_title, p.title AS paper_title
             FROM notifications n
             LEFT JOIN threads t ON t.id = n.thread_id
             LEFT JOIN papers p ON p.id = n.paper_id
             WHERE n.owner_id = ?`;
  const params: any[] = [userId];
  if (opts.kind) {
    sql += " AND n.kind = ?";
    params.push(opts.kind);
  }
  sql += " ORDER BY n.read ASC, n.updated_at DESC, n.id DESC LIMIT ?";
  params.push(opts.limit ?? 60);

  const rows = db.prepare(sql).all(...params) as any[];

  return rows.map((r) => ({
    id: r.id,
    kind: (r.kind === "paper_tip" ? "paper_tip" : "thread_reply") as NoticeKind,
    thread_id: r.thread_id ?? null,
    paper_id: r.paper_id ?? null,
    thread_title: r.thread_title ?? "",
    paper_title: r.paper_title ?? "",
    last_reply_id: r.last_reply_id ?? null,
    actors: String(r.actors || "").split(",").filter(Boolean),
    count: r.count,
    excerpt: r.excerpt,
    read: r.read,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

/** 进入某一栏即视为读完那一栏（与系统通知的做法一致）。不给 kind 则全部标记已读。 */
export function markNotificationsRead(userId: number, kind?: NoticeKind): void {
  if (kind) {
    db.prepare(
      "UPDATE notifications SET read = 1 WHERE owner_id = ? AND read = 0 AND kind = ?",
    ).run(userId, kind);
    return;
  }
  db.prepare("UPDATE notifications SET read = 1 WHERE owner_id = ? AND read = 0").run(userId);
}
