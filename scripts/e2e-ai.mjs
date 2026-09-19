/**
 * 学正（AI 点评）回归套件 —— 用**本地桩模型服务**跑真链路，不花一分钱、不外发一个字节。
 *
 * 覆盖：隐藏态（未配置 AI_API_KEY）· 正常点评 · 追问带上文 · 外发口径与「不可评议」文案合一 ·
 *       自有未刊稿可评 · 思索中的气泡 · 上游故障→失败可重试且退个人次数 · 全站总闸 · 个人额度 ·
 *       注入与渲染（无 <script>、无链接）· 删除 AI 回复 · 非 2xx 与水合报错零容忍。
 *
 * 用法：
 *   1) 起站点（env 在模块加载时读取，必须一起给；AI_TIMEOUT_MS 要大于桩服务的慢应答 5 秒；
 *      AI_MAX_CONCURRENT=1 是并发闸那一步的断言前提 —— AI 可以慢，但别给机器增压）：
 *        AI_API_KEY=stub AI_BASE_URL=http://127.0.0.1:3999/v1 AI_MODEL=stub-model \
 *        AI_DAILY_PER_USER=10 AI_MAX_CONCURRENT=1 npm run dev -- --port 3100
 *      （桩服务由本脚本自己起在 3999；也可另开 node scripts/ai-stub-server.mjs）
 *   2) node scripts/e2e-ai.mjs
 *   3) 另跑一遍「隐藏态」：不带任何 AI_* 变量重启站点，再跑一次（会自动识别并只跑隐藏态断言）
 *
 * 安全自检：若站点已配置模型、桩服务却一个请求都没收到，本脚本**立即中止**并提示
 * —— 那说明 AI_BASE_URL 没指向桩服务，测试会打到真服务上花钱。
 *
 * 只写本地库：BASE 不是 127.0.0.1/localhost 即拒绝运行。**本库是站主的真实数据，跑前请备份 data/**。
 */
import { chromium } from "playwright";
import Database from "better-sqlite3";
import { startStub, STUB_PORT } from "./ai-stub-server.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(BASE)) {
  console.error("拒绝运行：BASE 必须指向本地开发服务器");
  process.exit(2);
}

const PW = "e2eAi2026";
const A_USER = "e2e学正甲"; // 召唤者
const B_USER = "e2e学正乙"; // 楼主 + 论著作者
const TEST_USERS = [A_USER, B_USER];

const CANARY = {
  published: "CANARY-已刊正文-771",
  otherDraft: "CANARY-他人未刊正文-772",
  ownDraft: "CANARY-己方未刊正文-773",
};

const db = new Database("data/schola.db");

const clearAiBuckets = () => db.prepare("DELETE FROM rate_limit_windows WHERE key LIKE 'ai:%'").run();

/** 删测试账号（论文/回复/召唤随外键级联而去），并清限流桶。 */
function cleanup() {
  const ids = db
    .prepare(`SELECT id FROM users WHERE username IN (${TEST_USERS.map(() => "?").join(",")})`)
    .all(...TEST_USERS)
    .map((r) => r.id);
  for (const name of TEST_USERS) db.prepare("DELETE FROM users WHERE username = ?").run(name);
  db.prepare("DELETE FROM rate_limit_windows WHERE key LIKE 'reg:%'").run();
  clearAiBuckets();
  return ids;
}

if (process.env.STEP === "clean") {
  const ids = cleanup();
  console.log(`已清理测试账号 ${ids.length} 个（id: ${ids.join(", ") || "无"}）`);
  process.exit(0);
}

db.prepare("DELETE FROM rate_limit_windows WHERE key LIKE 'reg:%'").run();
clearAiBuckets();
cleanup();

let fails = 0;
const ok = (c, m) => {
  console.log(`  ${c ? "✅" : "❌"} ${m}`);
  if (!c) fails++;
};

