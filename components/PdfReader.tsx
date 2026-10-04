"use client";

import { useEffect, useRef, useState } from "react";
import type { PdfReaderProps } from "./pdf-reader-types";

/**
 * 手稿在线阅读器（客户端）：自托管 pdf.js（Mozilla 5.4.530 legacy，Apache-2.0，public/pdfjs/）。
 *
 * 之前嵌的是浏览器原生阅读器的 iframe——桌面 Chrome 里能看，但微信 X5 与 iOS Safari
 * 里要么白屏、要么只翻得出首屏，等于逼人回到下载，算不得线上阅览。pdf.js 把每页
 * 直接画成 canvas，凡跑得动 JS 的浏览器（含微信）都可读；太老的浏览器有栏上退路。
 *
 * 低内存取向（站规），处处守着：
 *   1. 默认收起；点开才动态 import pdf.js（首次约 2MB，其后走 HTTP 缓存），
 *      浏览论文库时一个字节都不拉；
 *   2. 开稿关掉整份自动取（disableAutoFetch + disableStream），只按需取段——
 *      附件路由已支持单段 Range：20MB 的扫描稿翻到第 3 页也只下过前几段；
 *   3. 关闭即 destroy()：文档、渲染任务与 worker 一并释放，浮层无 DOM 残留。
 *
 * 退路常在浮层栏上：另开一页（原生阅读器）与下载。设密码的稿不猜密码，请下载后打开。
 */

// ---- pdf.js 运行时（懒加载一次，整页会话内复用；worker 每次开稿各起一个，关稿即随文档销毁） ----

const PDFJS_API = "/pdfjs/pdf.min.mjs";
const PDFJS_WORKER = "/pdfjs/pdf.worker.min.mjs";
const PDFJS_VIEWER = "/pdfjs/web/pdf_viewer.mjs";

type PdfjsLib = any;
type PdfjsViewerModule = any;
type PdfSession = { eventBus: any; viewer: any; task: any; pdf: any; lastQuery: string };

let pdfjsPromise: Promise<{ lib: PdfjsLib; viewerMod: PdfjsViewerModule }> | null = null;

function loadPdfjs(): Promise<{ lib: PdfjsLib; viewerMod: PdfjsViewerModule }> {
  pdfjsPromise ??= (async () => {
    // 经变量绕开打包器的静态分析（带 webpackIgnore/turbopackIgnore 保险）：
    // pdf.js 是 vendored 的静态件（public/pdfjs/），不能被 webpack/Turbopack 拿去解析打包。
    const apiUrl = PDFJS_API;
    const lib: PdfjsLib = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ apiUrl);
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    // pdf_viewer.mjs 自取 globalThis.pdfjsLib（上一步 import 落库时已设好），须在其后加载。
    const viewerUrl = PDFJS_VIEWER;
    const viewerMod: PdfjsViewerModule = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ viewerUrl);
    ensureViewerCss();
    return { lib, viewerMod };
  })();
  return pdfjsPromise;
}

