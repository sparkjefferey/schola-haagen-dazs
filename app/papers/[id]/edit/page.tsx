import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPaper } from "@/lib/queries";
import { requireUser } from "@/lib/auth";
import { DISCIPLINES } from "@/lib/db";
import { editPaperAction } from "@/lib/actions";
import { PaperAuthorEditor, type AuthorRow } from "@/components/PaperAuthorEditor";

export const metadata: Metadata = { title: "修订文稿" };

export default async function EditPaperPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const paperId = Number(id);
  if (!Number.isInteger(paperId)) notFound();
  const paper = getPaper(paperId);
  if (!paper) notFound();
  if (paper.author_id !== u.id) notFound();
  if (!["submitted", "revision"].includes(paper.status)) {
    return (
      <div className="card" style={{ maxWidth: 720, margin: "0 auto", padding: 28 }}>
        <p className="notice">此稿已进入审稿流程（{paper.status}），不可再改。若被退修，方得于此修订。</p>
        <Link href={`/papers/${paper.id}`} className="btn">返回文稿</Link>
      </div>
    );
  }

  const defaultAuthors: AuthorRow[] = paper.authors
    .slice()
    .sort((a, b) => a.author_order - b.author_order)
    .map((a) => ({
      display_name: a.display_name,
      affiliation: a.affiliation,
      email: a.email,
      orcid: a.orcid,
      is_corresponding: a.is_corresponding === 1,
    }));

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <h1 className="big-title" style={{ marginBottom: 4 }}>修 订 文 稿</h1>
      <p className="lead" style={{ textAlign: "center", marginTop: 0, marginBottom: 18 }}>
        稿号 <code className="ms-code">{paper.manuscript_code}</code> · 当前状态：
        {paper.status === "revision" ? "掌门退修中" : "已收稿待分诊"}。修订后重新进入流程。
      </p>

      <form action={editPaperAction.bind(null, paper.id)} className="card" style={{ padding: 28 }}>
        <div className="field">
          <label htmlFor="p-title">题 名</label>
          <input id="p-title" name="title" required maxLength={120} defaultValue={paper.title} />
        </div>
        <div className="field">
          <label htmlFor="p-short">短题名 / 栏外题（选填）</label>
          <input id="p-short" name="short_title" maxLength={80} defaultValue={paper.short_title} />
        </div>
        <div className="field">
          <label htmlFor="p-disc">学科门类</label>
          <select id="p-disc" name="discipline" defaultValue={paper.discipline}>
            {DISCIPLINES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="p-key">关 键 词（选填，逗号分隔）</label>
          <input id="p-key" name="keywords" maxLength={200} defaultValue={paper.keywords} />
        </div>
        <div className="field">
          <label htmlFor="p-abs">提 要 / 摘 要</label>
          <textarea id="p-abs" name="abstract" maxLength={600} defaultValue={paper.abstract} style={{ minHeight: 90 }} />
        </div>
        <div className="field">
          <label>作 者 署 名</label>
          <PaperAuthorEditor ownerName={u.display_name} defaultAuthors={defaultAuthors} />
        </div>
        <div className="field">
          <label htmlFor="p-body">正 文</label>
          <textarea id="p-body" name="content" required style={{ minHeight: 320 }} defaultValue={paper.content} />
        </div>
        <div className="field">
          <label htmlFor="p-fund">基 金 与 鸣 谢（选填）</label>
          <textarea id="p-fund" name="funding" maxLength={600} defaultValue={paper.funding} style={{ minHeight: 60 }} />
        </div>
        <div className="field">
          <label htmlFor="p-cover">投 稿 附 言（选填）</label>
          <textarea id="p-cover" name="cover_letter" maxLength={1000} defaultValue={paper.cover_letter} style={{ minHeight: 60 }} />
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-gold" type="submit">保 存 修 订</button>
          <Link href={`/papers/${paper.id}`} className="btn">取消</Link>
        </div>
      </form>
    </div>
  );
}
