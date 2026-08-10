"use client";

import { useState } from "react";

export function CitationBox({ citation, bibtex }: { citation: string; bibtex: string }) {
  const [copied, setCopied] = useState(false);
  const [showBib, setShowBib] = useState(false);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="cite-box">
      <div className="cite-head">如 何 引 用</div>
      <p className="cite-text">{citation}</p>
      <div className="cite-actions">
        <button type="button" className="btn btn-sm btn-gold" onClick={() => copy(citation)}>
          {copied ? "已复制" : "复制引文"}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setShowBib((s) => !s)}>
          {showBib ? "收起 BibTeX" : "BibTeX"}
        </button>
      </div>
      {showBib && <pre className="cite-bib">{bibtex}</pre>}
    </div>
  );
}