const stub = await startStub(STUB_PORT).catch((e) => {
  console.error(`桩服务起不来（端口 ${STUB_PORT}）：${e?.message ?? e}`);
  console.error("若你已手动起过桩服务，请先关掉；或设 AI_STUB_PORT 并让站点的 AI_BASE_URL 指向同一端口。");
  process.exit(2);
});
const stubState = stub.state;
const stubReset = () => fetch(`http://127.0.0.1:${STUB_PORT}/__reset`, { method: "POST" }).then(() => {});
const stubMode = (mode) =>
  fetch(`http://127.0.0.1:${STUB_PORT}/__control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  }).then(() => {});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const pageErrors = [];
const badResponses = [];
page.on("pageerror", (e) => pageErrors.push(`pageerror @ ${decodeURIComponent(page.url())}: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push(`console @ ${decodeURIComponent(page.url())}: ${m.text()}`);
});
page.on("response", (r) => {
  if (r.status() >= 400) badResponses.push(`${r.status()} ${r.request().method()} ${decodeURIComponent(r.url())}`);
});

const fillCaptcha = async () => {
  const q = await page.$eval("#r-cap", (el) => el.placeholder);
  const m = q.match(/(\d+)\s*\+\s*(\d+)/);
  await page.locator("#r-cap").fill(String(Number(m[1]) + Number(m[2])));
};

async function register(username, displayName) {
  await page.goto(BASE + "/register", { waitUntil: "networkidle" });
  await page.locator(".tab-btn").first().click();
  await page.locator("#r-user").fill(username);
  await page.locator("#r-name").fill(displayName);
  await page.locator("#r-pass").fill(PW);
  await fillCaptcha();
  await page.locator('form button[type="submit"]').last().click();
  await page.waitForURL(/\/login\?registered=/, { timeout: 20000 });
}

async function login(username) {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.locator("#l-user").fill(username);
  await page.locator("#l-pass").fill(PW);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}

async function logout() {
  await page.goto(BASE + "/forum", { waitUntil: "domcontentloaded" });
  await page.locator('form.inline-form button[type="submit"]').click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
}

/** 轮询等待（页面上的异步结果、桩服务收到请求等）。 */
async function waitFor(fn, timeout = 30000, step = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true;
    await page.waitForTimeout(step);
  }
  return false;
}
/** 等某组元素至少 n 个。 */
const waitForAtLeast = (loc, n, timeout = 30000) => waitFor(async () => (await loc.count()) >= n, timeout);

/**
 * 在帖子页发一条回复。
 * 服务端动作是「同路由软导航」——URL 往往不变，别指望 waitForURL 或 networkidle 能等到
 * 界面更新；这里显式等一等，凡是会跳到 ?e=… 的，调用方传 expectUrl 精确等待。
 */
