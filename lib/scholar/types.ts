// 学术检索统一数据模型 —— 借鉴 paper-hunter 的 PaperResult，迁移为 TS 版。
// 此文件不含任何服务端代码（无 fetch / 无 process.env），可安全在客户端与服务端共用。

export type SourceKey = "openalex" | "arxiv" | "semantic_scholar" | "crossref";

export interface PaperItem {
  id: string; // 稳定标识（source + sourceId 或 doi 哈希）
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  abstract: string | null;
  source: SourceKey;
  sourceId: string | null;
  url: string | null;
  pdfUrl: string | null;
  citationCount: number;
  journal: string | null;
  keywords: string[];
  peerReviewed: boolean | null; // 是否已同行评审：false=预印本(草稿)，true=已发表，null=混合来源未判别
}

export const SOURCE_LABELS: Record<SourceKey, string> = {
  openalex: "OpenAlex",
  arxiv: "arXiv",
  semantic_scholar: "Semantic Scholar",
  crossref: "Crossref",
};

export const ALL_SOURCES: SourceKey[] = ["openalex", "arxiv", "semantic_scholar", "crossref"];
