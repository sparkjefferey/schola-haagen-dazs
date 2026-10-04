/**
 * 投稿门槛回归套件（本地验收）
 *
 * 覆盖三件容易出错的事：
 *   1. 入派冷静期：未满 24 小时不得著书；
 *   2. 掌门认证：已授认证印者不受冷静期限制，且免分诊（投稿直接进「送审中」）；
 *   3. **不带附件的投稿必须能成功** —— 未选择的 file 输入会被浏览器提交成
 *      名字为 "undefined" 的 0 字节条目，曾被误当成附件校验，导致无附件投稿
 *      一律被拒（报"附件格式不受支持"）。
 *   4. 正文与手稿文件二选一：正文可留空而以 PDF 等手稿文件呈递，两者俱无才拒稿。
 *
 * 用法（需先起本地 dev server；冷静期按默认 24h 才有意义，不要设 COOL_DOWN_HOURS=0）：
 *   node scripts/e2e-papers.mjs
 *
 * 只会写本地库：BASE 不是 127.0.0.1/localhost 时直接拒绝运行。
 */
import { chromium } from "playwright";
import Database from "better-sqlite3";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(BASE)) {
  console.error("拒绝运行：BASE 必须指向本地开发服务器");
  process.exit(2);
}

const db = new Database("data/schola.db");
const uname = "papertest" + Math.random().toString(36).slice(2, 6);
const PASSWORD = "papertest-pass-2026";
const TEST_PREFIX = "papertest%";

db.prepare("DELETE FROM rate_limit_windows").run();
db.prepare(`DELETE FROM users WHERE username LIKE '${TEST_PREFIX}'`).run();

let fails = 0;
const ok = (c, m) => {
  console.log(`  ${c ? "✅" : "❌"} ${m}`);
  if (!c) fails++;
};

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
// 带着 Range 头打到附件路由的响应（第 [6] 节用：验证 pdf.js 真在按段取稿）
const rangeResponses = [];
page.on("response", (r) => {
  try {
    if (r.request().headers()["range"]) {
      rangeResponses.push({ url: r.request().url().replace(BASE, ""), status: r.status() });
    }
  } catch {
    /* 请求失效则不计 */
  }
});

// ---- 注册 + 登录一个"刚刚入派"的学者 ----
await page.goto(BASE + "/register", { waitUntil: "networkidle" });
await page.locator("#r-user").fill(uname);
await page.locator("#r-pass").fill(PASSWORD);
const capQ = await page.$eval("#r-cap", (el) => el.placeholder);
const capM = capQ.match(/(\d+)\s*\+\s*(\d+)/);
await page.locator("#r-cap").fill(String(Number(capM[1]) + Number(capM[2])));
await page.locator('form button[type="submit"]').click();
await page.waitForTimeout(3000);

await page.goto(BASE + "/login", { waitUntil: "networkidle" });
await page.locator("#l-user").fill(uname);
await page.locator("#l-pass").fill(PASSWORD);
await page.locator('form button[type="submit"]').click();
await page.waitForTimeout(3000);

const me = db.prepare("SELECT id, endorsed, created_at FROM users WHERE username = ?").get(uname);
console.log(`\n测试账号: id=${me.id} endorsed=${me.endorsed} created_at=${me.created_at}`);

/** 填一份最小可投稿件并提交，返回落点 URL 与提示。body 传 "" 即试「正文留空」。 */
async function submit(tag, { file, body } = {}) {
  await page.goto(BASE + "/papers/new", { waitUntil: "networkidle" });
  await page.locator("#p-title").fill(`投稿门槛试作（${tag}）`);
  await page
    .locator("#p-body")
    .fill(
      body ??
        "## 一、缘起\n\n这是一段用于验证投稿门槛的正文，长度超过三十个字，足以通过服务端的最低字数校验。",
    );
  if (file) await page.setInputFiles('input[name="files"]', [file]);
  await page.locator('form:has(#p-title) button[type="submit"]').click();
  await page.waitForTimeout(4500);
  const url = page.url().replace(BASE, "");
  const notice = (await page.locator("p.notice").allInnerTexts().catch(() => [])).join(" | ");
  console.log(`  [${tag}] → ${url}${notice ? " ｜ " + notice : ""}`);
  return url;
}
const papersOf = () =>
  db.prepare("SELECT title, status FROM papers WHERE author_id = ? ORDER BY id").all(me.id);

