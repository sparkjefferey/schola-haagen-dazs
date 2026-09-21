/**
 * 墨银回归套件（本地验收）
 *
 * 锁住五件最容易坏的事：
 *   1. 每日一次靠**数据库唯一索引**拦下，而不是靠前端把按钮藏起来；
 *   2. 投出即焚：币从投币者账上扣掉，作者一枚也收不到——只涨「获币数」与「学望」；
 *   3. 自投、超上限、余额不足三种情况在**服务端**被拒（前端 disabled 只是礼貌）；
 *   4. 「点开即变」：领币/投币后余额与获币数当场变，且**不发生整页刷新**——
 *      钱囊挂在 layout 上，layout 的客户端组件在软导航时不重挂载，靠服务端重渲染
 *      换数会闪，这套件就是防它退化的（同 3c3b2dd 的教训）。
 *   5. 学望进入学榜：score = 论著数×20 + 总阅量 + 获墨银×权重。
 *
 * 用法（需先起本地 server，dev 或 next start 皆可）：
 *   node scripts/e2e-coins.mjs
 *
 * 只会写本地库：BASE 不是 127.0.0.1/localhost 时直接拒绝运行。
 */
import { chromium } from "playwright";
import Database from "better-sqlite3";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(BASE)) {
  console.error("拒绝运行：BASE 必须指向本地开发服务器");
  process.exit(2);
}

const DAILY = Number(process.env.COIN_DAILY ?? 5);
const TIP_CAP = Number(process.env.COIN_TIP_PER_PAPER ?? 3);
const WEIGHT = Number(process.env.COIN_SCORE_WEIGHT ?? 5);

const PASSWORD = "cointest-pass-2026";
const TEST_PREFIX = "cointest";
const suffix = Math.random().toString(36).slice(2, 5);
const A = `${TEST_PREFIX}a${suffix}`;
const B = `${TEST_PREFIX}b${suffix}`;

const db = new Database("data/schola.db");
db.prepare("DELETE FROM rate_limit_windows").run();
db.prepare(`DELETE FROM users WHERE username LIKE '${TEST_PREFIX}%'`).run();

const todaySH = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

