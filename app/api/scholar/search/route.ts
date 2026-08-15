import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { searchScholar } from "@/lib/scholar/sources";
import { ALL_SOURCES, SourceKey } from "@/lib/scholar/types";
import { consumeFixedWindow, type RateLimitResult } from "@/lib/rate-limit";

const VALID = new Set<string>(ALL_SOURCES);

// 简单内存缓存：同一检索不重复打上游 API（上游有限流）。单 VPS 实例 OK。
const cache = new Map<string, { ts: number; data: unknown }>();
const TTL = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const MAX_QUERY_LENGTH = 200;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const CLIENT_RATE_LIMIT = positiveInt(process.env.SCHOLAR_CLIENT_RATE_LIMIT, 20);

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.status !== "active") {
    return NextResponse.json(
      { error: "请先登录后再使用学术检索。" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ error: "缺少查询参数 q" }, { status: 400 });
  if (q.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: `查询词不可超过 ${MAX_QUERY_LENGTH} 字` }, { status: 400 });
  }

  const requested = (sp.get("sources") ?? "").split(",").filter(Boolean);
  const sources = requested.filter((s) => VALID.has(s)) as SourceKey[];
  if (requested.length > 0 && sources.length === 0) {
    return NextResponse.json({ error: "没有有效的检索来源" }, { status: 400 });
  }
  const limit = Math.min(Math.max(parseInt(sp.get("limit") ?? "30", 10) || 30, 1), 50);
  const yearFrom = parseYear(sp.get("year_from"));
  const yearTo = parseYear(sp.get("year_to"));
  if (yearFrom === undefined || yearTo === undefined || (yearFrom && yearTo && yearFrom > yearTo)) {
    return NextResponse.json({ error: "年份范围无效" }, { status: 400 });
  }

  // 只限制当前登录账号，不使用可伪造的代理 IP 头，也不会让一个人的请求占满全站额度。
  const clientRate = consumeFixedWindow(
    `scholar:user:${user.id}`,
    CLIENT_RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  if (clientRate.limited) return rateLimitedResponse(clientRate);

  const key = JSON.stringify({ q, sources, limit, yearFrom, yearTo });
  const now = Date.now();
  for (const [cacheKey, entry] of cache) {
    if (now - entry.ts >= TTL) cache.delete(cacheKey);
  }
  const hit = cache.get(key);
  if (hit) {
    const data = hit.data as any[];
    return searchResponse({ query: q, cached: true, total: data.length, papers: data }, clientRate);
  }

  const papers = await searchScholar({
    query: q,
    sources: sources.length ? sources : undefined,
    limit,
    yearFrom,
    yearTo,
  });
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { ts: Date.now(), data: papers });
  return searchResponse({ query: q, cached: false, total: papers.length, papers }, clientRate);
}

function rateHeaders(rate: RateLimitResult): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(rate.limit),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function searchResponse(body: unknown, rate: RateLimitResult) {
  return NextResponse.json(body, { headers: rateHeaders(rate) });
}

function rateLimitedResponse(rate: RateLimitResult) {
  const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    {
      error: `检索过于频繁，请在约 ${Math.ceil(retryAfter / 60)} 分钟后再试。`,
      retryAfter,
    },
    {
      status: 429,
      headers: { ...rateHeaders(rate), "Retry-After": String(retryAfter) },
    },
  );
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseYear(value: string | null): number | null | undefined {
  if (!value) return null;
  if (!/^\d{4}$/.test(value)) return undefined;
  const year = Number(value);
  const maxYear = new Date().getUTCFullYear() + 1;
  return year >= 1800 && year <= maxYear ? year : undefined;
}
