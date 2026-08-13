import { db, userMapper, type Message, type SafeUser } from "./db";

/** 当前用户的未读消息总数（私聊 + 系统）。用于顶部红点。 */
export function getUnreadCount(userId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM messages WHERE receiver_id = ? AND read = 0")
    .get(userId) as { c: number };
  return row.c;
}

export interface Conversation {
  other: SafeUser;
  last: Message;
  unread: number;
  last_at: string;
}

/** 列出当前用户所有私聊会话：对方信息 + 最后一条消息 + 未读数。 */
export function getConversations(userId: number): Conversation[] {
  const rows = db
    .prepare(
      `SELECT
         CASE WHEN sender_id = @me THEN receiver_id ELSE sender_id END AS other_id,
         MAX(id) AS last_id,
         SUM(CASE WHEN receiver_id = @me AND read = 0 THEN 1 ELSE 0 END) AS unread
       FROM messages
       WHERE kind = 'pm' AND (sender_id = @me OR receiver_id = @me)
       GROUP BY other_id
       ORDER BY MAX(created_at) DESC`,
    )
    .all({ me: userId }) as { other_id: number; last_id: number; unread: number }[];

  return rows
    .map((r) => {
      const last = db.prepare("SELECT * FROM messages WHERE id = ?").get(r.last_id) as Message;
      const u = db.prepare("SELECT * FROM users WHERE id = ?").get(r.other_id) as any;
      if (!u) return null;
      return { other: userMapper(u), last, unread: r.unread, last_at: last.created_at };
    })
    .filter(Boolean) as Conversation[];
}

/** 取两人之间的私聊记录（按时间升序），并把对方发来的未读标记为已读。 */
export function getThread(userId: number, otherId: number): Message[] {
  const msgs = db
    .prepare(
      `SELECT * FROM messages
       WHERE kind = 'pm'
         AND ((sender_id = @me AND receiver_id = @other) OR (sender_id = @other AND receiver_id = @me))
       ORDER BY id ASC`,
    )
    .all({ me: userId, other: otherId }) as Message[];

  db.prepare(
    `UPDATE messages SET read = 1
     WHERE kind = 'pm' AND receiver_id = @me AND sender_id = @other AND read = 0`,
  ).run({ me: userId, other: otherId });

  return msgs;
}

/** 取当前用户的系统消息（按时间降序），并全部标记为已读。 */
export function getSystemMessages(userId: number): Message[] {
  const msgs = db
    .prepare(
      `SELECT * FROM messages
       WHERE kind = 'system' AND receiver_id = ?
       ORDER BY id DESC`,
    )
    .all(userId) as Message[];

  db.prepare(
    "UPDATE messages SET read = 1 WHERE kind = 'system' AND receiver_id = ? AND read = 0",
  ).run(userId);

  return msgs;
}

/** 发送系统消息（不依赖登录态，供各治理/业务动作调用）。 */
export function sendSystemMessage(receiverId: number, body: string) {
  db.prepare(
    "INSERT INTO messages (sender_id, receiver_id, body, kind) VALUES (NULL, ?, ?, 'system')",
  ).run(receiverId, body);
}
