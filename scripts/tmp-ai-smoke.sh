#!/usr/bin/env bash
# 临时烟测：最小一次真实对话调用（max_tokens=1），确认账户可用（余额/权限），用完即删。
# 只打印状态码与回包摘要，绝不打印密钥。
set -uo pipefail
cd /opt/schola-haagen-dazs || exit 1

echo "=== 最小对话调用（max_tokens=1）==="
docker compose exec -T schola node -e '
const base = (process.env.AI_BASE_URL || "").replace(/\/+$/, "");
const t0 = Date.now();
fetch(base + "/chat/completions", {
  method: "POST",
  headers: { Authorization: "Bearer " + process.env.AI_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: process.env.AI_MODEL,
    messages: [{ role: "user", content: "回复一个字：好" }],
    max_tokens: 1,
  }),
})
  .then(async (r) => {
    const ms = Date.now() - t0;
    console.log("POST " + base + "/chat/completions → " + r.status + " (" + ms + "ms)");
    const t = await r.text();
    if (r.ok) {
      try {
        const j = JSON.parse(t);
        console.log("回包 model: " + j.model + " | 有 choices: " + Array.isArray(j.choices) + " | 用量: " + JSON.stringify(j.usage || {}));
      } catch { console.log("回包(截断): " + t.slice(0, 200)); }
    } else {
      console.log("错误回包(截断): " + t.slice(0, 300));
    }
  })
  .catch((e) => console.log("请求失败: " + e.message));
' < /dev/null

echo
echo "=== 站点仍在服务 ==="
docker compose exec -T schola node -e 'fetch("http://127.0.0.1:3000/forum").then(r=>console.log("GET /forum → " + r.status))' < /dev/null
