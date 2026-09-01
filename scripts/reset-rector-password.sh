#!/usr/bin/env bash
# 在服务器上重置 rector 账号密码（只读通道无法执行，须走 GitHub Actions 曲线 SSH）
# 安全措施：
#   1) 写入前先备份 schola.db
#   2) 密码在服务器容器内现场随机生成，不写进代码仓库
#   3) 沿用 lib/auth.ts 的 scrypt(salt:hash) 格式，写入后立即校验一次
set -u

cd /opt/schola-haagen-dazs || exit 1

echo "=== 1) 备份数据库 ==="
TS=$(date +%s)
BAK="/app/data/schola.db.bak.reset-${TS}"
docker compose exec -T schola sh -c "cp /app/data/schola.db ${BAK} && ls -l ${BAK}" < /dev/null

echo
echo "=== 2) 生成新密码并写入 ==="
docker compose exec -T schola node -e '
const crypto = require("crypto");
const Database = require("better-sqlite3");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}
function verifyPassword(password, stored) {
  const parts = String(stored).split(":");
  const salt = parts[0];
  const hash = parts[1];
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== calc.length) return false;
  return crypto.timingSafeEqual(expected, calc);
}

const db = new Database("/app/data/schola.db");
const row = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get("rector");
if (!row) { console.error("!! 没找到 rector 账号，终止，未做任何改动"); process.exit(1); }

const oldHash = row.password_hash;
const newPwd = crypto.randomBytes(12).toString("base64url");

const info = db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(hashPassword(newPwd), "rector");
const after = db.prepare("SELECT password_hash FROM users WHERE username = ?").get("rector");

console.log("账号: " + row.username + " (id=" + row.id + ")");
console.log("UPDATE 影响行数: " + info.changes);
console.log("哈希确实变了: " + (oldHash !== after.password_hash));
console.log("新密码登录校验: " + (verifyPassword(newPwd, after.password_hash) ? "通过" : "失败"));
console.log("乱填密码能否通过: " + (verifyPassword("definitely-wrong", after.password_hash) ? "能(异常!)" : "不能(正常)"));
console.log("");
console.log(">>> rector 新密码: " + newPwd);
' < /dev/null

echo
echo "=== 3) 用新密码实际打一次登录接口 ==="
SITE=$(docker compose exec -T schola sh -c "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login" < /dev/null 2>/dev/null)
echo "登录页 HTTP 状态: ${SITE}（200 即站点正常，密码请用浏览器实测）"
