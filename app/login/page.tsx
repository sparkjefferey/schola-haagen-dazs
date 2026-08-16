import { Metadata } from "next";
import Link from "next/link";
import { loginAction } from "@/lib/actions";
import { clientIp, captchaRequired } from "@/lib/auth";
import { createCaptcha } from "@/lib/captcha";
import { Scroll } from "@/components/decor";

export const metadata: Metadata = { title: "登学" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string; e?: string; locked?: string; u?: string }>;
}) {
  const { registered, e, locked, u } = await searchParams;
  const err = locked
    ? "连日叩门过多，门卫将你锁在门外 15 分钟。"
    : e === "bad"
      ? "雅名或口令有误。（同一雅名连续失败 3 次须验明正身，5 次将闭门 15 分钟）"
      : e === "captcha"
        ? "连试未成，请先验明正身：答出算式的得数，方可继续叩门。"
        : e === "banned"
          ? "此学籍已封，如有冤情请与掌门面议。"
          : null;

  // 验证码：仅当 (IP, 用户名) 确有失败记录时才出题，避免无谓干扰。
  let captcha: { id: string; question: string } | null = null;
  if (e === "captcha" && u) {
    const ip = await clientIp();
    if (captchaRequired(ip, u)) captcha = createCaptcha(u);
  }

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
          <input id="l-user" name="username" required autoFocus defaultValue={u} placeholder="你的用户名" />
        </div>
        <div className="field">
          <label htmlFor="l-pass">口 令</label>
          <input id="l-pass" name="password" type="password" required placeholder="你的口令" />
        </div>
        {captcha && (
          <div className="field">
            <label htmlFor="c-q">验 明 正 身</label>
            <input
              id="c-q"
              name="captcha_answer"
              inputMode="numeric"
              autoComplete="off"
              required
              placeholder={captcha.question}
            />
            <input type="hidden" name="captcha_id" value={captcha.id} />
            <p className="hint">连试未成，请先答出此算式的得数，以证非机器叩门。</p>
          </div>
        )}
        <button className="btn btn-gold btn-block" type="submit">入 馆</button>
        <p style={{ textAlign: "center", marginTop: 16, fontSize: 14, color: "var(--ink-soft)" }}>
          尚未入派？<Link href="/register">注册入学</Link>
        </p>
      </form>
    </div>
  );
}
