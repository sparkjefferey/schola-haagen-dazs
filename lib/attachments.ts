import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { EXT_INFO, extOf, sanitizeFileName } from "./attachment-formats";

/**
 * 论文附件（服务端）：存储于 data/attachments/（Docker 内为持久卷 /app/data），
 * 元数据存 paper_attachments 表。文件名落盘一律用随机十六进制名，展示名存库，
 * 下载路径由本模块唯一构造，杜绝路径拼接注入。
 */

// ---- 配额（环境变量可调，代码内夹紧防呆） ----
const clampNum = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(Number.isFinite(v) ? Math.floor(v) : lo, lo), hi);

const MAX_MB = clampNum(Number(process.env.ATTACHMENT_MAX_MB ?? "20"), 1, 20);
const TOTAL_MB = clampNum(Number(process.env.ATTACHMENT_TOTAL_MB ?? "50"), 5, 200);
const MAX_COUNT = clampNum(Number(process.env.ATTACHMENT_MAX_COUNT ?? "10"), 1, 30);

export const ATTACHMENT_MAX_BYTES = MAX_MB * 1024 * 1024;
export const ATTACHMENT_TOTAL_BYTES = TOTAL_MB * 1024 * 1024;
export const ATTACHMENT_MAX_COUNT = MAX_COUNT;

export const ATTACHMENTS_DIR = path.join(process.cwd(), "data", "attachments");
fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

export interface PaperAttachment {
  id: number;
  paper_id: number;
  file_name: string;
  stored_name: string;
  ext: string;
  mime: string;
  size: number;
  uploaded_by: number;
  created_at: string;
}

// ---- 错误码（与页面提示语一一对应，见 papers 页 ATTACHMENT_ERRORS） ----

export type AttachmentErrorCode =
  | "attnone"
  | "attempty"
  | "atttype"
  | "attsize"
  | "attcount"
  | "atttotal"
  | "attfail";

export class AttachmentError extends Error {
  code: AttachmentErrorCode;
  constructor(code: AttachmentErrorCode) {
    super(`attachment: ${code}`);
    this.code = code;
  }
}

// ---- 查询 ----

export function getAttachments(paperId: number): PaperAttachment[] {
  return db
    .prepare("SELECT * FROM paper_attachments WHERE paper_id = ? ORDER BY id ASC")
    .all(paperId) as PaperAttachment[];
}

export function countAttachments(paperId: number): number {
  return (
    db.prepare("SELECT COUNT(*) AS c FROM paper_attachments WHERE paper_id = ?").get(paperId) as {
      c: number;
    }
  ).c;
}

export function getAttachment(attId: number): PaperAttachment | null {
  const row = db.prepare("SELECT * FROM paper_attachments WHERE id = ?").get(attId) as
    | PaperAttachment
    | undefined;
  return row ?? null;
}

// ---- 磁盘路径（stored_name 白名单校验，杜绝路径穿越） ----

const STORED_NAME_RE = /^att_[0-9a-f]{32}\.[a-z0-9]{1,8}$/;

export function attachmentDiskPath(storedName: string): string {
  if (!STORED_NAME_RE.test(storedName)) throw new Error("附件存储名非法");
  const p = path.join(ATTACHMENTS_DIR, storedName);
  if (!path.resolve(p).startsWith(ATTACHMENTS_DIR + path.sep)) throw new Error("附件路径越界");
  return p;
}

// ---- 校验（扩展名白名单 + 魔数嗅探 + 配额） ----

