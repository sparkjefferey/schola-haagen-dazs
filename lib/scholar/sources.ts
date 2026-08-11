// 学术数据源客户端（全部免费、无需 API key）。
// 参考 paper-hunter 的 SourceAdapter 思路，用 TypeScript 在 Schola 内重写：
//   - OpenAlex（主源，2.5 亿篇，10 次/秒，含引文）
//   - arXiv（预印本，3 次/秒，100% 有摘要）
//   - Semantic Scholar（引文 / TLDR，无 key 限流 1 次/秒）
//   - Crossref（权威 DOI 元数据，建议带 mailto）
// 聚合时并发调用、按 DOI 精确 + 标题模糊去重、按被引数降序。

import { ALL_SOURCES, PaperItem, SourceKey } from "./types";

const MAILTO = process.env.SCHOLAR_MAILTO ?? "schola@example.com";
const UA = `ScholaHaagenDazs/0.1 (mailto:${MAILTO})`;

// ---------------- 轻量限流（单进程内存，单 VPS 实例 OK）----------------
const lastCall: Record<string, number> = {};
async function throttle(key: string, minIntervalMs: number) {
  const now = Date.now();
  const last = lastCall[key] ?? 0;
  const wait = Math.max(0, minIntervalMs - (now - last));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall[key] = Date.now();
}

// 单源失败不影响整体
async function guard<T>(p: Promise<T>): Promise<T[]> {
  try {
    return [await p];
  } catch (e) {
    console.error(`[scholar] 源检索失败:`, (e as Error).message);
    return [];
  }
}

// ---------------- OpenAlex ----------------
export async function openAlexSearch(query: string, limit: number): Promise<PaperItem[]> {
  await throttle("openalex", 120);
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(Math.min(limit, 50)));
  url.searchParams.set("mailto", MAILTO);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  const data = (await res.json()) as any;
  const works: any[] = data.results ?? [];
  return works.map((w): PaperItem => ({
    id: `oa_${w.id}`,
    title: w.title ?? "(无题)",
    authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean),
    year: w.publication_year ?? null,
    doi: w.doi ?? null,
    abstract: invertIndex(w.abstract_inverted_index),
    source: "openalex",
    sourceId: w.id,
    url: w.primary_location?.landing_page_url ?? w.id,
    pdfUrl: w.open_access?.oa_url ?? null,
    citationCount: w.cited_by_count ?? 0,
    journal: w.primary_location?.source?.display_name ?? null,
    keywords: (w.concepts ?? []).slice(0, 6).map((c: any) => c.display_name),
  }));
}

// OpenAlex 摘要以倒排索引形式给出，需还原为纯文本
function invertIndex(idx: Record<string, number[]> | null | undefined): string | null {
  if (!idx) return null;
  let max = -1;
  for (const positions of Object.values(idx)) {
    for (const p of positions) if (p > max) max = p;
  }
  if (max < 0) return null;
  const arr = new Array(max + 1).fill("");
  for (const [word, positions] of Object.entries(idx)) {
    for (const p of positions) if (p <= max) arr[p] = word;
  }
  return arr.join(" ").replace(/\s+/g, " ").trim() || null;
}

// ---------------- arXiv（Atom XML）----------------
export async function arxivSearch(query: string, limit: number): Promise<PaperItem[]> {
  await throttle("arxiv", 350);
  const url = new URL("http://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query}`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(Math.min(limit, 50)));
  url.searchParams.set("sortBy", "relevance");
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`arXiv ${res.status}`);
  const xml = await res.text();
  return parseArxiv(xml);
}

function decodeEnt(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function parseArxiv(xml: string): PaperItem[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  return entries.map((e, i): PaperItem => {
    const pick = (re: RegExp): string | null => {
      const m = e.match(re);
      return m ? decodeEnt(m[1] ?? "") : null;
    };
    const title = (pick(/<title>([\s\S]*?)<\/title>/) ?? "").replace(/\s+/g, " ").trim();
    const authors = [...e.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/g)].map((m) =>
      decodeEnt(m[1]).trim()
    );
    const published = pick(/<published>(\d{4})/);
    const year = published ? parseInt(published, 10) : null;
    const idUrl = pick(/<id>([\s\S]*?)<\/id>/);
    const summary = (pick(/<summary>([\s\S]*?)<\/summary>/) ?? "").replace(/\s+/g, " ").trim();
    const pdfM = [...e.matchAll(/<link[^>]*href="([^"]+)"[^>]*type="application\/pdf"/g)];
    const pdfUrl = pdfM.length ? pdfM[0][1] : null;
    const doi = pick(/<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/) ?? pick(/<doi>([\s\S]*?)<\/doi>/);
    const journal = pick(/<arxiv:journal_ref[^>]*>([\s\S]*?)<\/arxiv:journal_ref>/);
    return {
      id: `ax_${idUrl ?? i}`,
      title: title || "(无题)",
      authors,
      year,
      doi,
      abstract: summary || null,
      source: "arxiv",
      sourceId: idUrl,
      url: idUrl,
      pdfUrl,
      citationCount: 0,
      journal: journal ? journal.replace(/\s+/g, " ").trim() : null,
      keywords: [],
    };
  });
}

