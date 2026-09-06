#!/usr/bin/env bash
# 临时：部署后自检（HTTP 可用性 + 新表是否就位 + 容器日志尾部）。用完即删。
set -u
cd /opt/schola-haagen-dazs || exit 1

echo "=== 1) 站点首页 HTTP 状态 ==="
curl -s -o /dev/null -w "首页: %{http_code}\n" http://127.0.0.1:3000/ < /dev/null
curl -s -o /dev/null -w "论文库: %{http_code}\n" http://127.0.0.1:3000/papers < /dev/null
curl -s http://127.0.0.1:3000/version.json < /dev/null || true
echo

echo "=== 2) 数据库新表是否建好 ==="
docker compose exec -T schola node -e '
const Database = require("better-sqlite3");
const db = new Database("/app/data/schola.db", { readonly: true });
const t = db.prepare("SELECT name FROM sqlite_master WHERE type=? AND name LIKE ?").all("table", "paper_%");
console.log("相关表:", JSON.stringify(t.map(r => r.name)));
const c = db.prepare("PRAGMA table_info(paper_attachments)").all().map(x => x.name);
console.log("paper_attachments 列:", JSON.stringify(c));
console.log("论文数:", db.prepare("SELECT COUNT(*) n FROM papers").get().n, "| 用户数:", db.prepare("SELECT COUNT(*) n FROM users").get().n);
' < /dev/null

echo
echo "=== 3) 容器日志尾部（最近 15 行） ==="
docker compose logs --tail 15 --no-color schola < /dev/null
