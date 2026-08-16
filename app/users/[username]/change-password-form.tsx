"use client";

import { useState } from "react";
import { changePasswordAction } from "@/lib/actions";
import { passwordStrength, type StrengthResult } from "@/lib/password-strength";
import { PasswordStrengthHint } from "@/components/password-strength-hint";

const inputStyle = {
  fontFamily: "var(--serif)",
  color: "var(--ink)",
  background: "var(--parch-0)",
  border: "1px solid var(--line)",
  borderRadius: 3,
  padding: "8px 12px",
  width: "100%",
} as const;

export default function ChangePasswordForm({ e, ok }: { e?: string; ok?: string }) {
  const [strength, setStrength] = useState<StrengthResult>(passwordStrength(""));

  return (
    <form action={changePasswordAction} style={{ marginTop: 12 }}>
      <div className="field" style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 13 }}>当前口令</label>
        <input
          name="current"
          type="password"
          autoComplete="current-password"
          style={inputStyle}
        />
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 13 }}>新口令（至少 6 位；建议 12 位以上）</label>
        <input
          name="next"
          type="password"
          autoComplete="new-password"
          style={inputStyle}
          onChange={(e) => setStrength(passwordStrength(e.target.value))}
        />
        <PasswordStrengthHint strength={strength} />
      </div>
      <button type="submit" className="btn btn-sm btn-gold" style={{ width: "100%" }}>
        更 新 口 令
      </button>
      <p className="meta" style={{ marginTop: 8, fontSize: 12, textAlign: "center" }}>
        改密后将注销你其他设备的登录，以防账号被盗用。
        {e === "pwd" && <span style={{ color: "var(--maroon)" }}> · 当前口令错误</span>}
        {e === "pwdlen" && <span style={{ color: "var(--maroon)" }}> · 新口令至少 6 位</span>}
        {e === "pwdsame" && <span style={{ color: "var(--maroon)" }}> · 新口令不能与旧口令相同</span>}
        {ok === "pwd" && <span style={{ color: "var(--gold-deep)" }}> · 口令已更新</span>}
      </p>
    </form>
  );
}
