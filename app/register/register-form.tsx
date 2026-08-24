"use client";

import { useState } from "react";
import { registerUser } from "@/lib/actions";
import type { CaptchaChallenge } from "@/lib/captcha";
import { passwordStrength, type StrengthResult } from "@/lib/password-strength";
import { PasswordStrengthHint } from "@/components/password-strength-hint";

export default function RegisterForm({
  initialTab = "scholar",
  captcha,
}: {
  initialTab?: "scholar" | "admin";
  captcha: CaptchaChallenge;
}) {
  const [tab, setTab] = useState<"scholar" | "admin">(initialTab);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [strength, setStrength] = useState<StrengthResult>(passwordStrength(""));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await registerUser(new FormData(e.currentTarget));
      setBusy(false);
    } catch (err) {
      if ((err as any)?.digest?.startsWith("NEXT_REDIRECT")) return;
      setError(err instanceof Error ? err.message : "注册未成，请重试");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="tabs">
        <button type="button" className={`tab-btn ${tab === "scholar" ? "on" : ""}`} onClick={() => setTab("scholar")}>
          学者入学
        </button>
        <button type="button" className={`tab-btn ${tab === "admin" ? "on" : ""}`} onClick={() => setTab("admin")}>
          管理者就任
        </button>
      </div>

      {error && <p className="notice" style={{ color: "var(--maroon-deep)" }}>✗ {error}</p>}

      <form onSubmit={onSubmit} className="card" style={{ padding: 28 }}>
        {/* 蜜罐：人类看不见（display:none），脚本无脑填满所有字段时才会触发。
            填了即视作机器，走"验证码错误"流程——真人永不触发。 */}
        <input
          type="text"
          name="website"
          autoComplete="off"
          tabIndex={-1}
          aria-hidden="true"
          style={{ display: "none" }}
        />
        <input type="hidden" name="role" value={tab} />
        <div className="row-inputs">
          <div className="field">
            <label htmlFor="r-user">雅 名（用户名）</label>
            <input id="r-user" name="username" required minLength={2} maxLength={20} placeholder="2–20 位，字母或汉字" />
          </div>
          <div className="field">
            <label htmlFor="r-name">表 字（显示名）</label>
            <input id="r-name" name="display_name" maxLength={24} placeholder="学部所称呼的名字，缺省为雅名" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="r-pass">口 令</label>
          <input
            id="r-pass"
            name="password"
            type="password"
            required
            minLength={6}
            placeholder="至少 6 位；建议 12 位以上"
            onChange={(e) => setStrength(passwordStrength(e.target.value))}
          />
          <PasswordStrengthHint strength={strength} />
        </div>
        <div className="field">
          <label htmlFor="r-motto">座 右 铭（可选）</label>
          <input id="r-motto" name="motto" maxLength={80} placeholder="将见于你的名册与学榜" />
        </div>
        <div className="field">
          <label htmlFor="r-email">电 子 邮 箱（可选，用于接收口令安全提醒）</label>
          <input
            id="r-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
          />
          <p className="hint">用于接收弱口令等系统安全提醒；不会公开展示。不填也可入学，日后可在名册中补填。</p>
        </div>

        <div className="field">
          <label htmlFor="r-cap">验 明 正 身</label>
          <input
            id="r-cap"
            name="captcha_answer"
            inputMode="numeric"
            autoComplete="off"
            required
            placeholder={captcha.question}
          />
          <input type="hidden" name="captcha_id" value={captcha.id} />
          <p className="hint">答出此算式的得数，以证非机器注册。注册无找回，口令务必牢记。</p>
        </div>

        {tab === "admin" && (
          <div className="field">
            <label htmlFor="r-invite">管 理 者 邀 请 函</label>
            <input id="r-invite" name="invite" required placeholder="由院长签发之暗号" />
            <div className="hint">
              管理部门须持有邀请函方可就任；如站长尚未配置，可先在学派志中联系院长，或以种子账户管理。
            </div>
          </div>
        )}

        <button className={`btn btn-block ${tab === "admin" ? "" : "btn-gold"}`} type="submit" disabled={busy}>
          {busy ? "书院注册中……" : tab === "scholar" ? "入 派 成 学" : "宣 誓 就 任"}
        </button>
      </form>
    </>
  );
}