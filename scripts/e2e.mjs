import { chromium } from "playwright";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const adminPassword = process.env.SEED_ADMIN_PW;
if (!adminPassword) {
  throw new Error("缺少 SEED_ADMIN_PW；端到端测试不会使用公开的管理员默认口令。");
}
const uname = "t" + Date.now().toString(36);
const results = [];
function check(name, cond) {
  results.push(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) process.exitCode = 1;
}

// 健康预检：站点须已在本机 3100（或设 E2E_BASE_URL）运行，且投稿冷静期已关（COOL_DOWN_HOURS=0），
// 否则新注册学者会在投稿一步被 ?e=cooldown 拦下。数据库须已播种（rector 来自 SEED_ADMIN_PW）。
try {
  const probe = await fetch(B + "/login");
  if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
} catch (e) {
  console.error(
    `无法连接 ${B}（${e?.message ?? e}）。请先启动站点：\n` +
      `  COOL_DOWN_HOURS=0 npm run dev -p 3100        # 开发模式\n` +
      `  npm run build && npx next start -p 3100      # 生产模式\n` +
      `或设 E2E_BASE_URL 指向实际地址。服务须以 COOL_DOWN_HOURS=0 运行。\n` +
      `另需先播种：npm run db:reset && npm run seed（三个 SEED_*_PW 环境变量）。\n` +
      `连续多轮测试会触发注册限流（8 次/10 分钟），可清库重播或稍候再跑。`,
  );
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// dev 模式下首次编译 + 水合需要时间：服务端动作表单若在水合前被原生提交会退化成 GET。
// 每次导航后先等网络空闲，再稍作停顿，确保 React 已接线。
async function settle(p = page, ms = 800) {
  await p.waitForLoadState("networkidle");
  await p.waitForTimeout(ms);
}

// 1. 首页
await page.goto(B + "/");
check("首页渲染", (await page.textContent("h1"))?.includes("SCHOLA HÄAGEN-DAZS"));
await page.screenshot({ path: "/tmp/shot-home.png" });

// 2. 注册新学者（算式验证码：从占位符读出题目并作答）
await page.goto(B + "/register");
await page.click("button:has-text('学者入学')");
await settle();
await page.fill("#r-user", uname);
await page.fill("#r-name", "试验学士");
await page.fill("#r-pass", "test1234");
await page.fill("#r-motto", "学海无涯，冷食作舟");
await page.fill("#r-email", "test@example.com");
const capQ = await page.getAttribute("#r-cap", "placeholder");
const capM = capQ.match(/(\d+)\s*\+\s*(\d+)/);
check("注册验证码可解析", !!capM);
await page.fill("#r-cap", String(Number(capM[1]) + Number(capM[2])));
await page.click("button:has-text('入 派 成 学')");
await page.waitForURL("**/login**");
check("注册成功跳转登学", page.url().includes("/login?registered="));
console.log("username:", uname);

// 3. 学者登录
await settle();
await page.fill("#l-user", uname);
await page.fill("#l-pass", "test1234");
await page.click("button:has-text('入 馆')");
await page.waitForURL(B + "/");
check("学者登录成功", page.url() === B + "/");
check("导航显示学者名", (await page.textContent("body")).includes("试验学士"));

// 4. 学者不能进后台（应弹回首页）
await page.goto(B + "/admin");
await page.waitForURL(B + "/**");
check("学者被拦在后台外", page.url().startsWith(B + "/") && !page.url().includes("/admin"));

// 5. 发论题
await page.goto(B + "/forum");
await settle();
await page.fill("#f-title", "端到端测试论题");
await page.fill("#f-body", "这是一条端到端测试内容，用于验证论坛发帖功能是否正常运转。");
await page.click("button:has-text('悬 帖 立 论')");
await page.waitForURL("**/forum/thread/**");
await page.waitForTimeout(500);
check("发帖成功", (await page.textContent("h1"))?.includes("端到端测试论题"));

// 6. 回帖
await page.fill("#r-body", "回复：言之有理！");
await page.click("button:has-text('应 帖')");
await page.waitForURL("**/forum/thread/**");
await page.waitForTimeout(300);
check("回帖成功", (await page.textContent("body")).includes("回复：言之有理！"));

// 7. 发文（新学者 → 入掌门审稿箱），随稿上传一件 PDF 附件
const MINI_PDF = "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
const TINY_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("fakepngpayload"),
]);
await page.goto(B + "/papers/new");
await settle();
await page.fill("#p-title", "《论初版之不足》");
await page.selectOption("#p-disc", "乳脂哲学");
await page.fill("#p-abs", "这是一篇测试提要。");
await page.fill("#p-body", "## 一、正文\n\n这是测试正文的完整内容，起码三十个字，好让论文能够顺利入库。\n\n> 引语示例。");
await page.setInputFiles('input[name="files"]', [
  { name: "手稿初稿.pdf", mimeType: "application/pdf", buffer: Buffer.from(MINI_PDF, "utf8") },
]);
await page.click("button:has-text('投 稿 入 库')");
await page.waitForURL(/\/papers\/\d+/);
await page.waitForTimeout(500);
check("发文成功", (await page.textContent("h1"))?.includes("初版之不足"));
check("新稿标示已收稿", (await page.textContent("body")).includes("已收稿"));
check("随稿附件已入库", (await page.textContent("body")).includes("手稿初稿.pdf"));

