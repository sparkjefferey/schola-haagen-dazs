/** PdfReader 的入参（独立文件以便纯类型导入，不把 React 拖进服务端引用链）。 */
export type PdfReaderProps = {
  /** 附件的内联地址（/api/papers/<id>/attachments/<attId>），pdf.js 依此按需取段。 */
  href: string;
  /** 强制下载地址（同上 + ?dl=1），常驻阅读器顶栏作退路。 */
  downloadHref: string;
  fileName: string;
  label?: string;
  buttonClass?: string;
};
