import type { Metadata } from "next";
import "./globals.css";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { getAnnouncement } from "@/lib/queries";
import { schoolYear } from "@/lib/format";
import { MeanderBand } from "@/components/emblem";
import { GreekKey, IonicColumn, Amphora, LaurelWreath } from "@/components/decor";
import { logoutAction } from "@/lib/actions";
import Link from "next/link";

export const metadata: Metadata = {
  title: {
    default: "Schola Häagen-Dazs · 乾酪学馆",
    template: "%s · Schola Häagen-Dazs",
  },
  description:
    "Schola Häagen-Dazs（沙学家）——一所属于研读者的学派网站：学派史、学术论坛、论文库与作者学行榜。",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const raw = await getSessionUser();
  const user = raw?.status === "active" ? raw : null;
  if (raw && raw.status !== "active") {
    const h = await headers();
    const pathname = h.get("x-pathname") || "";
    if (!pathname.startsWith("/banned")) {
      redirect(`/banned?u=${encodeURIComponent(raw.username)}`);
    }
  }
  const year = schoolYear();
  const announcement = getAnnouncement();

  // 按网址给每页分配主题色（古典手抄本调色板），打破全站一片栗红
  const h = await headers();
  const pathname = h.get("x-pathname") || "/";
  let theme = "home";
  if (pathname === "/" || pathname.startsWith("/home")) theme = "home";
  else if (pathname.startsWith("/about")) theme = "about";
  else if (pathname.startsWith("/forum")) theme = "forum";
  else if (pathname.startsWith("/papers")) theme = "papers";
  else if (pathname.startsWith("/scholar")) theme = "papers";
  else if (pathname.startsWith("/ranking")) theme = "ranking";
  else if (pathname.startsWith("/users")) theme = "users";
  else if (pathname.startsWith("/admin")) theme = "admin";
  else if (pathname.startsWith("/login") || pathname.startsWith("/register") || pathname.startsWith("/banned")) theme = "auth";

  return (
    <html lang="zh-CN">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body data-theme={theme}>
        <div className="greek-arch-bg" aria-hidden />
        <header>
<div className="sitename-band">
            <MeanderBand />
            <div className="wordmark-wrap">
              <LaurelWreath size={46} color="rgba(217,189,124,0.55)" />
              <p className="wordmark">SCHOLA HÄAGEN-DAZS</p>
              <div style={{ transform: "scaleX(-1)" }}>
                <LaurelWreath size={46} color="rgba(217,189,124,0.55)" />
              </div>
            </div>
            <div className="sub">沙 藏 学 观 · SCHOLA HÄAGEN-DAZS</div>
          </div>
          <nav className="nav">
            <div className="nav-inner">
              <a className="nitem" href="/">首府之户</a>
              <a className="nitem" href="/about">学派志</a>
              <a className="nitem" href="/forum">学术论坛</a>
              <a className="nitem" href="/papers">论文库</a>
              <a className="nitem" href="/scholar">学林检索</a>
              <a className="nitem" href="/ranking">作者学榜</a>
              <span className="spacer" />
              {user ? (
                <>
                  <span className="whoami">
                    <a href={`/users/${user.username}`} style={{ color: "var(--maroon)" }}>
                      {user.display_name}
                    </a>
                    {user.endorsed === 1 && <span className="badge">认证学者</span>}
                    {user.role === "admin" && <span className="badge badge-admin">管理者</span>}
                    {user.role === "admin" && <a className="nitem" href="/admin">燕京阁</a>}
                  </span>
                  <form action={logoutAction} className="inline-form">
                    <button type="submit" className="btn btn-sm">登出</button>
                  </form>
                </>
              ) : (
                <>
                  <a className="nitem" href="/login">登学</a>
                  <a className="btn btn-sm" style={{ marginRight: 12 }} href="/register">入学派</a>
                </>
              )}
            </div>
          </nav>
          {announcement && (
            <div
              style={{
                background: "linear-gradient(90deg, var(--maroon-deep), var(--maroon))",
                color: "#f6e7c3",
                padding: "8px 18px",
                fontSize: 14.5,
                textAlign: "center",
                borderBottom: "2px solid var(--gold)",
                letterSpacing: "0.04em",
              }}
            >
              <b style={{ fontFamily: "var(--display)", letterSpacing: "0.2em", marginRight: 10 }}>
                谕令：
              </b>
              {announcement.title} —— {announcement.content}
            </div>
          )}
        </header>

        <div className="theme-band" />

        <main className="container pagewrap">{children}</main>

        <footer>
          <GreekKey color="rgba(217,189,124,0.35)" className="meander" />
          <div style={{ display: "flex", justifyContent: "center", gap: 8, color: "rgba(217,189,124,0.3)" }}>
            <Amphora size={34} />
            <IonicColumn height={44} />
            <Amphora size={34} />
          </div>
          <div className="foot-links">
            <a href="/about">学派志</a>
            <a href="/forum">论坛</a>
            <a href="/papers">论文库</a>
            <a href="/scholar">学林检索</a>
            <a href="/ranking">学榜</a>
          </div>
          <div className="foot-motto">IN LACTE · VERITAS</div>
          <div className="foot-sign">Anno MMXXIV · Fundata in Lacte</div>
          <div className="foot-note">
            Schola Häagen-Dazs · 建校于 {year - 1} 周年，谨奉求知之诚、冷食之甘
          </div>
        </footer>
      </body>
    </html>
  );
}