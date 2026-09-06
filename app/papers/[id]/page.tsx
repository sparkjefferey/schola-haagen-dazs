import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPaper, reviewEventsWithActor } from "@/lib/queries";
import { getSessionUser } from "@/lib/auth";
import {
  deletePaperAction,
  deleteAttachmentAction,
  discardPaperAction,
  resubmitPaperAction,
  submitRevisionAction,
  uploadAttachmentAction,
} from "@/lib/actions";
import ViewTally from "@/components/view-tally";
import ReportButton from "@/components/report-button";
import { Avatar } from "@/components/avatar";
import { renderMarkdown } from "@/lib/md";
import { formatDate, formatBytes } from "@/lib/format";
import { IonicColumn, LaurelWreath } from "@/components/decor";
import { StatusBadge } from "@/components/StatusBadge";
import { CitationBox } from "@/components/CitationBox";
import { ReviewTimeline } from "@/components/ReviewTimeline";
import { EditorialActions } from "@/app/admin/admin-actions";
import { buildCitation, buildBibtex } from "@/lib/paper";
import { getAttachments, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_COUNT, ATTACHMENT_TOTAL_BYTES } from "@/lib/attachments";
import { ATTACHMENT_ACCEPT } from "@/lib/attachment-formats";

export const metadata: Metadata = { title: "论著" };

const ATTACHMENT_ERRORS: Record<string, string> = {
  attnone: "请先选择要上传的文件。",
  attempty: "该文件是空文件，无法收讫。",
  atttype: "文件格式不受支持，或内容与扩展名不符（仅收常见文档、图片与压缩包）。",
  attsize: "单个附件超过大小上限，请压缩后重试。",
  attcount: "附件数量已达上限，请先移除若干。",
  atttotal: "附件总大小已达上限，请先移除若干。",
  attrate: "上传操作过于频繁，请稍歇再传。",
  attfail: "附件保存失败，请重试。",
};

