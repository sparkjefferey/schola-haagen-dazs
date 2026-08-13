"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db, DISCIPLINES, FORUM_CATEGORIES, nextManuscriptCode } from "@/lib/db";
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  getSessionUser,
  isLocked,
  recordFailedAttempt,
  clearFailedAttempts,
} from "@/lib/auth";
import { logAudit, consumeInvite, createInviteCode } from "@/lib/governance";
import { CONTENT_KEYS } from "@/lib/content";
import { sendSystemMessage } from "@/lib/messages";

const USERNAME_RE = /^[a-zA-Z0-9_\-\u4e00-\u9fa5]{2,20}$/;

function fail(message: string): never {
  throw new Error(message);
}

async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip")) || "local";
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
  const displayName = String(formData.get("display_name") ?? "").trim() || username;
  const motto = String(formData.get("motto") ?? "").trim().slice(0, 80);
  const role = String(formData.get("role") ?? "scholar") as "admin" | "scholar";
  const invite = String(formData.get("invite") ?? "").trim();
  const roleTab = role === "admin" ? "&tab=admin" : "";

  if (!USERNAME_RE.test(username)) redirect(`/register?e=user${roleTab}`);
  if (password.length < 6) redirect(`/register?e=pass${roleTab}`);
  if (role !== "admin" && role !== "scholar") redirect("/register?e=user");

  const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
  if (exists) redirect(`/register?e=taken${roleTab}`);

  if (role === "admin") {
    const valid =
      consumeInvite(invite, "admin") ||
      (!!process.env.ADMIN_INVITE && process.env.ADMIN_INVITE === invite);
    if (!valid) redirect(`/register?e=invite${roleTab}`);
    logAudit(null, "admin.register", username, "凭邀请函注册管理者");
  }

  const info = db
    .prepare(
      "INSERT INTO users (username, display_name, password_hash, role, motto) VALUES (?, ?, ?, ?, ?)",
    )
    .run(username, displayName, hashPassword(password), role, motto);

  if (role === "scholar") {
    logAudit(info.lastInsertRowid as number, "user.register", username, "公开入学");
  }

  sendSystemMessage(
    info.lastInsertRowid as number,
    "欢迎入学 Schola Häagen-Dazs！此间为学派同侪论学、刊文、互证之所。若有疑义或建言，可赴『讯息』向管理者陈情。",
  );

  redirect(`/login?registered=${encodeURIComponent(username)}`);
}

export async function loginAction(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const ip = await clientIp();

  if (isLocked(ip, username)) {
    redirect("/login?e=locked");
  }

  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
  if (!row || !verifyPassword(password, row.password_hash)) {
    recordFailedAttempt(ip, username);
    redirect("/login?e=bad");
  }
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

const RATE_LIMITS = new Map<string, { t: number; n: number }>();
function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const cur = RATE_LIMITS.get(key);
  if (!cur || now - cur.t > windowMs) {
    RATE_LIMITS.set(key, { t: now, n: 1 });
    return false;
  }
  if (cur.n >= max) return true;
  cur.n += 1;
  return false;
}

export async function createThreadAction(formData: FormData) {
  const user = await requireLogin();
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const category = String(formData.get("category") ?? "学术交流");

  if (title.length < 4 || title.length > 80) redirect("/forum?e=title");
  if (content.length < 10) redirect("/forum?e=body");
  if (!FORUM_CATEGORIES.includes(category as any)) redirect("/forum?e=body");
  if (rateLimited(`t:${user.id}`, 10, 3600_000)) redirect("/forum?e=rate");

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
  if (content.length < 2) redirect(`/forum/thread/${threadId}?e=short`);
  if (rateLimited(`r:${user.id}`, 30, 3600_000)) redirect(`/forum/thread/${threadId}?e=rate`);

  db.prepare("INSERT INTO replies (thread_id, author_id, content) VALUES (?, ?, ?)").run(
    threadId,
    user.id,
    content,
  );
  revalidatePath(`/forum/thread/${threadId}`);
  redirect(`/forum/thread/${threadId}`);
}

export async function deleteThreadAction(threadId: number, authorId: number) {
  const user = await requireLogin();
  if (user.role !== "admin" && user.id !== authorId) fail("无权删除");
  db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
  logAudit(user.id, "thread.delete", `thread#${threadId}`, "删除论题");
  revalidatePath("/forum");
  redirect("/forum");
}

export async function deleteReplyAction(replyId: number, authorId: number) {
  const user = await requireLogin();
  if (user.role !== "admin" && user.id !== authorId) fail("无权删除");
  const row = db.prepare("SELECT thread_id FROM replies WHERE id = ?").get(replyId) as any;
  db.prepare("DELETE FROM replies WHERE id = ?").run(replyId);
  logAudit(user.id, "reply.delete", `reply#${replyId}`, "删除辩答");
  revalidatePath(`/forum/thread/${row.thread_id}`);
}

// ==================== 论文 / 掌门认证（专业期刊流水线） ====================

