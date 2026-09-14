import { NextResponse } from "next/server";
import { clientIp } from "@/lib/auth";
import { consumeFixedWindow, rateLimitFingerprint } from "@/lib/rate-limit";
import { findUsernameClaim } from "@/lib/db";
import { normalizeUsername, suggestUsernames, usernameProblem } from "@/lib/username";

export const dynamic = "force-dynamic";

// 查名接口：只为把"撞名"提前告诉用户，别让人填完一整张表才被打回。
// 隐私上不新增泄露面 —— 学者名册（学榜、个人页）本就公开列名；
// 但仍按 IP 限流，防止有人把它当批量抓名接口刷。
const CHECK_LIMIT = 30;
const CHECK_WINDOW_MS = 5 * 60_000;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("u") ?? "";
  const problem = usernameProblem(raw);
  if (problem) return NextResponse.json({ state: "invalid", message: problem });

  const name = normalizeUsername(raw);

  const ip = await clientIp();
  const gate = consumeFixedWindow(`uname:${rateLimitFingerprint(ip)}`, CHECK_LIMIT, CHECK_WINDOW_MS);
  if (gate.limited) {
    return NextResponse.json({
      state: "throttled",
      message: "查名过于频繁，请稍后再试（不影响提交注册，最终以提交时的判定为准）。",
    });
  }

  const claim = findUsernameClaim(name);
  if (!claim) return NextResponse.json({ state: "free", name });

  return NextResponse.json({
    state: "taken",
    name,
    // 曾用名也算占用：旧名永久归原账号，避免冒名或截断旧链接。
    // 但不透露是哪位学者 —— 只说明性质。
    former: claim.source === "history",
    suggestions: suggestUsernames(name, (candidate) => !findUsernameClaim(candidate)),
  });
}
