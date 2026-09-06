"use client";

import { useRef, useState } from "react";
import { formatBytes } from "@/lib/format";
import { ATTACHMENT_ACCEPT, extOf, ALLOWED_EXTS } from "@/lib/attachment-formats";

/**
 * 投稿表单的随稿附件选择器（客户端预校验，服务端仍全量复核）：
 * - 仅白名单扩展名、单件大小、合计大小与数量达标者才进入待传列表；
 * - 不变量：input.files 始终与列表 state 同步——任何拒收分支都会回写既有列表，
 *   否则拒收一次会把已选好的合格文件也静默丢出表单载荷；
 * - 移除通过 DataTransfer 改写 input.files，无 JS 时退化为普通多文件上传，
 *   服务端校验与错误提示照常生效。
 */
export function AttachmentPicker({
  maxCount,
  maxBytes,
  totalBytes,
}: {
  maxCount: number;
  maxBytes: number;
  totalBytes: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  function syncInput(next: File[]) {
    const dt = new DataTransfer();
    next.forEach((f) => dt.items.add(f));
    if (inputRef.current) inputRef.current.files = dt.files;
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // 允许重复选择同一文件；随后各分支都会重建 input.files
    if (picked.length === 0) {
      syncInput(files);
      return;
    }

    const overCount = picked.length + files.length > maxCount;
    const bad = picked.find(
      (f) => !ALLOWED_EXTS.includes(extOf(f.name)) || (f.size > 0 && f.size > maxBytes),
    );
    const empty = picked.find((f) => f.size === 0);
    const overTotal =
      [...files, ...picked].reduce((s, f) => s + f.size, 0) > totalBytes;

    if (overCount) {
      setError(`附件最多 ${maxCount} 件，请分次选择或先移除若干。`);
      syncInput(files);
      return;
    }
    if (bad) {
      if (bad.size > maxBytes) {
        setError(`《${bad.name}》超过单件上限（${formatBytes(maxBytes)}），请压缩后重试。`);
      } else {
        setError(`《${bad.name}》的格式不受支持，请改存 PDF / Word / 图片等常见格式。`);
      }
      syncInput(files);
      return;
    }
    if (empty) {
      setError(`《${empty.name}》是空文件，无法上传。`);
      syncInput(files);
      return;
    }
    if (overTotal) {
      setError(`所选附件合计超过上限（${formatBytes(totalBytes)}），请精简后再传。`);
      syncInput(files);
      return;
    }

    setError(null);
    const next = [...files, ...picked];
    setFiles(next);
    syncInput(next);
  }

  function removeAt(i: number) {
    const next = files.filter((_, idx) => idx !== i);
    setFiles(next);
    syncInput(next);
    setError(null);
  }

  return (
    <div className="att-picker">
      <input
        ref={inputRef}
        type="file"
        name="files"
        multiple
        accept={ATTACHMENT_ACCEPT}
        onChange={onPick}
        className="att-input"
      />
      {files.length > 0 ? (
        <ul className="att-list att-list-pick">
          {files.map((f, i) => (
            <li className="att-row" key={`${f.name}-${i}`}>
              <span className="att-ext">{extOf(f.name) || "?"}</span>
              <span className="att-name" title={f.name}>{f.name}</span>
              <span className="att-meta">{formatBytes(f.size)}</span>
              <button type="button" className="btn btn-sm" onClick={() => removeAt(i)}>
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="att-empty">尚未选择文件。</p>
      )}
      {error && <p className="att-warn">✗ {error}</p>}
    </div>
  );
}
