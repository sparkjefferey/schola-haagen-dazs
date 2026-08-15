/** @type {import('next').NextConfig} */

// 安全响应头（ defense-in-depth；站点当前为 HTTP，HSTS 仅在有 HTTPS 时被浏览器采纳，提前写入无害）
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 注：Next.js App Router 注入的 RSC 引导脚本需要内联，故 script/style 暂含 'unsafe-inline'。
      // 后续可改用 nonce 进一步收紧（见待办）。
      "script-src 'self' 'unsafe-inline'",
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

const nextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingRoot: process.cwd(),
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