async function say(text, expectUrl) {
  await page.locator("#r-body").fill(text);
  await page.locator('button:has-text("应 帖")').click();
  if (expectUrl) await page.waitForURL(expectUrl, { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
}

const aiCards = () => page.locator('.ai-reply:has-text("（桩答")');
const pendingBubbles = () => page.locator('.ai-reply:has-text("正在思索")');
const failedBubbles = () => page.locator('.ai-reply:has-text("模型服务暂时不可用")');
const noticeText = async () =>
  (await page.locator("p.notice").count()) ? (await page.locator("p.notice").first().innerText()).trim() : "";
const bucketCount = (key) => db.prepare("SELECT count FROM rate_limit_windows WHERE key = ?").get(key)?.count ?? 0;
/** 每次召唤前清掉相关额度桶：本套件才不受站点取值影响（新账号回复限流 8 条/小时会先撞上）。 */
const freshQuota = (userId) => {
  db.prepare("DELETE FROM rate_limit_windows WHERE key = ?").run(`ai:user:${userId}`);
  db.prepare("DELETE FROM rate_limit_windows WHERE key = 'ai:global'").run();
  db.prepare("DELETE FROM rate_limit_windows WHERE key = ?").run(`reply:${userId}`);
};

console.log("\n[1] 造账号、造论著、造论题");
await register(A_USER, "学正甲");
await register(B_USER, "学正乙");
const [A, B] = TEST_USERS.map(
  (n) => db.prepare("SELECT id, username, display_name FROM users WHERE username = ?").get(n),
);
ok(!!A && !!B, `甲=#${A?.id} 乙=#${B?.id}`);

// 论著直插（走 UI 要过冷静期与附件校验，与本次要测的东西无关）
const mkPaper = (authorId, title, status, code, content) =>
  Number(
    db
      .prepare(
        `INSERT INTO papers (author_id, title, discipline, abstract, content, status, manuscript_code, published_at)
         VALUES (?, ?, '乳脂哲学', '', ?, ?, ?, ${status === "published" ? "datetime('now')" : "NULL"})`,
      )
      .run(authorId, title, content, status, code).lastInsertRowid,
  );
mkPaper(B.id, "桩论文·已刊", "published", "SCHOLA-2026-9001", `正文。${CANARY.published}。`);
mkPaper(B.id, "桩论文·他人未刊", "submitted", "SCHOLA-2026-9002", `草稿。${CANARY.otherDraft}。`);
// 甲自己的未刊稿，顺带用老稿号格式（MS-YYYY-NNNN）
mkPaper(A.id, "桩论文·己方未刊", "submitted", "MS-2026-9003", `草稿。${CANARY.ownDraft}。`);
ok(true, "三篇桩论文就位（已刊 / 他人未刊 / 己方未刊·老稿号）");

await login(B_USER);
await page.goto(BASE + "/forum", { waitUntil: "networkidle" });
await page.locator("#f-title").fill("桩论题：请评议此篇");
await page.locator("#f-body").fill("诸君且看，这篇论著说得可通？");
// 按文案点，别用「第一个 submit」——页眉那枚登出也是 submit，点错就把自己登出了
await page.locator('button:has-text("悬 帖 立 论")').click();
await page.waitForURL(/\/forum\/thread\/\d+/, { timeout: 20000 });
const threadId = Number(page.url().match(/thread\/(\d+)/)[1]);
ok(Number.isInteger(threadId), `乙方立论题 thread#${threadId}`);
await logout();

await login(A_USER);
await page.goto(BASE + `/forum/thread/${threadId}`, { waitUntil: "networkidle" });
const configured = (await page.locator("p.ai-hint").count()) === 1;

if (!configured) {
  console.log("\n[隐藏态] 站点未配置 AI_*（未出现召唤提示）—— 只跑隐藏态断言");
  await say("@学正 点评 SCHOLA-2026-9001");
  ok((await page.locator(".ai-reply").count()) === 0, "整块功能隐藏：帖子里不出现任何学正卡片");
  ok((await aiCards().count()) === 0, "没有 AI 回复");
  ok(
    (db.prepare("SELECT COUNT(*) AS c FROM ai_calls WHERE thread_id = ?").get(threadId).c ?? 0) === 0,
    "没有落任何召唤任务",
  );
  ok(stubState.requests.length === 0, "桩服务一个请求都没收到（功能确实整块关着）");
  console.log("\n---- 页面异常 ----");
  console.log(pageErrors.slice(0, 6).join("\n") || "(无)");
  ok(badResponses.length === 0, `全程无非 2xx 响应（实得 ${badResponses.length} 条）`);
  await browser.close();
  stub.server.close();
  cleanup();
  console.log(`\n===== ${fails === 0 ? "全部通过" : fails + " 项未通过"} =====`);
  console.log("（若要测全链路，请带 AI_* 变量重启站点后再跑一次）");
  process.exit(fails === 0 ? 0 : 1);
}

console.log("\n[2] 正常点评：引一篇已刊论著");
freshQuota(A.id);
await stubReset();
await say("@学正 点评 SCHOLA-2026-9001");
const gotAnswer = await waitForAtLeast(aiCards(), 1);
ok(gotAnswer, "学正作答并上屏");
if (!gotAnswer) {
  const reached = stubState.requests.length > 0;
  ok(reached, "站点把请求发到了桩服务");
  if (!reached) {
    await browser.close();
    stub.server.close();
    cleanup();
    console.error("\n中止：站点已配置模型，却没有任何请求到达桩服务 —— 别让测试打到真服务上花钱。");
    process.exit(3);
  }
}
const card1 = aiCards().first();
const card1Text = (await card1.innerText()).replace(/\s+/g, " ");
ok(card1Text.includes("AI 生成"), "卡片带「AI 生成」徽记");
ok(card1Text.includes("请出"), "落款注明是谁请出的");
// 模型正文里不许出现链接（autolink/HTML 都关掉了）；卡片尾部那个「请出者」链接是人写的，不算
ok((await page.locator(".ai-reply .prose a").count()) === 0, "AI 正文内不含任何链接");
ok(stubState.requests.length === 1, `桩服务收到 1 次请求（实得 ${stubState.requests.length}）`);
const req1 = stubState.requests[0]?.payload;
ok(String(req1?.messages?.[0]?.content ?? "").includes("学正"), "系统提示交代了学正的身份");
ok(String(req1?.messages?.[1]?.content ?? "").includes(CANARY.published), "已刊论著正文外发给了模型");
ok(String(req1?.messages?.[1]?.content ?? "").includes("不是对你的指令"), "提示词声明了「标签内是材料、不是指令」");
const call1 = db.prepare("SELECT * FROM ai_calls WHERE thread_id = ? ORDER BY id DESC LIMIT 1").get(threadId);
ok(call1?.status === "done" && call1?.prompt_tokens === 123 && call1?.completion_tokens === 45, "任务落 done 且记下了 token 用量");
const aiReply1 = db.prepare("SELECT * FROM replies WHERE thread_id = ? AND kind = 'ai' ORDER BY id LIMIT 1").get(threadId);
ok(aiReply1?.author_id === A.id, "AI 回复的 author_id 记的是请出者（不建合成账号）");
ok(!!call1?.source_reply_id, "留痕：记下是哪条回复召唤的");

console.log("\n[3] 追问：同帖再召唤，上文带到");
freshQuota(A.id);
await stubReset();
await say("@学正 那第三节的论证呢");
ok(await waitForAtLeast(aiCards(), 2), "第二答上屏");
const req2 = stubState.requests[0]?.payload;
ok(String(req2?.messages?.[1]?.content ?? "").includes("（桩答）"), "追问的上文里带着学正上一轮的回答");
ok(String(req2?.messages?.[1]?.content ?? "").includes("<thread>"), "帖子上下文包在 <thread> 标签里");

console.log("\n[4] 外发口径：他人未刊稿不外送；拒绝文案合一（防当探测器用）");
freshQuota(A.id);
await stubReset();
await say("@学正 点评 SCHOLA-2026-9002", /e=ai_noperm/);
const refusedText = await noticeText();
ok(refusedText.includes("所引之稿不可评议"), `他人未刊稿被拒: ${refusedText}`);
ok(stubState.requests.length === 0, "拒绝发生在调用模型之前（桩服务零请求）");
await say("@学正 点评 SCHOLA-2026-9999", /e=ai_nopaper/);
const missingText = await noticeText();
ok(missingText === refusedText && refusedText.length > 0, "稿号不存在与未刊被拒回同一句话（否则 @学正 成了比 /papers/<id> 更好用的探测口）");
ok(!JSON.stringify(stubState.requests).includes(CANARY.otherDraft), "他人未刊稿的正文从未出现在任何一次外发里");

console.log("\n[4b] 作者本人的未刊稿可请评（老稿号 MS-YYYY-NNNN 也认）");
freshQuota(A.id);
await stubReset();
await say("@学正 评评我这篇 MS-2026-9003");
ok(await waitForAtLeast(aiCards(), 3), "作者请评自己的未刊稿：作答上屏");
const reqOwn = String(stubState.requests[0]?.payload?.messages?.[1]?.content ?? "");
ok(reqOwn.includes(CANARY.ownDraft), "本人未刊稿正文确实外发");
ok(reqOwn.includes("尚未刊印"), "提示词标明了该稿尚未刊印（并要求不摘引原句）");

console.log("\n[5] 思索中的气泡（慢应答时可见）与上游故障 → 失败可重试");
freshQuota(A.id);
await stubReset();
await stubMode("slow");
await say("@学正 点评 SCHOLA-2026-9001");
ok(await waitForAtLeast(pendingBubbles(), 1, 8000), "慢应答期间显示「正在思索」气泡");
ok((await aiCards().count()) === 3, "此时尚未作答");
// 并发闸：此刻已有一条在跑（桩服务正慢答），第二声召唤不该跟着挤上去 —— 排队即可。
// 直接往库里插一条 pending、再用接口去领，就能在单页面上验出「满载时只排队、不执行」。
const queuedId = Number(
  db
    .prepare("INSERT INTO ai_calls (thread_id, requester_id, paper_id, question) VALUES (?, ?, NULL, ?)")
    .run(threadId, A.id, "排队测试").lastInsertRowid,
);
const second = await page.request.post(`${BASE}/api/ai/run`, {
  // 中间件要求 POST 带 Origin（浏览器 fetch 自带，这里得手动加）
  headers: { "Content-Type": "application/json", Origin: BASE },
  data: { call_id: queuedId },
});
const secondBody = await second.json().catch(() => null);
ok(
  secondBody?.skipped === true && secondBody?.status === "running",
  `满载时第二声召唤只排队、不执行（本断言假定站点以 AI_MAX_CONCURRENT=1 启动）: ${JSON.stringify(secondBody)}`,
);
ok(stubState.requests.length === 1, `第二声召唤没有同时压到上游（桩收到 ${stubState.requests.length} 次）`);
db.prepare("DELETE FROM ai_calls WHERE id = ?").run(queuedId); // 别让它挂成僵尸气泡
ok(await waitForAtLeast(aiCards(), 4, 30000), "慢应答最终也上屏");
await stubMode("error");
freshQuota(A.id);
await say("@学正 点评 SCHOLA-2026-9001");
ok(await waitForAtLeast(failedBubbles(), 1), "上游 500 → 出失败气泡");
ok((await page.locator('button:has-text("再 请 一 次")').count()) === 1, "给出「再请一次」");
ok(bucketCount(`ai:user:${A.id}`) === 0, `失败已退个人次数（桶计数 ${bucketCount(`ai:user:${A.id}`)}）`);
await stubMode("ok");
await page.locator('button:has-text("再 请 一 次")').click();
await page.waitForLoadState("networkidle");
ok(await waitForAtLeast(aiCards(), 5), "重试成功、作答上屏");
ok(bucketCount(`ai:user:${A.id}`) === 1, "重试算一次新额度（桶计数 1）");

console.log("\n[6] 注入与渲染：模型的输出不能带出可执行内容与链接");
freshQuota(A.id);
await stubReset();
await stubMode("inject");
await say("@学正 点评 SCHOLA-2026-9001");
ok(await waitForAtLeast(aiCards(), 6), "注入模式的应答上屏");
ok((await page.evaluate(() => window.__x)) === undefined, "<script> 未执行");
ok((await page.locator(".ai-reply .prose a, .ai-reply .prose img").count()) === 0, "正文里无 <a>/<img>（markdown 链接按纯文本显示）");
const injectText = (await aiCards().last().innerText()).replace(/\s+/g, " ");
ok(injectText.includes("<script>"), "<script> 按字面文本显示");
ok(injectText.includes("javascript:alert(1)"), "伪协议链接按字面文本显示");
await stubMode("ok");

console.log("\n[7] 个人额度与全站总闸");
freshQuota(A.id);
await stubReset();
db.prepare(
  `INSERT INTO rate_limit_windows (key, count, window_end) VALUES (?, ?, ?)
   ON CONFLICT(key) DO UPDATE SET count = excluded.count, window_end = excluded.window_end`,
).run(`ai:user:${A.id}`, 999, Date.now() + 86400_000);
const repliesBefore = db.prepare("SELECT COUNT(*) AS c FROM replies WHERE thread_id = ?").get(threadId).c;
await say("@学正 点评 SCHOLA-2026-9001", /e=ai_rate/);
ok((await noticeText()).includes("次数已用尽"), "个人额度用尽时如实回话");
ok(
  (db.prepare("SELECT COUNT(*) AS c FROM replies WHERE thread_id = ?").get(threadId).c ?? 0) === repliesBefore + 1,
  "应帖本身照常落库（学正的事不该连累发言）",
);
ok(stubState.requests.length === 0, "额度不足时不去打扰模型服务");
ok(
  (db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'security.ai_blocked'").get().c ?? 0) > 0,
  "额度拦截写审计",
);
freshQuota(A.id);
db.prepare(
  `INSERT INTO rate_limit_windows (key, count, window_end) VALUES ('ai:global', 999, ?)
   ON CONFLICT(key) DO UPDATE SET count = excluded.count, window_end = excluded.window_end`,
).run(Date.now() + 86400_000);
await say("@学正 点评 SCHOLA-2026-9001", /e=ai_global/);
const globalNotice = await noticeText();
ok(globalNotice.includes("全站"), `全站总闸拦下时如实回话: ${globalNotice}`);
ok(bucketCount(`ai:user:${A.id}`) === 0, "被全站闸拦下不扣个人次数（两个桶都是先预检、后落账）");

console.log("\n[8] 删除 AI 回复");
freshQuota(A.id);
await stubReset();
await say("@学正 点评 SCHOLA-2026-9001");
ok(await waitForAtLeast(aiCards(), 7), "再作一答，准备删除");
const lastAiReply = db
  .prepare("SELECT id FROM replies WHERE thread_id = ? AND kind = 'ai' ORDER BY id DESC LIMIT 1")
  .get(threadId);
await aiCards().last().locator('button:has-text("删")').click();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(600);
ok((db.prepare("SELECT COUNT(*) AS c FROM replies WHERE id = ?").get(lastAiReply.id).c ?? 0) === 0, "请出者可以删掉自己请出的 AI 回复");
ok(
  db.prepare("SELECT reply_id FROM ai_calls WHERE thread_id = ? ORDER BY id DESC LIMIT 1").get(threadId)?.reply_id === null,
  "删除后任务的 reply_id 置空（ON DELETE SET NULL），不留悬空指针",
);
ok((await pendingBubbles().count()) === 0, "删除后不留僵尸气泡");

console.log("\n---- 页面异常 ----");
console.log(pageErrors.slice(0, 8).join("\n") || "(无)");
const hydration = pageErrors.filter((e) => /Minified React error #418|Hydration failed/.test(e));
ok(hydration.length === 0, `无水合报错（实得 ${hydration.length} 条）`);
console.log("\n---- 非 2xx 响应 ----");
console.log([...new Set(badResponses)].slice(0, 12).join("\n") || "(无)");
ok(badResponses.length === 0, `全程无非 2xx 响应（实得 ${badResponses.length} 条）`);

await browser.close();
stub.server.close();
const removed = cleanup();
console.log(`\n（测试账号 ${removed.length} 个、其论著与召唤、ai:* 限流桶均已清理）`);
console.log(`\n===== ${fails === 0 ? "全部通过" : fails + " 项未通过"} =====`);
process.exit(fails === 0 ? 0 : 1);
