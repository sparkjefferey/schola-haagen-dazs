import { db } from "./db";
import { getCertRelation, type CertRelation } from "./certification";
import { consumeFixedWindow } from "./rate-limit";
import { logAudit } from "./governance";

/**
 * 学友检索（按学号或雅名找人）
 * ---------------------------------------------------------------
 * 讯息页的「找同侪」入口：输学号（`#7` 或 `7`）精确命中，输名字按子串匹配。
 *
 * 两条刻意收紧的口径：
 * 1. 只搜在籍（active）账号 —— 封禁与已离馆者不出现在结果里，免得检索变成
 *    学籍状态探测面（同审计报告 V4「账号状态枚举」的顾虑）。
 * 2. 只在「有检索词」时才查库，且结果有上限、按账号限流 —— 这是检索，不是
 *    可翻页浏览的全员名录；整册导出的成本被抬高（审计 V11「ID 枚举」）。
 */

/** 单次检索最多返回几人。够用即可：更多说明该换更精确的词。 */
export const USER_SEARCH_LIMIT = 8;
const QUERY_MAX = 24;

/** 检索额度：每账号 10 分钟 30 次。正常人改词重搜绰绰有余，脚本扫全册则远远不够。 */
const SEARCH_LIMIT = 30;
const SEARCH_WINDOW_MS = 10 * 60_000;

export interface UserHit {
  id: number;
  username: string;
  display_name: string;
  role: string;
  endorsed: number;
  motto: string;
  created_at: string;
  /** 我与该同窗的互证关系（决定结果行上给什么按钮）。 */
  relation: CertRelation;
  isSelf: boolean;
}

export type UserSearchResult =
  | { ok: true; query: string; hits: UserHit[] }
  | { ok: false; limited: true; query: string };

/** 去掉装饰前缀（`#`/`@`，含全角）与首尾空白，并截断超长串，避免拿长文本打库。 */
export function normalizeUserQuery(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/^[#@＃＠]+/, "")
    .trim()
    .slice(0, QUERY_MAX);
}

/** LIKE 通配符转义：用户输入里的 % 与 _ 一律按字面量处理。 */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** 行 → 结果项，顺带问出我与该同窗的互证关系（决定结果行给什么按钮）。 */
function toHit(row: any, meId: number): UserHit {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    endorsed: row.endorsed,
    motto: row.motto ?? "",
    created_at: row.created_at,
    relation: row.id === meId ? "none" : getCertRelation(meId, row.id),
    isSelf: row.id === meId,
  };
}

/**
 * 检索同窗。查库前先扣本账号的检索额度，超限即拒绝（并留审计）。
 * 只认在籍账号；自己也在结果里（标出「你自己」），免得搜自己的学号却扑空。
 */
export function searchUsers(meId: number, rawQuery: string): UserSearchResult {
  const query = normalizeUserQuery(rawQuery);
  if (!query) return { ok: true, query, hits: [] };

  if (consumeFixedWindow(`usersearch:${meId}`, SEARCH_LIMIT, SEARCH_WINDOW_MS).limited) {
    logAudit(meId, "security.user_search_blocked", "users", "学友检索触发限流");
    return { ok: false, limited: true, query };
  }

  const numericId = /^\d{1,10}$/.test(query) ? Number(query) : 0;
  if (numericId > 0) {
    // 纯数字先当学号精确查。这一步很要紧：否则「75」会连用户名里含 75 的
    // 陌生人（如 17530）一起捞出来——输数字的人要找的是学号，不该被名字串干扰。
    const byId = db
      .prepare(
        `SELECT id, username, display_name, role, endorsed, motto, created_at
         FROM users WHERE status='active' AND id = ?`,
      )
      .get(numericId) as any;
    if (byId) return { ok: true, query, hits: [toHit(byId, meId)] };
    // 学号查无此人：退回按名字匹配 —— 有人雅名或用户名本身就是一串数字。
  }

  const escaped = escapeLike(query);
  const rows = db
    .prepare(
      `SELECT id, username, display_name, role, endorsed, motto, created_at
       FROM users
       WHERE status = 'active'
         AND (username LIKE @sub ESCAPE '\\' OR display_name LIKE @sub ESCAPE '\\')
       ORDER BY
         CASE
           WHEN lower(username) = lower(@q) THEN 1
           WHEN lower(display_name) = lower(@q) THEN 2
           WHEN username LIKE @pre ESCAPE '\\' THEN 3
           WHEN display_name LIKE @pre ESCAPE '\\' THEN 4
           ELSE 5
         END,
         display_name
       LIMIT @limit`,
    )
    .all({
      q: query,
      sub: `%${escaped}%`,
      pre: `${escaped}%`,
      limit: USER_SEARCH_LIMIT,
    }) as any[];

  return { ok: true, query, hits: rows.map((r) => toHit(r, meId)) };
}
