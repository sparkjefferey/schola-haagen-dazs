#!/usr/bin/env bash
# 只读：列出站点用户（不含密码哈希）。
# 由 GitHub Actions 通过 ssh 'bash -s' 喂进来执行，本地不要直接跑。
set -u

cd /opt/schola-haagen-dazs || exit 1

docker compose exec -T schola node -e '
const Database = require("better-sqlite3");
const db = new Database("/app/data/schola.db", { readonly: true });
const rows = db.prepare(
  "SELECT id, username, display_name, role, root, status, endorsed, created_at FROM users ORDER BY id"
).all();
console.log("用户总数: " + rows.length);
console.log("");
console.log("id\tusername\t显示名\trole\troot\tstatus\tendorsed\t注册时间");
for (const r of rows) {
  console.log([r.id, r.username, r.display_name, r.role, r.root, r.status, r.endorsed, r.created_at].join("\t"));
}
console.log("");
const founder = rows.filter((r) => r.root === 1);
console.log("创始人(root=1): " + (founder.length ? founder.map((r) => r.username).join(", ") : "无"));
db.close();
'
