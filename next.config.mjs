/** @type {import('next').NextConfig} */

// 安全响应头（ defense-in-depth；站点当前为 HTTP，HSTS 仅在有 HTTPS 时被浏览器采纳，提前写入无害）
// dev 模式须放行 'unsafe-eval'：Next 的 react-refresh 运行时依赖它，
// 否则整包客户端 JS 会在 CSP 处抛 EvalError、水合全灭（生产构建不含该运行时，不受影响）。
const cspScriptSrc =
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 注：Next.js App Router 注入的 RSC 引导脚本需要内联，故 script/style 暂含 'unsafe-inline'。
      // 后续可改用 nonce 进一步收紧（见待办）。
      cspScriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=()",
  },
  { key: "X-XSS-Protection", value: "0" },
];

// 附件总量上限（与 lib/attachments.ts 同源的夹紧规则）：
// 传输上限必须 ≥ 应用层配额，超限才会交由动作内校验给出友好文案（?e=atttotal），而非被框架裸 413 截断。
// +8mb 覆盖正文/作者/多部分边界的表单开销。注意 Cloudflare 免费隧道单请求体上限约 100MB。
const attachmentTotalMb = Math.min(Math.max(Number(process.env.ATTACHMENT_TOTAL_MB ?? "50") || 50, 5), 200);

const nextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingRoot: process.cwd(),
  experimental: {
    serverActions: {
      bodySizeLimit: `${attachmentTotalMb + 8}mb`,
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
