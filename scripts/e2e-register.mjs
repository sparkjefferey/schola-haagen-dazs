/**
 * 注册表单回归套件（本地验收）
 *
 * 覆盖两类曾经/易发的故障：
 *   1. 缺项或不合规时不静默卡在「书院注册中……」，而是逐栏中文点名；
 *   2. 雅名撞名提前告知（边打字即查）+ 服务端退回时描红聚焦。
 *
 * 用法（需先起本地 dev server，见 .workbuddy/memory 里的"本地验收"一节）：
 *   STEP=seed  node scripts/e2e-register.mjs   # 造一个"曾用名"测试账号
 *   node scripts/e2e-register.mjs              # 跑全套断言
 *   STEP=clean node scripts/e2e-register.mjs   # 清理测试账号 + 限流计数
 *
 * 只会写本地库：BASE 不是 127.0.0.1/localhost 时直接拒绝运行（防误伤线上）。
 */
import { chromium } from "playwright";
import Database from "better-sqlite3";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(BASE)) {
  console.error("拒绝运行：BASE 必须指向本地开发服务器");
  process.exit(2);
}

const db = new Database("data/schola.db");
const TEMP_USER = "e2etmpformer";
const TEMP_OLD = "e2eoldname";

if (process.env.STEP === "seed") {
  db.prepare("DELETE FROM users WHERE username = ?").run(TEMP_USER);
  const info = db
    .prepare("INSERT INTO users (username, display_name, password_hash, role, root) VALUES (?,?,?,?,0)")
    .run(TEMP_USER, TEMP_USER, "x", "scholar");
  db.prepare("INSERT INTO username_history (user_id, old_username) VALUES (?,?)").run(info.lastInsertRowid, TEMP_OLD);
  console.log(`已造「曾用名」测试账号: ${TEMP_USER} → 旧名 ${TEMP_OLD}`);
  process.exit(0);
}
if (process.env.STEP === "clean") {
  const n = db
    .prepare("DELETE FROM users WHERE username = ? OR username LIKE 'e2e%' OR username LIKE 'testuser%'")
    .run(TEMP_USER).changes;
  db.prepare("DELETE FROM rate_limit_windows").run();
  console.log(`已清理测试账号 ${n} 个，用户总数:`, db.prepare("SELECT COUNT(*) c FROM users").get().c);
  process.exit(0);
}

let fails = 0;
const ok = (c, m) => {
  console.log(`  ${c ? "✅" : "❌"} ${m}`);
  if (!c) fails++;
};
const api = async (u) => (await fetch(`${BASE}/api/username-check?u=${encodeURIComponent(u)}`)).json();

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 780, height: 1150 }, deviceScaleFactor: 2 })).newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push("console: " + m.text());
});
const btn = () => page.locator('form button[type="submit"]');
const btnText = async () => (await btn().innerText()).trim();
const navCount = () => page.evaluate(() => performance.getEntriesByType("navigation").length);
const fillCaptcha = async () => {
  const q = await page.$eval("#r-cap", (el) => el.placeholder);
  const m = q.match(/(\d+)\s*\+\s*(\d+)/);
  await page.locator("#r-cap").fill(String(Number(m[1]) + Number(m[2])));
};

console.log("\n[1] 缺项：当场逐栏点名，不进 loading、不发请求");
await page.goto(BASE + "/register", { waitUntil: "networkidle" });
await btn().click();
await page.waitForTimeout(700);
ok((await page.locator("p.field-err").count()) === 3, "三栏中文红字");
ok((await btnText()) === "入 派 成 学" && !(await btn().isDisabled()), "按钮未卡 loading");
ok((await page.locator("p.notice").innerText()).includes("还有栏目未填写"), "顶部汇总缺填");

console.log("\n[2] 雅名只填空格 / 口令首尾带空格 / 管理者漏邀请函");
await page.locator("#r-user").fill("   ");
await page.locator("#r-pass").fill(" abc123456 ");
await page.locator("#r-cap").fill("3");
await btn().click();
await page.waitForTimeout(600);
let errs = await page.locator("p.field-err").allInnerTexts();
ok(errs.some((t) => t.includes("雅名")) && errs.some((t) => t.includes("空格")), `两处都被点名: ${JSON.stringify(errs)}`);
await page.locator('.tab-btn:has-text("管理者就任")').click();
await page.locator("#r-user").fill("e2etmpcheck");
await page.locator("#r-pass").fill("abc123456");
await btn().click();
await page.waitForTimeout(600);
ok((await page.locator("p.field-err").allInnerTexts()).some((t) => t.includes("邀请函")), "邀请函缺填被点名");