const COOL_DOWN_HOURS = Number(process.env.COOL_DOWN_HOURS ?? "24");

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
  if (content.length < 30) redirect("/papers/new?e=body");

  const joined = new Date(user.created_at.endsWith("Z") ? user.created_at : user.created_at + "Z").getTime();
  if (Date.now() - joined < COOL_DOWN_HOURS * 3600_000 && !user.endorsed) {
    redirect("/papers/new?e=cooldown");
  }
  if (rateLimited(`p:${user.id}`, 5, 3600_000)) redirect("/papers/new?e=rate");

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
  if (content.length < 30) fail("正文至少 30 字。");

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

export async function deletePaperAction(paperId: number, authorId: number) {
  const user = await requireLogin();
  if (user.role !== "admin" && user.id !== authorId) fail("无权撤稿");
  const row = db.prepare("SELECT status FROM papers WHERE id = ?").get(paperId) as any;
  if (row?.status !== "published") fail("未刊文稿不须撤取，可在个人名册中处置");
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

export async function incrementViewsAction(paperId: number, authorId: number) {
  const user = await getSessionUser();
  if (!user) return;
  if (user.id === authorId) return;
  db.prepare("UPDATE papers SET views = views + 1 WHERE id = ?").run(paperId);
  revalidatePath(`/papers/${paperId}`);
}

// ==================== 成员处置 ====================

export async function setUserStatusAction(userId: number, status: "active" | "banned" | "retired", reason: string) {
  const actor = await requireAdmin();
  const target = db.prepare("SELECT username, role, root FROM users WHERE id = ?").get(userId) as any;
  if (!target) redirect("/admin?tab=members&e=missing");
  if (userId === actor.id && status !== "active") redirect("/admin?tab=members&e=self");
  if (target.root && status !== "active") redirect("/admin?tab=members&e=root");
  const reasonCleaned = reason.trim().slice(0, 200);
  if (status !== "active" && reasonCleaned.length < 2) redirect("/admin?tab=members&e=reason");

  db.prepare("UPDATE users SET status = ?, banned_reason = ? WHERE id = ?").run(
    status,
    status === "active" ? "" : reasonCleaned,
    userId,
  );
  logAudit(actor.id, `user.${status}`, `@${target.username}`, reasonCleaned || "恢复在籍");
  revalidatePath("/admin");
}

export async function setUserRoleAction(userId: number, role: "admin" | "scholar") {
  const actor = await requireAdmin();
  if (role !== "admin" && role !== "scholar") redirect("/admin?tab=members&e=role");
  const target = db.prepare("SELECT username, role, root FROM users WHERE id = ?").get(userId) as any;
  if (!target) redirect("/admin?tab=members&e=missing");
  if (target.root && role === "scholar") redirect("/admin?tab=members&e=root");
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
  if (next.length < 6) redirect(`/users/${me.username}?e=pwdlen`);
  if (next === current) redirect(`/users/${me.username}?e=pwdsame`);

  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(next), me.id);
  // 改密后吊销其他设备的会话，只保留当前会话，防止被盗用
  const store = (await import("next/headers")).cookies;
  const token = (await store()).get("schola_session")?.value;
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND token IS NOT ?").run(me.id, token ?? "__none__");
  logAudit(me.id, "account.password", `@${me.username}`, "自助修改口令（其余会话已吊销）");
  revalidatePath(`/users/${me.username}`);
  redirect(`/users/${me.username}?ok=pwd`);
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
  if (target.root) redirect("/admin?tab=members&e=root");
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
  const target = db.prepare("SELECT id, status FROM users WHERE id = ?").get(receiverId) as any;
  if (!target || target.status !== "active") redirect(`/messages?e=nouser`);
  db.prepare(
    "INSERT INTO messages (sender_id, receiver_id, body, kind) VALUES (?, ?, ?, 'pm')",
  ).run(me.id, receiverId, body);
  revalidatePath("/messages");
  redirect(`/messages?with=${receiverId}&sent=1`);
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
  const reasonCleaned = (reason || "").trim().slice(0, 200);
  if (!reasonCleaned) fail("检举须附理由");
  const exists = db
    .prepare("SELECT 1 FROM reports WHERE kind = ? AND target_id = ? AND status = 'open' AND reporter_id = ?")
    .get(kind, targetId, user.id);
  if (exists) return;
  db.prepare(
    "INSERT INTO reports (kind, target_id, reporter_id, reason) VALUES (?, ?, ?, ?)",
  ).run(kind, targetId, user.id, reasonCleaned);
  logAudit(user.id, "report.open", `${kind}#${targetId}`, reasonCleaned.slice(0, 80));
  revalidatePath(`/forum/*`);
}

export async function resolveReportAction(reportId: number, action: "resolve" | "dismiss") {
  const actor = await requireAdmin();
  db.prepare(
    "UPDATE reports SET status = 'resolved', resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'open'",
  ).run(actor.id, new Date().toISOString(), reportId);
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