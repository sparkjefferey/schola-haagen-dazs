import { PAPER_STATUS } from "@/lib/paper";
import type { PaperStatus } from "@/lib/db";

export function StatusBadge({ status }: { status: PaperStatus }) {
  const meta = PAPER_STATUS[status];
  return (
    <span className={`badge badge-${meta.cls || "default"}`} title={meta.sub}>
      {meta.label}
      {meta.sub ? <span style={{ opacity: 0.7, marginLeft: 6, fontSize: "0.82em", fontFamily: "var(--serif)" }}>{meta.sub}</span> : null}
    </span>
  );
}
