#!/usr/bin/env bash
# 临时诊断：学正线上报「模型服务暂时不可用」到底卡在哪一步（用完即删）
set -uo pipefail
cd /opt/schola-haagen-dazs || exit 1

echo "=== 1) 容器日志里的 [ai] 行（最近 20 条）==="
docker compose logs --tail 800 schola 2>/dev/null | grep -a "\[ai\]" | tail -20

echo
echo "=== 2) 复现 app 的载荷（system+user、max_tokens=1500），看回包结构 ==="
docker compose exec -T schola node -e '
const base = (process.env.AI_BASE_URL || "").replace(/\/+$/, "");
const body = {
  model: process.env.AI_MODEL,
  messages: [
    { role: "system", content: "你是「学正」，沙藏学馆的学术点评人。" },
    { role: "user", content: "请就这一帖讲一句话。" },
  ],
  max_tokens: 1500,
  stream: false,
};
fetch(base + "/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.AI_API_KEY },
  body: JSON.stringify(body),
})
  .then(async (r) => {
    console.log("HTTP:", r.status);
    const t = await r.text();
    if (!r.ok) { console.log("错误回包:", t.slice(0, 400)); return; }
    const j = JSON.parse(t);
    const ch = j.choices && j.choices[0];
    console.log("finish_reason:", ch && ch.finish_reason);
    console.log("message 的字段名:", ch && ch.message ? Object.keys(ch.message).join(", ") : "(无 message)");
    console.log("content 类型/长度:", ch && ch.message ? typeof ch.message.content + " / " + String(ch.message.content || "").length : "-");
    console.log("usage:", JSON.stringify(j.usage || {}));
    console.log("回包(截断 700):", t.slice(0, 700));
  })
  .catch((e) => console.log("请求失败:", e.name, e.message));
' < /dev/null
