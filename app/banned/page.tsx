import { Metadata } from "next";
import { db } from "@/lib/db";
import { Amphora } from "@/components/decor";
import Link from "next/link";

export const metadata: Metadata = { title: "门禁外" };

export default async function BannedPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string }>;
}) {
  const { u } = await searchParams;
  const row = u
    ? (db.prepare("SELECT status, banned_reason, display_name FROM users WHERE username = ?").get(u) as any)
    : null;

  const banned = row && row.status === "banned";
  const retired = row && row.status === "retired";

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
      <div style={{ marginTop: 30 }}>
        <Amphora size={64} color="var(--maroon)" />
      </div>
      <h1 className="big-title" style={{ marginTop: 12 }}>
        {retired ? "已 辞 别 学 派" : "学 籍 已 封"}
      </h1>
      {banned && (
        <div className="card" style={{ textAlign: "left", marginTop: 24 }}>
          <p>
            <b>{row.display_name}</b> 的学籍因故被封。掌门留谕：
          </p>
          <blockquote
            style={{
              borderLeft: "3px solid var(--maroon)",
              padding: "4px 16px",
              background: "rgba(109,47,43,0.06)",
              color: "var(--ink-soft)",
              margin: "14px 0",
              fontStyle: "italic",
            }}
          >
            {row.banned_reason || "（未留缘由）"}
          </blockquote>
          <p className="meta">
            如自觉冤枉，可于门墙外上书：直接与掌门面谈，或重新注册以观后效。
          </p>
        </div>
      )}
      {retired && (
        <div className="card" style={{ textAlign: "left", marginTop: 24 }}>
          <p className="meta">
            {row?.display_name} 已自行辞别学派。派内档案仍存，文章留名，署名不改。
            若回心转意，可重入门墙。
          </p>
        </div>
      )}
      <div style={{ marginTop: 26, display: "flex", gap: 12, justifyContent: "center" }}>
        <Link className="btn btn-gold" href="/login">重返门墙</Link>
        <Link className="btn" href="/">回首府</Link>
      </div>
    </div>
  );
}