let fails = 0;
const ok = (c, m) => {
  console.log(`  ${c ? "✅" : "❌"} ${m}`);
  if (!c) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 造两名学者：A 花钱，B 发稿 ----
async function register(page, uname) {
  await page.goto(BASE + "/register", { waitUntil: "networkidle" });
  await page.locator("#r-user").fill(uname);
  await page.locator("#r-pass").fill(PASSWORD);
  const capQ = await page.$eval("#r-cap", (el) => el.placeholder);
  const m = capQ.match(/(\d+)\s*\+\s*(\d+)/);
  await page.locator("#r-cap").fill(String(Number(m[1]) + Number(m[2])));
  await page.locator('form button[type="submit"]').click();
  await sleep(2500);
}

async function login(page, uname) {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.locator("#l-user").fill(uname);
  await page.locator("#l-pass").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await sleep(2500);
}

const browser = await chromium.launch();
const pageA = await (await browser.newContext()).newPage();
const pageB = await (await browser.newContext()).newPage();
await register(pageA, A);
await register(pageB, B);

const aId = db.prepare("SELECT id FROM users WHERE username = ?").get(A).id;
const bId = db.prepare("SELECT id FROM users WHERE username = ?").get(B).id;
console.log(`\n学者甲(投币) id=${aId} ${A} ｜ 学者乙(著书) id=${bId} ${B}`);

// ---- [1] 入馆未满一日：按钮在，但点下去服务端拒 ----
console.log("\n[1] 入馆未满一日");
await login(pageA, A);
const claimBtn = pageA.locator('[data-testid="coin-claim"]');
ok(await claimBtn.isVisible().catch(() => false), "钱囊按钮已显示（余额 0 也看得到）");
await claimBtn.click();
await sleep(1500);
const youngMsg = await pageA.locator("header").innerText();
ok(youngMsg.includes("入馆未满一日"), "服务端以「入馆未满一日」拒付（挡小号的最低成本手段）");
ok(
  (db.prepare("SELECT COUNT(*) c FROM coin_ledger WHERE user_id = ? AND kind='daily'").get(aId).c) === 0,
  "未留下任何领取记录",
);

// ---- [2] 越过 24 小时门槛后可领，且当场到账 ----
console.log("\n[2] 越过门槛后领取");
db.prepare("UPDATE users SET created_at = datetime('now','-2 days') WHERE id IN (?, ?)").run(aId, bId);
await pageA.goto(BASE + "/", { waitUntil: "networkidle" });
await pageA.evaluate(() => {
  // 记下基线：整页导航次数（每次 goto/reload 会 +1，软导航不会）
  window.__navBase = performance.getEntriesByType("navigation").length;
});
await pageA.locator('[data-testid="coin-claim"]').click();
await sleep(2000);
const balance = (await pageA.locator('[data-testid="coin-balance"]').innerText()).trim();
ok(balance === String(DAILY), `余额当场变为 ${DAILY}（实际 ${balance}）`);
ok(
  (await pageA.locator("header").innerText()).includes(`+${DAILY}`),
  "给了「+N」的即时反馈",
);
const ledger = db
  .prepare("SELECT amount, day FROM coin_ledger WHERE user_id = ? AND kind='daily'")
  .all(aId);
ok(
  ledger.length === 1 && ledger[0].amount === DAILY && ledger[0].day === todaySH,
  `账本记下一条，日戳按东八区算：${JSON.stringify(ledger)}`,
);

// ---- [3] 每日一次的地基是唯一索引，不是前端 ----
console.log("\n[3] 每日一次由数据库兜底");
let dupRejected = false;
try {
  db.prepare("INSERT INTO coin_ledger (user_id, kind, amount, day) VALUES (?, 'daily', ?, ?)").run(
    aId,
    DAILY,
    todaySH,
  );
} catch {
  dupRejected = true;
}
ok(dupRejected, "重复插入同一天的 daily 记录被唯一索引拒绝");
await pageA.goto(BASE + "/", { waitUntil: "networkidle" });
ok(
  !(await pageA.locator('[data-testid="coin-claim"]').isVisible().catch(() => false)),
  "刷新后领取按钮消失（服务端已知道今天领过）",
);

// ---- 造三篇已刊论著：乙两篇（供投币）、甲一篇（测自投） ----
const insPaper = db.prepare(
  `INSERT INTO papers (author_id, title, discipline, abstract, content, status, manuscript_code, published_at, tips)
   VALUES (?, ?, '乳脂哲学', '提要', '正文', 'published', ?, datetime('now'), 0)`,
);
const pB1 = Number(insPaper.run(bId, `墨银试作·甲（${suffix}）`, `SCHOLA-2026-90${suffix}1`).lastInsertRowid);
const pB2 = Number(insPaper.run(bId, `墨银试作·乙（${suffix}）`, `SCHOLA-2026-90${suffix}2`).lastInsertRowid);
const pB3 = Number(insPaper.run(bId, `墨银试作·丁（${suffix}）`, `SCHOLA-2026-90${suffix}4`).lastInsertRowid);
const pA1 = Number(insPaper.run(aId, `墨银试作·丙（${suffix}）`, `SCHOLA-2026-90${suffix}3`).lastInsertRowid);

// ---- [4] 投币：币焚毁、作者不落币、页面当场变 ----
console.log("\n[4] 投币给乙的论著");
await pageA.goto(`${BASE}/papers/${pB1}`, { waitUntil: "networkidle" });
ok(await pageA.locator('[data-testid="tip-btn"]').isVisible(), "非本人论著上给了投币键");
await pageA.evaluate(() => {
  window.__navBase = performance.getEntriesByType("navigation").length;
});
await pageA.locator('[data-testid="tip-btn"]').click();
await sleep(2000);
ok((await pageA.locator('[data-testid="tip-count"]').innerText()).trim() === "1", "获币数当场变 1");
ok(
  (await pageA.locator('[data-testid="tip-mine"]').innerText()).includes(`1 / ${TIP_CAP}`),
  "个人进度当场变 1/N",
);
ok(
  (await pageA.locator('[data-testid="coin-balance"]').innerText()).trim() === String(DAILY - 1),
  `顶栏余额同步扣为 ${DAILY - 1}（靠广播事件，不是整页刷新）`,
);
const navAfter = await pageA.evaluate(
  () => performance.getEntriesByType("navigation").length - window.__navBase,
);
ok(navAfter === 0, "全程没有整页刷新（点开即变，不靠在读的长文页上重渲染）");
const balB = db.prepare("SELECT coin_balance FROM users WHERE id = ?").get(bId).coin_balance;
ok(balB === 0, `作者一枚也没收到（余额 ${balB}）——投出即焚`);
ok(
  db.prepare("SELECT tips FROM papers WHERE id = ?").get(pB1).tips === 1,
  "论著获币数 +1",
);

// ---- [5] 投满上限 ----
console.log(`\n[5] 单篇上限 ${TIP_CAP} 枚`);
await pageA.locator('[data-testid="tip-btn"]').click();
await sleep(1800);
await pageA.locator('[data-testid="tip-btn"]').click();
await sleep(1800);
ok((await pageA.locator('[data-testid="tip-count"]').innerText()).trim() === String(TIP_CAP), "投满后获币数为上限值");
const disabled = await pageA.locator('[data-testid="tip-btn"]').isDisabled();
ok(disabled, "按钮已置灰（但这不是防线，见下一步）");

// ---- [6] 前端禁用只是礼貌：让服务端状态在页面渲染之后变化，再点 ----
// 手工改 disabled 是验不到服务端的——React 的 onClick 里 full 已经是 true，会直接 return，
// 请求根本发不出去。要让「服务端那道闸」真正承压，得让页面以为能投、而库里已经投满。
// 这等价于另一个标签页抢先投满了同一篇稿，或有人绕过界面直接发请求。
console.log("\n[6] 服务端才是防线");
db.prepare("UPDATE users SET coin_balance = ? WHERE id = ?").run(DAILY, aId);
await pageA.goto(`${BASE}/papers/${pB3}`, { waitUntil: "networkidle" });
const forgeTip = db.prepare(
  "INSERT INTO coin_ledger (user_id, kind, amount, paper_id) VALUES (?, 'tip', -1, ?)",
);
for (let i = 0; i < TIP_CAP; i++) forgeTip.run(aId, pB3);
db.prepare("UPDATE papers SET tips = ? WHERE id = ?").run(TIP_CAP, pB3);
await pageA.locator('[data-testid="tip-btn"]').click();
await sleep(1800);
ok(
  (await pageA.locator('[data-testid="tip-count"]').innerText()).trim() === String(TIP_CAP),
  "服务端拦下超额投币：获币数没有涨到上限 +1",
);
ok(
  (await pageA.locator("body").innerText()).includes(`至多投 ${TIP_CAP} 枚`),
  "并如实告知上限",
);
ok(
  db.prepare("SELECT COUNT(*) c FROM coin_ledger WHERE user_id=? AND paper_id=? AND kind='tip'").get(aId, pB3).c ===
    TIP_CAP,
  "账本里没有多出来的流水——扣款与记账都在事务内，没留下半截",
);
// 收尾：清掉这批伪造流水，免得污染后面的学望断言
db.prepare("DELETE FROM coin_ledger WHERE user_id=? AND paper_id=? AND kind='tip'").run(aId, pB3);
db.prepare("UPDATE papers SET tips = 0 WHERE id = ?").run(pB3);

// ---- [7] 自己的论著不可自投 ----
console.log("\n[7] 自投拦截");
await pageA.goto(`${BASE}/papers/${pA1}`, { waitUntil: "networkidle" });
ok(
  (await pageA.locator("body").innerText()).includes("自己的论著不可自投"),
  "自己的稿上不给投币键，并说明缘由",
);

// ---- [8] 余额不足 ----
console.log("\n[8] 钱囊见底");
db.prepare("UPDATE users SET coin_balance = 0 WHERE id = ?").run(aId);
await pageA.goto(`${BASE}/papers/${pB2}`, { waitUntil: "networkidle" });
await pageA.locator('[data-testid="tip-btn"]').click();
await sleep(1800);
ok(
  (await pageA.locator("body").innerText()).includes("钱囊空了"),
  "余额不足时给出可操作的提示",
);
ok(
  (await pageA.locator('[data-testid="tip-count"]').innerText()).trim() === "0",
  "论著获币数未被污染",
);

// ---- [9] 学望进入学榜 ----
console.log("\n[9] 学望与学榜");
const bName = db.prepare("SELECT display_name FROM users WHERE id = ?").get(bId).display_name;
await pageA.goto(BASE + "/ranking", { waitUntil: "networkidle" });
ok((await pageA.locator("table.rank-table").innerText()).includes("获墨银"), "学榜已增列「获墨银」");
// 期望值从库里现算：我们访问过这几篇稿的页面，阅数已被自增，写死会假失败
const agg = db
  .prepare(
    `SELECT COUNT(*) c, COALESCE(SUM(views), 0) v, COALESCE(SUM(tips), 0) t
     FROM papers WHERE author_id = ? AND status = 'published'`,
  )
  .get(bId);
const expectScore = agg.c * 20 + agg.v + agg.t * WEIGHT;
const cells = await pageA
  .locator("table.rank-table tbody tr", { hasText: bName })
  .locator("td")
  .allInnerTexts();
ok(cells[5]?.trim() === String(TIP_CAP), `「获墨银」列 = ${TIP_CAP}（实际 ${cells[5]?.trim()}）`);
ok(
  cells[6]?.trim() === String(expectScore),
  `学绩分含墨银权重：${expectScore} = ${agg.c}×20 + ${agg.v} + ${agg.t}×${WEIGHT}`,
);

// ---- [10] 列表页显示获币徽章 ----
console.log("\n[10] 论文库列表");
await pageA.goto(BASE + "/papers", { waitUntil: "networkidle" });
ok(
  (await pageA.locator("body").innerText()).includes(`墨银 ${TIP_CAP}`),
  "列表条目带「墨银 N」徽章",
);

// ---- 清理 ----
const rows = db.prepare(`SELECT id FROM users WHERE username LIKE '${TEST_PREFIX}%'`).all();
db.prepare(`DELETE FROM users WHERE username LIKE '${TEST_PREFIX}%'`).run();
db.prepare("DELETE FROM rate_limit_windows").run();
console.log(`\n清理测试账号 ${rows.length} 个（级联清掉其论著与账本），用户总数:`, db.prepare("SELECT COUNT(*) c FROM users").get().c);
console.log(`\n===== ${fails === 0 ? "全部通过" : fails + " 项未通过"} =====`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
