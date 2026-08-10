import { NextResponse, type NextRequest } from "next/server";

// 注意：大门环节跑在边缘环境，翻不了会员账本（better-sqlite3 在那跑不了），
// 所以小票名字只能写死，必须与 lib/auth.ts 里的 SESSION_COOKIE 保持一致。
// 这里只做“有没有小票”的粗查，小票真假由各页面的 requireAdmin 细查。
const SESSION_COOKIE = "schola_session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();
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
