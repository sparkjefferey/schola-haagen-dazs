#!/usr/bin/env bash
# ============================================================
#  沙藏学馆 · 管理员口令重置脚本（服务器本地执行）
#
#  特点：
#   - 口令由脚本随机生成（20 位，含大小写/数字/符号，剔除 0O1lI 等易混字符）
#   - 口令不落盘、不进仓库、不经过任何第三方，只在终端打印一次
#   - 与站点 lib/auth.ts 完全同格式：salt:scrypt(64)
#   - 顺带吊销该账号全部会话（把可能还在线的旧会话/他人会话踢下线）
#   - 写入审计日志，便于事后追溯
#
#  用法（在服务器项目目录里）：
#      cd /opt/schola-haagen-dazs
#      git pull
#      bash scripts/reset-admin-password.sh            # 默认重置 rector
#      bash scripts/reset-admin-password.sh Selina      # 重置指定用户名
#
#  执行前会先备份数据库到 backups/（失败即中止）
# ============================================================
set -eu

TARGET="${1:-rector}"

echo "=========== 沙藏学馆 · 管理员口令重置 ==========="
echo "目标账号: $TARGET"
echo ""

# 1) 先备份，失败就停
echo ">> 备份数据库..."
mkdir -p /opt/schola-haagen-dazs/backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="/opt/schola-haagen-dazs/backups/schola-pre-reset-$STAMP.sqlite"
docker compose -f /opt/schola-haagen-dazs/docker-compose.yml exec -T schola node -e '
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");
const source = new Database("/app/data/schola.db", { readonly: true, fileMustExist: true });
const target = path.join(os.tmpdir(), `schola-${crypto.randomUUID()}.sqlite`);
(async () => {
  try {
    await source.backup(target);
    source.close();
    process.stdout.write(fs.readFileSync(target));
    fs.rmSync(target, { force: true });
  } catch (e) {
    try { source.close(); } catch {}
    fs.rmSync(target, { force: true });
    console.error(e.message);
    process.exitCode = 1;
  }
})();
' > "$BACKUP"
if [ ! -s "$BACKUP" ]; then
  rm -f "$BACKUP"
  echo "!! 备份失败或为空，已中止，未改动任何数据。"
  exit 1
fi
echo "   备份完成: $BACKUP"
echo ""

# 2) 重置口令
echo ">> 重置口令并吊销旧会话..."
docker exec -i schola-haagen-dazs node -e '
const crypto = require("node:crypto");
const Database = require("better-sqlite3");
// 兼容 node -e 'code' arg 与 node file.js arg 两种调用：取最后一个位置参数
const cliArgs = process.argv.slice(1);
const target = cliArgs[cliArgs.length - 1] || "rector";
const db = new Database("/app/data/schola.db");

const row = db.prepare("SELECT id, username, role, root FROM users WHERE username = ?").get(target);
if (!row) {
  console.error(`!! 找不到账号: ${target}`);
  process.exit(2);
}

// 生成 20 位强口令（剔除 0 O 1 l I 等易混字符）
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
const bytes = crypto.randomBytes(20);
let pw = "";
for (let i = 0; i < 20; i++) pw += ALPHABET[bytes[i] % ALPHABET.length];

// 与 lib/auth.ts 同格式
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(pw, salt, 64).toString("hex");

db.transaction(() => {
  db.prepare("UPDATE users SET password_hash = ?, status = ?, banned_reason = ? WHERE id = ?")
    .run(`${salt}:${hash}`, "active", "", row.id);
  // 归一化为唯一始祖+管理员（先清掉别人的 root，避免触发 users(root) 唯一索引）
  db.prepare("UPDATE users SET root = 0 WHERE id != ? AND root != 0").run(row.id);
  db.prepare("UPDATE users SET role = ?, root = 1 WHERE id = ?").run("admin", row.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);
  db.prepare("DELETE FROM login_attempts WHERE username = ?").run(target);
  try {
    db.prepare(
      "INSERT INTO audit_log (actor_id, action, target, detail) VALUES (NULL, ?, ?, ?)"
    ).run("security.password_reset", "users", `CLI 重置口令并吊销全部会话：user#${row.id} ${target}`);
  } catch (e) {
    console.log("（审计日志写入跳过：" + e.message + "）");
  }
})();

console.log("");
console.log("  账号: " + row.username + "  (user#" + row.id + ")");
console.log("");
console.log("  >>> 新口令（只显示这一次，请立刻抄下来）<<<");
console.log("");
console.log("      " + pw);
console.log("");
console.log("  已同时：吊销该账号全部会话、清空其登录失败计数、恢复为管理员权限。");
db.close();
' "$TARGET"

echo ""
echo "=========== 完成 ==========="
echo "请立刻用新口令登录，登录后建议到个人页再改成自己记得住的口令。"
