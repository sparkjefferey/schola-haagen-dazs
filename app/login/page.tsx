import { Metadata } from "next";
import Link from "next/link";
import { loginAction } from "@/lib/actions";
import { Scroll } from "@/components/decor";

export const metadata: Metadata = { title: "登学" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string; e?: string; locked?: string }>;
}) {
  const { registered, e, locked } = await searchParams;
  const err = locked
    ? "连日叩门过多，门卫将你锁在门外 15 分钟。"
    : e === "bad"
      ? "雅名或口令有误。（同一雅名连续失败 5 次将闭门 15 分钟）"
      : e === "banned"
        ? "此学籍已封，如有冤情请与掌门面议。"
        : null;
  return (
    <div style={{ maxWidth: 460, margin: "0 auto" }}>
      <section style={{ textAlign: "center", marginBottom: 24 }}>
        <Scroll size={52} color="var(--maroon)" />
        <h1 className="big-title" style={{ marginTop: 4 }}>登 学</h1>
        <p className="lead" style={{ fontSize: 15 }}>凭雅名与口令，入座学馆。</p>
      </section>

      {registered && (
        <p className="notice">注册已成，欢迎入派，{registered}学士！请登学。密码不可复得，谨记在胸。</p>
      )}
      {err && <p className="notice" style={{ color: "var(--maroon-deep)" }}>{err}</p>}

      <form action={loginAction} className="card" style={{ padding: 28 }}>
        <div className="field">
          <label htmlFor="l-user">雅 名</label>
          <input id="l-user" name="username" required autoFocus placeholder="你的用户名" />
        </div>
        <div className="field">
          <label htmlFor="l-pass">口 令</label>
          <input id="l-pass" name="password" type="password" required placeholder="你的口令" />
        </div>
        <button className="btn btn-gold btn-block" type="submit">入 馆</button>
        <p style={{ textAlign: "center", marginTop: 16, fontSize: 14, color: "var(--ink-soft)" }}>
          尚未入派？<Link href="/register">注册入学</Link>
        </p>
      </form>
    </div>
  );
}