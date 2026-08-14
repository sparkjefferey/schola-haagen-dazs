import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPaper, reviewEventsWithActor } from "@/lib/queries";
import { getSessionUser } from "@/lib/auth";
import {
  deletePaperAction,
  discardPaperAction,
  resubmitPaperAction,
  submitRevisionAction,
} from "@/lib/actions";
import ViewTally from "@/components/view-tally";
import ReportButton from "@/components/report-button";
import { Avatar } from "@/components/avatar";
import { renderMarkdown } from "@/lib/md";
import { formatDate } from "@/lib/format";
import { IonicColumn, LaurelWreath } from "@/components/decor";
import { StatusBadge } from "@/components/StatusBadge";
import { CitationBox } from "@/components/CitationBox";
import { ReviewTimeline } from "@/components/ReviewTimeline";
import { EditorialActions } from "@/app/admin/admin-actions";
import { buildCitation, buildBibtex } from "@/lib/paper";

export const metadata: Metadata = { title: "论著" };

export default async function PaperPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const paperId = Number(id);
  if (!Number.isInteger(paperId)) notFound();
  const paper = getPaper(paperId);
  if (!paper) notFound();

  const user = await getSessionUser();
  const isOwner = !!user && user.id === paper.author_id;
  const isAdmin = user?.role === "admin";
  const canReadFull = paper.status === "published" || isOwner || isAdmin;
  if (!canReadFull) notFound();

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