function sniffMatches(ext: string, bytes: Buffer): boolean {
  const info = EXT_INFO[ext];
  if (!info) return false;
  const head = bytes.subarray(0, Math.min(bytes.length, 4096));
  const ascii = (from: number, to: number) => head.subarray(from, to).toString("latin1");
  const startsWith = (...sig: number[]) => sig.every((b, i) => head[i] === b);
  switch (info.family) {
    case "pdf":
      return startsWith(0x25, 0x50, 0x44, 0x46); // %PDF-
    case "zip":
      // docx/pptx/xlsx/odt 及通用 zip：PK\x03\x04（空 zip 为 PK\x05\x06 / PK\x07\x08）
      return (
        startsWith(0x50, 0x4b, 0x03, 0x04) ||
        startsWith(0x50, 0x4b, 0x05, 0x06) ||
        startsWith(0x50, 0x4b, 0x07, 0x08)
      );
    case "ole":
      return startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1); // 旧版 doc/ppt/xls
    case "png":
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "jpeg":
      return startsWith(0xff, 0xd8, 0xff);
    case "gif":
      return ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a";
    case "webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "gzip":
      return startsWith(0x1f, 0x8b);
    case "7z":
      return startsWith(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c);
    case "rar":
      return ascii(0, 4) === "Rar!" && head[4] === 0x1a && head[5] === 0x07;
    case "tar":
      return bytes.length > 262 && ascii(257, 262) === "ustar";
    case "rtf":
      return ascii(0, 5) === "{\\rtf";
    case "text":
      // 文本启发式：首 4KB 不含 NUL 字节（UTF-8/GBK 文本均通过，二进制几乎必含 NUL）
      return !head.includes(0);
    default:
      return false;
  }
}

export interface InspectedUpload {
  file_name: string;
  ext: string;
  mime: string;
  size: number;
  bytes: Buffer;
}

/** 全面校验单个上传文件（不落盘、不写库）。任何不合格都以 AttachmentError 抛出。 */
export async function inspectUpload(file: File): Promise<InspectedUpload> {
  if (!(file instanceof File)) throw new AttachmentError("attnone");
  const ext = extOf(file.name || "");
  if (!ext || !EXT_INFO[ext]) throw new AttachmentError("atttype");
  if (file.size <= 0) throw new AttachmentError("attempty");
  if (file.size > ATTACHMENT_MAX_BYTES) throw new AttachmentError("attsize");

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new AttachmentError("attfail");
  if (!sniffMatches(ext, bytes)) throw new AttachmentError("atttype");

  return {
    file_name: sanitizeFileName(file.name),
    ext,
    mime: EXT_INFO[ext].mime,
    size: bytes.length,
    bytes,
  };
}

/** 随稿批量校验：数量、总量、逐件内容（此时尚无 paper_id，只验不存）。 */
export async function inspectUploadBatch(files: File[]): Promise<InspectedUpload[]> {
  if (files.length > ATTACHMENT_MAX_COUNT) throw new AttachmentError("attcount");
  const out: InspectedUpload[] = [];
  let total = 0;
  for (const f of files) {
    const ins = await inspectUpload(f);
    total += ins.size;
    out.push(ins);
  }
  if (total > ATTACHMENT_TOTAL_BYTES) throw new AttachmentError("atttotal");
  return out;
}

// ---- 落盘与入库 ----

/**
 * 把一件已校验的文件落到磁盘并登记入库（随机存储名）。
 * 写库失败时回收磁盘文件，保持两侧一致。
 */
