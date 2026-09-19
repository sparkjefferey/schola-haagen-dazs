import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { formatDate } from "@/lib/format";
import { requestCertificationAction, respondCertificationAction } from "@/lib/actions";
import { USER_SEARCH_LIMIT, type UserHit } from "@/lib/user-search";

/**
 * 学友检索结果。
 * 每一行的按钮随「我与该同窗的关系」而变：未互证给申请，待我应允给应允/婉拒，
 * 已是学友直接进私聊——不必先绕去对方名册页。
 * 管理者与常人同一套判断（从前管理员只给「私信」，馆长账号上便一处申请按钮
 * 都见不着）；另给管理者一个直达私信的便门，免得多点两下。
 */
export function UserSearchResults({
  query,
  hits,
  meRole,
  backPath,
}: {
  query: string;
  hits: UserHit[];
  meRole: string;
  /** 办完事回本页（保留检索词），由 actions 做站内路径白名单校验。 */
  backPath: string;
}) {
  const isAdmin = meRole === "admin";

  return (
    <div>
      <h2 className="section-title" style={{ fontSize: 20, marginTop: 4 }}>
        检 索 同 窗
      </h2>
      <p className="meta" style={{ marginTop: -6, marginBottom: 14, fontSize: 13 }}>
        「<b>{query}</b>」共得 {hits.length} 人
        {hits.length >= USER_SEARCH_LIMIT && "（仅示前若干人，可写全名或学号缩小范围）"}
      </p>

      <div className="card" style={{ padding: "4px 18px 8px" }}>
        {hits.length === 0 && (
          <p className="empty-note" style={{ padding: "18px 0" }}>
            未找到此同窗。学号须完全一致（如 <b>#7</b> 与 <b>7</b> 皆可），名字可只写其中一两字。
            已封禁或已辞别门派者不列于此。
          </p>
        )}

        {hits.map((u) => (
          <div className="hit-row" key={u.id}>
            <Avatar name={u.display_name} id={u.id} size={44} />
            <div className="hit-main">
              <div>
                <Link className="title" href={`/users/${encodeURIComponent(u.username)}`} style={{ fontSize: 16.5 }}>
                  {u.display_name}
                </Link>{" "}
                <span className="uin">学号 #{u.id}</span>{" "}
                {u.endorsed === 1 && <span className="badge">认证学者</span>}
                {u.role === "admin" && <span className="badge badge-admin">管理者</span>}
                {u.isSelf && <span className="badge badge-dim">这是你自己</span>}
              </div>
              <div className="meta">
                @{u.username} · 入馆于 {formatDate(u.created_at)}
              </div>
              {u.motto && (
                <div className="meta" style={{ fontStyle: "italic" }}>
                  「{u.motto}」
                </div>
              )}
            </div>

            <div className="hit-act">
              {/* 管理者的便门：行内动作已是私信（certified）时不必重复 */}
              {isAdmin && !u.isSelf && u.relation !== "certified" && (
                <Link className="btn btn-sm" href={`/messages?with=${u.id}`}>
                  私 信
                </Link>
              )}
              {u.isSelf ? (
                <Link className="btn btn-sm" href={`/users/${encodeURIComponent(u.username)}`}>
                  赴 名 册
                </Link>
              ) : u.relation === "certified" ? (
                <Link className="btn btn-sm btn-gold" href={`/messages?with=${u.id}`}>
                  进 入 私 聊
                </Link>
              ) : u.relation === "pending_received" ? (
                <>
                  <form
                    action={respondCertificationAction.bind(null, u.id, true)}
                    style={{ display: "inline" }}
                  >
                    <input type="hidden" name="back" value={backPath} />
                    <button className="btn btn-sm btn-gold" type="submit">
                      应 允
                    </button>
                  </form>{" "}
                  <form
                    action={respondCertificationAction.bind(null, u.id, false)}
                    style={{ display: "inline" }}
                  >
                    <input type="hidden" name="back" value={backPath} />
                    <button className="btn btn-sm" type="submit">
                      婉 拒
                    </button>
                  </form>
                </>
              ) : u.relation === "pending_sent" ? (
                <span className="badge badge-dim">已申请 · 待对方应允</span>
              ) : (
                <>
                  {u.relation === "declined" && (
                    <span className="badge badge-dim">对方曾婉拒</span>
                  )}
                  <form
                    action={requestCertificationAction.bind(null, u.id)}
                    style={{ display: "inline" }}
                  >
                    <input type="hidden" name="back" value={backPath} />
                    <button className="btn btn-sm btn-gold" type="submit">
                      申请学友私聊
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="meta" style={{ marginTop: 14, fontSize: 12.5 }}>
        对方应允即成学友，可无限私信；未成学友之前，每日私信仍有条数之限。
        学号即名册编号，见于各人名册页，可径寄他人。
      </p>
    </div>
  );
}