// 7.5 案头增传 PNG 附件
await page.waitForTimeout(600);
await page.setInputFiles('input[name="file"]', [
  { name: "图版一.png", mimeType: "image/png", buffer: TINY_PNG },
]);
await page.click("button:has-text('上 传 附 件')");
await page.waitForURL(/e=|ok=/);
await page.waitForTimeout(400);
check("案头上传成功", (await page.textContent("body")).includes("附件已收讫"));
check("附件列表出现新件", (await page.textContent("body")).includes("图版一.png"));

// 7.6 案头删除该附件
await page.locator(".att-row", { hasText: "图版一.png" }).locator("button:has-text('删 除')").click();
await page.waitForTimeout(600);
check("附件删除成功", !(await page.textContent("body")).includes("图版一.png"));

// 7.7 非白名单格式（.exe）被拒
await page.setInputFiles('input[name="file"]', [
  { name: "evil.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ1234567890") },
]);
await page.click("button:has-text('上 传 附 件')");
await page.waitForURL(/e=atttype/);
await page.waitForTimeout(600);
check("可执行文件被拒", (await page.textContent("body")).includes("格式不受支持"));

// 7.8 扩展名与内容不符（假 .pdf）被拒（魔数嗅探）
await page.setInputFiles('input[name="file"]', [
  { name: "假手稿.pdf", mimeType: "application/pdf", buffer: Buffer.from("这不是一份真的 PDF") },
]);
await page.click("button:has-text('上 传 附 件')");
await page.waitForURL(/e=atttype/);
await page.waitForTimeout(600);
check("内容与扩展名不符被拒", (await page.textContent("body")).includes("内容与扩展名不符"));

// 8. 管理者登录并放行新稿（掌门认证）
const ctx = await browser.newContext();
const p2 = await ctx.newPage();
p2.on("dialog", (d) => d.accept());
await p2.goto(B + "/login");
await settle(p2);
await p2.fill("#l-user", "rector");
await p2.fill("#l-pass", adminPassword);
await p2.click("button:has-text('入 馆')");
await p2.waitForURL("**/admin**");
check("管理者登录进后台", p2.url().includes("/admin"));

await p2.goto(B + "/admin?tab=reviews");
await p2.waitForTimeout(400);
const reviewRow = p2.locator(`.item:has-text("@${uname}")`).first();
check("审稿箱出现待审新稿", (await reviewRow.count()) > 0);
check("审稿箱显示附件角标", (await reviewRow.textContent()).includes("附件 ×1"));
await reviewRow.locator("button:has-text('收稿·送审')").click();
await p2.waitForTimeout(800);
await reviewRow.locator("button:has-text('录用')").click();
await p2.waitForTimeout(800);
await reviewRow.locator("button:has-text('刊印成典')").click();
await p2.waitForTimeout(800);
check("审稿流程完成", (await reviewRow.count()) === 0);

// 9. 论文已刊且作者获认证印；附件随刊公开可取
const paperUrl = page.url().split("?")[0];
await page.goto(paperUrl);
await page.waitForTimeout(400);
check("论文已刊出", (await page.textContent("body")).includes("已刊印"));

// 9.5 附件下载：PDF 内联可取、中文名走 RFC 5987、?dl=1 强制下载
const attHref = await page.getAttribute("a.att-name", "href");
check("附件链接存在", !!attHref);
if (attHref) {
  const res1 = await page.request.get(new URL(attHref, B).href);
  check(
    "附件可下载且为 PDF",
    res1.status() === 200 && (await res1.body()).subarray(0, 4).toString("latin1") === "%PDF",
  );
  check("中文名走 RFC5987 编码", (res1.headers()["content-disposition"] || "").includes("filename*=UTF-8''"));
  const res2 = await page.request.get(new URL(attHref + "?dl=1", B).href);
  check("强制下载响应头", (res2.headers()["content-disposition"] || "").startsWith("attachment"));
}

await page.goto(B + `/users/${uname}`);
await page.waitForTimeout(400);
check("作者获认证学者印", (await page.textContent("body")).includes("认证学者"));

// 10. 弃稿验证（已刊文稿可在论文页撤稿，再由作者重投需重新认证）
await page.goto(paperUrl);
await page.waitForTimeout(300);
const burnBtn = page.locator(`button:has-text('撤 稿 焚 文')`);
check("已刊论文可撤稿", (await burnBtn.count()) === 1);
await burnBtn.click();
await page.waitForURL("**/papers**");
check("撤稿成功", page.url().includes("/papers"));

// 11. 改身阶
await p2.goto(B + "/admin?tab=members");
await settle(p2);
const row = p2.locator(`tr:has-text("@${uname}")`);
check("名册中有新学者", (await row.count()) === 1);
await row.locator("select").selectOption("admin");
await p2.waitForTimeout(600);
await p2.reload();
await p2.waitForTimeout(400);
const row2 = p2.locator(`tr:has-text("@${uname}")`).first();
check("身阶已改为管理者", (await row2.locator("select").inputValue()) === "admin");

// 12. 升职后学者登录 → 跳后台
await page.goto(B + "/login");
await settle();
await page.fill("#l-user", uname);
await page.fill("#l-pass", "test1234");
await page.click("button:has-text('入 馆')");
await page.waitForURL("**/admin**");
check("升职后登录跳转管理员页", page.url().includes("/admin"));

// 13. 管理员移除学者
await p2.goto(B + "/admin?tab=members");
await settle(p2, 400);
const row3 = p2.locator(`tr:has-text("@${uname}")`).first();
await row3.getByRole("button", { name: "移除" }).click();
await p2.waitForTimeout(2500);
const gone = await p2.locator(`tr:has-text("@${uname}")`).count() === 0;
check("管理员移除学者成功", gone);

await browser.close();
console.log(results.join("\n"));
