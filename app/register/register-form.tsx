"use client";

import { useEffect, useRef, useState } from "react";
import { registerUser } from "@/lib/actions";
import type { CaptchaChallenge } from "@/lib/captcha";
import { passwordStrength, type StrengthResult } from "@/lib/password-strength";
import { PasswordStrengthHint } from "@/components/password-strength-hint";

// 与 lib/actions.ts 的校验保持一致（那边改了记得同步这里）。
const USERNAME_RE = /^[a-zA-Z0-9_\-\u4e00-\u9fa5]{2,20}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SUBMIT_TIMEOUT_MS = 20_000;

const FIELD_LABELS: Record<string, string> = {
  username: "雅名",
  password: "口令",
  email: "电子邮箱",
  captcha_answer: "验明正身",
  invite: "管理者邀请函",
};

/** 前端逐项体检：哪栏没填、哪栏不合规，一次全挑明（不静默、不转圈）。 */
function collectErrors(fd: FormData, tab: "scholar" | "admin"): Record<string, string> {
  const errors: Record<string, string> = {};
  const username = String(fd.get("username") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  const email = String(fd.get("email") ?? "").trim();
  const captchaAnswer = String(fd.get("captcha_answer") ?? "").trim();
  const invite = String(fd.get("invite") ?? "").trim();

  if (!username) errors.username = "这一栏还没填：请写上你的雅名。";
  else if (username.length < 2) errors.username = "雅名太短，至少 2 位。";
  else if (username.length > 20) errors.username = "雅名太长，最多 20 位。";
  else if (!USERNAME_RE.test(username))
    errors.username = "雅名只能用字母、数字、下划线或汉字，且首尾不能有空格。";

  if (!password) errors.password = "这一栏还没填：请设置口令。";
  else if (password !== password.trim()) errors.password = "口令首尾不能有空格，请去掉首尾空格。";
  else if (password.length < 6) errors.password = "口令至少 6 位。";

  if (email && !EMAIL_RE.test(email)) errors.email = "邮箱格式不正确，例如 you@example.com。";

  if (!captchaAnswer) errors.captcha_answer = "这一栏还没填：请算出算式的得数。";
  else if (!/^\d+$/.test(captchaAnswer)) errors.captcha_answer = "算式得数请只填数字。";

  if (tab === "admin" && !invite) errors.invite = "这一栏还没填：就任管理者须填写邀请函暗号。";

  return errors;
}

export default function RegisterForm({
  initialTab = "scholar",
  captcha,
}: {
  initialTab?: "scholar" | "admin";
  captcha: CaptchaChallenge;
}) {
  const [tab, setTab] = useState<"scholar" | "admin">(initialTab);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [strength, setStrength] = useState<StrengthResult>(passwordStrength(""));

  const formRef = useRef<HTMLFormElement>(null);
  const captchaRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 收尾：清掉超时看门狗并复位 loading。任何路径（成功/失败/超时）都必须走到。 */
  function settle() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setBusy(false);
  }

  // 服务端校验不过时会 redirect 回本页（如 ?e=captcha）——这是同路由软导航，
  // 组件不会重挂载，useState 里的 busy 会一直是 true（按钮永久停在「书院注册中……」）。
  // captcha.id 由服务端每次渲染新生成，正好当"页面已重渲"的信号，据此复位。
  useEffect(() => {
    settle();
    setFieldErrors({});
    setError(null);
    // 旧题的答案对新题无意义，顺手清空，避免拿旧答案撞新验证码
    if (captchaRef.current) captchaRef.current.value = "";
  }, [captcha.id]);

  // 组件卸载时别留下定时器
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function clearField(name: string) {
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);

    // 第一步永远是本地体检：缺项/不合规当场逐栏点名，不进 loading、不发请求。
    const errs = collectErrors(fd, tab);
    const missing = Object.keys(errs);
    if (missing.length > 0) {
      setFieldErrors(errs);
      const labels = missing.map((k) => FIELD_LABELS[k] ?? k);
      const blank = missing.filter((k) => errs[k].startsWith("这一栏还没填"));
      setError(
        `${blank.length === missing.length ? "还有栏目未填写" : "填写尚有问题"}：${labels.join("、")}。请按下方红字提示补正后重新提交。`,
      );
      const el = formRef.current?.querySelector<HTMLInputElement>(`[name="${missing[0]}"]`);
      el?.focus();
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    setFieldErrors({});
    setError(null);
    setBusy(true);
    // 兜底看门狗：隧道/网络抖动导致服务端久不回，也不能让用户对着转圈干等。
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setBusy(false);
      setError(`提交后等待 ${SUBMIT_TIMEOUT_MS / 1000} 秒仍未收到回应，请检查网络后重试（你填写的内容还在，不必重填）。`);
    }, SUBMIT_TIMEOUT_MS);

    try {
      await registerUser(fd);
    } catch (err) {
      // 服务端成功后会 redirect 到 /login：这是个特殊错误，放行给导航处理，不当作失败提示
      if ((err as any)?.digest?.startsWith("NEXT_REDIRECT")) return;
      setError(err instanceof Error ? err.message : "注册未成，请稍后重试。");
    } finally {
      // 成功、失败、转页，三条路都必须复位 loading —— 绝不留「书院注册中……」卡死
      settle();
    }
  }

  const fieldErr = (name: string) =>
    fieldErrors[name] ? (
      <p className="field-err" id={`err-${name}`} role="alert">
        ✗ {fieldErrors[name]}
      </p>
    ) : null;

  const aria = (name: string) => ({
    "aria-invalid": fieldErrors[name] ? true : undefined,
    "aria-describedby": fieldErrors[name] ? `err-${name}` : undefined,
  });

  return (
    <>
      <div className="tabs">
        <button
          type="button"
          className={`tab-btn ${tab === "scholar" ? "on" : ""}`}
          onClick={() => {
            setTab("scholar");
            clearField("invite");
          }}
        >
          学者入学
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === "admin" ? "on" : ""}`}
          onClick={() => setTab("admin")}
        >
          管理者就任
        </button>
      </div>

      {error && (
        <p className="notice" role="alert" style={{ color: "var(--maroon-deep)" }}>
          ✗ {error}
        </p>
      )}

      {/* noValidate：关掉浏览器自带的英文气泡（"Please fill out this field"），
          改由下面的中文红字逐栏说明缺了什么，且一次性列全。 */}
      <form ref={formRef} onSubmit={onSubmit} noValidate className="card" style={{ padding: 28 }}>
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
            <input
              id="r-user"
              name="username"
              maxLength={20}
              placeholder="2–20 位，字母或汉字"
              className={fieldErrors.username ? "input-invalid" : undefined}
              {...aria("username")}
              onChange={() => clearField("username")}
            />
            {fieldErr("username")}
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
            placeholder="至少 6 位；建议 12 位以上"
            className={fieldErrors.password ? "input-invalid" : undefined}
            {...aria("password")}
            onChange={(e) => {
              setStrength(passwordStrength(e.target.value));
              clearField("password");
            }}
          />
          <PasswordStrengthHint strength={strength} />
          {fieldErr("password")}
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
            className={fieldErrors.email ? "input-invalid" : undefined}
            {...aria("email")}
            onChange={() => clearField("email")}
          />
          <p className="hint">用于接收弱口令等系统安全提醒；不会公开展示。不填也可入学，日后可在名册中补填。</p>
          {fieldErr("email")}
        </div>

        <div className="field">
          <label htmlFor="r-cap">验 明 正 身</label>
          <input
            id="r-cap"
            ref={captchaRef}
            name="captcha_answer"
            inputMode="numeric"
            autoComplete="off"
            placeholder={captcha.question}
            className={fieldErrors.captcha_answer ? "input-invalid" : undefined}
            {...aria("captcha_answer")}
            onChange={() => clearField("captcha_answer")}
          />
          <input type="hidden" name="captcha_id" value={captcha.id} />
          <p className="hint">答出此算式的得数，以证非机器注册。注册无找回，口令务必牢记。</p>
          {fieldErr("captcha_answer")}
        </div>

        {tab === "admin" && (
          <div className="field">
            <label htmlFor="r-invite">管 理 者 邀 请 函</label>
            <input
              id="r-invite"
              name="invite"
              placeholder="由院长签发之暗号"
              className={fieldErrors.invite ? "input-invalid" : undefined}
              {...aria("invite")}
              onChange={() => clearField("invite")}
            />
            <div className="hint">
              管理部门须持有邀请函方可就任；如站长尚未配置，可先在学派志中联系院长，或以种子账户管理。
            </div>
            {fieldErr("invite")}
          </div>
        )}

        <button className={`btn btn-block ${tab === "admin" ? "" : "btn-gold"}`} type="submit" disabled={busy}>
          {busy ? "书院注册中……" : tab === "scholar" ? "入 派 成 学" : "宣 誓 就 任"}
        </button>
      </form>
    </>
  );
}
