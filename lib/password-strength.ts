// 口令风险等级评分（纯函数，客户端与服务端通用，无任何 Node/浏览器依赖）。
// 用途：注册与改密时实时提示风险等级（建议性质，非强制门槛）。

export type StrengthLevel = "weak" | "medium" | "strong" | "very-strong";

export interface StrengthResult {
  score: number;
  level: StrengthLevel;
  label: string;
}

export function passwordStrength(password: string): StrengthResult {
  const len = password.length;
  let score = 0;
  // 字符类别：小写 / 大写 / 数字 / 符号，各 +1
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  // 长度：≥8 / ≥12 / ≥16，各 +1
  if (len >= 8) score += 1;
  if (len >= 12) score += 1;
  if (len >= 16) score += 1;
  // 全同字符（如 aaaaaaaa / 111111）直接压到最低
  if (len >= 4 && /^(.)\1+$/.test(password)) score = Math.min(score, 1);

  const level: StrengthLevel =
    score >= 7 ? "very-strong" : score >= 5 ? "strong" : score >= 3 ? "medium" : "weak";
  const label =
    level === "very-strong" ? "极强" : level === "strong" ? "强" : level === "medium" ? "中" : "弱";
  return { score, level, label };
}
