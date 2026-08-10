"use client";

import { useState } from "react";

export interface AuthorRow {
  display_name: string;
  affiliation: string;
  email: string;
  orcid: string;
  is_corresponding: boolean;
}

export function PaperAuthorEditor({
  ownerName,
  defaultAuthors = [],
}: {
  ownerName: string;
  defaultAuthors?: AuthorRow[];
}) {
  const initial: AuthorRow[] =
    defaultAuthors.length > 0
      ? defaultAuthors
      : [{ display_name: ownerName, affiliation: "", email: "", orcid: "", is_corresponding: true }];
  const [rows, setRows] = useState<AuthorRow[]>(initial);

  function update(i: number, patch: Partial<AuthorRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, { display_name: "", affiliation: "", email: "", orcid: "", is_corresponding: false }]);
  }
  function removeRow(i: number) {
    setRows((rs) => {
      const next = rs.filter((_, idx) => idx !== i);
      if (!next.some((r) => r.is_corresponding)) next[0] = { ...next[0], is_corresponding: true };
      return next;
    });
  }
  function setCorresponding(i: number) {
    setRows((rs) => rs.map((r, idx) => ({ ...r, is_corresponding: idx === i })));
  }

  return (
    <div className="author-editor">
      <input type="hidden" name="authors_json" value={JSON.stringify(rows)} />
      {rows.map((r, i) => (
        <div className="author-row" key={i}>
          <div className="author-row-head">
            <span className="author-idx">作者 {i + 1}</span>
            {i === 0 ? (
              <span className="badge badge-dim">投稿人（默认第一作者）</span>
            ) : (
              <button type="button" className="btn btn-sm" onClick={() => removeRow(i)}>
                移除
              </button>
            )}
          </div>
          <div className="author-grid">
            <label>
              姓名
              <input
                name={`au_name_${i}`}
                value={r.display_name}
                disabled={i === 0}
                onChange={(e) => update(i, { display_name: e.target.value })}
                placeholder="如：张冷"
                required
              />
            </label>
            <label>
              单位 / 机构
              <input
                name={`au_aff_${i}`}
                value={r.affiliation}
                onChange={(e) => update(i, { affiliation: e.target.value })}
                placeholder="如：沙藏学馆 · 乳脂研究所"
              />
            </label>
            <label>
              邮箱
              <input
                name={`au_email_${i}`}
                value={r.email}
                onChange={(e) => update(i, { email: e.target.value })}
                placeholder="选填"
              />
            </label>
            <label>
              ORCID
              <input
                name={`au_orcid_${i}`}
                value={r.orcid}
                onChange={(e) => update(i, { orcid: e.target.value })}
                placeholder="选填 0000-0000-0000-0000"
              />
            </label>
          </div>
          <label className="author-corresp">
            <input
              type="radio"
              name="corresponding"
              checked={r.is_corresponding}
              onChange={() => setCorresponding(i)}
            />
            通信作者（Corresponding Author）
          </label>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={addRow} style={{ marginTop: 4 }}>
        ＋ 增 添 合 著 者
      </button>
    </div>
  );
}
