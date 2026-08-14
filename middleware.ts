import { NextResponse, type NextRequest } from "next/server";

// 注意：大门环节跑在边缘环境，翻不了会员账本（better-sqlite3 在那跑不了），
// 所以小票名字只能写死，必须与 lib/auth.ts 里的 SESSION_COOKIE 保持一致。
// 这里只做“有没有小票”的粗查，小票真假由各页面的 requireAdmin 细查。
const SESSION_COOKIE = "schola_session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 直连模式下 Next.js 拿不到真实客户端 TCP IP（Web Request 抽象无 remote address），
  // 这里优先信任 x-forwarded-for / x-real-ip——目前直连二者皆空，回落 "local"；
  // 将来接入可信反代（Cloudflare/Caddy）后会自动带上真实 IP，无需改代码。
  // 注意：直连时客户端可伪造这两个头，故「单 IP 限流」在直连下退化为全局共享桶，
  // 真正的防线是 actions.ts 里的「全局注册速率限制」（不依赖 IP，挡得住多 IP 僵尸网络）。
  const forwarded = request.headers.get("x-forwarded-for");
  const clientIp =
    (forwarded ? forwarded.split(",")[0].trim() : request.headers.get("x-real-ip")) || "local";

  // 通过「请求头」把 IP 透传给下游 Server Action（必须用 request headers 透传，
  // 不能只写在 response 上——下游 headers() 读不到响应头）。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-client-ip", clientIp);

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
