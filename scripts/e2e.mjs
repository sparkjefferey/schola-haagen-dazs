import { chromium } from "playwright";

const B = "http://localhost:3100";
const uname = "t" + Date.now().toString(36);
const results = [];
function check(name, cond) {
  results.push(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) process.exitCode = 1;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// 1. 首页
await page.goto(B + "/");
check("首页渲染", (await page.textContent("h1"))?.includes("SCHOLA HÄAGEN-DAZS"));
await page.screenshot({ path: "/tmp/shot-home.png" });

// 2. 注册新学者
await page.goto(B + "/register");
await page.click("button:has-text('学者入学')");
await page.fill("#r-user", uname);
await page.fill("#r-name", "试验学士");
await page.fill("#r-pass", "test1234");
await page.fill("#r-motto", "学海无涯，冷食作舟");
await page.click("button:has-text('入 派 成 学')");
await page.waitForURL("**/login**");
check("注册成功跳转登学", page.url().includes("/login?registered="));
console.log("username:", uname);

// 3. 学者登录
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

// 7. 发文（新学者 → 入掌门审稿箱）
await page.goto(B + "/papers/new");
await page.fill("#p-title", "《论初版之不足》");
await page.selectOption("#p-disc", "乳脂哲学");
await page.fill("#p-abs", "这是一篇测试提要。");
await page.fill("#p-body", "## 一、正文\n\n这是测试正文的完整内容，起码三十个字，好让论文能够顺利入库。\n\n> 引语示例。");
await page.click("button:has-text('投 稿 入 库')");
await page.waitForURL(/\/papers\/\d+$/);
await page.waitForTimeout(500);
check("发文成功", (await page.textContent("h1"))?.includes("初版之不足"));
check("新稿标示已收稿", (await page.textContent("body")).includes("已收稿"));

// 8. 管理者登录并放行新稿（掌门认证）
const ctx = await browser.newContext();
const p2 = await ctx.newPage();
p2.on("dialog", (d) => d.accept());
await p2.goto(B + "/login");
await p2.fill("#l-user", "rector");
await p2.fill("#l-pass", process.env.SEED_ADMIN_PW || "Sd7mK2pQx9vBnW3rTz8L");
await p2.click("button:has-text('入 馆')");
await p2.waitForURL("**/admin**");
check("管理者登录进后台", p2.url().includes("/admin"));

await p2.goto(B + "/admin?tab=reviews");
await p2.waitForTimeout(400);
const reviewRow = p2.locator(`.item:has-text("@${uname}")`).first();
check("审稿箱出现待审新稿", (await reviewRow.count()) > 0);
await reviewRow.locator("button:has-text('收稿·送审')").click();
await p2.waitForTimeout(800);
await reviewRow.locator("button:has-text('录用')").click();
await p2.waitForTimeout(800);
await reviewRow.locator("button:has-text('刊印成典')").click();
await p2.waitForTimeout(800);
check("审稿流程完成", (await reviewRow.count()) === 0);

// 9. 论文已刊且作者获认证印
const paperUrl = page.url();
await page.goto(paperUrl);
await page.waitForTimeout(400);
check("论文已刊出", (await page.textContent("body")).includes("已刊印"));
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
await page.fill("#l-user", uname);
await page.fill("#l-pass", "test1234");
await page.click("button:has-text('入 馆')");
await page.waitForURL("**/admin**");
check("升职后登录跳转管理员页", page.url().includes("/admin"));

// 13. 管理员移除学者
await p2.goto(B + "/admin?tab=members");
await p2.waitForTimeout(300);
const row3 = p2.locator(`tr:has-text("@${uname}")`).first();
await row3.getByRole("button", { name: "移除" }).click();
await p2.waitForTimeout(2500);
const gone = await p2.locator(`tr:has-text("@${uname}")`).count() === 0;
check("管理员移除学者成功", gone);

await browser.close();
console.log(results.join("\n"));