export async function storeInspected(
  paperId: number,
  uploadedBy: number,
  ins: InspectedUpload,
): Promise<PaperAttachment> {
  const storedName = `att_${randomBytes(16).toString("hex")}.${ins.ext}`;
  const diskPath = attachmentDiskPath(storedName);
  try {
    await fsp.writeFile(diskPath, ins.bytes, { flag: "wx" });
  } catch {
    throw new AttachmentError("attfail");
  }
  try {
    const info = db
      .prepare(
        `INSERT INTO paper_attachments (paper_id, file_name, stored_name, ext, mime, size, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(paperId, ins.file_name, storedName, ins.ext, ins.mime, ins.size, uploadedBy);
    return {
      id: Number(info.lastInsertRowid),
      paper_id: paperId,
      file_name: ins.file_name,
      stored_name: storedName,
      ext: ins.ext,
      mime: ins.mime,
      size: ins.size,
      uploaded_by: uploadedBy,
      created_at: "",
    };
  } catch (e) {
    fsp.unlink(diskPath).catch(() => {});
    throw e instanceof AttachmentError ? e : new AttachmentError("attfail");
  }
}

/**
 * 校验并存储一件上传（供「著者案头」单件上传使用）。
 * 全部异步工作（读文件、校验、落盘）先完成，再以单条原子语句复核配额并入库——
 * better-sqlite3 单条语句同步执行，语句内部无 await 间隙，杜绝并发 TOCTOU。
 */
export async function storeUpload(paperId: number, uploadedBy: number, file: File): Promise<PaperAttachment> {
  const ins = await inspectUpload(file);
  const storedName = `att_${randomBytes(16).toString("hex")}.${ins.ext}`;
  const diskPath = attachmentDiskPath(storedName);
  try {
    await fsp.writeFile(diskPath, ins.bytes, { flag: "wx" });
  } catch {
    throw new AttachmentError("attfail");
  }

  const info = db
    .prepare(
      `INSERT INTO paper_attachments (paper_id, file_name, stored_name, ext, mime, size, uploaded_by)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM paper_attachments WHERE paper_id = ?) < ?
         AND (SELECT COALESCE(SUM(size), 0) FROM paper_attachments WHERE paper_id = ?) + ? <= ?`,
    )
    .run(
      paperId, ins.file_name, storedName, ins.ext, ins.mime, ins.size, uploadedBy,
      paperId, ATTACHMENT_MAX_COUNT, paperId, ins.size, ATTACHMENT_TOTAL_BYTES,
    );
  if (info.changes === 0) {
    unlinkQuiet(storedName);
    throw new AttachmentError(
      countAttachments(paperId) >= ATTACHMENT_MAX_COUNT ? "attcount" : "atttotal",
    );
  }
  return {
    id: Number(info.lastInsertRowid),
    paper_id: paperId,
    file_name: ins.file_name,
    stored_name: storedName,
    ext: ins.ext,
    mime: ins.mime,
    size: ins.size,
    uploaded_by: uploadedBy,
    created_at: "",
  };
}

// ---- 删除（方向统一为「先删库行、后回收文件」：DB 失败时文件与行俱在、可重试；
//      unlink 失败的孤儿文件由启动清扫回收，失败留痕） ----

function unlinkQuiet(storedName: string) {
  try {
    fs.unlinkSync(attachmentDiskPath(storedName));
  } catch (e: any) {
    if (e?.code === "ENOENT") return; // 文件本就不在：正常
    console.error(`[attachments] 附件文件删除失败（待启动清扫回收）: ${storedName}: ${e?.message ?? e}`);
  }
}

export function unlinkStoredFiles(storedNames: string[]) {
  for (const n of storedNames) unlinkQuiet(n);
}

export function removeAttachmentRow(att: Pick<PaperAttachment, "id" | "stored_name">) {
  db.prepare("DELETE FROM paper_attachments WHERE id = ?").run(att.id);
  unlinkQuiet(att.stored_name);
}

/** 论文被删除（撤稿/弃稿）前取其附件存储名；DELETE 成功后交 unlinkStoredFiles 回收。 */
export function listPaperAttachmentStoredNames(paperId: number): string[] {
  return getAttachments(paperId).map((a) => a.stored_name);
}

/** 用户被除籍前取其名下所有附件存储名；DELETE 成功后交 unlinkStoredFiles 回收。 */
export function listUserAttachmentStoredNames(userId: number): string[] {
  return (
    db
      .prepare(
        `SELECT a.stored_name FROM paper_attachments a
         JOIN papers p ON p.id = a.paper_id WHERE p.author_id = ?`,
      )
      .all(userId) as { stored_name: string }[]
  ).map((r) => r.stored_name);
}

/**
 * 启动孤儿清扫：data/attachments/ 中命名合法但库中已无登记、且超过 1 小时
 * （避开并发写入窗口）的文件予以回收。任何一侧删除失败留下的孤儿由此兜底。
 */
function sweepOrphanAttachments() {
  try {
    const names = fs
      .readdirSync(ATTACHMENTS_DIR)
      .filter((n) => STORED_NAME_RE.test(n));
    if (names.length === 0) return;
    const inDb = new Set(
      (
        db.prepare("SELECT stored_name FROM paper_attachments").all() as {
          stored_name: string;
        }[]
      ).map((r) => r.stored_name),
    );
    const cutoff = Date.now() - 3600_000;
    for (const name of names) {
      if (inDb.has(name)) continue;
      try {
        const st = fs.statSync(path.join(ATTACHMENTS_DIR, name));
        if (st.mtimeMs < cutoff) {
          fs.unlinkSync(path.join(ATTACHMENTS_DIR, name));
          console.warn(`[attachments] 回收孤儿附件文件: ${name}`);
        }
      } catch {
        /* stat 失败的文件留待下轮 */
      }
    }
  } catch {
    /* 目录不可读：留待下轮 */
  }
}

sweepOrphanAttachments();
