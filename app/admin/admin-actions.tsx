"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { REVIEW_FLOW } from "@/lib/paper";

export function RoleSelect({
  userId,
  current,
  isSelf,
}: {
  userId: number;
  current: "admin" | "scholar";
  isSelf: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const role = e.target.value as "admin" | "scholar";
    if (isSelf && role !== current) {
      setError("不可撤销自己的管理者之职");
      return;
    }
    setBusy(true);
    try {
      const { setUserRoleAction } = await import("@/lib/actions");
      await setUserRoleAction(userId, role);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "改职未成");
    }
    setBusy(false);
  }

  return (
    <div>
      <select
        value={current}
        onChange={onChange}
        disabled={busy}
        style={{
          padding: "6px 10px",
          fontFamily: "var(--serif)",
          border: "1px solid var(--line)",
          background: "var(--parch-0)",
          borderRadius: 3,
          color: "var(--ink)",
        }}
      >
        <option value="scholar">学者</option>
        <option value="admin">管理者</option>
      </select>
      {error && <div style={{ fontSize: 12.5, color: "var(--maroon)" }}>{error}</div>}
    </div>
  );
}

export function EndorseToggle({
  userId,
  endorsed,
}: {
  userId: number;
  endorsed: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    try {
      const { setUserEndorsedAction } = await import("@/lib/actions");
      await setUserEndorsedAction(userId, endorsed === 1 ? 0 : 1);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "改印未成");
    }
    setBusy(false);
  }

  return (
    <span>
      <button
        className="btn btn-sm"
        onClick={onClick}
        disabled={busy}
        style={{
          fontSize: 12.5,
          color: endorsed === 1 ? "var(--gold-deep)" : "var(--ink-soft)",
        }}
      >
        {endorsed === 1 ? "已授认证印·收回" : "授认证印"}
      </button>
      {error && <div style={{ fontSize: 12.5, color: "var(--maroon)" }}>{error}</div>}
    </span>
  );
}

export function StatusButtons({
  userId,
  status,
  isSelf,
}: {
  userId: number;
  status: "active" | "banned" | "retired";
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(next: "active" | "banned" | "retired") {
    if (isSelf && next !== "active") {
      setError("不可对自己行此处置（此乃本机最高之权）");
      return;
    }
    const verb =
      next === "banned" ? "封" : next === "retired" ? "除籍" : "恢复";
    const reason =
      next === "active"
        ? "掌门亲赦"
        : window.prompt(
            next === "banned"
              ? `封禁 ${verb} —— 掌门留谕（必填）：`
              : "除籍须履掌门谕令（必填）：",
          );
    if (reason === null) return;
    if (reason.trim() === "") {
      setError("必须留谕缘由");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { setUserStatusAction } = await import("@/lib/actions");
      await setUserStatusAction(userId, next, reason);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "处置未成");
    }
    setBusy(false);
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {status !== "active" && (
        <button className="btn btn-sm btn-gold" onClick={() => run("active")} disabled={busy}>
          恢复在籍
        </button>
      )}
      {status !== "banned" && (
        <button className="btn btn-sm btn-danger" onClick={() => run("banned")} disabled={busy}>
          封禁
        </button>
      )}
      {status !== "retired" && (
        <button className="btn btn-sm" onClick={() => run("retired")} disabled={busy}>
          除籍
        </button>
      )}
      {error && (
        <div style={{ fontSize: 12.5, color: "var(--maroon)", width: "100%" }}>{error}</div>
      )}
    </span>
  );
}

export function DeleteButtons({
  kind,
  id,
  label,
}: {
  kind: "user" | "paper" | "thread";
  id: number;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (!window.confirm(`确定要移除「${label}」吗？此操作不可恢复。`)) return;
    setBusy(true);
    setError(null);
    try {
      const actions = await import("@/lib/actions");
      if (kind === "user") await actions.deleteUserAction(id);
      else if (kind === "paper") await actions.deletePaperAction(id);
      else await actions.deleteThreadAction(id);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
    setBusy(false);
  }

  return (
    <span>
      <button className="btn btn-danger" onClick={onClick} disabled={busy} style={{ opacity: busy ? 0.5 : 1 }}>
        {busy ? "处理中" : "移除"}
      </button>
      {error && <div style={{ fontSize: 12.5, color: "var(--maroon)" }}>{error}</div>}
    </span>
  );
}

export function EditorialActions({
  paperId,
  status,
  title,
}: {
  paperId: number;
  status: "submitted" | "in_review" | "revision" | "accepted" | "published" | "rejected";
  title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps = REVIEW_FLOW[status] || [];

  async function run(step: (typeof steps)[number]) {
    let note = "";
    if (step.needNote) {
      const msg =
        step.key === "reject"
          ? `驳回《${title}》之缘由（必填，作者将可见）：`
          : `请填写「${step.label}」的审稿意见（必填）：`;
      note = window.prompt(msg) ?? "";
      if (note === null) return;
      if (note.trim() === "") {
        setError("必须填写意见");
        return;
      }
    }
    if (step.confirm && !window.confirm(`确定对《${title}》执行「${step.label}」？`)) return;
    setBusy(true);
    setError(null);
    try {
      const a = await import("@/lib/actions");
      if (step.key === "review") await a.sendToReviewAction(paperId);
      else if (step.key === "revision") await a.requestRevisionAction(paperId, note);
      else if (step.key === "accept") await a.acceptPaperAction(paperId, note);
      else if (step.key === "publish") await a.publishPaperAction(paperId);
      else if (step.key === "reject") await a.rejectPaperAction(paperId, note);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作未成");
    }
    setBusy(false);
  }

  if (steps.length === 0)
    return <span className="meta">此稿已刊印，流程终结。</span>;

  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {steps.map((s) => (
        <button
          key={s.key}
          className={`btn btn-sm ${s.gold ? "btn-gold" : s.danger ? "btn-danger" : ""}`}
          disabled={busy}
          onClick={() => run(s)}
        >
          {s.label}
        </button>
      ))}
      {error && (
        <div style={{ fontSize: 12.5, color: "var(--maroon)", width: "100%" }}>{error}</div>
      )}
    </span>
  );
}

export function ReportRowActions({
  reportId,
}: {
  reportId: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "dismiss" | "resolve") {
    if (
      action === "resolve" &&
      !window.confirm("认定检举确有其事？目标将被移除（文/帖/复）。")
    )
      return;
    setBusy(true);
    try {
      const { resolveReportAction } = await import("@/lib/actions");
      await resolveReportAction(reportId, action);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "处置未成");
    }
    setBusy(false);
  }

  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <button className="btn btn-sm btn-gold" onClick={() => act("resolve")} disabled={busy}>
        认定·移除
      </button>
      <button className="btn btn-sm" onClick={() => act("dismiss")} disabled={busy}>
        辩诬·销案
      </button>
      {error && (
        <div style={{ fontSize: 12.5, color: "var(--maroon)", width: "100%" }}>{error}</div>
      )}
    </span>
  );
}
