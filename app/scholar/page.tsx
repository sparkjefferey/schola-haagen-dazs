"use client";

import { FormEvent, useState } from "react";
import { Scroll } from "@/components/decor";
import { ALL_SOURCES, SOURCE_LABELS, SourceKey, type PaperItem } from "@/lib/scholar/types";

const SOURCE_COLOR: Record<SourceKey, string> = {
  openalex: "#7a5c00",
  arxiv: "#b31b1b",
  semantic_scholar: "#1f6f54",
  crossref: "#1b4f9c",
};

export default function ScholarPage() {
  const [q, setQ] = useState("");
  const [sources, setSources] = useState<SourceKey[]>(ALL_SOURCES);
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [cached, setCached] = useState(false);

  function toggleSource(s: SourceKey) {
    setSources((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: q.trim(), sources: sources.join(",") });
      if (yearFrom) params.set("year_from", yearFrom);
      if (yearTo) params.set("year_to", yearTo);
      const res = await fetch(`/api/scholar/search?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "检索失败");
      setPapers(data.papers ?? []);
      setTotal(data.total ?? 0);
      setCached(!!data.cached);
    } catch (err) {
      setError((err as Error).message);
      setPapers([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <section className="hero" style={{ padding: "24px 0 6px" }}>
        <Scroll size={52} color="var(--maroon)" />
        <h1 className="big-title" style={{ marginTop: 4 }}>学 林 检 索</h1>
        <p className="quote" style={{ margin: "0 auto" }}>
          通览寰宇学海——自 OpenAlex、arXiv、Semantic Scholar、Crossref 四库并搜，去重呈览。
        </p>
      </section>

      <form onSubmit={run} style={{ maxWidth: 720, margin: "0 auto 18px" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="输入关键词，如：quantum entanglement、古希腊哲学……"
            style={{
              flex: "1 1 320px",
              padding: "10px 14px",
              fontFamily: "var(--serif)",
              fontSize: 16,
              background: "var(--parch-0)",
              border: "1px solid var(--line)",
              borderRadius: 3,
              color: "var(--ink)",
            }}
          />
          <button className="btn btn-gold" type="submit" disabled={loading}>
            {loading ? "检 索 中 …" : "检 索"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
          <span style={{ fontSize: 13, fontFamily: "var(--serif)", color: "var(--ink)", opacity: 0.7 }}>来源：</span>
          {ALL_SOURCES.map((s) => (
            <label
              key={s}
              style={{ fontSize: 13, fontFamily: "var(--serif)", cursor: "pointer", color: "var(--ink)" }}
            >
              <input
                type="checkbox"
                checked={sources.includes(s)}
                onChange={() => toggleSource(s)}
                style={{ marginRight: 4 }}
              />
              {SOURCE_LABELS[s]}
            </label>
          ))}
          <span style={{ fontSize: 13, fontFamily: "var(--serif)", color: "var(--ink)", opacity: 0.7, marginLeft: 8 }}>
            年份：
          </span>
          <input
            value={yearFrom}
            onChange={(e) => setYearFrom(e.target.value)}
            placeholder="起"
            inputMode="numeric"
            style={yearInputStyle}
          />
          <span style={{ color: "var(--ink)", opacity: 0.7 }}>–</span>
          <input
            value={yearTo}
            onChange={(e) => setYearTo(e.target.value)}
            placeholder="止"
            inputMode="numeric"
            style={yearInputStyle}
          />
        </div>
      </form>

      {error && (
        <p className="empty-note" style={{ color: "var(--maroon)", textAlign: "center" }}>
          ⚠ {error}
        </p>
      )}

      {loading && <p className="quote">正自四库徵集篇籍……</p>}

      {!loading && papers.length > 0 && (
        <p className="quote" style={{ fontSize: 13 }}>
          共得 {total} 篇{ cached ? "（缓存）" : "" }，按被引数降序。
          <br />
          <span style={{ opacity: 0.7 }}>
            标注「预印本」者为未经同行评审之草稿（如 arXiv）；其余来源混合预印本与正式发表，未逐一判别。
          </span>
        </p>
      )}

      <div className="card" style={{ padding: "6px 20px 10px" }}>
        {!loading && papers.length === 0 && !error && (
          <p className="empty-note">尚无检索。输入关键词，遍览主流学术平台之论文。</p>
        )}
        {papers.map((p) => (
          <div className="item" key={p.id} style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {p.url ? (
                <a className="title" href={p.url} target="_blank" rel="noreferrer">
                  {p.title}
                </a>
              ) : (
                <span className="title">{p.title}</span>
              )}
              <div className="meta">
                <span
                  className="badge"
                  style={{
                    background: SOURCE_COLOR[p.source],
                    color: "#fff",
                    borderColor: SOURCE_COLOR[p.source],
                  }}
                >
                  {SOURCE_LABELS[p.source]}
                </span>{" "}
                {p.peerReviewed === false && (
                  <span
                    className="badge"
                    style={{ background: "#b31b1b", color: "#fff", borderColor: "#b31b1b" }}
                  >
                    预印本
                  </span>
                )}
                {p.peerReviewed === true && (
                  <span
                    className="badge"
                    style={{ background: "#1f6f54", color: "#fff", borderColor: "#1f6f54" }}
                  >
                    已发表
                  </span>
                )}{" "}
                {p.authors.slice(0, 4).join("、")}
                {p.authors.length > 4 ? " 等" : ""}
                {p.year ? ` · ${p.year}` : ""}
                {p.journal ? ` · ${p.journal}` : ""}
                {p.citationCount ? ` · 引 ${p.citationCount}` : ""}
              </div>
              {p.abstract && (
                <p className="excerpt">
                  {p.abstract.length > 320 ? p.abstract.slice(0, 320) + "…" : p.abstract}
                </p>
              )}
              <div style={{ marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
                {p.pdfUrl && (
                  <a href={p.pdfUrl} target="_blank" rel="noreferrer" style={linkStyle}>
                    PDF ↗
                  </a>
                )}
                {p.doi && (
                  <a
                    href={`https://doi.org/${p.doi}`}
                    target="_blank"
                    rel="noreferrer"
                    style={linkStyle}
                  >
                    DOI ↗
                  </a>
                )}
                {p.keywords.length > 0 && (
                  <span style={{ fontSize: 12, color: "var(--ink)", opacity: 0.6 }}>
                    关键词：{p.keywords.slice(0, 5).join("、")}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const yearInputStyle: React.CSSProperties = {
  width: 70,
  padding: "4px 8px",
  fontFamily: "var(--serif)",
  background: "var(--parch-0)",
  border: "1px solid var(--line)",
  borderRadius: 3,
  color: "var(--ink)",
};

const linkStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--maroon)",
};
