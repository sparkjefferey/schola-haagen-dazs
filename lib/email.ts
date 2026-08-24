// 真·邮件发送（SMTP）。通过环境变量配置，未配置时静默降级为「不发邮件」，
// 由调用方（notifyWeakPassword）改用站内系统消息兜底，保证用户始终能被通知到。
//
// 配置（docker-compose 的 environment 或同目录 .env）：
//   SMTP_HOST  邮件服务器地址，例如 smtp.resend.com / smtp.gmail.com
//   SMTP_PORT  端口，默认 587（STARTTLS）；若用 465 会自动切到 SSL
//   SMTP_USER 登录用户名（有的服务商要求填固定值，如 Resend 填 "resend"）
//   SMTP_PASS 登录密码 / API Key
//   SMTP_FROM  发件人，例如 "沙藏学馆 <noreply@yourdomain.com>"
//
// 免费额度足够小站使用：Resend 3000/月、Brevo 300/天、Mailgun  flex 等；
// 用 Resend 时 host=smtp.resend.com port=587 user=resend pass=你的APIKey。

import nodemailer from "nodemailer";
import { sendSystemMessage } from "./messages";

const SMTP_HOST = process.env.SMTP_HOST?.trim();
const SMTP_PORT = Number(process.env.SMTP_PORT ?? "587") || 587;
const SMTP_USER = process.env.SMTP_USER?.trim() ?? "";
const SMTP_PASS = process.env.SMTP_PASS?.trim() ?? "";
const SMTP_FROM = process.env.SMTP_FROM?.trim() || "Schola <noreply@schola.local>";

/** 是否已配置可用的 SMTP（缺 host 或 缺密码即视为未配置）。 */
export const emailConfigured = Boolean(SMTP_HOST && SMTP_PASS);

export interface EmailResult {
  sent: boolean;
  reason?: string;
}

/** 发送一封邮件；未配置或发送失败时返回 { sent:false }，不抛异常。 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<EmailResult> {
  if (!emailConfigured) return { sent: false, reason: "unconfigured" };
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
    await transporter.sendMail({
      from: SMTP_FROM,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { sent: true };
  } catch (err) {
    console.error("[email] 发送失败:", (err as Error)?.message ?? err);
    return { sent: false, reason: (err as Error)?.message ?? "unknown" };
  }
}

// ---- 弱口令提醒文案 ----

const WEAK_SUBJECT = "【沙藏学馆】请加强你的账户口令";

// 站内系统消息（纯文本，单行，避免换行在列表里显示异常）
const WEAK_INAPP =
  "⚠️ 系统提醒：你近期设置的账户口令强度偏低（「弱」等级），易被自动脚本试出，存在被盗风险。建议 12 位以上、含大小写数字与符号。本学派不提供口令找回，请尽快在「学者名册 → 修改口令」中更换为更强口令。";

// 真·邮件正文（多行，邮件客户端会保留换行）
function weakEmailText(username: string): string {
  return `学者 ${username} 道友：

我们在你最近设置账户口令时检测到其强度偏低（属于「弱」等级）。弱口令易被自动化脚本试出，存在账号被盗风险。

建议你尽快将口令加强：
· 长度 12 位以上；
· 同时包含大写字母、小写字母、数字与符号；
· 避免使用生日、姓名、连续或重复字符（如 123456、aaaaaa）。

说明：本学派不提供口令找回，口令务必牢记。请登录后在「学者名册 → 修改口令」中更换为更强口令。

—— 沙藏学馆 · 燕京阁（系统自动提醒，无需回复）`;
}

/**
 * 弱口令提醒：双通道送达。
 * 1) 站内系统消息：永远可达（即便没配 SMTP，或用户还没填邮箱）。
 * 2) 真·邮件：仅当 SMTP 已配置且用户已填邮箱时发送。
 */
export async function notifyWeakPassword(opts: {
  userId: number;
  email: string;
  username: string;
}): Promise<void> {
  sendSystemMessage(opts.userId, WEAK_INAPP);
  const email = opts.email?.trim();
  if (email && emailConfigured) {
    await sendEmail({ to: email, subject: WEAK_SUBJECT, text: weakEmailText(opts.username) });
  }
}
