import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { timeAgo } from "@/lib/format";
import { respondCertificationAction } from "@/lib/actions";

type CertUser = { id: number; username: string; display_name: string };

/**
 * 讯息页「学友申请」栏。
 * 收到的申请可就地应允/婉拒（以前非跑一趟对方名册页不可）；发出的申请在此交代进展；
 * 栏首给出「想与谁结为学友？」的检索下手处——本栏既是申请的归处，也该是发起处。
 * 申请不再另发一条系统消息，免得同一件事两处出现、红点还要算两遍。
 */
export function CertPanel({
  received,
  sent,
  backPath,
}: {
  received: (CertUser & { created_at: string })[];
  sent: (CertUser & { created_at: string })[];
  /** 办完事回本页（保留当前栏目与检索词），由 actions 做站内路径白名单校验。 */
  backPath: string;
}) {
  return (
    <div>
      <h2 className="section-title" style={{ fontSize: 20, marginTop: 4 }}>
        学 友 申 请
      </h2>

      {/* 下手处。本栏从前只有「待你应允」「你已发出」两张卡片：想结学友的人点进来
          无从下手，只能自己猜到要去检索框里找人——申请按钮也就显得不存在。 */}
      <div className="card" style={{ padding: "12px 18px 16px", marginBottom: 20 }}>
        <h3 style={{ fontSize: 15 }}>想与谁结为学友？</h3>
        <p className="meta" style={{ marginTop: 2, fontSize: 13 }}>
          按学号（<b>#7</b>）或雅名找到人，在其一行上发出申请；对方应允后即互为学友，可无限私信。
        </p>
        <form method="get" action="/messages" className="user-search" style={{ marginTop: 12, marginBottom: 0 }}>
          <input
            name="find"
            type="search"
            autoComplete="off"
            maxLength={24}
            placeholder="学号 #7 · 雅名 · 用户名"
            aria-label="检索同窗"
          />
          <button className="btn btn-sm btn-gold" type="submit">
            检 索
          </button>
        </form>
      </div>

      <div className="card" style={{ padding: "10px 18px 16px", marginBottom: 20 }}>
        <h3 style={{ fontSize: 15 }}>待你应允 · {received.length}</h3>
        {received.length === 0 && (
          <p className="empty-note" style={{ padding: "10px 0" }}>
            暂无待你应允的申请。
          </p>
        )}
        {received.map((u) => (
          <div className="item" key={u.id} style={{ alignItems: "center" }}>
            <Avatar name={u.display_name} id={u.id} size={42} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link className="title" href={`/users/${u.username}`} style={{ fontSize: 16 }}>
                {u.display_name}
              </Link>
              <div className="meta">
                @{u.username} · {timeAgo(u.created_at)}请求互证
              </div>
            </div>
            <form action={respondCertificationAction.bind(null, u.id, true)} style={{ display: "inline" }}>
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
          </div>
        ))}
        <p className="meta" style={{ marginTop: 10, fontSize: 12 }}>
          应允之后即互为学友，可无限私信，不再受每日条数之限。
        </p>
      </div>

      <div className="card" style={{ padding: "10px 18px 16px" }}>
        <h3 style={{ fontSize: 15 }}>你已发出 · {sent.length}</h3>
        {sent.length === 0 && (
          <p className="empty-note" style={{ padding: "10px 0" }}>
            暂无待对方应允的申请。
          </p>
        )}
        {sent.map((u) => (
          <div className="item" key={u.id} style={{ alignItems: "center" }}>
            <Avatar name={u.display_name} id={u.id} size={42} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link className="title" href={`/users/${u.username}`} style={{ fontSize: 16 }}>
                {u.display_name}
              </Link>
              <div className="meta">
                @{u.username} · {timeAgo(u.created_at)}发出
              </div>
            </div>
            <span className="badge badge-dim">待对方应允</span>
          </div>
        ))}
        <p className="meta" style={{ marginTop: 10, fontSize: 12 }}>
          对方应允后，你们即可无限私信；若对方婉拒，可赴其名册页再次请求。
        </p>
      </div>
    </div>
  );
}