/** pdf_viewer.css 只在读稿期间进场：随浮层开闭插拔，HTTP 缓存复用，不与站内样式常态共存。 */
function ensureViewerCss() {
  const href = "/pdfjs/web/pdf_viewer.css";
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function removeViewerCss() {
  document.querySelector(`link[href="/pdfjs/web/pdf_viewer.css"]`)?.remove();
}

type Phase = "loading" | "ready" | "error";

function ReaderOverlay({ href, downloadHref, fileName, onClose }: { href: string; downloadHref: string; fileName: string; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [fitWidth, setFitWidth] = useState(true); // 是否处于「适宽」档
  const [matches, setMatches] = useState<{ current: number; total: number } | null>(null);
  const scrolledRef = useRef<HTMLDivElement | null>(null);
  const viewerDivRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const sessionRef = useRef<PdfSession | null>(null);
  const fitRef = useRef(true); // 状态的镜像：事件回调里直读不必重新挂监听
  const findingRef = useRef(false); // 当前是否有一次检索在展——控制器在收场时还会再报一次计数

  useEffect(() => {
    // Esc = 关闭；Ctrl/Cmd+F 在画布阅读器里没有原生可用，改入稿内检索
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        findInputRef.current?.focus();
        findInputRef.current?.select();
      }
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // 浮层之下不许页面跟着滚
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // 窗口改形（转屏、改栏宽）时若仍处适宽档，跟着重新适宽；手动缩放过后则只通知重排
  useEffect(() => {
    const onWindowResize = () => {
      const session = sessionRef.current;
      if (!session) return;
      try {
        if (fitRef.current) session.viewer.currentScaleValue = "page-width";
        session.viewer.update();
      } catch {
        /* 尺寸未定，下回再试 */
      }
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task: any = null;
    let viewer: any = null;
    let cssAdded = false;

    (async () => {
      try {
        const { lib, viewerMod } = await loadPdfjs();
        if (cancelled || !scrolledRef.current || !viewerDivRef.current) return;
        cssAdded = true;

        const container = scrolledRef.current;
        const eventBus = new viewerMod.EventBus();
        const linkService = new viewerMod.PDFLinkService({
          eventBus,
          // PDF 内的外链一律新页打开，别把读者带离文稿页
          externalLinkTarget: 2 /* LinkTarget.BLANK */,
          externalLinkRel: "noreferrer",
        });
        const findController = new viewerMod.PDFFindController({ eventBus, linkService });
        viewer = new viewerMod.PDFViewer({ container, eventBus, linkService, findController });
        linkService.setViewer(viewer);

        // 「按需取段」三件套：附件路由逐段应答（206），不整份下载。
        // isEvalSupported=false：不碰 Function 构造器，CSP 再紧也照常渲染。
        task = lib.getDocument({
          url: href,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
          isEvalSupported: false,
          // 「按需取段」双闸：既不整份预取也不整份流式，只按正在读的页逐段发 Range。
          rangeChunkSize: 65_536,
          disableAutoFetch: true,
          disableStream: true,
        });
        if (cancelled) {
          task.destroy();
          return;
        }

        const pdf = await task.promise;
        if (cancelled) return;
        sessionRef.current = { eventBus, viewer, task, pdf, lastQuery: "" };

        viewer.setDocument(pdf);
        findController.setDocument(pdf);
        linkService.setDocument(pdf);
        setPages(pdf.numPages);

        await new Promise<void>((resolve) => {
          const fn = () => {
            eventBus.off("pagesloaded", fn);
            resolve();
          };
          eventBus.on("pagesloaded", fn);
        });
        if (cancelled) return;

        viewer.currentScaleValue = "page-width"; // 适宽起读
        setPhase("ready");

        eventBus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
          if (!cancelled) setPage(pageNumber);
        });
        const onMatches = (data: any) => {
          if (cancelled || !findingRef.current) return; // 收场上报不复活计数
          const mc = data?.matchesCount;
          setMatches(mc ? { current: mc.current ?? 0, total: mc.total ?? 0 } : null);
        };
        eventBus.on("updatefindmatchescount", onMatches);
        eventBus.on("updatefindcontrolstate", onMatches);
      } catch (e: any) {
        if (cancelled) return;
        setError(
          e?.name === "PasswordException"
            ? "此稿设了密码，站内不做解锁；请下载后自行打开。"
            : "此稿未能在线打开（文件或已损坏，或格式特殊）。可下载或另开一页一试。",
        );
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      // 关闭即释放：渲染任务、viewer 内部缓冲、文档与其 worker；晚到的 await 也走得到
      sessionRef.current = null;
      try {
        viewer?.cleanup?.();
      } catch {
        /* 已毁则罢 */
      }
      try {
        task?.destroy?.();
      } catch {
        /* 已毁则罢 */
      }
      if (cssAdded) removeViewerCss();
    };
    // 依赖只有 href：同一篇稿只开一次；换稿 = 换一个 href = 换一个浮层实例
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href]);

  function doFind(findPrevious: boolean) {
    const session = sessionRef.current;
    const input = findInputRef.current;
    if (!session || !input) return;
    const query = input.value.trim();
    if (query === "") {
      // 检索框清空：撤去全部高亮，回到普通阅读
      session.eventBus.dispatch("findbarclose", { source: ReaderOverlay });
      session.lastQuery = "";
      findingRef.current = false;
      setMatches(null);
      return;
    }
    // 新问句 type=find（全文重扫），旧问句 type=findagain（顺势走到下一处）
    findingRef.current = true;
    const sameAsLast = session.lastQuery === query;
    session.lastQuery = query;

    session.eventBus.dispatch("find", {
      source: ReaderOverlay,
      type: sameAsLast ? "findagain" : "find",
      query,
      phraseSearch: true,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious,
    });
  }

  function changeScale(factor: number | "fit") {
    const session = sessionRef.current;
    if (!session) return;
    try {
      if (factor === "fit") {
        session.viewer.currentScaleValue = "page-width";
        fitRef.current = true;
        setFitWidth(true);
      } else {
        const next = Math.min(4, Math.max(0.25, session.viewer.currentScale * factor));
        session.viewer.currentScale = next;
        fitRef.current = false;
        setFitWidth(false);
      }
    } catch {
      /* scale 未就绪 */
    }
  }

  function gotoPage(delta: number) {
    const session = sessionRef.current;
    if (!session) return;
    session.viewer.currentPageNumber = Math.min(pages, Math.max(1, page + delta));
  }

  return (
    <div className="reader-mask" role="dialog" aria-modal="true" aria-label={fileName} onClick={onClose}>
      <div className="reader-box" onClick={(e) => e.stopPropagation()}>
        <div className="reader-bar">
          {!fitWidth && phase === "ready" && (
            <button type="button" className="btn btn-sm" onClick={() => changeScale("fit")}>适宽</button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => changeScale(1 / 1.2)} aria-label="缩小">−</button>
          <button type="button" className="btn btn-sm" onClick={() => changeScale(1.2)} aria-label="放大">＋</button>
          {phase === "ready" && (
            <span className="reader-page">
              <button type="button" className="btn btn-sm" onClick={() => gotoPage(-1)} aria-label="上一页">◀</button>
              <span className="reader-page-num">第 {page} / {pages} 页</span>
              <button type="button" className="btn btn-sm" onClick={() => gotoPage(1)} aria-label="下一页">▶</button>
            </span>
          )}
          <input
            ref={findInputRef}
            className="reader-find"
            type="search"
            placeholder="在稿中检索 ⏎"
            onKeyDown={(e) => {
              if (e.key === "Enter") doFind(e.shiftKey);
            }}
          />
          {matches && matches.total > 0 && (
            <span className="reader-find-count">{matches.current}/{matches.total} 处</span>
          )}
          <span className="reader-title" title={fileName}>{fileName}</span>
          <a className="reader-link" href={href} target="_blank" rel="noreferrer">另开一页</a>
          <a className="reader-link" href={downloadHref}>下载</a>
          <button type="button" className="btn btn-sm" onClick={onClose}>关 闭</button>
        </div>

        {phase === "loading" && <div className="reader-loading">手稿开启中……（大稿按需取段，稍候）</div>}
        {phase === "error" && <div className="reader-loading reader-loading-warn">✗ {error}</div>}

        <div className="reader-scroll" ref={scrolledRef}>
          <div className="pdfViewer" ref={viewerDivRef} />
        </div>
      </div>
    </div>
  );
}

export function PdfReader({ href, downloadHref, fileName, label = "在 线 阅 读", buttonClass = "btn btn-sm btn-gold" }: PdfReaderProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return <ReaderOverlay href={href} downloadHref={downloadHref} fileName={fileName} onClose={() => setOpen(false)} />;
}
