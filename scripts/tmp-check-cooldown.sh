#!/usr/bin/env bash
# 临时只读核查：冷静期配置、用户与稿件现状（用完即删）
set -uo pipefail
cd /opt/schola-haagen-dazs || exit 1

echo "=== 冷静期配置 ==="
docker compose exec -T schola printenv COOL_DOWN_HOURS < /dev/null

echo "=== 版本 ==="
cat public/version.json 2>/dev/null

echo "=== 数据库现状 ==="
docker compose exec -T schola node -e '
const Database = require("better-sqlite3");
const db = new Database("/app/data/schola.db", { readonly: true });
const one = (sql) => db.prepare(sql).get();
console.log("用户总数:", one("SELECT COUNT(*) c FROM users").c);
console.log("最近注册:", JSON.stringify(db.prepare("SELECT id, username, endorsed, root, created_at FROM users ORDER BY id DESC LIMIT 5").all()));
console.log("稿件总数:", one("SELECT COUNT(*) c FROM papers").c);
console.log("按状态:", JSON.stringify(db.prepare("SELECT status, COUNT(*) c FROM papers GROUP BY status").all()));
console.log("附件总数:", one("SELECT COUNT(*) c FROM paper_attachments").c);
db.close();
' < /dev/null

echo "=== 站点自检 ==="
docker compose exec -T schola node -e 'fetch("http://127.0.0.1:3000/papers/new").then(r=>console.log("GET /papers/new →", r.status)).catch(e=>console.log("ERR", e.message))' < /dev/null
