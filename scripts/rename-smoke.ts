// 用户名改名冒烟测试：始终在临时目录创建独立数据库，不会触碰项目或生产数据。
// 运行：node scripts/rename-smoke.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const USERNAME_RE = /^[a-zA-Z0-9_\-一-龥]{2,20}$/;
const originalCwd = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schola-rename-smoke-"));
process.chdir(tempDir);

const { db, findUsernameClaim } = await import("../lib/db.ts");

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

try {
  console.log("== 1. 隔离与表结构 ==");
  // macOS 会把 /var 等路径规范化成 /private/var，比较真实路径避免符号链接误报。
  assert(fs.realpathSync(process.cwd()) === fs.realpathSync(tempDir), "测试数据库位于临时目录");
  const tablesInDb = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('username_changes','username_history')")
    .all() as { name: string }[];
  assert(tablesInDb.length === 2, "username_changes 与 username_history 已建");
  const historyIndex = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_username_history_old_nocase'")
    .get();
  assert(!!historyIndex, "曾用名大小写不敏感索引已建");

  console.log("== 2. 申请与并发保护 ==");
  const alice = cleanUser("alice");
  const bob = cleanUser("bob");
  const newName = "奶昔修士";
  assert(USERNAME_RE.test(newName), "中文新名通过命名规则");
  assert(USERNAME_RE.test("ab"), "2 位用户名合法");
  assert(!USERNAME_RE.test("a"), "1 位用户名非法");
  assert(!USERNAME_RE.test("a b!"), "含空格或特殊符号非法");
  assert(findUsernameClaim("BOB")?.userId === bob, "现用名查重不区分 ASCII 大小写");
  assert("Rector".toLowerCase() === "rector", "rector 保留名逻辑生效");

  const insertPending = db.prepare(
    `INSERT INTO username_changes (requester_id, old_username, new_username, reason)
     SELECT ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM username_changes WHERE requester_id = ? AND status = 'pending'
     )`,
  );
  const firstRequest = insertPending.run(alice, "alice", "WithB修士", "门下更名", alice);
  const duplicateRequest = insertPending.run(alice, "alice", "另一个名字", "重复提交", alice);
  assert(firstRequest.changes === 1, "首份待审申请写入成功");
  assert(duplicateRequest.changes === 0, "并发或重复待审申请被原子拒绝");

  const reqRow = db
    .prepare("SELECT * FROM username_changes WHERE requester_id = ? AND status = 'pending'")
    .get(alice) as any;
  assert(reqRow?.new_username === "WithB修士", "待审申请内容保持正确");

  console.log("== 3. 审核应允与旧链接 ==");
  const aliceNow = db.prepare("SELECT id, username FROM users WHERE id = ?").get(alice) as any;
  const approve = db.transaction(() => {
    const decided = db.prepare(
      `UPDATE username_changes
       SET status='approved', responded_by=?, responded_at=datetime('now')
       WHERE id=? AND status='pending'`,
    ).run(bob, reqRow.id);
    assert(decided.changes === 1, "管理员原子认领待审申请");
    db.prepare(
      `INSERT INTO username_history (user_id, old_username)
       SELECT ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM username_history WHERE lower(old_username) = lower(?)
       )`,
    ).run(aliceNow.id, aliceNow.username, aliceNow.username);
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(reqRow.new_username, aliceNow.id);
  });
  approve();

  const aliceAfter = db.prepare("SELECT username FROM users WHERE id = ?").get(alice) as any;
  assert(aliceAfter.username === "WithB修士", "应允后用户名已更改");
  const oldClaim = findUsernameClaim("ALICE");
  assert(oldClaim?.userId === alice && oldClaim.source === "history", "旧名大小写变体仍指向原账号");
  assert(oldClaim?.currentUsername === "WithB修士", "旧链接可定位当前用户名");
  assert(findUsernameClaim("alice")?.userId !== bob, "他人不能认领曾用名");
  assert(findUsernameClaim("alice")?.userId === alice, "本人仍拥有自己的曾用名，可申请改回");

  console.log("== 4. 冷却期 ==");
  const lastAt = db
    .prepare("SELECT MAX(created_at) AS at FROM username_changes WHERE requester_id = ?")
    .get(alice) as { at: string };
  const cooldownBlocked = Date.now() - new Date(`${lastAt.at}Z`).getTime() < 7 * 24 * 3600_000;
  assert(cooldownBlocked, "7 天冷却期内再次申请会被拒");

  console.log("== 5. 婉拒与二次查重 ==");
  const carol = cleanUser("carol");
  insertPending.run(carol, "carol", "Duke", "慕名更名", carol);
  const carolReq = db
    .prepare("SELECT id FROM username_changes WHERE requester_id = ? AND status='pending'")
    .get(carol) as any;
  const declined = db.prepare(
    `UPDATE username_changes
     SET status='declined', responded_by=?, responded_at=datetime('now'), response_note=?
     WHERE id=? AND status='pending'`,
  ).run(bob, "此名与本阁旧案有涉", carolReq.id);
  const declinedAgain = db.prepare(
    "UPDATE username_changes SET status='declined' WHERE id=? AND status='pending'",
  ).run(carolReq.id);
  assert(declined.changes === 1, "首次婉拒成功落档");
  assert(declinedAgain.changes === 0, "同一申请不能被第二位管理员重复处置");
  const carolUser = db.prepare("SELECT username FROM users WHERE id=?").get(carol) as any;
  assert(carolUser.username === "carol", "婉拒不会修改用户名");

  const eve = cleanUser("Eve");
  assert(findUsernameClaim("eve")?.userId === eve, "应允前二次查重能命中现用名");
  assert(findUsernameClaim("Alice")?.userId === alice, "应允前二次查重能命中曾用名");

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exitCode = fail > 0 ? 1 : 0;
} finally {
  db.close();
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
}