console.log("\n[1] 未认证 + 入派未满 24 小时");
let u = await submit("未认证未满期");
ok(u.includes("e=cooldown"), "被冷静期拦下");
ok((await papersOf()).length === 0, "未产生半截稿件");

console.log("\n[2] 把入派时间往前推两天（冷静期已过），仍不带任何附件");
db.prepare("UPDATE users SET created_at = datetime('now', '-2 days') WHERE id = ?").run(me.id);
u = await submit("冷静期已过·无附件");
ok(!u.includes("e="), "无附件投稿成功（曾因「未选文件」被误判为附件格式非法而必败）");
let papers = await papersOf();
ok(papers.length === 1 && papers[0].status === "submitted", `稿件已入库，状态=已收稿待分诊: ${JSON.stringify(papers)}`);

console.log("\n[3] 附件校验没有被这次修改放开");
// 3a 客户端选择器当场拦下非法扩展名：给出红字，并把文件从载荷中撤回（不静默带毒投递）
await page.goto(BASE + "/papers/new", { waitUntil: "networkidle" });
await page.setInputFiles('input[name="files"]', [
  { name: "evil.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ1234567890") },
]);
await page.waitForTimeout(500);
const warn = (await page.locator("p.att-warn").allInnerTexts().catch(() => [])).join(" | ");
ok(warn.includes("格式不受支持"), `选择器当场拦下并给出红字提示: ${warn}`);
ok(
  (await page.evaluate(() => document.querySelector('input[name="files"]').files.length)) === 0,
  "非法文件已被撤出表单载荷（不会悄悄带上去）",
);

// 3b 合成绕过：不经选择器直接塞进 input.files（等价于无 JS / 手工构造请求）→ 服务端必须拒
await page.goto(BASE + "/papers/new", { waitUntil: "networkidle" });
await page.locator("#p-title").fill("投稿门槛试作（绕过前端）");
await page.locator("#p-body").fill("## 一、缘起\n\n这是一段用于验证服务端附件守卫的正文，长度超过三十个字，足以通过最低字数校验。");
await page.evaluate(() => {
  const input = document.querySelector('input[name="files"]');
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array([0x4d, 0x5a, 0x31, 0x32, 0x33])], "evil.exe", { type: "application/octet-stream" }));
  input.files = dt.files; // 不触发 change，绕过客户端的 onChange 校验
});
await page.locator('form:has(#p-title) button[type="submit"]').click();
await page.waitForTimeout(4500);
ok(page.url().includes("e=atttype"), `服务端仍拒绝可执行文件: ${page.url().replace(BASE, "")}`);

// 3c/3d 服务端魔数嗅探与合法附件
let u3 = await submit("扩展名与内容不符", {
  file: { name: "假手稿.pdf", mimeType: "application/pdf", buffer: Buffer.from("这不是一份真正的 PDF 内容") },
});
ok(u3.includes("e=atttype"), "假 PDF 仍被拒（魔数嗅探）");
u3 = await submit("合法纯文本附件", { file: { name: "手稿.txt", mimeType: "text/plain", buffer: Buffer.from("这是随稿附上的纯文本手稿。") } });
ok(!u3.includes("e="), "合法附件可正常随稿提交");

