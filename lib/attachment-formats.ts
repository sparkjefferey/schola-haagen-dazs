/**
 * 论文附件：格式白名单与纯函数（不依赖 Node API，客户端组件亦可引用）。
 * 真正的魔数嗅探、落盘与鉴权见 lib/attachments.ts（服务端专用）。
 *
 * 安全模型：扩展名只声明「意图」，服务端必须再用魔数验证「内容」与意图相符，
 * 两者不符一律拒收（atttype）。展示 MIME 一律查本表，绝不采信客户端声明。
 */

export type MagicFamily =
  | "pdf"
  | "zip"
  | "ole"
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "gzip"
  | "7z"
  | "rar"
  | "tar"
  | "rtf"
  | "text";

export interface AttachmentFormatInfo {
  /** 存库并随下载响应发送的规范 Content-Type */
  mime: string;
  /** 魔数嗅探所属家族（lib/attachments.ts 按此校验文件头） */
  family: MagicFamily;
  /** 可安全内联预览（顶层导航打开）：仅 PDF 与位图；SVG/HTML 永不入白名单 */
  inline?: boolean;
}

export const EXT_INFO: Record<string, AttachmentFormatInfo> = {
  pdf: { mime: "application/pdf", family: "pdf", inline: true },
  doc: { mime: "application/msword", family: "ole" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    family: "zip",
  },
  ppt: { mime: "application/vnd.ms-powerpoint", family: "ole" },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    family: "zip",
  },
  xls: { mime: "application/vnd.ms-excel", family: "ole" },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    family: "zip",
  },
  odt: { mime: "application/vnd.oasis.opendocument.text", family: "zip" },
  odp: { mime: "application/vnd.oasis.opendocument.presentation", family: "zip" },
  ods: { mime: "application/vnd.oasis.opendocument.spreadsheet", family: "zip" },
  rtf: { mime: "application/rtf", family: "rtf" },
  txt: { mime: "text/plain; charset=utf-8", family: "text" },
  md: { mime: "text/markdown; charset=utf-8", family: "text" },
  csv: { mime: "text/csv; charset=utf-8", family: "text" },
  tex: { mime: "application/x-tex", family: "text" },
  png: { mime: "image/png", family: "png", inline: true },
  jpg: { mime: "image/jpeg", family: "jpeg", inline: true },
  jpeg: { mime: "image/jpeg", family: "jpeg", inline: true },
  gif: { mime: "image/gif", family: "gif", inline: true },
  webp: { mime: "image/webp", family: "webp", inline: true },
  zip: { mime: "application/zip", family: "zip" },
  "7z": { mime: "application/x-7z-compressed", family: "7z" },
  rar: { mime: "application/vnd.rar", family: "rar" },
  gz: { mime: "application/gzip", family: "gzip" },
  tgz: { mime: "application/gzip", family: "gzip" },
  tar: { mime: "application/x-tar", family: "tar" },
};

export const ALLOWED_EXTS = Object.keys(EXT_INFO);

/** <input accept> 值：操作系统文件选择框按白名单过滤 */
export const ATTACHMENT_ACCEPT = ALLOWED_EXTS.map((e) => `.${e}`).join(",");

/** 取小写扩展名（最后一个点之后）；无点或空名返回 "" */
export function extOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  if (i <= 0 || i === fileName.length - 1) return "";
  return fileName.slice(i + 1).toLowerCase();
}

/** 展示名消毒：去路径成分与控制字符，压空白，掐头尾点空，限长并保扩展名。 */
export function sanitizeFileName(raw: string): string {
  let base = String(raw ?? "")
    .replace(/[\\/]/g, " ")
    // Windows 保留字符；点号保留（扩展名可读），仅掐头尾
    .replace(/[*?\"<>|:]/g, " ")
    // 去除 C0 控制字符与 DEL（含 CR/LF，杜绝响应头注入）
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s-]+/, "")
    .replace(/[.\s-]+$/, "");
  if (!base) base = "attachment";
  if (base.length > 120) {
    const dot = base.lastIndexOf(".");
    const extPart = dot > 0 && dot >= base.length - 8 ? base.slice(dot) : "";
    base = base.slice(0, Math.max(1, 120 - extPart.length)).trimEnd() + extPart;
  }
  return base;
}