export default async function PaperPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ e?: string; ok?: string }>;
}) {
  const { id } = await params;
  const { e, ok } = await searchParams;
  const paperId = Number(id);
  if (!Number.isInteger(paperId)) notFound();
  const paper = getPaper(paperId);
  if (!paper) notFound();

  const user = await getSessionUser();
  const isOwner = !!user && user.id === paper.author_id;
  const isAdmin = user?.role === "admin";
  const canReadFull = paper.status === "published" || isOwner || isAdmin;
  if (!canReadFull) notFound();

  const attachments = getAttachments(paper.id);
  const canManageAttachments = isOwner && ["submitted", "revision"].includes(paper.status);
  // 未刊之稿：作者与掌门始终可见附件卡（含空态，便于确认投稿是否携带附件）；已刊者有附件才显示
  const showAttachmentCard =
    attachments.length > 0 || (paper.status !== "published" && (isOwner || isAdmin));
  const hasCsv = attachments.some((a) => a.ext === "csv");

  const authors = [...paper.authors].sort((a, b) => a.author_order - b.author_order);
  const corr = authors.find((a) => a.is_corresponding === 1);
  const correspondingName = corr?.display_name ?? authors[0]?.display_name ?? paper.author.display_name;
  const events = reviewEventsWithActor(paper.id);
  const keywords = paper.keywords
    .split(/[,，、;；]/)
    .map((k) => k.trim())
    .filter(Boolean);

  const citation = buildCitation(paper, authors.map((a) => ({ display_name: a.display_name })));
  const bibtex = buildBibtex(paper, authors.map((a) => ({ display_name: a.display_name })));

  const canDelete = (isOwner || isAdmin) && paper.status === "published";

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      {paper.status === "published" && <ViewTally paperId={paper.id} />}

      <p className="meta" style={{ marginBottom: 8 }}>
        <Link href="/papers" style={{ color: "var(--ink-soft)" }}>← 论文库</Link>
      </p>

      {ok === "att" && <p className="notice" style={{ marginBottom: 16 }}>附件已收讫。</p>}
      {e && ATTACHMENT_ERRORS[e] && (
        <p className="notice" style={{ marginBottom: 16, color: "var(--maroon-deep)" }}>
          ✗ {ATTACHMENT_ERRORS[e]}
        </p>
      )}

      {/* 卷首 */}
      <div className="card" style={{ padding: 34, textAlign: "center", marginBottom: 26 }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, color: "var(--gold-deep)" }}>
          <IonicColumn height={52} />
          <LaurelWreath size={44} color="var(--gold-deep)" />
        </div>
        <h1 style={{ margin: "14px 0 8px", fontSize: "clamp(24px, 3.4vw, 34px)" }}>{paper.title}</h1>

        {paper.short_title && (
          <div className="meta" style={{ fontSize: 13, opacity: 0.75 }}>栏外题：{paper.short_title}</div>
        )}

        {/* 署名 */}
        <div className="byline">
          {authors.map((a) => (
            <span className="byline-author" key={a.id}>
              <b>{a.display_name}</b>
              {a.affiliation && <span className="byline-aff">{a.affiliation}</span>}
              {a.is_corresponding === 1 && <span className="badge badge-dim" style={{ marginLeft: 6 }}>通信作者</span>}
            </span>
          ))}
        </div>

        <div className="meta" style={{ fontSize: 14, marginTop: 8 }}>
          <span className="badge badge-dim">{paper.discipline}</span>
          <span style={{ margin: "0 8px" }}>·</span>
          稿号 <code className="ms-code">{paper.manuscript_code || "—"}</code>
          <span style={{ margin: "0 8px" }}>·</span>
          投稿 {formatDate(paper.created_at)}
          {paper.published_at && (
            <>
              <span style={{ margin: "0 8px" }}>·</span>
              刊于 {formatDate(paper.published_at)}
            </>
          )}
        </div>

        {keywords.length > 0 && (
          <div className="keywords" style={{ marginTop: 12 }}>
            {keywords.map((k, i) => (
              <span className="kw-chip" key={i}>{k}</span>
            ))}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <StatusBadge status={paper.status} />
        </div>
      </div>

      {/* 审稿进程（非刊印可见） */}
      {paper.status !== "published" && (
        <div className="card" style={{ padding: 24, marginBottom: 26 }}>
          <h2 className="section-title" style={{ fontSize: 19, marginBottom: 14 }}>审 稿 进 程</h2>
          <ReviewTimeline events={events} />
          {paper.status === "revision" && paper.decision_note && (
            <p className="notice" style={{ marginTop: 10 }}>
              <b>掌门退修意见：</b>{paper.decision_note}
            </p>
          )}
          {paper.status === "rejected" && paper.reject_reason && (
            <p className="notice" style={{ marginTop: 10 }}>
              <b>掌门驳回缘由：</b>{paper.reject_reason}
            </p>
          )}
        </div>
      )}

      {/* 著者 / 掌门操作区 */}
      {isOwner && paper.status !== "published" && (
        <div className="card author-desk" style={{ padding: 20, marginBottom: 26 }}>
          <h2 className="section-title" style={{ fontSize: 19, marginBottom: 12 }}>著 者 案 头</h2>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Link href={`/papers/${paper.id}/edit`} className="btn btn-sm btn-gold">修 订 文 稿</Link>
            {paper.status === "revision" && (
              <form action={submitRevisionAction.bind(null, paper.id)}>
                <button className="btn btn-sm" type="submit">提交修改稿 · 重回送审</button>
              </form>
            )}
            {paper.status === "rejected" && (
              <form action={resubmitPaperAction.bind(null, paper.id)}>
                <button className="btn btn-sm" type="submit">改稿重投</button>
              </form>
            )}
            {["submitted", "revision", "rejected"].includes(paper.status) && (
              <form action={discardPaperAction.bind(null, paper.id)}>
                <button className="btn btn-sm btn-danger" type="submit">弃 稿</button>
              </form>
            )}
            <span className="meta">通信作者：{correspondingName}</span>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="card" style={{ padding: 20, marginBottom: 26 }}>
          <h2 className="section-title" style={{ fontSize: 19, marginBottom: 12 }}>掌 门 编 辑 部</h2>
          <EditorialActions paperId={paper.id} status={paper.status} title={paper.title} />
        </div>
      )}

      {/* 提要 */}
      {paper.abstract && (
        <div className="abstract-box">
          <div className="abstract-tag">提 要 / ABSTRACT</div>
          <p>{paper.abstract}</p>
        </div>
      )}

      {/* 正文 */}
      <article className="prose">{renderMarkdown(paper.content)}</article>

      {/* 基金与鸣谢 */}
      {paper.funding && (
        <div className="funding-note">
          <b>基金与鸣谢：</b>{paper.funding}
        </div>
      )}

      {/* 附件档案：已刊公开可取；未刊仅作者与掌门；增删限作者修订窗口，掌门可随时处置 */}
      {showAttachmentCard && (
        <div className="card" style={{ padding: 24, marginBottom: 26 }}>
          <h2 className="section-title" style={{ fontSize: 19, marginBottom: 14 }}>附 件 档 案</h2>
          {attachments.length > 0 && hasCsv && (
            <p className="att-warn" style={{ marginTop: 0 }}>
              注意：CSV 附件以表格软件（Excel / WPS / LibreOffice）打开时，以 = + - @ 起头的单元格
              会被当作公式求值，可能触发链接或外部调用。请确认文件来自可信作者后再开启。
            </p>
          )}

          {attachments.length > 0 ? (
            <ul className="att-list">
              {attachments.map((att) => (
                <li className="att-row" key={att.id}>
                  <span className="att-ext">{att.ext}</span>
                  <a
                    className="att-name"
                    href={`/api/papers/${paper.id}/attachments/${att.id}`}
                    title={att.file_name}
                  >
                    {att.file_name}
                  </a>
                  <span className="att-meta">
                    {formatBytes(att.size)} · {formatDate(att.created_at)}
                  </span>
                  <a
                    className="att-dl"
                    href={`/api/papers/${paper.id}/attachments/${att.id}?dl=1`}
                  >
                    下载
                  </a>
                  {(canManageAttachments || isAdmin) && (
                    <form action={deleteAttachmentAction.bind(null, att.id)}>
                      <button className="btn btn-sm btn-danger" type="submit">删 除</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="att-empty">此稿暂无附件。</p>
          )}

          {canManageAttachments && (
            <>
              <form
                action={uploadAttachmentAction.bind(null, paper.id)}
                className="att-upload"
                style={{ marginTop: 14 }}
              >
                <input
                  type="file"
                  name="file"
                  required
                  accept={ATTACHMENT_ACCEPT}
                  className="att-input"
                />
                <button className="btn btn-sm btn-gold" type="submit">上 传 附 件</button>
              </form>
              <p className="hint" style={{ marginTop: 8 }}>
                支持 PDF、Word、PPT、Excel、TXT/MD、图片与压缩包等常见格式；单件 ≤ {formatBytes(ATTACHMENT_MAX_BYTES)}
                、全部合计 ≤ {formatBytes(ATTACHMENT_TOTAL_BYTES)}、至多 {ATTACHMENT_MAX_COUNT} 件。
                PDF 与图片可在线预览，余者点击即下载。
              </p>
            </>
          )}
          {isOwner && paper.status !== "published" && !canManageAttachments && (
            <p className="hint" style={{ marginTop: 8 }}>
              此稿已进入审稿流程，附件暂不可增删；待掌门退修（或驳回后重投）方可在著者案头处置。
            </p>
          )}
        </div>
      )}

      {/* 引用块（刊印后） */}
      {paper.status === "published" && (
        <CitationBox citation={citation} bibtex={bibtex} />
      )}

      {canDelete && (
        <form action={deletePaperAction.bind(null, paper.id)} style={{ marginTop: 18, textAlign: "center" }}>
          <button className="btn btn-danger" type="submit">撤 稿 焚 文</button>
        </form>
      )}

      <div className="ornament-divider">✻ 终 ✻</div>
      <p className="meta" style={{ textAlign: "center" }}>
        本文刊于 Schola Häagen-Dazs · 《{paper.discipline}》门刊
        {user && user.status === "active" && (
          <span style={{ marginLeft: 14 }}>
            <ReportButton kind="paper" targetId={paper.id} />
          </span>
        )}
      </p>
    </div>
  );
}
