"use client";

import { useEffect, useState } from "react";

/**
 * 手稿在线阅读器（客户端）。
 *
 * 学界投稿多以 PDF 呈递，读者不该先下载再读。此处嵌的是浏览器原生 PDF 阅读器，
 * 指向同源附件路由（该路由支持 Range，按需取段，服务端与浏览器都不必整份驻留内存）。
 *
 * 低内存取向，三条都守：
 *   1. 默认收起——不点开就不建 iframe，浏览论文库不会为每篇稿子白拉一份 PDF；
 *   2. 关闭即卸载 iframe，浏览器随即释放阅读器与其缓存；
 *   3. 阅读器是浮层而非页内嵌块，同一时刻至多一份 PDF 在内存里。
 *
 * 退路：手机上部分浏览器（如 iOS Safari）页内 PDF 只能翻首屏，
 * 故浮层顶端常驻「另开一页」与「下载」，不与浏览器较劲。
 */
export function PdfReader({
  href,
  downloadHref,
  fileName,
  label = "在 线 阅 读",
  buttonClass = "btn btn-sm btn-gold",
}: {
  href: string;
  downloadHref: string;
  fileName: string;
  label?: string;
  buttonClass?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // 浮层之下不许页面跟着滚
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) {
    return (
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(false)}>
        收 起
      </button>
      <div className="reader-mask" role="dialog" aria-modal="true" aria-label={fileName} onClick={() => setOpen(false)}>
        <div className="reader-box" onClick={(e) => e.stopPropagation()}>
          <div className="reader-bar">
            <span className="reader-title" title={fileName}>{fileName}</span>
            <a className="reader-link" href={href} target="_blank" rel="noreferrer">另开一页</a>
            <a className="reader-link" href={downloadHref}>下载</a>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>关 闭</button>
          </div>
          <iframe className="reader-frame" src={href} title={fileName} />
        </div>
      </div>
    </>
  );
}
