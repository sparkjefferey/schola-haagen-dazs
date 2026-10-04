import { NextResponse, type NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { attachmentDiskPath } from "@/lib/attachments";
import { EXT_INFO } from "@/lib/attachment-formats";

export const dynamic = "force-dynamic";

/**
 * 论文附件下载/预览：
 * - 已刊之文：附件公开可取；未刊之稿：仅作者本人与掌门（与其正文可见性一致，404 不泄露存在性）。
 * - Content-Type 一律查白名单表，不采信任何客户端声明；PDF 与位图内联预览，余者一律下载。
 *   （HTML/SVG 永不入白名单，杜绝内联执行；CSV 一律 attachment 下载，浏览器侧无从执行，
 *   公式注入面仅剩「人工下载后用表格软件打开」，页面已另附警示文案。）
 * - stored_name 由服务端随机生成并经白名单正则校验，路径拼接无注入面。
 * - 支持单段 Range：浏览器原生 PDF 阅读器靠它按需取段，翻到哪页取哪段，
 *   不必先整份下载。服务端依旧流式（createReadStream 定段），不把文件读进内存。
 */

function notFound() {
  return new NextResponse("Not Found", { status: 404 });
}

function contentDisposition(name: string, inline: boolean): string {
  const type = inline ? "inline" : "attachment";
  // ASCII 回退名：非 ASCII 与引号一律折为下划线
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  // RFC 5987：中文等非 ASCII 文件名走 filename*
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

type ByteRange =
  | { kind: "none" } // 语法不合或多段：规范允许服务器无视 Range，回整份
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" }; // 语法合法但越界：回 416

/** 解析单段 Range（bytes=a-b / bytes=a- / bytes=-n）。多段（含逗号）一律当没有。 */
function parseByteRange(header: string, size: number): ByteRange {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return { kind: "none" };
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: "none" };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Number(m[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { kind: "none" };
    end = Math.min(end, size - 1);
  }
  if (start >= size) return { kind: "unsatisfiable" };
  if (start > end) return { kind: "none" };
  return { kind: "partial", start, end };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; attId: string }> },
) {
  const { id, attId } = await ctx.params;
  const paperId = Number(id);
  const aid = Number(attId);
  if (!Number.isInteger(paperId) || !Number.isInteger(aid)) return notFound();

  const row = db
    .prepare(
      `SELECT a.id, a.file_name, a.stored_name, a.ext, a.mime, a.size,
              p.status AS paper_status, p.author_id AS paper_author_id
       FROM paper_attachments a JOIN papers p ON p.id = a.paper_id
       WHERE a.id = ? AND a.paper_id = ?`,
    )
    .get(aid, paperId) as
    | {
        id: number;
        file_name: string;
        stored_name: string;
        ext: string;
        mime: string;
        size: number;
        paper_status: string;
        paper_author_id: number;
      }
    | undefined;
  if (!row) return notFound();

  if (row.paper_status !== "published") {
    const user = await getSessionUser();
    if (
      !user ||
      user.status !== "active" ||
      (user.id !== row.paper_author_id && user.role !== "admin")
    ) {
      return notFound();
    }
  }

  const info = EXT_INFO[row.ext];
  if (!info) return notFound();

  let diskPath: string;
  try {
    diskPath = attachmentDiskPath(row.stored_name);
  } catch {
    return notFound();
  }
  let stat: Awaited<ReturnType<typeof fsp.stat>>;
  try {
    stat = await fsp.stat(diskPath);
  } catch {
    return notFound();
  }

  const etag = `W/"att${row.id}-${row.size}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  const forceDownload = req.nextUrl.searchParams.get("dl") === "1";
  const inline = !forceDownload && !!info.inline;

  const size = stat.size;
  let range: { start: number; end: number } | null = null;
  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    // If-Range 校验不过（文件已换过）就按整份回，免得把陈段拼到新文件上
    const ifRange = req.headers.get("if-range");
    const stale = !!ifRange && ifRange !== etag && ifRange !== stat.mtime.toUTCString();
    if (!stale) {
      const parsed = parseByteRange(rangeHeader, size);
      if (parsed.kind === "unsatisfiable") {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
        });
      }
      if (parsed.kind === "partial") range = { start: parsed.start, end: parsed.end };
    }
  }

  const stream = Readable.toWeb(
    range ? createReadStream(diskPath, { start: range.start, end: range.end }) : createReadStream(diskPath),
  ) as unknown as ReadableStream<Uint8Array>;
  return new NextResponse(stream, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": info.mime,
      "Content-Length": String(range ? range.end - range.start + 1 : size),
      ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` } : {}),
      "Accept-Ranges": "bytes",
      "Content-Disposition": contentDisposition(row.file_name, inline),
      "X-Content-Type-Options": "nosniff",
      ETag: etag,
      "Last-Modified": stat.mtime.toUTCString(),
      // 未刊之稿的附件仅限登录者可见，禁缓存；已刊附件允许短时缓存
      "Cache-Control": row.paper_status === "published" ? "public, max-age=300" : "private, no-store",
    },
  });
}
