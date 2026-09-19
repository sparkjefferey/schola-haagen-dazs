#!/usr/bin/env bash
# 临时核查：学正（AI 点评）在线上是否真的开馆（用完即删）
# 只读；密钥只报长度与哈希前缀，绝不打印明文。
set -uo pipefail
cd /opt/schola-haagen-dazs || exit 1

echo "=== 版本 ==="
cat public/version.json

echo
echo "=== 容器 ==="
docker compose ps

echo
echo "=== 容器内 AI_* 到位情况 ==="
docker compose exec -T schola node -e '
const crypto = require("crypto");
const k = process.env.AI_API_KEY || "";
console.log("AI_API_KEY: 长度 " + k.length + " | sha256[:12] " + (k ? crypto.createHash("sha256").update(k).digest("hex").slice(0,12) : "(空)"));
for (const v of ["AI_BASE_URL","AI_MODEL","AI_DAILY_PER_USER","AI_DAILY_GLOBAL","AI_MAX_CONCURRENT","AI_MAX_INPUT_CHARS","AI_TIMEOUT_MS"]) {
  console.log(v + ": " + (process.env[v] ?? "(未设置)"));
}
' < /dev/null

echo
echo "=== 运行时启动日志（学正是否开馆）==="
docker compose logs --tail 300 schola 2>/dev/null | grep -a "\[ai\]" | tail -3

echo
echo "=== 模型服务连通性（只用 key 问 /models：不产生费用）==="
docker compose exec -T schola node -e '
const base = (process.env.AI_BASE_URL || "").replace(/\/+$/, "");
fetch(base + "/models", { headers: { Authorization: "Bearer " + process.env.AI_API_KEY } })
  .then(async (r) => {
    console.log("GET " + base + "/models → " + r.status);
    const t = await r.text();
    if (r.ok) {
      try { const j = JSON.parse(t); console.log("可用模型: " + (j.data || []).map(m => m.id).join(", ").slice(0, 500)); }
      catch { console.log("回包(截断): " + t.slice(0, 300)); }
    } else {
      console.log("回包(截断): " + t.slice(0, 300));
    }
  })
  .catch((e) => console.log("请求失败: " + e.message));
' < /dev/null

echo
echo "=== 站点自检 ==="
docker compose exec -T schola node -e 'fetch("http://127.0.0.1:3000/forum").then(r=>console.log("GET /forum → " + r.status)).catch(e=>console.log("ERR " + e.message))' < /dev/null
