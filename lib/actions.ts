"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, DISCIPLINES, FORUM_CATEGORIES, nextManuscriptCode } from "@/lib/db";
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  getSessionUser,
  destroyAllSessions,
  isLocked,
  captchaRequired,
  CAPTCHA_FAILS,
  clientIp,
  recordFailedAttempt,
  clearFailedAttempts,
} from "@/lib/auth";
import { logAudit, consumeInvite, createInviteCode } from "@/lib/governance";
import { CONTENT_KEYS } from "@/lib/content";
import { sendSystemMessage } from "@/lib/messages";
import { notifyWeakPassword } from "@/lib/email";
import { passwordStrength } from "@/lib/password-strength";
import { isMutuallyCertified, pmQuotaUsed, pmDailyLimit } from "@/lib/certification";
import { consumeFixedWindow, resetFixedWindow, peekFixedWindow, rateLimitFingerprint } from "@/lib/rate-limit";
import { verifyCaptcha } from "@/lib/captcha";

const USERNAME_RE = /^[a-zA-Z0-9_\-\u4e00-\u9fa5]{2,20}$/;

function fail(message: string): never {
  throw new Error(message);
}

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

// 登录限流参数（与 lib/auth.ts 的单 IP 桶互补）：
// - 设备桶：同一真实 IP 累计错误 10 次 → 锁该设备 15 分钟（锁"设备"不锁"账号"）；
// - 用户名全局桶：全站同一用户名累计 15 次失败 → 每次尝试递增等待而非锁死账号。
const LOGIN_WINDOW_MS = 15 * 60_000;
const IP_DEVICE_FAILS = 10;
const USER_GLOBAL_FAILS = 15;

function accountAgeMs(createdAt: string): number {
  const normalized = createdAt.endsWith("Z") ? createdAt : `${createdAt}Z`;
  const joinedAt = new Date(normalized).getTime();
  return Number.isFinite(joinedAt) ? Math.max(0, Date.now() - joinedAt) : 0;
}

function isNewAccount(user: { created_at: string }): boolean {
  return accountAgeMs(user.created_at) < DAY_MS;
}

function limitAccountAction(key: string, limit: number, windowMs: number): boolean {
  return consumeFixedWindow(key, limit, windowMs).limited;
}

export async function requireLogin() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireLogin();
  if (user.role !== "admin") redirect("/");
  return user;
}

// ==================== 注册 / 登录 ====================

export async function registerUser(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim().slice(0, 24) || username;
  const motto = String(formData.get("motto") ?? "").trim().slice(0, 80);
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 120);
  const role = String(formData.get("role") ?? "scholar") as "admin" | "scholar";
  const invite = String(formData.get("invite") ?? "").trim();
  const captchaId = String(formData.get("captcha_id") ?? "").trim();
  const captchaAnswer = String(formData.get("captcha_answer") ?? "").trim();
  const roleTab = role === "admin" ? "&tab=admin" : "";

  if (!USERNAME_RE.test(username)) redirect(`/register?e=user${roleTab}`);
  if (password.length < 6 || password.length > 256) redirect(`/register?e=pass${roleTab}`);
  // 邮箱：格式粗校验（不收邮件时不强求，但填了就必须是合法格式）；用于接收口令安全提醒等系统邮件。
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect(`/register?e=email${roleTab}`);
  if (role !== "admin" && role !== "scholar") redirect("/register?e=user");

  // 蜜罐（呆脚本过滤器）：人类看不见的隐藏字段被填了 = 机器在操作，
  // 走"验证码错误"流程即可（真人永不触发，触发者也不被记仇/封禁）。
  if (String(formData.get("website") ?? "").trim() !== "") {
    redirect(`/register?e=captcha${roleTab}`);
  }

  // 验证码（真人校验）：注册页每次渲染出一道算式，机器人无法预取囤积。
  if (!verifyCaptcha(captchaId, "register", captchaAnswer)) {
    redirect(`/register?e=captcha${roleTab}`);
  }

  // 防恶意批量注册：全局兜底（挡多IP僵尸网络）+ 单IP（挡单点猛刷）。
  // SQLite 持久化（重启不清零）；小众学术站正常注册极少，
  // 每 10 分钟全局 8 个、单 IP 3 个足够，不会误伤真人。
  const ip = await clientIp();
  if (limitAccountAction("reg:global", 8, 600_000)) redirect(`/register?e=regrate${roleTab}`);
  if (limitAccountAction(`reg:${rateLimitFingerprint(ip)}`, 3, 600_000)) {
    redirect(`/register?e=regrate${roleTab}`);
  }

  // 同名检测：不区分大小写（"Rector"/"rector" 视为同一名，防止大小写变体卡名/冒名）
  const exists = db
    .prepare("SELECT 1 FROM users WHERE lower(username) = lower(?)")
    .get(username);
  if (exists) redirect(`/register?e=taken${roleTab}`);

  if (role === "admin") {
    const valid =
      consumeInvite(invite, "admin") ||
      (!!process.env.ADMIN_INVITE && process.env.ADMIN_INVITE === invite);
    if (!valid) redirect(`/register?e=invite${roleTab}`);
    logAudit(null, "admin.register", username, "凭邀请函注册管理者");
  }

  // INSERT OR IGNORE：并发抢注同一名的竞态由数据库唯一索引兜底
  // （changes = 0 即撞名被拒），避免两个同时请求都通过预检后一方报 500。
  const info = db
    .prepare(
      "INSERT OR IGNORE INTO users (username, display_name, password_hash, role, motto, email, root) VALUES (?, ?, ?, ?, ?, ?, 0)",
    )
    .run(username, displayName, hashPassword(password), role, motto, email);
  if (info.changes === 0) redirect(`/register?e=taken${roleTab}`);

  if (role === "scholar") {
    logAudit(info.lastInsertRowid as number, "user.register", username, "公开入学");
  }

  sendSystemMessage(
    info.lastInsertRowid as number,
    "欢迎入学 Schola Häagen-Dazs！此间为学派同侪论学、刊文、互证之所。若有疑义或建言，可赴『讯息』向管理者陈情。",
  );

  // 弱口令提醒：注册时即设了弱口令的用户，双通道（站内消息 + 真邮件）提示其加强。
  const newId = info.lastInsertRowid as number;
  if (passwordStrength(password).level === "weak") {
    await notifyWeakPassword({ userId: newId, email, username });
  }

  redirect(`/login?registered=${encodeURIComponent(username)}`);
}

