"use client";

import { useState } from "react";
import { AttachmentPicker } from "@/components/AttachmentPicker";
import { formatBytes } from "@/lib/format";

/**
 * 投稿表单的「正文 + 手稿文件」两栏。
 *
 * 正文与手稿文件是同一件东西的两种载体，至少其一即可：正文留空、以 PDF 等手稿文件呈递，
 * 是学界常态，不该逼人把 PDF 再打一遍。故两栏共用一个客户端状态——
 * AttachmentPicker 报来已选件数，正文框据此松开 required 并改文案。
 *
 * 无 JS 时 fileCount 恒为 0，正文仍为必填：比服务端规矩更严，但绝不更松，
 * 且服务端始终按「至少其一」复核，投不出半截稿。
 */
export function PaperManuscriptFields({
  maxCount,
  maxBytes,
  totalBytes,
}: {
  maxCount: number;
  maxBytes: number;
  totalBytes: number;
}) {
  const [fileCount, setFileCount] = useState(0);
  const byAttachment = fileCount > 0;

  return (
    <>
      <div className="field">
        <label htmlFor="p-body">
          正 文{byAttachment ? `（可留空 · 已随稿 ${fileCount} 件手稿）` : ""}
        </label>
        <textarea
          id="p-body"
          name="content"
          required={!byAttachment}
          style={{ minHeight: 320 }}
          placeholder={
            "## 一、缘起\n\n此处正文（最少 30 字）。\n\n正文若随 PDF 等手稿文件呈递，此处可留空。\n\n> 引语可用 > 起头。\n\n- 条目可用 - 开头。"
          }
        />
        <div className="hint">
          {byAttachment ? (
            <>已随稿 {fileCount} 件手稿文件，正文此处可留空；若两处都填，刊印时一并呈现。</>
          ) : (
            <>正文与手稿文件至少其一：正文须 30 字以上，或于下方随稿上传手稿文件。</>
          )}
        </div>
      </div>

      <div className="field">
        <label htmlFor="p-files">
          手 稿 文 件 / 附 件{byAttachment ? "" : "（正文留空时必传）"}
        </label>
        <AttachmentPicker
          maxCount={maxCount}
          maxBytes={maxBytes}
          totalBytes={totalBytes}
          onCountChange={setFileCount}
        />
        <div className="hint">
          支持 PDF、Word、PPT、Excel、OpenDocument、TXT/MD/CSV/TeX、PNG/JPG/GIF/WEBP、ZIP/7z/RAR/TAR.GZ；
          内容与扩展名不符者拒收。单件 ≤ {formatBytes(maxBytes)}、全部合计 ≤ {formatBytes(totalBytes)}、至多{" "}
          {maxCount} 件。PDF 与图片刊后可在线预览，余者点击即下载。
        </div>
      </div>
    </>
  );
}
