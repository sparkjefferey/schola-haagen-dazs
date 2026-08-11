import { NextRequest, NextResponse } from "next/server";
import { searchScholar } from "@/lib/scholar/sources";
import { ALL_SOURCES, SourceKey } from "@/lib/scholar/types";

const VALID = new Set<string>(ALL_SOURCES);

// 简单内存缓存：同一检索不重复打上游 API（上游有限流）。单 VPS 实例 OK。
const cache = new Map<string, { ts: number; data: unknown }>();
const TTL = 5 * 60 * 1000;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ error: "缺少查询参数 q" }, { status: 400 });

  const requested = (sp.get("sources") ?? "").split(",").filter(Boolean);
  const sources = requested.filter((s) => VALID.has(s)) as SourceKey[];
  const limit = Math.min(parseInt(sp.get("limit") ?? "30", 10) || 30, 50);
  const yearFrom = sp.get("year_from") ? parseInt(sp.get("year_from")!, 10) : null;
  const yearTo = sp.get("year_to") ? parseInt(sp.get("year_to")!, 10) : null;

  const key = JSON.stringify({ q, sources, limit, yearFrom, yearTo });
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) {
    const data = hit.data as any[];
    return NextResponse.json({ query: q, cached: true, total: data.length, papers: data });
  }

  const papers = await searchScholar({
    query: q,
    sources: sources.length ? sources : undefined,
    limit,
    yearFrom,
    yearTo,
  });
  cache.set(key, { ts: Date.now(), data: papers });
  return NextResponse.json({ query: q, cached: false, total: papers.length, papers });
}
