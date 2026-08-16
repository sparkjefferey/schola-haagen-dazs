import { randomBytes } from "node:crypto";
import { db } from "./db";

// 算式验证码：无第三方依赖，服务端本地生成/校验。
// 作用：登录连续失败后拦住"脚本自动喂错"（每个请求都要先取题、答题），
// 对真人只是多敲几个数字。答案存 rate_limit_windows（复用限流表的清理机制），
// 一次性使用（校验即删），5 分钟过期。

const CAPTCHA_TTL_MS = 5 * 60_000;

export interface CaptchaChallenge {
  id: string;
  question: string;
}

function newChallenge() {
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  return { a, b, answer: a + b, question: `${a} + ${b} = ？` };
}

/** 为用户 username 生成一道新算式验证码。id 绑定用户名，防跨账号复用。 */
export function createCaptcha(username: string): CaptchaChallenge {
  const { answer, question } = newChallenge();
  const id = randomBytes(8).toString("hex");
  const now = Date.now();
  db.prepare(
    `INSERT INTO rate_limit_windows (key, count, window_end) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET count = excluded.count, window_end = excluded.window_end`,
  ).run(`login:captcha:${id}:${username}`, answer, now + CAPTCHA_TTL_MS);
  return { id, question };
}

/** 校验并消费验证码（无论对错都作废，答错须重新取题）。 */
export function verifyCaptcha(id: string, username: string, answer: string): boolean {
  const clean = answer.trim();
  if (!id || !/^\d{1,3}$/.test(clean)) return false;
  const key = `login:captcha:${id}:${username}`;
  const row = db
    .prepare("SELECT count FROM rate_limit_windows WHERE key = ?")
    .get(key) as { count: number } | undefined;
  db.prepare("DELETE FROM rate_limit_windows WHERE key = ?").run(key);
  if (!row) return false;
  return Number(clean) === row.count;
}
