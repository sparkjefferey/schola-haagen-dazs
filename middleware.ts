import { NextResponse, type NextRequest } from "next/server";

// 注意：大门环节跑在边缘环境，翻不了会员账本（better-sqlite3 在那跑不了），
// 所以小票名字只能写死，必须与 lib/auth.ts 里的 SESSION_COOKIE 保持一致。
// 这里只做“有没有小票”的粗查，小票真假由各页面的 requireAdmin 细查。
const SESSION_COOKIE = "schola_session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 可信客户端 IP（不可被客户端伪造的前提：请求只经可信反代到达本应用）：
  // 1. CF-Connecting-IP：由 Cloudflare 边缘（cloudflared 隧道必经）写入，客户端无法伪造；
  // 2. 否则取 X-Forwarded-For 的「最后一项」——可信反代在末尾追加真实客户端 IP，
  //    客户端自己塞进头部的前缀段不可信（修复 V1：原取第一项可被 XFF 伪造绕过锁定）；
  // 3. 否则 x-real-ip；都为空则回落 "local"。
  // 直连调试（无可信反代）时客户端仍可伪造上述头，因此登录限流另设「按用户名全局桶」
  // 兜底（见 actions.ts loginAction），IP 轮换也无法绕开。
  const cfIp = request.headers.get("cf-connecting-ip");
  const forwarded = request.headers.get("x-forwarded-for");
  const lastForwarded = forwarded ? forwarded.split(",").pop()!.trim() : "";
  const clientIp = cfIp || lastForwarded || request.headers.get("x-real-ip") || "local";

  // 通过「请求头」把 IP 透传给下游 Server Action（必须用 request headers 透传，
  // 不能只写在 response 上——下游 headers() 读不到响应头）。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-client-ip", clientIp);

  // CSRF 纵深（V3）：浏览器发起的 POST 必定携带 Origin（同源/跨源皆然）。
  // Next.js 内置校验只拦「Origin 不匹配」，可被「无 Origin 的 POST」绕过；
  // 这里把缺失 Origin 的 POST 一律 403，封死该绕过，非浏览器脚本直调 Server Action 被拒。
  if (request.method === "POST" && !request.headers.get("origin")) {
    return new NextResponse("Forbidden: missing Origin", { status: 403 });
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-pathname", pathname);

  // 浅守卫：管理后台相关路径，连登录小票都没有的，直接轰去登录页。
  // 防止以后新加 admin 子页忘了上锁，就被人猜网址看到。
  if (pathname.startsWith("/admin") && !request.cookies.get(SESSION_COOKIE)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("e", "auth");
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|fonts|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)"],
};
