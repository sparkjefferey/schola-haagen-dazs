import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getPaper, getThread } from "@/lib/queries";
import { logAudit } from "@/lib/governance";
import { notifyThreadReply } from "@/lib/notifications";
import { consumeFixedWindow } from "@/lib/rate-limit";
import {
  AI_NAME,
  aiConfigured,
  aiFailureNote,
  aiModelName,
  askAi,
  buildPrompt,
  clampText,
  refundAiQuota,
} from "@/lib/ai";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
/** 领取接口的轮询上限：多标签页每几秒一次也远远够用，防的是把它当成免费算力刷。 */
const RUN_LIMIT = 300;
const RUN_WINDOW_MS = 10 * 60_000;

/**
 * 执行一次学正（AI）点评/讲解。
 *
 * 为什么是 Route Handler 而不是 Server Action：单次模型调用要 20–40 秒，
 * 放在表单动作里就是让人对着转圈的提交按钮干等，且隧道一断就前功尽弃。
 * 这里只做「领一条 pending、做完、写回」，前端由小件在页面渲染后触发，
 * 失败可重试、进程重启可重领 —— 与论文阅读量的 ViewTally 同一路数。
 * 也照它那条规矩：**不调 revalidatePath**（那会把读者正在看的页面搅一下），
 * 收尾交给客户端的 router.refresh()。
 *
 * 领取是**条件 UPDATE**：SQLite 单写者 + 单进程，多个客户端同时打开同一帖，
 * 也只有一个能把 pending 改成 running，其余拿到 skipped 直接收手。
 *
 * 回话一律 200：这套接口只被站内页面调用，非 2xx 会让回归套件（任何非 2xx
 * 计为失败）与浏览器控制台都报红，而这里并没有需要靠状态码区分的东西。
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.status !== "active") {
    return NextResponse.json({ ok: false, error: "请先登学。" }, { headers: NO_STORE });
  }
  if (consumeFixedWindow(`ai:run:${user.id}`, RUN_LIMIT, RUN_WINDOW_MS).limited) {
    return NextResponse.json({ ok: false, error: "请稍候再试。" }, { headers: NO_STORE });
  }

  let callId = 0;
  try {
    callId = Number((await req.json())?.call_id);
  } catch {
    /* 非 JSON 请求体按无效处理 */
  }
  if (!Number.isInteger(callId) || callId <= 0) {
    return NextResponse.json({ ok: false, error: "任务无效。" }, { headers: NO_STORE });
  }

  /** 落终态。failed = 可重试（上游故障）；refused = 不可重试（口径所限，点一百次也一样）。 */
  const finish = (status: "failed" | "refused", note: string) => {
    db.prepare("UPDATE ai_calls SET status=?, error=?, updated_at=datetime('now') WHERE id=?").run(
      status,
      note,
      callId,
    );
  };
  /** 没领到活时回话：带上任务当前状态，前端据此决定是「再等等」还是「刷新」。 */
  const skipped = (status: string) =>
    NextResponse.json({ ok: true, skipped: true, status }, { headers: NO_STORE });

  if (!aiConfigured) {
    const note = aiFailureNote("unconfigured");
    finish("refused", note);
    return NextResponse.json({ ok: false, error: note }, { headers: NO_STORE });
  }

  // 原子领取：pending，或 running 且已卡死五分钟以上（进程重启、隧道中断留下的僵尸）
  const claim = db
    .prepare(
      `UPDATE ai_calls SET status='running', updated_at=datetime('now')
       WHERE id = ? AND (status='pending'
                         OR (status='running' AND updated_at < datetime('now','-5 minutes')))`,
    )
    .run(callId);
  if (claim.changes === 0) {
    // 别人已在跑、或已完成、或已失败待重试 —— 都算无事可做，状态交前端定夺
    const row = db.prepare("SELECT status FROM ai_calls WHERE id = ?").get(callId) as
      | { status: string }
      | undefined;
    return skipped(row?.status ?? "gone");
  }

  const call = db.prepare("SELECT * FROM ai_calls WHERE id = ?").get(callId) as any;
  const thread = call ? getThread(call.thread_id) : null;
  const asker = call
    ? (db.prepare("SELECT id, display_name FROM users WHERE id = ?").get(call.requester_id) as
        | { id: number; display_name: string }
        | undefined)
    : undefined;
  if (!call || !thread || !asker) {
    finish("refused", "论题已不在。");
    return skipped("refused");
  }

  // 论著：召唤时已判过权限，这里再判一次（稿子可能在这中间被撤回、驳回或改了状态）。
  // 口径：已刊印者人人可请评；未刊稿只有作者本人可请 —— 未刊之稿不外送。
  let paperBlock: Parameters<typeof buildPrompt>[0]["paper"];
  if (call.paper_id) {
    const paper = getPaper(call.paper_id);
    if (!paper) {
      finish("refused", "所引之稿已不在。");
      return skipped("refused");
    }
    if (paper.status !== "published" && paper.author_id !== call.requester_id) {
      logAudit(call.requester_id, "security.ai_blocked", `paper#${paper.id}`, "未刊之稿不外送");
      finish("refused", "所引之稿不可评议。");
      return skipped("refused");
    }
    const body = clampText(
      [paper.abstract ? `摘要：${paper.abstract}` : "", paper.content].filter(Boolean).join("\n\n"),
    );
    paperBlock = {
      title: paper.title,
      discipline: paper.discipline,
      author: paper.author.display_name,
      code: paper.manuscript_code || `#${paper.id}`,
      published: paper.status === "published",
      content: body.text,
      truncated: body.truncated,
    };
  }

  const prompt = buildPrompt({
    threadTitle: thread.title,
    threadBody: clampText(thread.content, 4000).text,
    threadAuthor: thread.author.display_name,
    recentReplies: thread.replies.slice(-6).map((r) => ({
      speaker: r.kind === "ai" ? AI_NAME : r.author.display_name,
      text: clampText(r.content, 800).text,
      isAi: r.kind === "ai",
    })),
    paper: paperBlock,
    question: call.question,
    asker: asker.display_name,
  });

  const res = await askAi(prompt.user, prompt.system);
  if (!res.ok) {
    // 退款：退个人次数（用户没得到东西不该白扣）。**不退全站桶** —— 那是账单上限，
    // 退了就等于上游一坏就能无限重试、无限花钱。
    refundAiQuota(call.requester_id);
    const note = aiFailureNote(res.reason);
    finish("failed", note);
    logAudit(call.requester_id, "ai.failed", `call#${callId}`, res.reason);
    return NextResponse.json({ ok: false, error: note }, { headers: NO_STORE });
  }

  const answer = clampText(res.text, 6000).text;
  const replyId = db.transaction(() => {
    const info = db
      .prepare("INSERT INTO replies (thread_id, author_id, content, kind) VALUES (?, ?, ?, 'ai')")
      .run(thread.id, call.requester_id, answer);
    db.prepare(
      `UPDATE ai_calls
       SET status='done', answer=?, reply_id=?, model=?, prompt_tokens=?, completion_tokens=?,
           error='', updated_at=datetime('now')
       WHERE id=?`,
    ).run(
      answer,
      Number(info.lastInsertRowid),
      aiModelName(),
      res.usage.promptTokens,
      res.usage.completionTokens,
      callId,
    );
    return Number(info.lastInsertRowid);
  })();

  // 提醒楼主：沿用「论辩回应」那一条通知（不新增 kind —— 那个红点是整表口径，
  // 新 kind 会被「点开论辩回应」一次性清掉）。actor 记请出者，摘要里写明是学正应请而评，
  // 于是通知栏读起来是「张三 回应了你的论题 · “学正(AI) 应 张三 之请作了点评：…”」。
  if (thread.author_id !== call.requester_id) {
    notifyThreadReply({
      threadId: thread.id,
      ownerId: thread.author_id,
      actorId: call.requester_id,
      actorName: asker.display_name,
      replyId,
      content: `${AI_NAME}(AI) 应 ${asker.display_name} 之请作了点评：${answer}`,
    });
  }

  logAudit(
    call.requester_id,
    "ai.reply",
    `thread#${thread.id}`,
    `${aiModelName()} · tokens ${res.usage.promptTokens}/${res.usage.completionTokens}`,
  );
  return NextResponse.json({ ok: true, reply_id: replyId }, { headers: NO_STORE });
}