// ---------------- Semantic Scholar ----------------
export async function semanticScholarSearch(query: string, limit: number): Promise<PaperItem[]> {
  await throttle("ss", 1000);
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(Math.min(limit, 50)));
  url.searchParams.set(
    "fields",
    "title,authors,year,abstract,doi,url,citationCount,externalIds,openAccessPdf,venue"
  );
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 429) throw new Error("Semantic Scholar 限流(429)");
  if (!res.ok) throw new Error(`SemanticScholar ${res.status}`);
  const data = (await res.json()) as any;
  const items: any[] = data.data ?? [];
  return items.map((p): PaperItem => ({
    id: `ss_${p.paperId}`,
    title: p.title ?? "(无题)",
    authors: (p.authors ?? []).map((a: any) => a.name).filter(Boolean),
    year: p.year ?? null,
    doi: p.externalIds?.DOI ?? p.doi ?? null,
    abstract: p.abstract ?? null,
    source: "semantic_scholar",
    sourceId: p.paperId,
    url: p.url ?? null,
    pdfUrl: p.openAccessPdf?.url ?? null,
    citationCount: p.citationCount ?? 0,
    journal: p.venue ?? null,
    keywords: [],
  }));
}

// ---------------- Crossref ----------------
export async function crossrefSearch(query: string, limit: number): Promise<PaperItem[]> {
  await throttle("crossref", 120);
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query", query);
  url.searchParams.set("rows", String(Math.min(limit, 50)));
  url.searchParams.set("mailto", MAILTO);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Crossref ${res.status}`);
  const data = (await res.json()) as any;
  const items: any[] = data.message?.items ?? [];
  return items.map((it): PaperItem => ({
    id: `cr_${it.DOI ?? it.URL ?? Math.random().toString(36)}`,
    title: Array.isArray(it.title) ? it.title[0] : it.title ?? "(无题)",
    authors: (it.author ?? [])
      .map((a: any) => [a.given, a.family].filter(Boolean).join(" "))
      .filter(Boolean),
    year: it.issued?.["date-parts"]?.[0]?.[0] ?? null,
    doi: it.DOI ?? null,
    abstract: cleanCrossrefAbstract(it.abstract),
    source: "crossref",
    sourceId: it.DOI ?? null,
    url: it.URL ?? null,
    pdfUrl: null,
    citationCount: it["is-referenced-by-count"] ?? 0,
    journal: Array.isArray(it["container-title"]) ? it["container-title"][0] : null,
    keywords: Array.isArray(it.subject) ? it.subject.slice(0, 6) : [],
  }));
}

function cleanCrossrefAbstract(s: string | undefined): string | null {
  if (!s) return null;
  return s.replace(/<\/?jats:p[^>]*>/g, " ").replace(/\s+/g, " ").trim() || null;
}

// ---------------- 聚合 + 去重 ----------------
export interface ScholarQuery {
  query: string;
  sources?: SourceKey[];
  limit?: number;
  yearFrom?: number | null;
  yearTo?: number | null;
}

export async function searchScholar(opts: ScholarQuery): Promise<PaperItem[]> {
  const sources = opts.sources ?? ALL_SOURCES;
  const limit = Math.min(opts.limit ?? 30, 50);
  const tasks: Promise<PaperItem[]>[] = [];
  if (sources.includes("openalex")) tasks.push(openAlexSearch(opts.query, limit));
  if (sources.includes("arxiv")) tasks.push(arxivSearch(opts.query, limit));
  if (sources.includes("semantic_scholar")) tasks.push(semanticScholarSearch(opts.query, limit));
  if (sources.includes("crossref")) tasks.push(crossrefSearch(opts.query, limit));

  const settled = await Promise.allSettled(tasks);
  const all: PaperItem[] = [];
  for (const s of settled) if (s.status === "fulfilled") all.push(...s.value);

  let papers = dedupe(all);
  if (opts.yearFrom || opts.yearTo) {
    papers = papers.filter((p) => {
      if (p.year == null) return true;
      if (opts.yearFrom && p.year < opts.yearFrom) return false;
      if (opts.yearTo && p.year > opts.yearTo) return false;
      return true;
    });
  }
  return papers.sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0));
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9一-龥]/g, "").trim();
}

function dedupe(papers: PaperItem[]): PaperItem[] {
  const byDoi = new Map<string, PaperItem>();
  const byTitle = new Map<string, PaperItem>();
  for (const p of papers) {
    if (p.doi) {
      const k = p.doi.toLowerCase();
      const existing = byDoi.get(k);
      if (!existing) {
        byDoi.set(k, { ...p });
      } else {
        existing.citationCount = Math.max(existing.citationCount, p.citationCount);
        if (!existing.abstract && p.abstract) existing.abstract = p.abstract;
      }
      continue;
    }
    const tk = normalizeTitle(p.title);
    if (!byTitle.has(tk)) byTitle.set(tk, { ...p });
  }
  return [...byDoi.values(), ...byTitle.values()];
}
