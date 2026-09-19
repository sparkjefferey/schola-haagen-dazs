/**
 * 学友检索与申请回归套件（本地验收）
 *
 * 覆盖「讯息页按学号/雅名找人 → 申请学友私聊 → 对方讯息栏见红点 → 应允 → 无限私聊」全链路：
 *   1. 检索框在讯息侧栏，按学号（#7 / 7）、雅名子串、@用户名 三种写法都能命中；
 *   2. 只列在籍账号，自己也在结果里并标明；
 *   3. 申请后回跳检索结果（不被甩到对方名册页），结果行转为「待对方应允」；
 *   4. 申请计入对方讯息红点（且不重复计数——申请不再另发系统消息）；
 *   5. 「学友申请」栏可就地应允，应允后双方转「进入私聊」，且不再受每日条数之限；
 *   6. 检索限流（每账号 10 分钟 30 次）到点即拦；
 *   7. 「学友申请」栏自身有下手处（栏内检索即可找人申请）；管理者同样有申请入口，
 *      查人便册与学友名录分开标名；
 *   8. 聊天框里输入法上屏的那一下 Enter 不会把半截话发出去，正常 Enter 照常发送。
 *
 * 用法（先起本地站点于 3100，见 README「端到端测试」）：
 *   node scripts/e2e-find-friend.mjs           # 跑全套（自动造号、跑完自清）
 *   STEP=clean node scripts/e2e-find-friend.mjs  # 只清理测试账号与限流计数
 *
 * 只会写本地库：BASE 不是 127.0.0.1/localhost 时直接拒绝运行（防误伤线上）。
 * 注意：本库是开发者的真实数据，跑前请先备份 data/ 目录。
 */
import { chromium } from "playwright";
import Database from "better-sqlite3";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(BASE)) {
  console.error("拒绝运行：BASE 必须指向本地开发服务器");
  process.exit(2);
}

const PW = "e2eFind2026";
const A_USER = "e2e检索甲";
const B_USER = "e2e检索乙";
// 用户名本身就是一串数字的同窗：验证「学号查无此人时退回按名字匹配」这条退路
const C_USER = "91357";
const C_NAME = "数字名测试";
const TEST_USERS = [A_USER, B_USER, C_USER];

const db = new Database("data/schola.db");

function cleanup() {
  const ids = db
    .prepare(`SELECT id FROM users WHERE username IN (${TEST_USERS.map(() => "?").join(",")})`)
    .all(...TEST_USERS)
    .map((r) => r.id);
  for (const name of TEST_USERS) db.prepare("DELETE FROM users WHERE username = ?").run(name);
  // 检索与注册限流桶一并清掉，免得连跑多轮被自己上一轮的名额挡住
  db.prepare("DELETE FROM rate_limit_windows WHERE key LIKE 'usersearch:%'").run();
  db.prepare("DELETE FROM rate_limit_windows WHERE key LIKE 'reg:%'").run();
  return ids;
}

if (process.env.STEP === "clean") {
  const ids = cleanup();
  console.log(`已清理测试账号 ${ids.length} 个（id: ${ids.join(", ") || "无"}）`);
  process.exit(0);
}

// 每轮开始先清限流桶，保证注册与检索都有额度
db.prepare("DELETE FROM rate_limit_windows WHERE key LIKE 'reg:%'").run();
cleanup();

let fails = 0;
const ok = (c, m) => {
  console.log(`  ${c ? "✅" : "❌"} ${m}`);
  if (!c) fails++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const pageErrors = [];
const badResponses = [];
// 带上出错时所处的页面：水合报错只说「不匹配」，不说是哪一页的哪一处
page.on("pageerror", (e) => pageErrors.push(`pageerror @ ${decodeURIComponent(page.url())}: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push(`console @ ${decodeURIComponent(page.url())}: ${m.text()}`);
});
// 任何非 2xx 都要留痕：500 往往只在服务端日志里，页面上看不见
page.on("response", (r) => {
  if (r.status() >= 400) badResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`);
});

const fillCaptcha = async (sel = "#r-cap") => {
  const q = await page.$eval(sel, (el) => el.placeholder);
  const m = q.match(/(\d+)\s*\+\s*(\d+)/);
  await page.locator(sel).fill(String(Number(m[1]) + Number(m[2])));
};

async function register(username, displayName) {
  await page.goto(BASE + "/register", { waitUntil: "networkidle" });
  await page.locator(".tab-btn").first().click(); // 学者
  await page.locator("#r-user").fill(username);
  await page.locator("#r-name").fill(displayName);
  await page.locator("#r-pass").fill(PW);
  await fillCaptcha();
  await page.locator('form button[type="submit"]').last().click();
  await page.waitForURL(/\/login\?registered=/, { timeout: 15000 });
}