console.log("\n[4] 授认证印（等价于燕京阁·学籍名册里点「授认证印」）");
db.prepare("UPDATE users SET endorsed = 1 WHERE id = ?").run(me.id);
const before = (await papersOf()).length;
u = await submit("已认证·注册仍未满 24 小时·无附件");
ok(!u.includes("e="), "认证印可越过冷静期：注册仍未满 24 小时也能立刻投稿");
papers = await papersOf();
ok(papers.length === before + 1, "稿件已入库");
ok(papers[papers.length - 1].status === "in_review", `认证学者免分诊，状态=送审中: ${papers[papers.length - 1].status}`);

console.log("\n[5] 正文与手稿文件二选一（正文可留空，以 PDF 等手稿文件呈递）");
// 投稿限流是「每小时 5 篇」的真闸，上面几节已把额度用光；本节专测另一件事，先清桶。
db.prepare("DELETE FROM rate_limit_windows WHERE key = ?").run(`paper:${me.id}`);
// 第 [5]/[6] 节用的手稿须是**有效**且大于 2×64KB 的真 PDF（pdf.js 按段取段只在
// 文件大于两个分块时启用；太小的文件会被它整份取——用仓库里那份真实的论文 PDF）。
const PDF = { name: "手稿.pdf", mimeType: "application/pdf", buffer: fs.readFileSync("docs/papers/feed-ratio-yield.pdf") };

// 5a 客户端：选了手稿文件，正文框自行松开必填（不点开这一步，用户会以为正文还得再打一遍）
await page.goto(BASE + "/papers/new", { waitUntil: "networkidle" });
await page.setInputFiles('input[name="files"]', [PDF]);
await page.waitForTimeout(400);
ok((await page.locator("#p-body").getAttribute("required")) === null, "选过手稿文件后，正文框的必填已松开");
ok(
  (await page.locator('label[for="p-body"]').innerText()).includes("可留空"),
  "正文标签随之改口为「可留空」",
);

// 5b 正文留空 + 合法手稿文件 → 入库
u = await submit("正文留空·随稿 PDF", { body: "", file: PDF });
ok(!u.includes("e="), `正文留空、以手稿文件呈递，投稿成功: ${u}`);
const lastPaper = db
  .prepare("SELECT id, content FROM papers WHERE author_id = ? ORDER BY id DESC LIMIT 1")
  .get(me.id);
ok(lastPaper && lastPaper.content === "", "库中正文确为空（未塞「正文见附件」之类的假正文）");
ok(
  db.prepare("SELECT COUNT(*) c FROM paper_attachments WHERE paper_id = ?").get(lastPaper.id).c === 1,
  "手稿文件已随稿入库",
);

// 5c 正文留空 + 无附件 → 服务端拒。浏览器端 required 会先拦，摘掉它等于无 JS 的老浏览器，
// 这条专测最后一道闸。
await page.goto(BASE + "/papers/new", { waitUntil: "networkidle" });
await page.locator("#p-title").fill("投稿门槛试作（正文留空·无附件）");
await page.evaluate(() => document.querySelector("#p-body").removeAttribute("required"));
await page.locator('form:has(#p-title) button[type="submit"]').click();
await page.waitForTimeout(4500);
ok(page.url().includes("e=nobody"), `正文留空又无手稿文件，服务端拦下: ${page.url().replace(BASE, "")}`);
ok(!(await papersOf()).some((p) => p.title.includes("正文留空·无附件")), "未产生半截稿件");

// 5d 正文留空 + 附件不合法 → 报的须是附件错（用户本意是拿附件顶正文），而非「正文为空」
await page.goto(BASE + "/papers/new", { waitUntil: "networkidle" });
await page.locator("#p-title").fill("投稿门槛试作（正文留空·附件非法）");
await page.evaluate(() => {
  document.querySelector("#p-body").removeAttribute("required");
  const input = document.querySelector('input[name="files"]');
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array([0x4d, 0x5a, 0x31, 0x32, 0x33])], "evil.exe", { type: "application/octet-stream" }));
  input.files = dt.files; // 不经 onChange，绕过客户端预校验
});
await page.locator('form:has(#p-title) button[type="submit"]').click();
await page.waitForTimeout(4500);
ok(page.url().includes("e=atttype"), `正文留空但附件非法时，报的是附件错: ${page.url().replace(BASE, "")}`);

