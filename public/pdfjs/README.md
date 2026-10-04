# 自托管 pdf.js（手稿在线阅读器）

本目录是 [Mozilla pdf.js](https://github.com/mozilla/pdf.js) 的 **5.4.530 legacy 构建**（从 npm 包
`pdfjs-dist@5.4.530` 复制），Apache-2.0 授权，全文见 [LICENSE](LICENSE)。
站内不做任何修改、不打补丁；升级 = 换同名文件并同步本文记下的版本号。

## 文件

| 路径 | 内容 |
| --- | --- |
| `pdf.min.mjs` | API 主件（页面上 `import` 它来开稿） |
| `pdf.worker.min.mjs` | 解码 worker（`GlobalWorkerOptions.workerSrc` 指向它，随开稿起、随关稿毁） |
| `web/pdf_viewer.mjs` | 观察器组件（`PDFViewer`/`EventBus`/`PDFFindController`，读稿期间动态 import） |
| `web/pdf_viewer.css` | 观察器配套样式（读稿期间以 `<link>` 插入，关稿即移除） |
| `cmaps/` | CJK 等 CMap 数据：中文 PDF 的文字正确绘制常靠它（用到哪个取哪个） |
| `standard_fonts/` | 标准字体数据：PDF 未内嵌字体时的兜底（用到哪个取哪个） |
| `wasm/` | JPEG2000（openjpeg）与 ICC 色管（qcms）解码器；不支持 WASM 的环境回退 JS fallback |

## 与站内的约定

- `components/PdfReader.tsx` 以「按需取段」开稿：`disableAutoFetch` + `disableStream` +
  `rangeChunkSize 262144`。这要求附件路由支持单段 Range（已实现，见
  `app/api/papers/[id]/attachments/[attId]/route.ts`），e2e（`scripts/e2e-papers.mjs` 第 6 节）
  会验证 pdf.js 真的在用 Range 取稿。
- CSP `script-src` 需含 `'wasm-unsafe-eval'`（见 next.config.mjs），否则 WASM 解码器退 JS 兜底。
- 为兼容老内核（微信 X5 等）选 legacy 构建；较新的浏览器用同一份文件也可，没必要分叉。