async function login(username) {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.locator("#l-user").fill(username);
  await page.locator("#l-pass").fill(PW);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
  // 注册时系统会发一条欢迎讯息，先把「系统通知」读过，红点才有个干净的零点。
  await page.goto(BASE + "/messages?with=system", { waitUntil: "networkidle" });
}

async function logout() {
  await page.goto(BASE + "/messages", { waitUntil: "domcontentloaded" });
  // logoutAction 落回首府之户（/），不是登录页
  await clickAndSettle(page.locator('form.inline-form button[type="submit"]'), (u) => u.pathname === "/");
}

/** 从干净的讯息页填检索框提交，等真正落到带 find 的结果页。 */
const search = async (q) => {
  await page.goto(BASE + "/messages", { waitUntil: "networkidle" });
  await page.locator('input[name="find"]').fill(q);
  await page.locator('.user-search button[type="submit"]').click();
  await page.waitForURL(new RegExp(`find=${encodeURIComponent(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), {
    timeout: 15000,
  });
  await page.waitForLoadState("networkidle");
};
/** 点行内动作后等一次「新的」跳转：目标串必须与当前 URL 不同，否则会在原地瞬间返回。 */
const clickAndSettle = async (locator, expected) => {
  await locator.click();
  await page.waitForURL(expected, { timeout: 15000 });
  await page.waitForLoadState("networkidle");
};
const hitNames = () => page.locator(".hit-row .title").allInnerTexts();
const hitRowText = async (name) => (await page.locator(".hit-row", { hasText: name }).innerText()).replace(/\s+/g, " ");
const bellCount = async () => {
  const n = await page.locator(".msg-bell .msg-badge").count();
  return n === 0 ? 0 : Number((await page.locator(".msg-bell .msg-badge").innerText()).trim());
};
/** 铃铛是客户端组件、靠路由变化后异步对账，取数要等它落定而不是读瞬时值。 */
const waitBell = async (expected, timeout = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await bellCount()) === expected) return true;
    await page.waitForTimeout(200);
  }
  return false;
};

console.log("\n[1] 造测试账号并登入甲");
await register(A_USER, "检索甲");
await register(B_USER, "检索乙");
await register(C_USER, C_NAME);
await login(A_USER);
const users = db
  .prepare(`SELECT id, username, display_name FROM users WHERE username IN (?, ?, ?)`)
  .all(A_USER, B_USER, C_USER);
const A = users.find((u) => u.username === A_USER);
const B = users.find((u) => u.username === B_USER);
ok(!!A && !!B, `甲=#${A?.id} 乙=#${B?.id}`);

console.log("\n[2] 讯息页有检索入口，且默认没有未读");
await page.goto(BASE + "/messages", { waitUntil: "networkidle" });
ok((await page.locator(".user-search input[name=\"find\"]").count()) === 1, "侧栏顶部有检索框");
ok(await waitBell(0), "新账号讯息铃无红点");

console.log("\n[3] 按学号检索（# 前缀与纯数字皆可）");
await search(`#${B.id}`);
ok((await page.locator(".hit-row").count()) === 1, `#${B.id} 命中 1 人（纯数字查询只当学号，不再捎带名字里含同串的人）`);
ok((await hitRowText("检索乙")).includes(`学号 #${B.id}`), "结果行示出学号");
ok((await hitRowText("检索乙")).includes("申请学友私聊"), "给出「申请学友私聊」按钮");
await search(String(B.id));
ok((await hitNames()).join() === "检索乙", `纯数字 ${B.id} 同样只命中检索乙`);

console.log("\n[3b] 学号查无此人时，退回按名字匹配（纯数字用户名仍搜得到）");
await search(C_USER);
ok((await hitNames()).join() === C_NAME, `${C_USER} 无此学号，按用户名找到「${C_NAME}」`);

console.log("\n[4] 按雅名子串 / @用户名 检索；搜不到时给交代");
await search("检索");
const names = await hitNames();
ok(names.includes("检索甲") && names.includes("检索乙"), `子串「检索」命中两人: ${JSON.stringify(names)}`);
ok((await hitRowText("检索甲")).includes("这是你自己"), "自己出现在结果里并标明");
await search("查无此人zzz");
ok((await page.locator(".hit-row").count()) === 0, "无结果时不列任何人");
ok((await page.locator(".msg-main .empty-note").first().innerText()).includes("未找到此同窗"), "无结果有交代文案");
await search(`@${B_USER}`);
ok((await hitNames()).join() === "检索乙", "@ 前缀被剥掉后照常命中");

console.log("\n[4b] LIKE 通配符按字面量处理（% 与 _ 不得变成「匹配所有人」）");
await search("%");
ok((await page.locator(".hit-row").count()) === 0, "查 % 命中 0 人（未转义则会列出全员）");
await search("_");
ok((await page.locator(".hit-row").count()) === 0, "查 _ 命中 0 人（未转义则会列出所有单字以上名前缀）");

console.log("\n[5] 发起学友申请：回跳检索结果，行内转「待对方应允」");
await search(`#${B.id}`);
await clickAndSettle(page.locator('.hit-row button:has-text("申请学友私聊")'), /ok=cert_sent/);
ok(page.url().includes("/messages?find="), "办完仍留在检索结果（未被甩去名册页）: " + decodeURIComponent(page.url()));
ok((await hitRowText("检索乙")).includes("已申请"), "该行转为「已申请 · 待对方应允」");
ok(await waitBell(0), "申请人自己不加红点（申请不再另发系统消息）");

console.log("\n[5b] 老路径仍在：名册页发起学友申请（不带 back 字段，目标为中文名账号）");
await logout();
await login(C_USER);
await page.goto(BASE + "/users/" + encodeURIComponent(A_USER), { waitUntil: "networkidle" });
ok(
  (await page.locator('.card a.btn:has-text("私 信")').count()) === 1,
  "名册页私信与申请并列一处（从前私信独占一行，申请是下方一枚素色小按钮）",
);
await clickAndSettle(page.locator('button:has-text("申请学友私聊")'), /ok=cert_sent/);
ok(decodeURIComponent(page.url()).endsWith(`/users/${A_USER}?ok=cert_sent`), "办完回到对方名册页: " + decodeURIComponent(page.url()));

console.log("\n[6] 乙方：讯息栏红点由申请点亮，可栏内应允");
await logout();
await login(B_USER);
await page.goto(BASE + "/messages", { waitUntil: "networkidle" });
ok(await waitBell(1), "乙的讯息铃红点为 1（申请计入，且不因系统消息重复计数）");
const certRow = page.locator('.conv-item:has-text("学友申请")');
ok((await certRow.locator(".msg-badge").innerText()).trim() === "1", "侧栏「学友申请」带红点 1");
await clickAndSettle(certRow, /with=certs/);
ok((await page.locator('.conv-item:has-text("学友申请") .msg-badge').innerText()).trim() === "1", "翻看申请栏时角标仍挂着（看过不算完，回应了才算）");
ok(await waitBell(1), "此时铃铛同样仍计这笔申请，两处口径一致");
ok((await page.locator('.card:has-text("待你应允")').innerText()).includes("检索甲"), "申请栏列出甲");
await clickAndSettle(page.locator('button:has-text("应 允")').first(), /ok=cert_accepted/);
ok((await page.locator('.card:has-text("待你应允")').innerText()).includes("暂无"), "应允后待应允列表清空");
ok(await waitBell(0), "回应后红点归零");

console.log("\n[6b] 「学友申请」栏自身有下手处：栏内检索 → 结果行给动作");
const panelSearch = page.locator(".msg-main .user-search");
ok((await panelSearch.count()) === 1, "申请栏首有检索框（从前本栏只有两张卡片，想结学友的人进来无从下手）");
await panelSearch.locator('input[name="find"]').fill(`#${A.id}`);
await panelSearch.locator('button[type="submit"]').click();
await page.waitForURL(/find=/, { timeout: 15000 });
await page.waitForLoadState("networkidle");
ok((await page.locator(".hit-row", { hasText: "检索甲" }).count()) === 1, "栏内检索直达结果行");

console.log("\n[7] 互证即成学友：结果行转「进入私聊」，且不再受每日条数之限");
await search(`#${A.id}`);
ok((await page.locator('.hit-row a:has-text("进 入 私 聊")').count()) === 1, "已是学友，行内直接给私聊入口");
await clickAndSettle(page.locator('.hit-row a:has-text("进 入 私 聊")'), /with=\d+/);
ok(!(await page.locator(".chat-window").innerText()).includes("今日剩余未互证私信"), "学友之间不显示每日限额");
await page.locator(".chat-input textarea").fill("幸会，今后常来常往。");
await page.locator('.chat-input button[type="submit"]').click();
await page.waitForTimeout(1500);
ok((await page.locator(".chat-body .bubble").count()) === 1, "消息已发出并上屏");

console.log("\n[7b] 输入法上屏的那一下 Enter 不得把半截话发出去");
// 无头浏览器驱动不了真实输入法，这里按事件的真实次序复演「确认候选」那一下：
// 先 compositionend（上屏），紧接着 keydown Enter —— Safari 正是这个次序，
// keydown 到手时 isComposing 已是 false，全凭护栏的时间窗兜住。
const imeCommitEnter = () =>
  page.evaluate(() => {
    const ta = document.querySelector(".chat-input textarea");
    ta.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "你好" }));
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
await page.locator(".chat-input textarea").fill("nihao");
await imeCommitEnter();
await page.waitForTimeout(600);
ok((await page.locator(".chat-body .bubble").count()) === 1, "上屏的那一下 Enter 没有发送");
ok((await page.locator(".chat-input textarea").inputValue()) === "nihao", "文字原样留在输入框，也没多落一个换行");
// 护栏不能把正常按 Enter 一并吞了：余波窗口过后，Enter 照常发送
await page.waitForTimeout(200);
await page.evaluate(() => {
  document
    .querySelector(".chat-input textarea")
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
});
await page.waitForTimeout(1500);
ok((await page.locator(".chat-body .bubble").count()) === 2, "余波过后按 Enter 照常发送");

console.log("\n[8] 甲方收到私聊，会话列表与线程俱在");
await logout();
await login(A_USER);
await page.goto(BASE + "/messages", { waitUntil: "networkidle" });
ok((await page.locator('.conv-item:has-text("检索乙")').count()) === 1, "会话列表出现检索乙");
await page.locator('.conv-item:has-text("检索乙")').click();
await page.waitForURL(/with=\d+/, { timeout: 15000 });
ok((await page.locator(".chat-body").innerText()).includes("幸会，今后常来常往。"), "能看到对方发来的原话");

console.log("\n[9] 检索限流：每账号 10 分钟 30 次，到点即拦");
let last = "";
for (let i = 0; i < 33; i++) {
  const res = await page.request.get(`${BASE}/messages?find=%E6%A3%80%E7%B4%A2`);
  last = await res.text();
}
ok(last.includes("检索过于频繁"), "超额后返回限流文案而非结果");

console.log("\n[10] 管理者视角：学友功能同样在（从前管理员被排除在互证之外，整块功能看不见）");
// 用测试账号临时充任管理者：这一视角正是「馆长试用时找不到申请按钮」的原样复现
db.prepare("UPDATE users SET role='admin' WHERE username = ?").run(C_USER);
await logout();
await login(C_USER);
await page.goto(BASE + "/messages", { waitUntil: "networkidle" });
ok((await page.locator('.conv-item:has-text("学友申请")').count()) === 1, "管理者侧栏仍有「学友申请」入口");
ok((await page.locator('.new-pm summary:has-text("学友名录")').count()) === 1, "「学友名录」只列真学友");
ok(
  (await page.locator('.new-pm summary:has-text("全员名录")').count()) === 1,
  "查人便册另立一条、单独标名（从前它顶着「学友名录」列全员，看着就像谁都是学友）",
);
await search(`#${B.id}`);
const adminRow = await hitRowText("检索乙");
ok(adminRow.includes("申请学友私聊"), `管理者检索结果照常给「申请学友私聊」: ${adminRow}`);
ok(adminRow.includes("私 信"), "另给管理者一个直达私信的便门");
await page.goto(BASE + "/users/" + encodeURIComponent(B_USER), { waitUntil: "networkidle" });
ok(
  (await page.locator('.card button:has-text("申请学友私聊")').count()) === 1,
  "管理者名册页也看得见学友申请（从前这一区整块不渲染）",
);
db.prepare("UPDATE users SET role='scholar' WHERE username = ?").run(C_USER);

console.log("\n---- 页面异常 ----");
console.log(pageErrors.slice(0, 8).join("\n") || "(无)");
// 水合失败会让 React 把整棵子树在客户端重建，属真缺陷（多为非法标签嵌套），单独盯住
const hydration = pageErrors.filter((e) => /Minified React error #418|Hydration failed/.test(e));
ok(hydration.length === 0, `无水合报错（实得 ${hydration.length} 条）`);
console.log("\n---- 非 2xx 响应 ----");
console.log([...new Set(badResponses)].slice(0, 12).join("\n") || "(无)");
ok(badResponses.length === 0, `全程无非 2xx 响应（实得 ${badResponses.length} 条）`);
await browser.close();
cleanup();
console.log("\n（测试账号与限流计数已清理）");
console.log(`\n===== ${fails === 0 ? "全部通过" : fails + " 项未通过"} =====`);
process.exit(fails === 0 ? 0 : 1);
