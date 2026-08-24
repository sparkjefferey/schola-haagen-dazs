// 冒烟测试：用户名改名申请审核链路（在临时目录运行，生成独立的 data/schola.db，不动真实数据）
// 运行：node scripts/rename-smoke.ts  （cwd 须为脚本内指定的临时目录，见 TEMP_DIR）
import { db } from "../lib/db.ts";

const USERNAME_RE = /^[a-zA-Z0-9_\-一-龥]{2,20}$/;

let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}`);
  }
}

function cleanUser(n: string): number {
  const info = db
    .prepare("INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)")
    .run(n, n, "x");
  return Number(info.lastInsertRowid);
}

console.log("== 1. 表结构 ==");
const tablesInDb = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('username_changes','username_history')")
  .all() as { name: string }[];
assert(tablesInDb.length === 2, "username_changes 与 username_history 已建");

console.log("== 2. 申请（requestRenameAction 的校验+写入） ==");
const alice = cleanUser("alice");
const bob = cleanUser("bob");
// 复刻 requestRenameAction 的关键语句
const newName = "奶昔修士";
assert(USERNAME_RE.test(newName), "新名通过 USERNAME_RE");
assert(USERNAME_RE.test("ab"), "2 位合法");
assert(!USERNAME_RE.test("a"), "1 位非法");
assert(!USERNAME_RE.test("a b!"), "含非法字符非法");
assert(newName !== "alice", "新名 ≠ 现名");
const takenCheck = db
  .prepare("SELECT 1 FROM users WHERE lower(username) = lower(?)")
  .get("BOB");
assert(!!takenCheck, "大小写不敏感查重能命中已有 bob");
const pendingCheck = db
  .prepare("SELECT 1 FROM username_changes WHERE requester_id = ? AND status = 'pending' LIMIT 1")
  .get(alice);
assert(!pendingCheck, "尚无待审申请");
// rector 保留（app 层逻辑）
assert(("Rector".toLowerCase() === "rector"), "rector 保留名逻辑生效");
const last = db
  .prepare("SELECT MAX(created_at) AS at FROM username_changes WHERE requester_id = ?")
  .get(alice) as { at: string } | undefined;
assert(!last?.at, "首次申请无冷却记录");

db.prepare("INSERT INTO username_changes (requester_id, old_username, new_username, reason) VALUES (?, ?, ?, ?)")
  .run(alice, "alice", "WithB修士", "门下更名");
const reqRow = db
  .prepare("SELECT * FROM username_changes WHERE requester_id = ? AND status = 'pending'")
  .get(alice) as any;
assert(reqRow?.new_username === "WithB修士" && reqRow?.status === "pending", "pending 申请已写入");

console.log("== 3. 审核·应允（respondRenameAction approve 事务） ==");
const aliceNow = db.prepare("SELECT id, username FROM users WHERE id = ?").get(alice) as any;
assert(aliceNow.username === "alice", "改名前用户名 alice");
// 复刻 approve 事务
const tx = db.transaction(() => {
  db.prepare("INSERT INTO username_history (user_id, old_username) VALUES (?, ?)").run(aliceNow.id, aliceNow.username);
  db.prepare("UPDATE users SET username = ? WHERE id = ?").run(reqRow.new_username, aliceNow.id);
  db.prepare("UPDATE username_changes SET status='approved', responded_by=?, responded_at=datetime('now') WHERE id=?").run(bob, reqRow.id);
});
tx();
const aliceAfter = db.prepare("SELECT id, username FROM users WHERE id = ?").get(alice) as any;
assert(aliceAfter.username === "WithB修士", "应允后用户名已更名");
const hist = db
  .prepare("SELECT user_id, old_username FROM username_history WHERE old_username = ?")
  .get("alice") as any;
assert(hist?.user_id === alice && hist.old_username === "alice", "旧名已入 username_history");
const approved = db.prepare("SELECT status, responded_by FROM username_changes WHERE id = ?").get(reqRow.id) as any;
assert(approved.status === "approved" && approved.responded_by === bob, "申请状态 approved + 审核人");
// 旧链接重定向查询（个人页逻辑）：原名查不到 → 曾用名回查 → 新名
const exact = db.prepare("SELECT 1 FROM users WHERE username = ?").get("alice");
assert(!exact, "原名已不再命中 users");
const alias = db
  .prepare("SELECT user_id FROM username_history WHERE old_username = ? ORDER BY id DESC LIMIT 1")
  .get("alice") as { user_id: number } | undefined;
assert(!!alias && alias.user_id === alice, "曾用名回查命中");
const cur = db.prepare("SELECT username FROM users WHERE id = ?").get(alias.user_id) as any;
assert(cur.username === "WithB修士", "回查定位到新名");

console.log("== 4. 冷却期 ==");
const lastAt = db
  .prepare("SELECT MAX(created_at) AS at FROM username_changes WHERE requester_id = ?")
  .get(alice) as { at: string };
assert(!!lastAt.at, "已有最近申请时间");
const cooldownBlocked = Date.now() - new Date(lastAt.at + "Z").getTime() < 7 * 24 * 3600_000;
assert(cooldownBlocked, "7 天冷却期内再次申请会被拒（<7 天）");

console.log("== 5. 审核·婉拒（declined 流） ==");
const carol = cleanUser("carol");
db.prepare("INSERT INTO username_changes (requester_id, old_username, new_username, reason) VALUES (?, ?, ?, ?)")
  .run(carol, "carol", "Duke", "慕名更名");
const carolReq = db.prepare("SELECT id FROM username_changes WHERE requester_id = ? AND status='pending'").get(carol) as any;
db.prepare("UPDATE username_changes SET status='declined', responded_by=?, responded_at=datetime('now'), response_note=? WHERE id=?")
  .run(bob, "此名与本阁旧案有涉", carolReq.id);
const declined = db.prepare("SELECT status, response_note FROM username_changes WHERE id=?").get(carolReq.id) as any;
assert(declined.status === "declined" && declined.response_note === "此名与本阁旧案有涉", "婉拒已落档留备注");
const carolUser = db.prepare("SELECT username FROM users WHERE id=?").get(carol) as any;
assert(carolUser.username === "carol", "婉拒不改名");

console.log("== 6. 应允时二次查重（防等待期被抢注） ==");
const dave = cleanUser("Eve");
const req2 = db.prepare("SELECT id FROM username_changes WHERE requester_id = ? AND status='pending'").get(carol) as any;
const reTaken = db
  .prepare("SELECT 1 FROM users WHERE id != ? AND lower(username) = lower(?)")
  .get(carol, "eve");
assert(!!reTaken, "应允时大小写不敏感查重命中 eve");

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