export async function loginAction(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim().slice(0, 20);
  const password = String(formData.get("password") ?? "").slice(0, 256);
  const captchaId = String(formData.get("captcha_id") ?? "").trim();
  const captchaAnswer = String(formData.get("captcha_answer") ?? "").trim();
  const ip = await clientIp();
  const ipKey = `login:ip:${rateLimitFingerprint(ip)}`;

  // 设备锁（锁"设备"而非"账号"）：同一设备（真实 IP，不可伪造）累计错误 10 次 →
  // 锁该设备 15 分钟。不影响他人、不锁他人账号；换设备即可正常登录。
  if (peekFixedWindow(ipKey).count >= IP_DEVICE_FAILS) {
    redirect("/login?e=locked");
  }

  // 验证码（真人校验）：同一 (IP, 用户名) 失败达 3 次后，继续尝试必须答对算式。
  // 只拦"正在狂试的那一方"——受害者的设备没有失败记录，从不受此门影响。
  if (captchaRequired(ip, username)) {
    const ok = verifyCaptcha(captchaId, username, captchaAnswer);
    if (!ok) redirect(`/login?e=captcha&u=${encodeURIComponent(username)}`);
  }

  if (isLocked(ip, username)) {
    redirect("/login?e=locked");
  }

  // 用户名全局桶（V1 纵深，防多设备/换 IP 分布式爆破）：全站同一用户名累计 15 次
  // 失败后不再"锁死账号"（否则任何人可拿他人用户名错试 15 次将其锁 15 分钟），
  // 改为每次尝试递增等待 30s/1m/2m/4m/1m（封顶 60s）——正常用户永远能登录，
  // 攻击者爆破速度上限约 60 次/小时；成功登录即清零。
  const userBucket = peekFixedWindow(`login:user:${username}`);
  if (userBucket.count >= USER_GLOBAL_FAILS) {
    const waitMs = Math.min(30_000 * 2 ** (userBucket.count - USER_GLOBAL_FAILS), 60_000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
  if (!row || !verifyPassword(password, row.password_hash)) {
    consumeFixedWindow(ipKey, IP_DEVICE_FAILS, LOGIN_WINDOW_MS);
    consumeFixedWindow(`login:user:${username}`, USER_GLOBAL_FAILS, LOGIN_WINDOW_MS);
    const fails = recordFailedAttempt(ip, username);
    redirect(
      fails >= CAPTCHA_FAILS
        ? `/login?e=captcha&u=${encodeURIComponent(username)}`
        : "/login?e=bad",
    );
  }
  resetFixedWindow(ipKey);
  resetFixedWindow(`login:user:${username}`);
  clearFailedAttempts(ip, username);

  if (row.status !== "active") {
    redirect("/login?e=banned");
  }

  const token = createSession(row.id);
  await setSessionCookie(token);
  logAudit(row.id, "user.login", username, "登学");
  redirect(row.role === "admin" ? "/admin" : "/");
}

export async function logoutAction() {
  const user = await getSessionUser();
  if (user) {
    const store = (await import("next/headers")).cookies;
    const token = (await store()).get("schola_session")?.value;
    if (token) destroySession(token);
    logAudit(user.id, "user.logout", user.username, "退学");
  }
  await clearSessionCookie();
  redirect("/");
}

// ==================== 论坛 ====================

export async function createThreadAction(formData: FormData) {
  const user = await requireLogin();
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const category = String(formData.get("category") ?? "学术交流");

  if (title.length < 4 || title.length > 80) redirect("/forum?e=title");
  if (content.length < 10 || content.length > 20_000) redirect("/forum?e=body");
  if (!FORUM_CATEGORIES.includes(category as any)) redirect("/forum?e=body");
  // 仅按账号限流，写入 SQLite；重启或重新部署不会清空计数。
  const threadLimit = isNewAccount(user) ? 2 : 10;
  if (limitAccountAction(`thread:${user.id}`, threadLimit, HOUR_MS)) redirect("/forum?e=rate");

  const info = db
    .prepare("INSERT INTO threads (author_id, title, content, category) VALUES (?, ?, ?, ?)")
    .run(user.id, title, content, category);
  revalidatePath("/forum");
  redirect(`/forum/thread/${info.lastInsertRowid}`);
}

export async function replyAction(formData: FormData) {
  const user = await requireLogin();
  const threadId = Number(formData.get("thread_id"));
  const content = String(formData.get("content") ?? "").trim();
  if (!Number.isInteger(threadId)) redirect("/forum");
  if (content.length < 2 || content.length > 10_000) redirect(`/forum/thread/${threadId}?e=short`);
  const replyLimit = isNewAccount(user) ? 8 : 30;
  if (limitAccountAction(`reply:${user.id}`, replyLimit, HOUR_MS)) {
    redirect(`/forum/thread/${threadId}?e=rate`);
  }

  db.prepare("INSERT INTO replies (thread_id, author_id, content) VALUES (?, ?, ?)").run(
    threadId,
    user.id,
    content,
  );
  revalidatePath(`/forum/thread/${threadId}`);
  redirect(`/forum/thread/${threadId}`);
}

export async function deleteThreadAction(threadId: number) {
  const user = await requireLogin();
  if (!Number.isInteger(threadId) || threadId <= 0) fail("论题编号无效");
  const thread = db.prepare("SELECT author_id FROM threads WHERE id = ?").get(threadId) as
    | { author_id: number }
    | undefined;
  if (!thread) fail("论题不存在");
  if (user.role !== "admin" && user.id !== thread.author_id) fail("无权删除");
  db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
  logAudit(user.id, "thread.delete", `thread#${threadId}`, "删除论题");
  revalidatePath("/forum");
  redirect("/forum");
}

export async function deleteReplyAction(replyId: number) {
  const user = await requireLogin();
  if (!Number.isInteger(replyId) || replyId <= 0) fail("回复编号无效");
  const row = db.prepare("SELECT thread_id, author_id FROM replies WHERE id = ?").get(replyId) as
    | { thread_id: number; author_id: number }
    | undefined;
  if (!row) fail("回复不存在");
  if (user.role !== "admin" && user.id !== row.author_id) fail("无权删除");
  db.prepare("DELETE FROM replies WHERE id = ?").run(replyId);
  logAudit(user.id, "reply.delete", `reply#${replyId}`, "删除辩答");
  revalidatePath(`/forum/thread/${row.thread_id}`);
}

// ==================== 论文 / 掌门认证（专业期刊流水线） ====================

const configuredCoolDownHours = Number(process.env.COOL_DOWN_HOURS ?? "24");
const COOL_DOWN_HOURS = Number.isFinite(configuredCoolDownHours)
  ? Math.max(0, configuredCoolDownHours)
  : 24;

interface RawAuthor {
  display_name: string;
  affiliation?: string;
  email?: string;
  orcid?: string;
  is_corresponding?: boolean;
}

function parseAuthors(json: string, fallback: RawAuthor): RawAuthor[] {
  let arr: any[] = [];
  try {
    arr = JSON.parse(json);
  } catch {
    arr = [];
  }
  if (!Array.isArray(arr)) arr = [];
  const clean = arr
    .slice(0, 50)
    .map((a) => ({
      display_name: String(a?.display_name ?? "").trim().slice(0, 60),
      affiliation: String(a?.affiliation ?? "").trim().slice(0, 160),
      email: String(a?.email ?? "").trim().slice(0, 120),
      orcid: String(a?.orcid ?? "").trim().slice(0, 40),
      is_corresponding: a?.is_corresponding === true,
    }))
    .filter((a) => a.display_name.length > 0);
  if (clean.length === 0)
    clean.push({
      display_name: fallback.display_name,
      affiliation: fallback.affiliation ?? "",
      email: "",
      orcid: "",
      is_corresponding: true,
    });
  // 至少保证有一位通信作者
  if (!clean.some((a) => a.is_corresponding)) clean[0].is_corresponding = true;
  return clean;
}

function recordEvent(paperId: number, from: string | null, to: string | null, note: string, actorId: number | null) {
  db.prepare(
    "INSERT INTO review_events (paper_id, from_status, to_status, note, actor_id) VALUES (?, ?, ?, ?, ?)",
  ).run(paperId, from, to, note || "", actorId);
}

export async function createPaperAction(formData: FormData) {
  const user = await requireLogin();
  const title = String(formData.get("title") ?? "").trim();
  const short_title = String(formData.get("short_title") ?? "").trim().slice(0, 80);
  const discipline = String(formData.get("discipline") ?? "乳脂哲学");
  const abstract = String(formData.get("abstract") ?? "").trim();
  const keywords = String(formData.get("keywords") ?? "").trim().slice(0, 200);
  const content = String(formData.get("content") ?? "").trim();
  const funding = String(formData.get("funding") ?? "").trim().slice(0, 600);
  const cover_letter = String(formData.get("cover_letter") ?? "").trim().slice(0, 1000);
  const authorsJson = String(formData.get("authors_json") ?? "[]");

  if (title.length < 4 || title.length > 120) redirect("/papers/new?e=title");
  if (!DISCIPLINES.includes(discipline as any)) redirect("/papers/new?e=title");
  if (abstract.length > 600) redirect("/papers/new?e=abstract");
  if (content.length < 30 || content.length > 200_000) redirect("/papers/new?e=body");

  const joined = new Date(user.created_at.endsWith("Z") ? user.created_at : user.created_at + "Z").getTime();
  if (Date.now() - joined < COOL_DOWN_HOURS * 3600_000 && !user.endorsed) {
    redirect("/papers/new?e=cooldown");
  }
  if (limitAccountAction(`paper:${user.id}`, 5, HOUR_MS)) redirect("/papers/new?e=rate");

  // 认证学者免分诊，投稿即直送审；余者进「已收稿」待掌门分诊
  const status = user.endorsed ? "in_review" : "submitted";
  const year = new Date().getFullYear();
  const code = nextManuscriptCode(year);
  const authors = parseAuthors(authorsJson, { display_name: user.display_name });

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO papers
          (author_id, title, discipline, abstract, content, status, manuscript_code,
           short_title, keywords, funding, cover_letter, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(user.id, title, discipline, abstract, content, status, code, short_title, keywords, funding, cover_letter);
    const id = Number(info.lastInsertRowid);
    const ins = db.prepare(
      "INSERT INTO paper_authors (paper_id, display_name, affiliation, email, orcid, is_corresponding, author_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    authors.forEach((a, i) => ins.run(id, a.display_name, a.affiliation, a.email, a.orcid, a.is_corresponding ? 1 : 0, i));
    recordEvent(
      id,
      null,
      status,
      user.endorsed ? "认证学者投稿，免分诊直送审" : "文稿收讫，待掌门分诊",
      user.id,
    );
    return id;
  });
  const id = tx();

  logAudit(
    user.id,
    "paper.submit",
    `paper#${id}`,
    `${title}（${code} · ${status === "in_review" ? "直送审" : "已收稿"}）`,
  );
  revalidatePath("/papers");
  revalidatePath("/ranking");
  revalidatePath(`/users/${user.username}`);
  redirect(`/papers/${id}`);
}

export async function editPaperAction(paperId: number, formData: FormData) {
  const user = await requireLogin();
  const paper = db.prepare("SELECT author_id, status FROM papers WHERE id = ?").get(paperId) as any;
  if (!paper || paper.author_id !== user.id) fail("这不是你的文稿");
  if (!["submitted", "revision"].includes(paper.status)) fail("此稿已进入审稿流程，不可再改");

  const title = String(formData.get("title") ?? "").trim();
  const short_title = String(formData.get("short_title") ?? "").trim().slice(0, 80);
  const discipline = String(formData.get("discipline") ?? "乳脂哲学");
  const abstract = String(formData.get("abstract") ?? "").trim();
  const keywords = String(formData.get("keywords") ?? "").trim().slice(0, 200);
  const content = String(formData.get("content") ?? "").trim();
  const funding = String(formData.get("funding") ?? "").trim().slice(0, 600);
  const cover_letter = String(formData.get("cover_letter") ?? "").trim().slice(0, 1000);
  const authorsJson = String(formData.get("authors_json") ?? "[]");

  if (title.length < 4 || title.length > 120) fail("论著标题须在 4–120 字之间。");
  if (!DISCIPLINES.includes(discipline as any)) fail("学科门类无效。");
  if (abstract.length > 600) fail("提要过长（限 600 字）。");
  if (content.length < 30 || content.length > 200_000) fail("正文须在 30–200000 字之间。");

  const authors = parseAuthors(authorsJson, { display_name: user.display_name });
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE papers SET title=?, discipline=?, abstract=?, content=?, short_title=?,
        keywords=?, funding=?, cover_letter=?, updated_at=datetime('now') WHERE id=?`,
    ).run(title, discipline, abstract, content, short_title, keywords, funding, cover_letter, paperId);
    db.prepare("DELETE FROM paper_authors WHERE paper_id = ?").run(paperId);
    const ins = db.prepare(
      "INSERT INTO paper_authors (paper_id, display_name, affiliation, email, orcid, is_corresponding, author_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    authors.forEach((a, i) => ins.run(paperId, a.display_name, a.affiliation, a.email, a.orcid, a.is_corresponding ? 1 : 0, i));
  });
  tx();
  logAudit(user.id, "paper.edit", `paper#${paperId}`, "作者修订文稿");
  revalidatePath(`/papers/${paperId}`);
  revalidatePath("/papers");
  redirect(`/papers/${paperId}`);
}

export async function submitRevisionAction(paperId: number) {
  const user = await requireLogin();
  const paper = db.prepare("SELECT author_id, status FROM papers WHERE id = ?").get(paperId) as any;
  if (!paper || paper.author_id !== user.id) fail("这不是你的文稿");
  if (paper.status !== "revision") fail("此稿不在退修状态");
  db.prepare("UPDATE papers SET status = 'in_review', updated_at = datetime('now') WHERE id = ?").run(paperId);
  recordEvent(paperId, "revision", "in_review", "作者提交修改稿，重回送审", user.id);
  logAudit(user.id, "paper.revision.submit", `paper#${paperId}`, "提交修改稿");
  revalidatePath(`/papers/${paperId}`);
  revalidatePath("/papers");
  redirect(`/papers/${paperId}`);
}

export async function deletePaperAction(paperId: number) {
  const user = await requireLogin();
  if (!Number.isInteger(paperId) || paperId <= 0) fail("论文编号无效");
  const row = db.prepare("SELECT author_id, status FROM papers WHERE id = ?").get(paperId) as
    | { author_id: number; status: string }
    | undefined;
  if (!row) fail("论文不存在");
  if (user.role !== "admin" && user.id !== row.author_id) fail("无权撤稿");
  if (row.status !== "published") fail("未刊文稿不须撤取，可在个人名册中处置");
  db.prepare("DELETE FROM papers WHERE id = ?").run(paperId);
  logAudit(user.id, "paper.delete", `paper#${paperId}`, "撤稿");
  revalidatePath("/papers");
  revalidatePath("/ranking");
}

export async function discardPaperAction(paperId: number) {
  const user = await requireLogin();
  const row = db.prepare("SELECT author_id, status FROM papers WHERE id = ?").get(paperId) as any;
  if (!row || row.author_id !== user.id) throw new Error("无权处置");
  if (!["submitted", "revision", "rejected"].includes(row.status)) fail("此稿已在刊印流程中，不可弃");
  db.prepare("DELETE FROM papers WHERE id = ?").run(paperId);
  logAudit(user.id, "paper.discard", `paper#${paperId}`, "作者弃稿");
  revalidatePath(`/users/${user.username}`);
}

export async function resubmitPaperAction(paperId: number) {
  const user = await requireLogin();
  const paper = db.prepare("SELECT author_id, status FROM papers WHERE id = ?").get(paperId) as any;
  if (!paper || paper.author_id !== user.id) fail("这不是你的文稿");
  if (paper.status !== "rejected") fail("此稿不在驳回状态");
  db.prepare("UPDATE papers SET status = 'submitted', reject_reason = '', updated_at = datetime('now') WHERE id = ?").run(paperId);
  recordEvent(paperId, "rejected", "submitted", "作者改稿重投", user.id);
  logAudit(user.id, "paper.resubmit", `paper#${paperId}`, "改稿重投");
  revalidatePath(`/papers/${paperId}`);
  revalidatePath("/papers");
  redirect(`/papers/${paperId}`);
}

// ---- 掌门编辑部流水线（不重定向，交由前端 router.refresh） ----
export async function sendToReviewAction(paperId: number) {
  const me = await requireAdmin();
  const p = db.prepare("SELECT status FROM papers WHERE id = ?").get(paperId) as any;
  if (!p) fail("查无此文");
  if (!["submitted", "rejected"].includes(p.status)) fail("此稿当前状态不可送审");
  db.prepare("UPDATE papers SET status = 'in_review', updated_at = datetime('now') WHERE id = ?").run(paperId);
  recordEvent(paperId, p.status, "in_review", "掌门收稿，分诊送审", me.id);
  logAudit(me.id, "paper.review", `paper#${paperId}`, "收稿送审");
  revalidatePath(`/papers/${paperId}`);
  revalidatePath("/papers");
  revalidatePath("/admin");
}

export async function requestRevisionAction(paperId: number, note: string) {
  const me = await requireAdmin();
  const p = db.prepare("SELECT status FROM papers WHERE id = ?").get(paperId) as any;
  if (!p) fail("查无此文");
  if (!["in_review", "revision", "accepted"].includes(p.status)) fail("此稿当前状态不可退修");
  if (note.trim().length < 4) fail("退修须附审稿意见（至少 4 字）");
  db.prepare("UPDATE papers SET status = 'revision', decision_note = ?, updated_at = datetime('now') WHERE id = ?").run(
    note.trim().slice(0, 600),
    paperId,
  );
  recordEvent(paperId, p.status, "revision", note.trim().slice(0, 600), me.id);
  logAudit(me.id, "paper.revision", `paper#${paperId}`, "退修");
  revalidatePath(`/papers/${paperId}`);
  revalidatePath("/papers");
  revalidatePath("/admin");
}

export async function acceptPaperAction(paperId: number, note: string) {
  const me = await requireAdmin();
  const p = db.prepare("SELECT status FROM papers WHERE id = ?").get(paperId) as any;
  if (!p) fail("查无此文");
  if (!["in_review", "revision", "rejected"].includes(p.status)) fail("此稿当前状态不可录用");
  db.prepare(
    "UPDATE papers SET status = 'accepted', accepted_at = datetime('now'), decision_note = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(note.trim().slice(0, 600), paperId);
  recordEvent(paperId, p.status, "accepted", note.trim().slice(0, 600) || "掌门录用", me.id);
  logAudit(me.id, "paper.accept", `paper#${paperId}`, "录用待刊");
  revalidatePath(`/papers/${paperId}`);
  revalidatePath("/papers");
  revalidatePath("/admin");
}

export async function publishPaperAction(paperId: number) {
  const me = await requireAdmin();
  const p = db.prepare("SELECT id, author_id, title, status FROM papers WHERE id = ?").get(paperId) as any;
  if (!p) fail("查无此文");
  if (p.status !== "accepted") fail("须先录用，方可刊印");
  db.prepare("UPDATE papers SET status = 'published', published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(paperId);
  db.prepare("UPDATE users SET endorsed = 1 WHERE id = ?").run(p.author_id);
  recordEvent(paperId, "accepted", "published", "刊印成典，作者获『认证学者』之印", me.id);
  logAudit(me.id, "paper.publish", `paper#${paperId}`, "刊印；作者获认证学者印");
  sendSystemMessage(p.author_id, `你的论文《${p.title}》已刊印成典，并获『认证学者』之印。可赴论文库查看。`);
  revalidatePath(`/papers/${paperId}`);
  revalidatePath("/papers");
  revalidatePath("/ranking");
  revalidatePath("/admin");
}

export async function rejectPaperAction(paperId: number, reason: string) {
  const me = await requireAdmin();
  if (reason.trim().length < 4) fail("驳回须告理由（至少 4 字）");
  const p = db.prepare("SELECT status FROM papers WHERE id = ?").get(paperId) as any;
  if (!p) fail("查无此文");
  db.prepare("UPDATE papers SET status = 'rejected', reject_reason = ?, updated_at = datetime('now') WHERE id = ?").run(
    reason.trim().slice(0, 200),
    paperId,
  );
  recordEvent(paperId, p.status, "rejected", reason.trim().slice(0, 200), me.id);
  logAudit(me.id, "paper.reject", `paper#${paperId}`, reason.trim().slice(0, 100));
  revalidatePath(`/papers/${paperId}`);
  revalidatePath("/papers");
  revalidatePath("/admin");
}

export async function incrementViewsAction(paperId: number) {
  const user = await getSessionUser();
  if (!user || !Number.isInteger(paperId) || paperId <= 0) return;
  // 阅读量防刷（V5）：同一 IP 对同一论文 10 分钟只计 1 次。
  // 正常阅读无感；脚本换账号狂刷也无法刷高学榜分。
  const ip = await clientIp();
  if (limitAccountAction(`view:${rateLimitFingerprint(ip)}:${paperId}`, 1, 10 * 60_000)) {
    return;
  }
  const result = db
    .prepare(
      "UPDATE papers SET views = views + 1 WHERE id = ? AND status = 'published' AND author_id <> ?",
    )
    .run(paperId, user.id);
  if (result.changes > 0) revalidatePath(`/papers/${paperId}`);
}

// ==================== 成员处置 ====================

/** 创始人 = 当前 root 成员中 id 最小者（即最早注册的那位，rector）。创始人永不可被封/删/降级。 */
function founderId(): number | null {
  const r = db.prepare("SELECT MIN(id) AS id FROM users WHERE root = 1").get() as { id: number | null } | undefined;
  return r && r.id != null ? r.id : null;
}
/** 当前 root 成员数量（用于防止把最后一位创始人也处置掉，导致全站无主）。 */
function rootCount(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM users WHERE root = 1").get() as { c: number }).c;
}

export async function setUserStatusAction(userId: number, status: "active" | "banned" | "retired", reason: string) {
  const actor = await requireAdmin();
  const target = db.prepare("SELECT username, role, root FROM users WHERE id = ?").get(userId) as any;
  if (!target) redirect("/admin?tab=members&e=missing");
  if (userId === actor.id && status !== "active") redirect("/admin?tab=members&e=self");
  // 允许处置 root 成员，但保护创始人本人、且不可令全站失去最后一位创始人。
  if (target.root && userId === founderId()) redirect("/admin?tab=members&e=founder");
  if (target.root && status !== "active" && rootCount() <= 1) redirect("/admin?tab=members&e=last-root");
  const reasonCleaned = reason.trim().slice(0, 200);
  if (status !== "active" && reasonCleaned.length < 2) redirect("/admin?tab=members&e=reason");

  db.prepare("UPDATE users SET status = ?, banned_reason = ? WHERE id = ?").run(
    status,
    status === "active" ? "" : reasonCleaned,
    userId,
  );
  if (status !== "active") destroyAllSessions(userId);
  logAudit(actor.id, `user.${status}`, `@${target.username}`, reasonCleaned || "恢复在籍");
  revalidatePath("/admin");
}

export async function setUserRoleAction(userId: number, role: "admin" | "scholar") {
  const actor = await requireAdmin();
  if (role !== "admin" && role !== "scholar") redirect("/admin?tab=members&e=role");
  const target = db.prepare("SELECT username, role, root FROM users WHERE id = ?").get(userId) as any;
  if (!target) redirect("/admin?tab=members&e=missing");
  if (target.root && userId === founderId()) redirect("/admin?tab=members&e=founder");
  if (target.root && role === "scholar" && rootCount() <= 1) redirect("/admin?tab=members&e=last-root");
  if (target.role === "admin" && role === "scholar") {
    const admins = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status='active'").get() as any).c;
    if (admins <= 1) redirect("/admin?tab=members&e=last-admin");
  }
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
  logAudit(actor.id, `role.${role}`, `@${target.username}`, `身阶变动 → ${role}`);
  if (role === "admin") {
    sendSystemMessage(userId, "你已被任命为学派管理者，自此可入燕京阁调度学务。");
  } else {
    sendSystemMessage(userId, "你的管理者身阶已被收回，复为学者。");
  }
  revalidatePath("/admin");
}

// ==================== 凭邀请函就任管理者（学者自助渠道） ====================
// 学者在个人页填入管理者邀请函（R-xxxx），校验通过后将自己的身份升为管理者。
// 与注册时管理者就任共用同一套邀请函校验逻辑。
export async function claimAdminAction(formData: FormData) {
  const me = await requireLogin();
  if (me.role === "admin") redirect(`/users/${me.username}`);
  if (me.status !== "active") redirect(`/users/${me.username}`);

  const code = String(formData.get("invite") ?? "").trim().toUpperCase();
  // 只允许 R- 开头的管理者邀请函；开放 ADMIN_INVITE 环境变量时也可作为通用凭据
  const valid =
    consumeInvite(code, "admin") ||
    (!!process.env.ADMIN_INVITE && process.env.ADMIN_INVITE.trim() !== "" && process.env.ADMIN_INVITE === code);
  if (!valid) redirect(`/users/${me.username}?e=invite`);

  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(me.id);
  logAudit(me.id, "admin.claim", `@${me.username}`, "凭邀请函就任管理者");
  sendSystemMessage(me.id, "你已凭邀请函就任学派管理者，自此可入燕京阁调度学务。");
  revalidatePath(`/users/${me.username}`);
  redirect(`/users/${me.username}?ok=就任`);
}

/** 自助改密码：仅本人可改，需先验证旧密码，再会话续期。 */
export async function changePasswordAction(formData: FormData) {
  const me = await requireLogin();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");

  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(me.id) as any;
  if (!row || !verifyPassword(current, row.password_hash)) {
    redirect(`/users/${me.username}?e=pwd`);
  }
  if (next.length < 6 || next.length > 256) redirect(`/users/${me.username}?e=pwdlen`);
  if (next === current) redirect(`/users/${me.username}?e=pwdsame`);

  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(next), me.id);
  // 改密后吊销其他设备的会话，只保留当前会话，防止被盗用
  const store = (await import("next/headers")).cookies;
  const token = (await store()).get("schola_session")?.value;
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND token IS NOT ?").run(me.id, token ?? "__none__");
  logAudit(me.id, "account.password", `@${me.username}`, "自助修改口令（其余会话已吊销）");

  // 弱口令提醒：若新口令仍为「弱」等级，双通道（站内消息 + 真邮件）提示其加强。
  if (passwordStrength(next).level === "weak") {
    const u = db.prepare("SELECT email FROM users WHERE id = ?").get(me.id) as { email: string } | undefined;
    await notifyWeakPassword({ userId: me.id, email: u?.email ?? "", username: me.username });
  }

  revalidatePath(`/users/${me.username}`);
  redirect(`/users/${me.username}?ok=pwd`);
}

/** 自助更新联系邮箱（仅本人，用于接收口令安全提醒等系统邮件）。留空即清除。 */
export async function updateEmailAction(formData: FormData) {
  const me = await requireLogin();
  let email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    redirect(`/users/${me.username}?e=emailfmt`);
  }
  db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email, me.id);
  logAudit(me.id, "account.email", `@${me.username}`, email ? "更新联系邮箱" : "清除联系邮箱");
  revalidatePath(`/users/${me.username}`);
  redirect(`/users/${me.username}?ok=email`);
}

// ==================== 用户名改名（申请 + 掌门审核） ====================
// 用户提交改名申请 → 掌门在燕京阁应允/婉拒 → 应允后立即执行改名，
// 旧名记入 username_history，个人页查不到原名时按曾用名 302 重定向到新名册。
const RENAME_COOLDOWN_DAYS = 7;
const RENAME_COOLDOWN_MS = RENAME_COOLDOWN_DAYS * 24 * 3600_000;

/** 最近一次改名申请的提交时间（无论结果），无则 null。 */
function lastRenameRequestAt(userId: number): number | null {
  const row = db
    .prepare("SELECT MAX(created_at) AS at FROM username_changes WHERE requester_id = ?")
    .get(userId) as { at: string } | undefined;
  if (!row?.at) return null;
  const t = new Date(row.at.endsWith("Z") ? row.at : `${row.at}Z`).getTime();
  return Number.isFinite(t) ? t : null;
}

/** 本人提交改名申请。 */
export async function requestRenameAction(formData: FormData) {
  const me = await requireLogin();
  if (me.status !== "active") redirect(`/users/${me.username}`);
  const newUsername = String(formData.get("new_username") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 120);

  if (!USERNAME_RE.test(newUsername)) redirect(`/users/${me.username}?e=renamefmt`);
  if (newUsername === me.username) redirect(`/users/${me.username}?e=renamesame`);
  // 创始掌门名保留：不得改名为 rector，防止日后有人抢注该名，破坏启动时的创始人修复逻辑
  if (newUsername.toLowerCase() === "rector") redirect(`/users/${me.username}?e=renamereserved`);

  const taken = db
    .prepare("SELECT 1 FROM users WHERE lower(username) = lower(?)")
    .get(newUsername);
  if (taken) redirect(`/users/${me.username}?e=renametaken`);

  const pending = db
    .prepare("SELECT 1 FROM username_changes WHERE requester_id = ? AND status = 'pending' LIMIT 1")
    .get(me.id);
  if (pending) redirect(`/users/${me.username}?e=renamepending`);

  const last = lastRenameRequestAt(me.id);
  if (last !== null && Date.now() - last < RENAME_COOLDOWN_MS) {
    redirect(`/users/${me.username}?e=renamecooldown`);
  }

  db.prepare(
    "INSERT INTO username_changes (requester_id, old_username, new_username, reason) VALUES (?, ?, ?, ?)",
  ).run(me.id, me.username, newUsername, reason);
  logAudit(me.id, "rename.request", `@${me.username}`, `申请改名 → @${newUsername}${reason ? `（${reason}）` : ""}`);
  revalidatePath(`/users/${me.username}`);
  redirect(`/users/${me.username}?ok=rename`);
}

/** 掌门审核改名申请。approve=true 应允并立即执行改名；false 婉拒（备注可告申请人）。 */
export async function respondRenameAction(requestId: number, approve: boolean, note: string) {
  const me = await requireAdmin();
  if (!Number.isInteger(requestId) || requestId <= 0) fail("改名申请编号无效");
  const req = db
    .prepare("SELECT * FROM username_changes WHERE id = ? AND status = 'pending'")
    .get(requestId) as any;
  if (!req) fail("该改名申请不存在或已处置");
  const target = db.prepare("SELECT id, username, status FROM users WHERE id = ?").get(req.requester_id) as any;
  if (!target) fail("申请人已不在册");
  const noteCleaned = (note || "").trim().slice(0, 200);

  if (approve) {
    // 二次校验：等待期间新名可能已被他人注册（注册走大小写不敏感唯一）
    if (!USERNAME_RE.test(req.new_username)) fail("新名已不符合命名规则，请婉拒并让其重新申请");
    if (target.username === req.new_username) fail("该用户已是此名，无需改名");
    const taken = db
      .prepare("SELECT 1 FROM users WHERE id != ? AND lower(username) = lower(?)")
      .get(target.id, req.new_username);
    if (taken) fail("该名已被他人占用，请婉拒并告知申请人另择新名。");

    const tx = db.transaction(() => {
      db.prepare("INSERT INTO username_history (user_id, old_username) VALUES (?, ?)").run(
        target.id,
        target.username,
      );
      db.prepare("UPDATE users SET username = ? WHERE id = ?").run(req.new_username, target.id);
      db.prepare(
        "UPDATE username_changes SET status = 'approved', responded_by = ?, responded_at = datetime('now'), response_note = ? WHERE id = ?",
      ).run(me.id, noteCleaned, requestId);
    });
    tx();
    logAudit(me.id, "rename.approve", `@${req.old_username}`, `应允改名 → @${req.new_username}`);
    sendSystemMessage(
      target.id,
      `你的改名申请已蒙掌门应允：@${req.old_username} 今更名 @${req.new_username}。旧名保留重定向，他人所留旧链接仍可抵达。`,
    );
    revalidatePath(`/users/${req.old_username}`);
    revalidatePath(`/users/${req.new_username}`);
    revalidatePath("/admin");
    revalidatePath("/ranking");
    revalidatePath("/");
    redirect(`/admin?tab=renames&ok=${encodeURIComponent(`已应允：@${req.new_username}`)}`);
  }

  db.prepare(
    "UPDATE username_changes SET status='declined', responded_by = ?, responded_at = datetime('now'), response_note = ? WHERE id = ?",
  ).run(me.id, noteCleaned, requestId);
  logAudit(me.id, "rename.decline", `@${req.old_username}`, `婉拒改名 → @${req.new_username}${noteCleaned ? `（${noteCleaned}）` : ""}`);
  sendSystemMessage(
    target.id,
    `你的改名申请（→ @${req.new_username}）被掌门婉拒${noteCleaned ? `：${noteCleaned}` : ""}。7 天后可再次提交。`,
  );
  revalidatePath(`/users/${target.username}`);
  redirect(`/admin?tab=renames&ok=${encodeURIComponent("已婉拒并致函申请人")}`);
}

export async function setUserEndorsedAction(userId: number, endorsed: 0 | 1) {
  const actor = await requireAdmin();
  const target = db.prepare("SELECT username, status FROM users WHERE id = ?").get(userId) as any;
  if (!target) redirect("/admin?tab=members&e=missing");
  db.prepare("UPDATE users SET endorsed = ? WHERE id = ?").run(endorsed || 0, userId);
  logAudit(actor.id, `endorse.${endorsed ? "grant" : "revoke"}`, `@${target.username}`, endorsed ? "授认证学者印" : "收回认证印");
  revalidatePath("/admin");
  revalidatePath(`/users/${target.username}`);
}

export async function deleteUserAction(userId: number) {
  const actor = await requireAdmin();
  if (actor.id === userId) redirect("/admin?tab=members&e=self");
  const target = db.prepare("SELECT username, root, role FROM users WHERE id = ?").get(userId) as any;
  if (!target) redirect("/admin?tab=members&e=missing");
  if (target.root && userId === founderId()) redirect("/admin?tab=members&e=founder");
  if (target.root && rootCount() <= 1) redirect("/admin?tab=members&e=last-root");
  if (target.role === "admin") {
    const admins = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as any).c;
    if (admins <= 1) redirect("/admin?tab=members&e=last-admin");
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  logAudit(actor.id, "user.delete", `@${target.username}`, "除籍永去");
  revalidatePath("/admin");
}

// ==================== 徽章司（邀请码） ====================

export async function createInviteAction(formData: FormData) {
  const actor = await requireAdmin();
  const kind = String(formData.get("kind") ?? "admin");
  const uses = Math.min(Math.max(Number(formData.get("uses")) || 1, 1), 20);
  const days = String(formData.get("days") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 60);
  if (kind !== "admin" && kind !== "scholar") fail("非法邀请类型");

  const expires = days ? Math.min(Math.max(Number(days), 1), 365) : null;
  const code = createInviteCode(kind, uses, note, actor.id, expires);
  logAudit(actor.id, "invite.create", kind, `${code} ×${uses}${expires ? ` ${expires}日` : " 永久"}`);
  redirect(`/admin?tab=invites&ok=${encodeURIComponent(`新字${code}已铸`)}`);
}

export async function revokeInviteAction(code: string) {
  const actor = await requireAdmin();
  db.prepare("UPDATE invites SET revoked = 1 WHERE code = ?").run(code);
  logAudit(actor.id, "invite.revoke", code, "作废邀请函");
  redirect(`/admin?tab=invites&ok=${encodeURIComponent("已作废")}`);
}

// ==================== 文宣司（可编辑文案） ====================
// 后台一次性提交全部文案字段；库里 upsert，留空则回退默认（由读取侧处理）。
// ==================== 站内讯息（私聊 + 系统消息） ====================

export async function sendMessageAction(formData: FormData) {
  const me = await requireLogin();
  const receiverId = Number(formData.get("receiver_id"));
  let body = String(formData.get("body") ?? "").trim();
  if (!receiverId || !Number.isFinite(receiverId)) redirect("/messages");
  if (body.length === 0) redirect(`/messages?with=${receiverId}&e=empty`);
  if (body.length > 2000) body = body.slice(0, 2000);
  if (receiverId === me.id) redirect("/messages?e=self");
  const target = db
    .prepare("SELECT id, username, role, status FROM users WHERE id = ?")
    .get(receiverId) as any;
  if (!target || target.status !== "active") redirect(`/messages?e=nouser`);

  const mutuallyCertified = isMutuallyCertified(me.id, receiverId);

  // 管理员收件箱是高价值目标。普通账号只有满足下列任一条件才可主动联系管理员：
  // 已获认证、已与该管理员互证，或管理员曾经先给它发送过私信。
  // 这项检查必须放在服务端，不能依赖页面是否展示管理员 ID。
  if (me.role !== "admin" && target.role === "admin") {
    const adminOpenedConversation = !!db
      .prepare(
        "SELECT 1 FROM messages WHERE kind='pm' AND sender_id=? AND receiver_id=? LIMIT 1",
      )
      .get(receiverId, me.id);
    if (!me.endorsed && !mutuallyCertified && !adminOpenedConversation) {
      logAudit(me.id, "security.pm_blocked", `@${target.username}`, "未获认证账号主动联系管理员");
      redirect(`/messages?with=${receiverId}&e=admin_gate`);
    }

    // 即便已获准联系管理员，也保留按“发送账号 + 管理员”计算的独立额度，
    // 防止某个已认证账号失陷后持续轰炸。管理员回信不受此限制。
    if (
      limitAccountAction(`pm-admin-hour:${me.id}:${receiverId}`, 2, HOUR_MS) ||
      limitAccountAction(`pm-admin-day:${me.id}:${receiverId}`, 5, DAY_MS)
    ) {
      logAudit(me.id, "security.pm_rate_blocked", `@${target.username}`, "管理员私信个人额度已满");
      redirect(`/messages?with=${receiverId}&e=admin_limit`);
    }
  }
  // 互证豁免额度：管理员或两人互证可无限私信；否则受每日限额约束（唯一强制点）
  if (
    me.role !== "admin" &&
    !mutuallyCertified &&
    pmQuotaUsed(me.id) >= pmDailyLimit()
  ) {
    redirect(`/messages?with=${receiverId}&e=limit`);
  }
  db.prepare(
    "INSERT INTO messages (sender_id, receiver_id, body, kind) VALUES (?, ?, ?, 'pm')",
  ).run(me.id, receiverId, body);
  logAudit(me.id, "message.send", `@${target.username}`, `普通私信 ${body.length} 字`);
  revalidatePath("/messages");
  redirect(`/messages?with=${receiverId}&sent=1`);
}

// ==================== 同侪互证（互相关注式） ====================

export async function requestCertificationAction(targetId: number) {
  const me = await requireLogin();
  if (targetId === me.id) redirect(`/users/${me.username}?e=cert_self`);

  const target = db
    .prepare("SELECT id, username, display_name, role, status FROM users WHERE id = ?")
    .get(targetId) as any;
  if (!target || target.status !== "active") redirect(`/users/${me.username}?e=cert_nouser`);
  if (me.role === "admin" || target.role === "admin") redirect(`/users/${me.username}?e=cert_admin`);
  if (limitAccountAction(`cert:${me.id}`, 5, HOUR_MS)) {
    redirect(`/users/${target.username}?e=cert_rate`);
  }

  const meName = me.display_name;
  const targetName = target.display_name;
  const tx = db.transaction(() => {
    // 对方已先向我发起互证 → 自动互认（反向 pending）
    const reverse = db
      .prepare("SELECT id FROM certifications WHERE requester_id=? AND responder_id=? AND status='pending'")
      .get(targetId, me.id) as any;
    if (reverse) {
      db.prepare("UPDATE certifications SET status='accepted', responded_at=datetime('now') WHERE id=?").run(reverse.id);
      sendSystemMessage(me.id, `${targetName} 已先向你发起互证，你们现已互相应允，可无限私信。`);
      sendSystemMessage(targetId, `你向 ${meName} 发起的互证请求已被应允，你们可无限私信。`);
      return "mutual";
    }
    // 我发出的既有记录：按状态处置
    const mine = db
      .prepare("SELECT id, status FROM certifications WHERE requester_id=? AND responder_id=?")
      .get(me.id, targetId) as any;
    if (mine) {
      if (mine.status === "accepted") return "already";
      if (mine.status === "pending") return "pending";
      db.prepare("UPDATE certifications SET status='pending', responded_at=NULL, created_at=datetime('now') WHERE id=?").run(mine.id);
      sendSystemMessage(targetId, `${meName} 再次请求与你同侪互证。`);
      return "sent";
    }
    db.prepare("INSERT INTO certifications (requester_id, responder_id, status) VALUES (?, ?, 'pending')").run(
      me.id,
      targetId,
    );
    sendSystemMessage(targetId, `${meName} 请求与你同侪互证。请赴其名册页应允，互证后即可无限私信。`);
    return "sent";
  });
  const outcome = tx();

  logAudit(me.id, "cert.request", `@${target.username}`, outcome);
  revalidatePath("/messages");
  revalidatePath(`/users/${me.username}`);
  revalidatePath(`/users/${target.username}`);
  redirect(
    `/users/${target.username}?ok=${outcome === "mutual" ? "cert_mutual" : "cert_sent"}`,
  );
}

export async function respondCertificationAction(targetId: number, accept: boolean) {
  const me = await requireLogin();
  const row = db
    .prepare("SELECT id FROM certifications WHERE requester_id=? AND responder_id=? AND status='pending'")
    .get(targetId, me.id) as any;
  if (!row) redirect(`/users/${me.username}?e=cert_none`);
  const target = db.prepare("SELECT username, display_name FROM users WHERE id = ?").get(targetId) as any;
  if (!target) redirect(`/users/${me.username}?e=cert_none`);

  const meName = me.display_name;
  const tx = db.transaction(() => {
    if (accept) {
      db.prepare("UPDATE certifications SET status='accepted', responded_at=datetime('now') WHERE id=?").run(row.id);
      // 反向 pending（我也发过）一并置为互认，保证对称
      const reverse = db
        .prepare("SELECT id FROM certifications WHERE requester_id=? AND responder_id=? AND status='pending'")
        .get(me.id, targetId) as any;
      if (reverse) db.prepare("UPDATE certifications SET status='accepted', responded_at=datetime('now') WHERE id=?").run(reverse.id);
      sendSystemMessage(targetId, `${meName} 已应允与你同侪互证，你们现可无限私信。`);
    } else {
      db.prepare("UPDATE certifications SET status='declined', responded_at=datetime('now') WHERE id=?").run(row.id);
      sendSystemMessage(targetId, `${meName} 婉拒了你的互证请求。`);
    }
  });
  tx();

  logAudit(me.id, accept ? "cert.accept" : "cert.decline", `@${target.username}`, "");
  revalidatePath("/messages");
  revalidatePath(`/users/${me.username}`);
  revalidatePath(`/users/${target.username}`);
  redirect(`/users/${target.username}?ok=${accept ? "cert_accepted" : "cert_declined"}`);
}

export async function setContentAction(formData: FormData) {
  const actor = await requireAdmin();
  for (const k of CONTENT_KEYS) {
    const v = String(formData.get(k.key) ?? "").slice(0, 5000);
    db.prepare(
      `INSERT INTO site_content (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ).run(k.key, v);
  }
  logAudit(actor.id, "content.edit", "site_content", `编修文案 ${CONTENT_KEYS.length} 项`);
  revalidatePath("/");
  revalidatePath("/about");
  revalidatePath("/forum");
  redirect(`/admin?tab=content&ok=${encodeURIComponent("文案已存")}`);
}

// ==================== 检举 ====================

export async function createReportAction(kind: "thread" | "reply" | "paper", targetId: number, reason: string) {
  const user = await requireLogin();
  const targetTables = { thread: "threads", reply: "replies", paper: "papers" } as const;
  const table = targetTables[kind];
  if (!table || !Number.isInteger(targetId) || targetId <= 0) fail("检举目标无效");
  const target = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(targetId);
  if (!target) fail("检举目标不存在");
  const reasonCleaned = (reason || "").trim().slice(0, 200);
  if (!reasonCleaned) fail("检举须附理由");
  // 新账号更严格，但完全按账号计算，不会因为别人滥用而让全站用户都无法检举。
  const reportLimit = isNewAccount(user) ? 1 : 5;
  if (limitAccountAction(`report:${user.id}`, reportLimit, DAY_MS)) {
    fail("今日检举次数已达个人上限，请稍后再试");
  }
  const exists = db
    .prepare("SELECT 1 FROM reports WHERE kind = ? AND target_id = ? AND status = 'open' AND reporter_id = ?")
    .get(kind, targetId, user.id);
  if (exists) return;
  db.prepare(
    "INSERT INTO reports (kind, target_id, reporter_id, reason) VALUES (?, ?, ?, ?)",
  ).run(kind, targetId, user.id, reasonCleaned);
  // 不把攻击者可控原文复制进通用审计流；完整理由只留在带安全警告的检举详情区。
  logAudit(
    user.id,
    "report.open",
    `${kind}#${targetId}`,
    `收到用户检举（理由 ${reasonCleaned.length} 字，原文见检举信箱）`,
  );
  revalidatePath(`/forum/*`);
}

export async function resolveReportAction(reportId: number, action: "resolve" | "dismiss") {
  const actor = await requireAdmin();
  if (!Number.isInteger(reportId) || reportId <= 0) fail("检举编号无效");
  if (action !== "resolve" && action !== "dismiss") fail("处置方式无效");
  const result = db.prepare(
    "UPDATE reports SET status = 'resolved', resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'open'",
  ).run(actor.id, new Date().toISOString(), reportId);
  if (result.changes === 0) fail("检举不存在或已经处置");
  logAudit(actor.id, `report.${action}`, `report#${reportId}`, action === "dismiss" ? "驳回其检举" : "检举已了");
  redirect("/admin?tab=reports&ok=检举已处");
}

// ==================== 谕令（公告） ====================

export async function createAnnouncementAction(formData: FormData) {
  const actor = await requireAdmin();
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (title.length < 2 || title.length > 60) fail("谕令标题须在 2–60 字");
  if (content.length < 4) fail("谕令正文至少 4 字");
  db.prepare("INSERT INTO announcements (title, content, created_by) VALUES (?, ?, ?)").run(
    title,
    content.slice(0, 400),
    actor.id,
  );
  logAudit(actor.id, "announcement.create", title, content.slice(0, 60));
  redirect(`/admin?tab=announcements&ok=${encodeURIComponent("谕令已颁")}`);
}

export async function setAnnouncementAction(id: number, active: boolean) {
  const actor = await requireAdmin();
  db.prepare("UPDATE announcements SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  logAudit(actor.id, active ? "announcement.publish" : "announcement.withdraw", `announcement#${id}`, "");
  redirect(`/admin?tab=announcements&ok=${encodeURIComponent("谕令已改")}`);
}
