"use client";

import { useEffect, useRef, useState } from "react";
import { registerUser } from "@/lib/actions";
import type { CaptchaChallenge } from "@/lib/captcha";
import { REGISTER_ERRORS } from "@/lib/register-errors";
import { normalizeUsername, usernameProblem } from "@/lib/username";
import { passwordStrength, type StrengthResult } from "@/lib/password-strength";
import { PasswordStrengthHint } from "@/components/password-strength-hint";

// 与服务端 lib/actions.ts 的校验保持一致（那边改了记得同步这里）。
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SUBMIT_TIMEOUT_MS = 20_000;
const NAME_CHECK_DEBOUNCE_MS = 450;

const FIELD_LABELS: Record<string, string> = {
  username: "雅名",
  password: "口令",
  email: "电子邮箱",
  captcha_answer: "验明正身",
  invite: "管理者邀请函",
};

type NameCheck =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "free"; name: string }
  | { state: "taken"; name: string; former: boolean; suggestions: string[] }
  | { state: "throttled"; message: string }
  | { state: "error" };

/** 前端逐项体检：哪栏没填、哪栏不合规，一次全挑明（不静默、不转圈）。 */
function collectErrors(fd: FormData, tab: "scholar" | "admin"): Record<string, string> {
  const errors: Record<string, string> = {};
  const password = String(fd.get("password") ?? "");
  const email = String(fd.get("email") ?? "").trim();
  const captchaAnswer = String(fd.get("captcha_answer") ?? "").trim();
  const invite = String(fd.get("invite") ?? "").trim();

  const nameIssue = usernameProblem(String(fd.get("username") ?? ""));
  if (nameIssue) errors.username = nameIssue;

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
  errorCode,
}: {
  initialTab?: "scholar" | "admin";
  captcha: CaptchaChallenge;
  /** 服务端退回码（?e=xxx）：用来把出错的那一栏描红并聚焦。 */
  errorCode?: string;
}) {
  const [tab, setTab] = useState<"scholar" | "admin">(initialTab);
  const [error, setError] = useState<string | null>(null);
  // 服务端退回码要用作"首屏初值"：让提示与描红直接出现在服务端渲染出的 HTML 里，
  // 而不是等 JS 加载完才补上（脚本没跑到也照样看得见错在哪）。
  const initialInfo = errorCode ? REGISTER_ERRORS[errorCode] : undefined;
  const [serverMessage, setServerMessage] = useState<string | null>(initialInfo?.message ?? null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(
    initialInfo?.field ? { [initialInfo.field]: initialInfo.message } : {},
  );
  const [busy, setBusy] = useState(false);
  const [strength, setStrength] = useState<StrengthResult>(passwordStrength(""));
  const [nameInput, setNameInput] = useState("");
  const [nameCheck, setNameCheck] = useState<NameCheck>({ state: "idle" });

  const formRef = useRef<HTMLFormElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const captchaRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverFieldRef = useRef<string | undefined>(initialInfo?.field);
  const nameInputRef = useRef("");

  /** 收尾：清掉超时看门狗并复位 loading。任何路径（成功/失败/超时）都必须走到。 */
  function settle() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setBusy(false);
  }

  // 服务端校验不过时会 redirect 回本页（如 ?e=captcha、?e=taken）——这是同路由软导航，
  // 组件不会重挂载，useState 里的 busy 会一直是 true（按钮永久停在「书院注册中……」）。
  // captcha.id 由服务端每次渲染新生成，正好当"页面已重渲"的信号，据此复位；
  // 同时把服务端点名的那一栏描红并聚焦，让人一眼看到错在哪。
  useEffect(() => {
    settle();
    setFieldErrors({});
    setError(null);
    setServerMessage(null);
    serverFieldRef.current = undefined;
    // 旧题的答案对新题无意义，顺手清空，避免拿旧答案撞新验证码
    if (captchaRef.current) captchaRef.current.value = "";

    const info = errorCode ? REGISTER_ERRORS[errorCode] : undefined;
    if (!info) return;
    setServerMessage(info.message);
    if (!info.field) return;
    serverFieldRef.current = info.field;
    setFieldErrors({ [info.field]: info.message });
    formRef.current?.querySelector<HTMLInputElement>(`[name="${info.field}"]`)?.focus();
  }, [captcha.id, errorCode]);

  // 组件卸载时别留下定时器
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // 边打字边查验雅名是否被占用：撞名只有服务端知道，所以这里问一下接口，
  // 免得填完整张表才被打回（提交时服务端仍会再判一次，这里只是提前告知）。
  useEffect(() => {
    const name = normalizeUsername(nameInput);
    nameInputRef.current = name;
    if (usernameProblem(name)) {
      setNameCheck({ state: "idle" });
      return;
    }
    setNameCheck({ state: "checking" });
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/username-check?u=${encodeURIComponent(name)}`, {
          signal: ctl.signal,
          cache: "no-store",
        });
        const data = await res.json();
        if (nameInputRef.current !== name) return; // 打字比请求快，丢弃过期结果
        if (data?.state === "free" || data?.state === "taken") {
          setNameCheck({ ...data, name });
        } else if (data?.state === "throttled") {
          setNameCheck({ state: "throttled", message: data.message ?? "查名过于频繁，请稍后再试。" });
        } else {
          setNameCheck({ state: "error" });
        }
      } catch {
        if (!ctl.signal.aborted) setNameCheck({ state: "error" });
      }
    }, NAME_CHECK_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [nameInput]);

  function clearField(name: string) {
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
    // 服务端给的红字，用户一改该栏就撤掉，别让旧结论一直挂着
    if (serverFieldRef.current === name) {
      serverFieldRef.current = undefined;
      setServerMessage(null);
    }
  }

  /** 把问题聚焦到某一栏：描红 + 顶部汇总 + 聚焦并滚到视野中间。 */
  function blameField(name: string, message: string, summary: string) {
    setFieldErrors({ [name]: message });
    setError(summary);
    const el = formRef.current?.querySelector<HTMLInputElement>(`[name="${name}"]`);
    el?.focus();
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /** 点建议名即填入雅名栏（输入框是非受控的，必须连 DOM 一起写，别只改状态）。 */
  function pickUsername(suggestion: string) {
    if (usernameRef.current) usernameRef.current.value = suggestion;
    setNameInput(suggestion);
    clearField("username");
    serverFieldRef.current = undefined;
    setServerMessage(null);
    usernameRef.current?.focus();
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

    // 已经查到撞名就不必白跑一趟服务端（真提交时服务端还会再判，不依赖这里的结论）
    const name = normalizeUsername(String(fd.get("username") ?? ""));
    if (nameCheck.state === "taken" && nameCheck.name === name) {
      blameField("username", "此雅名已被占用，请换一个（可点下方建议）。", "填写尚有问题：雅名。请按下方红字提示补正后重新提交。");
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

  const taken = nameCheck.state === "taken" ? nameCheck : null;

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

      {(error || serverMessage) && (
        <p className="notice" role="alert" style={{ color: "var(--maroon-deep)" }}>
          ✗ {error ?? serverMessage}
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
              ref={usernameRef}
              name="username"
              maxLength={20}
              placeholder="2–20 位，字母或汉字"
              className={fieldErrors.username || taken ? "input-invalid" : undefined}
              {...aria("username")}
              onChange={(e) => {
                setNameInput(e.target.value);
                clearField("username");
              }}
            />
            {fieldErr("username")}
            {!fieldErrors.username && nameCheck.state === "checking" && (
              <p className="field-tip">◌ 正在查验此名……</p>
            )}
            {!fieldErrors.username && nameCheck.state === "free" && (
              <p className="field-tip ok">✓ 此名尚无人用，可放心注册。</p>
            )}
            {taken && (
              <p className={`field-tip ${fieldErrors.username ? "" : "bad"}`}>
                {!fieldErrors.username &&
                  `✗ 此名已被占用${taken.former ? "（曾是某位学者的名号，依规矩不可重领）" : ""}。`}
                {taken.suggestions.length > 0 && (
                  <>
                    {fieldErrors.username ? "可试：" : " 可试："}
                    {taken.suggestions.map((s) => (
                      <button key={s} type="button" className="name-chip" onClick={() => pickUsername(s)}>
                        {s}
                      </button>
                    ))}
                  </>
                )}
              </p>
            )}
            {nameCheck.state === "throttled" && <p className="field-tip">{nameCheck.message}</p>}
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
