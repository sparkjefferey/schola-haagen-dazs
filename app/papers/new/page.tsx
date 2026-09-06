import { Metadata } from "next";
import Link from "next/link";
import { DISCIPLINES } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { createPaperAction } from "@/lib/actions";
import { PaperAuthorEditor } from "@/components/PaperAuthorEditor";
import { AttachmentPicker } from "@/components/AttachmentPicker";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_COUNT, ATTACHMENT_TOTAL_BYTES } from "@/lib/attachments";
import { formatBytes } from "@/lib/format";

export const metadata: Metadata = { title: "著书立说" };

const PAPER_ERRORS: Record<string, string> = {
  cooldown: "入派未满一日，须静候 24 小时方可著书。",
  title: "论著标题须在 4–120 字之间。",
  abstract: "提要过长（限 600 字）。",
  body: "正文至少 30 字。",
  rate: "一小时之内投稿甚勤，请稍歇再著。",
  atttype: "附件格式不受支持，或文件内容与扩展名不符（仅收常见文档、图片与压缩包）。",
  attsize: "单个附件超过大小上限，请压缩后重试。",
  attempty: "附件中存在空文件，无法收讫。",
  attcount: "附件数量超出上限，请精简后重投。",
  atttotal: "附件总大小超出上限，请精简后重投。",
  attfail: "附件保存失败，请重试；收稿或退修期间亦可于「著者案头」补传。",
};

export default async function NewPaperPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const u = await requireUser();
  const { e } = await searchParams;
  const err = e ? PAPER_ERRORS[e] : null;
  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <h1 className="big-title" style={{ marginBottom: 4 }}>著 书 立 说</h1>
      <p className="lead" style={{ textAlign: "center", marginTop: 0, marginBottom: 18 }}>
        投稿须知：凡所投文稿，经掌门编辑部收稿、送审、退修、录用、刊印，方成正典。
        认证学者投稿免分诊直送审；余者进「已收稿」待掌门分诊。
      </p>
      {err && <p className="notice" style={{ color: "var(--maroon-deep)" }}>✗ {err}</p>}

      <div className="submission-guide">
        <b>投 稿 须 知（请先阅）</b>
        <ul>
          <li>题名与短题名（栏外题）须确切，刊印后题名一般不再更易。</li>
          <li>摘要以 5–10 句概述要旨，将刊于题下；关键词便于检索。</li>
          <li>作者署名请如实填列单位与通信作者；多作者请逐一增列。</li>
          <li>基金与鸣谢、投稿附言均为选填；正文支持 ## 小标题与 &gt; 引语。</li>
          <li>
            手稿文件（PDF、Word、PPT、图片、压缩包等）可随稿上传，单件 ≤ {formatBytes(ATTACHMENT_MAX_BYTES)}
            、全部合计 ≤ {formatBytes(ATTACHMENT_TOTAL_BYTES)}、至多 {ATTACHMENT_MAX_COUNT} 件；
            收稿或退修期间（及被驳回后重投）可于文稿页「著者案头」增删。
          </li>
        </ul>
      </div>

      <form action={createPaperAction} className="card" style={{ padding: 28 }}>
        <div className="field">
          <label htmlFor="p-title">题 名</label>
          <input id="p-title" name="title" required maxLength={120} placeholder="《……论》" />
          <div className="hint">正式论著请以书名号或副题立名（4–120 字）。</div>
        </div>
        <div className="field">
          <label htmlFor="p-short">短题名 / 栏外题（选填）</label>
          <input id="p-short" name="short_title" maxLength={80} placeholder="用于页眉的简题（≤80 字）" />
        </div>
        <div className="field">
          <label htmlFor="p-disc">学科门类</label>
          <select id="p-disc" name="discipline" defaultValue="乳脂哲学">
            {DISCIPLINES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="p-key">关 键 词（选填，逗号分隔）</label>
          <input id="p-key" name="keywords" maxLength={200} placeholder="如：乳脂哲学，感官，冷食" />
        </div>
        <div className="field">
          <label htmlFor="p-abs">提 要 / 摘 要</label>
          <textarea id="p-abs" name="abstract" maxLength={600} placeholder="以 5–10 句概述此篇要旨，将见于论文库题下。" style={{ minHeight: 90 }} />
          <div className="hint">限 600 字。</div>
        </div>
        <div className="field">
          <label>作 者 署 名</label>
          <PaperAuthorEditor ownerName={u.display_name} />
          <div className="hint">第一作者默认为投稿人；可增列合著者并指定通信作者。</div>
        </div>
        <div className="field">
          <label htmlFor="p-body">正 文</label>
          <textarea id="p-body" name="content" required style={{ minHeight: 320 }} placeholder={"## 一、缘起\n\n此处正文（最少 30 字）。\n\n## 二、论证\n\n> 引语可用 > 起头。\n\n- 条目可用 - 开头。"} />
        </div>
        <div className="field">
          <label htmlFor="p-files">附 件 / 手 稿 文 件（选填）</label>
          <AttachmentPicker maxCount={ATTACHMENT_MAX_COUNT} maxBytes={ATTACHMENT_MAX_BYTES} totalBytes={ATTACHMENT_TOTAL_BYTES} />
          <div className="hint">
            支持 PDF、Word、PPT、Excel、OpenDocument、TXT/MD/CSV/TeX、PNG/JPG/GIF/WEBP、ZIP/7z/RAR/TAR.GZ；
            内容与扩展名不符者拒收。PDF 与图片刊后可在线预览，余者点击即下载。
          </div>
        </div>
        <div className="field">
          <label htmlFor="p-fund">基 金 与 鸣 谢（选填）</label>
          <textarea id="p-fund" name="funding" maxLength={600} placeholder="如：本研究受……资助；谨谢……" style={{ minHeight: 60 }} />
        </div>
        <div className="field">
          <label htmlFor="p-cover">投 稿 附 言（选填）</label>
          <textarea id="p-cover" name="cover_letter" maxLength={1000} placeholder="给掌门编辑部的附言（选填）。" style={{ minHeight: 60 }} />
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-gold" type="submit">投 稿 入 库</button>
          <Link href="/papers" className="btn">退出不复</Link>
        </div>
      </form>
    </div>
  );
}
