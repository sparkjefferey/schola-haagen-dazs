#!/usr/bin/env bash
# 临时实验：模型「思考」能不能调低？（用完即删）
# 同一输入下逐项试参数，只看 status / 思考 token 数 / 正文长度 / 耗时。
set -uo pipefail
cd /opt/schola-haagen-dazs || exit 1

docker compose exec -T schola node -e '
const base = (process.env.AI_BASE_URL || "").replace(/\/+$/, "");
const para = "论乳脂之冷与知性之甜：冷食之甘，非徒口腹之欲，实为感官与理念之中介；然则洞穴之喻，可施于冰柜乎？";
const post = new Array(20).fill(para).join(""); // 约 1000 字
const sys = "你是「学正」，沙藏学馆的学术点评人。就所给帖文作一段简评，300 字以内。";

const variants = [
  { tag: "1 基线（不带任何参数）        ", extra: {} },
  { tag: "2 reasoning_effort=low       ", extra: { reasoning_effort: "low" } },
  { tag: "3 reasoning_effort=minimal   ", extra: { reasoning_effort: "minimal" } },
  { tag: "4 reasoning_effort=none      ", extra: { reasoning_effort: "none" } },
  { tag: "5 enable_thinking=false      ", extra: { enable_thinking: false } },
  { tag: "6 换模型 deepseek-v4-pro     ", extra: {}, model: "deepseek-v4-pro" },
];

async function run(v) {
  const body = Object.assign(
    {
      model: v.model || process.env.AI_MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: "帖文如下：\n\n" + post + "\n\n【请托】\n@学正 点评" },
      ],
      max_tokens: 6000,
      stream: false,
    },
    v.extra,
  );
  const t0 = Date.now();
  const r = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.AI_API_KEY },
    body: JSON.stringify(body),
  });
  const raw = await r.text();
  let j = null;
  try { j = JSON.parse(raw); } catch { /* 非 JSON */ }
  const ms = Date.now() - t0;
  if (!r.ok) {
    console.log(v.tag + "→ HTTP " + r.status + " | " + ms + "ms | " + raw.slice(0, 180).replace(/\s+/g, " "));
    return;
  }
  const ch = j && j.choices && j.choices[0];
  const usage = (j && j.usage) || {};
  const reasoning = usage.completion_tokens_details ? usage.completion_tokens_details.reasoning_tokens : "?";
  const content = ch && ch.message ? String(ch.message.content || "") : "";
  console.log(
    v.tag + "→ HTTP 200 | " + ms + "ms | 思考 " + reasoning + " | 正文 " + content.length +
    " 字 | 总 completion " + usage.completion_tokens + " | finish=" + (ch && ch.finish_reason),
  );
}

(async () => { for (const v of variants) await run(v); })();
' < /dev/null
