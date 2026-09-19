#!/usr/bin/env bash
# 临时诊断 2：查 ai_calls 里的失败记录 + 用长输入复现「空内容」（用完即删）
set -uo pipefail
cd /opt/schola-haagen-dazs || exit 1

echo "=== 1) ai_calls 最近 8 条（含 token 用量）==="
docker compose exec -T schola node -e '
const Database = require("better-sqlite3");
const db = new Database("/app/data/schola.db", { readonly: true });
const rows = db.prepare("SELECT id, thread_id, status, error, model, prompt_tokens, completion_tokens, length(question) AS qlen, created_at FROM ai_calls ORDER BY id DESC LIMIT 8").all();
for (const r of rows) console.log(JSON.stringify(r));
const agg = db.prepare("SELECT status, COUNT(*) c FROM ai_calls GROUP BY status").all();
console.log("按状态汇总: " + JSON.stringify(agg));
db.close();
' < /dev/null

echo
echo "=== 2) 长输入复现：同一帖文，分别给 max_tokens=1500 / 4000 ==="
docker compose exec -T schola node -e '
const base = (process.env.AI_BASE_URL || "").replace(/\/+$/, "");
const para = "论乳脂之冷与知性之甜：冷食之甘，非徒口腹之欲，实为感官与理念之中介。";
const longPost = new Array(70).fill(para).join("");
console.log("输入帖文字数: " + longPost.length);
async function tryOnce(tag, maxTokens) {
  const body = {
    model: process.env.AI_MODEL,
    messages: [
      { role: "system", content: "你是「学正」，沙藏学馆的学术点评人。就所给帖文作一段简评，300 字以内。" },
      { role: "user", content: "帖文如下：\n\n" + longPost },
    ],
    max_tokens: maxTokens,
    stream: false,
  };
  const t0 = Date.now();
  const r = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.AI_API_KEY },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  const ch = j && j.choices && j.choices[0];
  const content = ch && ch.message ? String(ch.message.content || "") : "";
  console.log(tag + " → HTTP " + r.status + " | " + (Date.now() - t0) + "ms | finish_reason=" + (ch && ch.finish_reason) + " | 正文长度=" + content.length + " | usage=" + JSON.stringify((j && j.usage) || {}));
}
(async () => {
  await tryOnce("max_tokens=1500（当前代码值）", 1500);
  await tryOnce("max_tokens=4000（拟改值）  ", 4000);
})();
' < /dev/null
