"use client";

import { useState } from "react";
import { createReportAction } from "@/lib/actions";

export default function ReportButton({
  kind,
  targetId,
}: {
  kind: "thread" | "reply" | "paper";
  targetId: number;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    try {
      await createReportAction(kind, targetId, reason);
      setMsg("已禀报燕京阁检举信箱。");
      setOpen(false);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "检举未成");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          border: "none",
          background: "none",
          color: "var(--ink-faint)",
          fontSize: 12.5,
          cursor: "pointer",
          padding: 0,
          textDecoration: "underline dotted",
          fontFamily: "var(--serif)",
        }}
      >
        检举
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13 }}>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="检举缘由（如：人身毁誉）"
        style={{
          padding: "5px 10px",
          border: "1px solid var(--line)",
          borderRadius: 3,
          fontFamily: "var(--serif)",
          fontSize: 13,
          background: "var(--parch-0)",
          color: "var(--ink)",
        }}
      />
      <button className="btn btn-danger" type="button" onClick={submit} style={{ fontSize: "12.5px" }}>
        禀告
      </button>
      <button
        className="btn btn-sm"
        type="button"
        onClick={() => setOpen(false)}
        style={{ fontSize: "12.5px", padding: "4px 10px" }}
      >
        罢了
      </button>
      {msg && <span style={{ color: "var(--gold-deep)" }}>{msg}</span>}
    </span>
  );
}