// 5e 正文写了但不足 30 字，且无附件 → 仍须拒（不能因为有了「可留空」就放走半截正文）
u = await submit("正文不足三十字·无附件", { body: "太短了。" });
ok(u.includes("e=body"), `正文不足 30 字且无附件，仍被拒: ${u}`);

console.log("\n[6] 正文留空之稿的呈现与在线阅读（自托管 pdf.js）");
const attId = db.prepare("SELECT id FROM paper_attachments WHERE paper_id = ?").get(lastPaper.id).id;
const pdfUrl = `/api/papers/${lastPaper.id}/attachments/${attId}`;
await page.goto(`${BASE}/papers/${lastPaper.id}`, { waitUntil: "networkidle" });
ok(
  (await page.locator(".manuscript-box .manuscript-note").innerText()).includes("以手稿文件呈递"),
  "正文位置写明「本稿正文以手稿文件呈递」",
);
ok((await page.locator("article.prose").count()) === 0, "不会渲染出一个空的正文块");

// 打开阅读器：pdf.js 画 canvas（不靠浏览器 PDF 插件，微信 X5 等内核也可读）
await page.locator(".manuscript-act button").click();
await page.waitForSelector(".reader-scroll .pdfViewer .page canvas", { timeout: 30000 });
const painted = await page.evaluate(() => {
  const c = document.querySelector(".reader-scroll .pdfViewer .page canvas");
  if (!c) return "无 canvas";
  const ctx = c.getContext("2d");
  if (!ctx) return "读不到 2d 上下文";
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  for (let k = 3; k < d.length; k += 4) if (d[k] !== 0) return "已落墨";
  return "整版空白";
});
ok(painted === "已落墨", `首页 canvas 已画出内容: ${painted}`);
await page.waitForSelector(".reader-scroll .textLayer span", { timeout: 30000 });
ok((await page.locator(".reader-scroll .textLayer span").count()) > 0, "有文本层，稿内文字可选可抄");

// 关闭即卸载：浮层连带 canvas 一并移除，pdf 文档与 worker 在组件内 destroy
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
ok((await page.locator(".reader-mask").count()) === 0, "Esc 关闭后浮层（连同 canvas）移除");

// 按需取段：pdf.js 应带 Range 头逐段取稿（附件路由回 206），而非整份 200 白送
const pdfRanges = rangeResponses.filter((r) => r.url === pdfUrl);
ok(
  pdfRanges.length > 0 && pdfRanges.every((r) => r.status === 206),
  `pdf.js 按段取稿（${pdfRanges.length} 个 Range 请求，皆 206）: ${JSON.stringify(pdfRanges.slice(0, 3))}`,
);
const fullHit = (await page.evaluate(async (u) => {
  // 直接核对该附件路由的两种应答形态，锁死 Range 行为
  const a = await fetch(u, { headers: { Range: "bytes=0-9" } });
  const b = await fetch(u, { headers: { Range: "bytes=99999999-" } });
  return { status: a.status, cr: a.headers.get("content-range"), bytes: (await a.arrayBuffer()).byteLength, far: b.status };
}, pdfUrl));
ok(
  fullHit.status === 206 && fullHit.bytes === 10 && fullHit.far === 416,
  `附件路由单段应答正常: ${JSON.stringify(fullHit)}`,
);

// ---- 清理 ----
const rows = db.prepare(`SELECT id FROM users WHERE username LIKE '${TEST_PREFIX}'`).all();
db.prepare(`DELETE FROM users WHERE username LIKE '${TEST_PREFIX}'`).run();
db.prepare("DELETE FROM rate_limit_windows").run();
console.log(`\n清理测试账号 ${rows.length} 个，用户总数:`, db.prepare("SELECT COUNT(*) c FROM users").get().c);
console.log(`\n===== ${fails === 0 ? "全部通过" : fails + " 项未通过"} =====`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
