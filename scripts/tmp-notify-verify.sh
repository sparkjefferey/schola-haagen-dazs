#!/usr/bin/env bash
# 临时只读核验：线上新表是否建成 + 站点自检（用后即删）
set -u
cd /opt/schola-haagen-dazs || exit 1

echo "=== version.json ==="
cat public/version.json 2>/dev/null
echo

echo "=== notifications 表结构（容器内 DB） ==="
docker compose exec -T schola node -e '
const D = require("better-sqlite3");
const db = new D("/app/data/schola.db", { readonly: true });
const cols = db.prepare("PRAGMA table_info(notifications)").all();
if (!cols.length) { console.log("!! 表不存在"); }
else {
  console.log(cols.map(c => c.name + " " + c.type).join("\n"));
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = \x27index\x27 AND tbl_name = \x27notifications\x27").all();
  console.log("索引: " + idx.map(r => r.name).join(", "));
  console.log("现有提醒条数: " + db.prepare("SELECT COUNT(*) c FROM notifications").get().c);
}
console.log("库内用户数: " + db.prepare("SELECT COUNT(*) c FROM users").get().c);
console.log("库内论题数: " + db.prepare("SELECT COUNT(*) c FROM threads").get().c);
' < /dev/null

echo
echo "=== 站点自检（容器内 node fetch） ==="
docker compose exec -T schola node -e '
const hit = async (p) => {
  const r = await fetch("http://127.0.0.1:3000" + p, { redirect: "manual" });
  return r.status + (r.headers.get("location") ? " -> " + r.headers.get("location") : "");
};
(async () => {
  console.log("home=" + (await hit("/")));
  console.log("login=" + (await hit("/login")));
  console.log("forum=" + (await hit("/forum")));
  console.log("messages_anon=" + (await hit("/messages?with=notices")));
  const r = await fetch("http://127.0.0.1:3000/api/messages/unread");
  console.log("unread_api=" + r.status + " " + (await r.text()));
})();
' < /dev/null

echo
echo "=== 容器状态 ==="
docker compose ps < /dev/null
