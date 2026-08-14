import type { Paper, PaperAuthor } from "./db";

export interface PaperStatusMeta {
  /** 中文主标签 */
  label: string;
  /** 括号内副说明（仿期刊状态词） */
  sub: string;
  /** 对应徽章 class 后缀 */
  cls: "dim" | "gold" | "warn" | "ok" | "danger" | "";
  /** 时间线节点色 */
  dot: string;
}

export const PAPER_STATUS: Record<Paper["status"], PaperStatusMeta> = {
  submitted: { label: "已收稿", sub: "待分诊", cls: "dim", dot: "#8a6d3b" },
  in_review: { label: "送审中", sub: "Under Review", cls: "gold", dot: "#b08a2e" },
  revision: { label: "退修", sub: "Revise", cls: "warn", dot: "#c97b2c" },
  accepted: { label: "录用待刊", sub: "Accepted", cls: "ok", dot: "#3f7d4f" },
  published: { label: "已刊印", sub: "Published", cls: "", dot: "#7d3b35" },
  rejected: { label: "驳回", sub: "Rejected", cls: "danger", dot: "#9c2b22" },
};

/** 给定当前状态，返回掌门可执行的下一步动作（驱动审稿台按钮） */
export const REVIEW_FLOW: Record<
  Paper["status"],
  { key: string; label: string; to: Paper["status"]; needNote?: boolean; danger?: boolean; gold?: boolean; confirm?: boolean }[]
> = {
  submitted: [
    { key: "review", label: "收稿·送审", to: "in_review", gold: true, confirm: true },
    { key: "reject", label: "直接驳回", to: "rejected", needNote: true, danger: true },
  ],
  in_review: [
    { key: "revision", label: "退修（附意见）", to: "revision", needNote: true, confirm: true },
    { key: "accept", label: "录用", to: "accepted", gold: true, confirm: true },
    { key: "reject", label: "驳回", to: "rejected", needNote: true, danger: true },
  ],
  revision: [
    { key: "accept", label: "录用", to: "accepted", gold: true, confirm: true },
    { key: "reject", label: "驳回", to: "rejected", needNote: true, danger: true },
  ],
  accepted: [
    { key: "publish", label: "刊印成典", to: "published", gold: true, confirm: true },
  ],
  published: [],
  rejected: [
    { key: "review", label: "复活·送审", to: "in_review", gold: true, confirm: true },
  ],
};

/** 生成标准引文（GB/T 7714 风格，学派化） */
export function buildCitation(
  paper: Pick<Paper, "title" | "discipline" | "manuscript_code" | "created_at" | "published_at">,
  authors: Pick<PaperAuthor, "display_name">[],
): string {
  const names =
    authors.length === 0
      ? "佚名"
      : authors.length > 3
        ? `${authors.slice(0, 3).map((a) => a.display_name).join(", ")} 等`
        : authors.map((a) => a.display_name).join(", ");
  const year = (paper.published_at || paper.created_at || "").slice(0, 4) || "XXXX";
  return `${names}. ${paper.title}[J]. Schola Häagen-Dazs, ${year}(${paper.discipline}门刊). ${paper.manuscript_code}.`;
}

/** 生成 BibTeX 引文 */
export function buildBibtex(
  paper: Pick<Paper, "title" | "discipline" | "manuscript_code" | "created_at" | "published_at" | "abstract">,
  authors: Pick<PaperAuthor, "display_name">[],
): string {
  const year = (paper.published_at || paper.created_at || "").slice(0, 4) || "XXXX";
  const key = `${paper.manuscript_code}`.replace(/[^A-Za-z0-9]/g, "");
  const authorStr = authors.map((a) => a.display_name).join(" and ");
  return `@article{${key},
  title = {${paper.title}},
  journal = {Schola Häagen-Dazs},
  year = {${year}},
  note = {${paper.discipline}门刊 · ${paper.manuscript_code}},
  abstract = {${paper.abstract}},
  author = {${authorStr}}
}`;
}
