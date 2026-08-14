import { db, userMapper, type SafeUser } from "./db";

/**
 * 同侪互证（互相关注式成对关系）
 * ---------------------------------------------------------------
 * 互证 = 两人之间存在 status='accepted' 的 certifications 记录（(A,B) 或 (B,A) 皆可）。
 * 互证后双方可无限私信；未互证者每日私信受 PM_DAILY_LIMIT 条数限制（管理员豁免）。
 * 注意：与「认证学者」（users.endorsed）是两个独立概念，勿混淆。
 */

/** 每日私信限额（未互证且非管理员）。UTC 零点重置，全站时间戳均 UTC。 */
export function pmDailyLimit(): number {
  const configured = Number(process.env.PM_DAILY_LIMIT ?? "5");
  return Number.isFinite(configured) ? Math.max(0, Math.floor(configured)) : 5;
}

/** 两人是否已互证。 */
export function isMutuallyCertified(a: number, b: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM certifications
       WHERE status='accepted'
         AND ((requester_id=? AND responder_id=?) OR (requester_id=? AND responder_id=?))
       LIMIT 1`,
    )
    .get(a, b, b, a);
  return !!row;
}

/** 与「我」互证的活跃同侪（供消息页「新私聊」名单）。 */
export function listContacts(me: number): SafeUser[] {
  const rows = db
    .prepare(
      `SELECT u.* FROM users u
       JOIN certifications c ON
         (c.requester_id = ? AND c.responder_id = u.id) OR
         (c.requester_id = u.id AND c.responder_id = ?)
       WHERE c.status='accepted' AND u.status='active' AND u.id <> ?
       GROUP BY u.id ORDER BY u.display_name`,
    )
    .all(me, me, me) as any[];
  return rows.map(userMapper);
}

export type CertRelation =
  | "none"
  | "pending_sent"
  | "pending_received"
  | "certified"
  | "declined";

/** 我与某人的互证关系状态（供个人页渲染互证区）。双向 pending 视为待回应。 */
export function getCertRelation(me: number, other: number): CertRelation {
  const rows = db
    .prepare(
      `SELECT requester_id, responder_id, status FROM certifications
       WHERE (requester_id=? AND responder_id=?) OR (requester_id=? AND responder_id=?)`,
    )
    .all(me, other, other, me) as any[];
  if (rows.some((r) => r.status === "accepted")) return "certified";
  if (rows.some((r) => r.responder_id === me && r.status === "pending")) return "pending_received";
  const sent = rows.find((r) => r.requester_id === me);
  if (sent) {
    if (sent.status === "pending") return "pending_sent";
    if (sent.status === "declined") return "declined";
  }
  return "none";
}

/** 待我回应的互证请求（供消息页横幅）。 */
export function listPendingCertRequests(me: number): (SafeUser & { created_at: string })[] {
  const rows = db
    .prepare(
      `SELECT u.*, c.created_at FROM certifications c
       JOIN users u ON u.id = c.requester_id
       WHERE c.responder_id=? AND c.status='pending' AND u.status='active'
       ORDER BY c.created_at DESC`,
    )
    .all(me) as any[];
  return rows.map((r) => ({ ...userMapper(r), created_at: r.created_at }));
}

/**
 * 今日已用私信额度：发给【当前未与「我」互证】接收者的私信条数。
 * 一旦互证，sendMessageAction 直接跳过额度，故此处按当前互证状态统计即可。
 */
export function pmQuotaUsed(me: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM messages m
       WHERE m.kind='pm' AND m.sender_id=@me AND date(m.created_at)=date('now')
         AND NOT EXISTS (
           SELECT 1 FROM certifications c
           WHERE c.status='accepted'
             AND ((c.requester_id=@me AND c.responder_id=m.receiver_id)
               OR (c.requester_id=m.receiver_id AND c.responder_id=@me))
         )`,
    )
    .get({ me }) as { c: number };
  return row.c;
}
