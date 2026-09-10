#!/usr/bin/env bash
# 临时只读核验：线上版本 + 站点自检 + 新铃铛逻辑是否已进构建产物（用后即删）
set -u
cd /opt/schola-haagen-dazs || exit 1

echo "=== version.json ==="
cat public/version.json 2>/dev/null
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
echo "=== 新铃铛逻辑是否已在构建产物中（应为非 0） ==="
docker compose exec -T schola sh -c 'echo -n "含 visibilitychange 的 chunk 数: "; grep -rl visibilitychange /app/.next/static 2>/dev/null | wc -l; echo -n "含 msg-bell 的 chunk 数: "; grep -rl "msg-bell" /app/.next/static 2>/dev/null | wc -l' < /dev/null

echo
echo "=== 容器状态 ==="
docker compose ps < /dev/null