console.log("\n[3] 查名接口：现役名 / 曾用名 / 可用名 / 非法名");
let r = await api("rector");
ok(r.state === "taken" && r.former === false, `现役名 rector → taken（former=${r.former}）`);
ok(r.suggestions?.length >= 2, `给出备选名: ${JSON.stringify(r.suggestions)}`);
r = await api(TEMP_OLD);
ok(r.state === "taken" && r.former === true, `曾用名 ${TEMP_OLD} → taken（former=true，不可重领）`);
ok((await api("rector2026")).state === "free", "rector2026 → free");
ok((await api("a")).state === "invalid", "非法名 a → invalid");

console.log("\n[4] 边打字即查重 + 备选名可点即填");
await page.goto(BASE + "/register", { waitUntil: "networkidle" });
await page.locator("#r-user").fill("rector");
await page.waitForTimeout(1300);
ok((await page.locator("p.field-tip.bad").count()) === 1, "出现撞名提示行");
ok((await page.locator("p.field-tip.bad").innerText()).includes("已被占用"), "文案说明已被占用");
const chips = await page.locator("button.name-chip").allInnerTexts();
ok(chips.length >= 2, `备选名: ${JSON.stringify(chips)}`);
ok((await page.$eval("#r-user", (el) => el.className)).includes("input-invalid"), "雅名栏已描红");
ok((await btnText()) === "入 派 成 学" && !(await btn().isDisabled()), "按钮正常，没有转圈");
await page.locator("button.name-chip").first().click();
await page.waitForTimeout(1300);
ok((await page.locator("p.field-tip.ok").count()) === 1, "点建议名后转为「此名尚无人用」");
ok((await page.$eval("#r-user", (el) => el.value)) === chips[0], `输入框确实填入了 ${chips[0]}`);

console.log("\n[5] 提交撞名：本地拦下，不发请求、不转圈");
await page.goto(BASE + "/register", { waitUntil: "networkidle" });
const nav0 = await navCount();
await page.locator("#r-user").fill("rector");
await page.locator("#r-pass").fill("abc123456");
await fillCaptcha();
await page.waitForTimeout(1300);
await btn().click();
await page.waitForTimeout(1500);
ok((await navCount()) === nav0, "没有整页刷新/服务端往返");
ok((await btnText()) === "入 派 成 学" && !(await btn().isDisabled()), "按钮未卡 loading");
ok((await page.locator("p.field-err").allInnerTexts()).some((t) => t.includes("已被占用")), "该栏红字已给出");

console.log("\n[6] 服务端退回（?e=taken）：首屏 HTML 就有提示，且描红 + 聚焦");
const html = await (await fetch(BASE + "/register?e=taken")).text();
ok(html.includes("已被他人先行注册"), "服务端渲染的 HTML 里已带提示（脚本没跑到也看得见）");
ok(html.includes("input-invalid"), "服务端渲染的 HTML 里已带描红");
await page.goto(BASE + "/register?e=taken", { waitUntil: "networkidle" });
ok((await page.evaluate(() => document.activeElement?.getAttribute("name"))) === "username", "光标已落在雅名栏");
await page.locator("#r-user").fill("rector");
await page.waitForTimeout(1200);
ok((await page.locator("p.field-err").count()) === 0, "一动手改名，旧的撞名红字就撤掉");
ok((await page.locator("p.field-tip.bad").count()) === 1, "改成仍撞名的名字，立即重新报告");

console.log("\n[7] 验证码答错退回后按钮复活，改对即可一次注册成功");
await page.goto(BASE + "/register", { waitUntil: "networkidle" });
const fresh = "e2e" + Math.random().toString(36).slice(2, 8);
await page.locator("#r-user").fill(fresh);
await page.waitForTimeout(1300);
ok((await page.locator("p.field-tip.ok").count()) === 1, `新名 ${fresh} 提示可用`);
await page.locator("#r-pass").fill("abc123456");
await page.locator("#r-cap").fill("999");
await btn().click();
await page.waitForTimeout(3500);
ok((await btnText()) === "入 派 成 学" && !(await btn().isDisabled()), "答错被打回后按钮已复活（不再永久卡死）");
ok(page.url().includes("e=captcha"), "带回错误码: " + page.url());
await fillCaptcha();
await btn().click();
await page.waitForTimeout(4000);
ok(page.url().includes("/login?registered="), "填对后注册成功并跳到登学页: " + page.url());

console.log("\n---- 页面异常 ----");
console.log(pageErrors.slice(0, 8).join("\n") || "(无)");
console.log(`\n===== ${fails === 0 ? "全部通过" : fails + " 项未通过"} =====`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
