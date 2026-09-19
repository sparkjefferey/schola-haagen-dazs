/**
 * 本地「桩模型服务」—— 冒充一个 OpenAI 兼容的 chat/completions 端点，
 * 供 e2e 用真实链路跑学正（AI 点评）而**不花一分钱、不发一个字节到真服务**。
 *
 * 用法（两种）：
 *   1. 单独起：node scripts/ai-stub-server.mjs          # 监听 127.0.0.1:3999
 *   2. 由 e2e 内嵌起（见 scripts/e2e-ai.mjs），同一进程里跑，跑完即关。
 *
 * 站点侧须以 AI_BASE_URL=http://127.0.0.1:3999/v1 启动，否则请求会打到真服务上去。
 *
 * 控制面（仅供测试脚本用）：
 *   POST /__control  {"mode":"ok|error|slow|garbage|inject"}   切换应答模式
 *   GET  /__state                                       读模式与**收到的全部请求体**
 *   POST /__reset                                       清空记录并回到 ok
 *
 * 模式说明：
 *   ok      正常应答，正文里带「（桩答）」字样，并回带 usage（供记账断言）
 *   error   HTTP 500（上游故障 → 可重试的 failed）
 *   slow    先睡 5 秒再答（配合站点 AI_TIMEOUT_MS 小值可测超时）
 *   garbage 返回一段非 JSON 正文（解析失败 → failed）
 *   inject  正文里塞 <script>、markdown 链接、超长文本（测渲染与限长）
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

export const STUB_PORT = Number(process.env.AI_STUB_PORT ?? 3999);

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function answer(text) {
  return {
    id: "stub-1",
    object: "chat.completion",
    model: "stub-model",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
  };
}

export function createStub() {
  const state = { mode: "ok", requests: [] };

  const reply = (res) => {
    if (state.mode === "error") return json(res, 500, { error: { message: "stub upstream error" } });
    if (state.mode === "garbage") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end("这不是 JSON");
    }
    if (state.mode === "inject") {
      const long = "长".repeat(900);
      return json(
        res,
        200,
        answer(
          `（桩答）<script>window.__x = 1</script>\n\n[点我](javascript:alert(1))\n\n` +
            `**引语**如下：\n\n> 桩服务的应答\n\n${long}`,
        ),
      );
    }
    const last = state.requests[state.requests.length - 1]?.payload;
    const ask = String(last?.messages?.find((m) => m.role === "user")?.content ?? "").slice(-80);
    const body = state.mode === "slow" ? `（桩答·慢）${ask}` : `（桩答）学正看过这段材料了。${ask}`;
    if (state.mode === "slow") return setTimeout(() => json(res, 200, answer(body)), 5000);
    return json(res, 200, answer(body));
  };

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/__control") {
        try {
          state.mode = JSON.parse(body || "{}").mode ?? "ok";
        } catch {
          state.mode = "ok";
        }
        return json(res, 200, { ok: true, mode: state.mode });
      }
      if (req.method === "GET" && req.url === "/__state") {
        return json(res, 200, { mode: state.mode, requests: state.requests });
      }
      if (req.method === "POST" && req.url === "/__reset") {
        state.mode = "ok";
        state.requests = [];
        return json(res, 200, { ok: true });
      }
      if (req.method === "POST" && /\/chat\/completions$/.test(req.url ?? "")) {
        let payload = null;
        try {
          payload = JSON.parse(body);
        } catch {
          /* 保留 null，测试里能看出请求体不是 JSON */
        }
        // 只留测试需要的那几项；Authorization 一并记下，便于断言密钥没有外泄进正文
        state.requests.push({ url: req.url, authorization: req.headers.authorization ?? "", payload });
        return reply(res);
      }
      json(res, 404, { error: "not found" });
    });
  });

  return { server, state };
}

/** 起桩并等它就绪。 */
export function startStub(port = STUB_PORT) {
  const { server, state } = createStub();
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({ server, state, port }));
  });
}

// 直接 `node scripts/ai-stub-server.mjs` 时起一个常驻的，便于手工联调
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { port } = await startStub();
  console.log(`[ai-stub] 桩模型服务已起于 http://127.0.0.1:${port}/v1（模式 ok）`);
}
