import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, clientIp } from "@/lib/auth";
import { consumeFixedWindow, rateLimitFingerprint } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * 阅读量自增。
 *
 * 刻意做成 Route Handler 而不是 Server Action。原先由 `incrementViewsAction` 承担，
 * 它在写库成功后调了 `revalidatePath('/papers/{id}')` —— 那会让 Next.js 重新拉取并
 * 重渲染当前路由。这个请求是在页面挂载时发出的，回来得晚，于是长文页上经常出现
 * 「读者滚到一半，整页突然闪一下、滚动被打断」。
 *
 * 阅读量没有实时性需求（下次加载页面自然会带出新数字），所以这里只写库、
 * 不触发任何缓存失效与重渲染，对阅读体验零打扰。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.status !== "active") return NextResponse.json({ ok: false });

  const { id } = await params;
  const paperId = Number(id);
  if (!Number.isInteger(paperId) || paperId <= 0) return NextResponse.json({ ok: false });

  // 阅读量防刷（V5）：同一 IP 对同一论文 10 分钟只计 1 次。
  // 正常阅读无感；脚本换账号狂刷也无法刷高学榜分。
  const ip = await clientIp();
  if (consumeFixedWindow(`view:${rateLimitFingerprint(ip)}:${paperId}`, 1, 10 * 60_000).limited) {
    return NextResponse.json({ ok: false });
  }

  db.prepare(
    "UPDATE papers SET views = views + 1 WHERE id = ? AND status = 'published' AND author_id <> ?",
  ).run(paperId, user.id);

  return NextResponse.json({ ok: true });
}
