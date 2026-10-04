# 快速安全审计报告（2026-10-02）

- **审计对象**：沙藏学馆全站（`app/`、`lib/`、`middleware.ts`、`next.config.mjs`、`scripts/`、部署配置、Git 历史）
- **审计方式**：静态代码审读 + `npm audit` 依赖扫描 + Git 全历史密钥扫描（147 个提交）
- **总体结论**：**代码层未发现高危漏洞**。认证、注入、XSS、越权、上传、CSRF、限流各条线均为闭环，此前多轮加固（V1/V3/V5/W6 等标记）有效。需处理的问题为 **1 个依赖漏洞、1 个构建上下文卫生问题、若干低危加固项**。
- **本报告只含结论与方案，代码尚未改动。** 每项方案均给出可直接落地的改动点与验证方法。

---

## 一、风险总览

| 编号 | 等级 | 问题 | 位置 | 状态 |
|---|---|---|---|---|
| F1 | 中高 | nodemailer 9.x 存在 HIGH 级已披露漏洞（凭据泄漏 + 多条 DoS） | `package.json` | 待修复 |
| F2 | 中 | `.dockerignore` 缺项，部署私钥与库备份进入 Docker 构建上下文 | `.dockerignore`、`Dockerfile` | 待修复 |
| F3 | 低 | 登录接口时序差异可枚举用户名 | `lib/actions.ts:256` | 待修复 |
| F4 | 低 | 会话 token 明文入库，库/备份泄漏即等于会话泄漏 | `lib/auth.ts` | 待修复 |
| F5 | 低·加固 | 口令下限仅 6 位 | `lib/actions.ts:145` 等 6 处 | 建议 |
| F6 | 低·加固 | `ADMIN_INVITE` 用 `===` 比较，非常数时间 | `lib/actions.ts:176`、`908` | 建议 |
| F7 | 低·运维 | 库备份目录权限与服务器 `.env.bak.*` 累积 | `update.sh`、服务器 | 建议 |
| F8 | 信息 | CSP `script-src 'unsafe-inline'`（已知待办） | `next.config.mjs` | 排期可选 |
| F9 | 信息 | 登录退避在请求内 sleep 最长 60 秒（注释已写明的取舍） | `lib/actions.ts:241` | 可保持现状 |

---

## 二、发现与详细修复方案

### F1【中高】nodemailer 依赖漏洞

**现状**：`npm audit --omit=dev` 报出 nodemailer ≤10.0.8 的 5 条 advisory，其中最严重的：

- **GHSA-6vj9-mwq6-2f5v（HIGH）**：进程级 DNS 缓存跨 transport 复用 TLS `servername`，可致跨租户 SMTP 凭据泄漏；
- GHSA-8vvx-rff5-p5rq：嵌套收件人数组绕过深度限制致栈耗尽 DoS；
- GHSA-g57g-f23g-4646 / GHSA-v53p-9fqp-m79j / GHSA-prgh-xp8r-p3m5：地址解析器二次方复杂度等 DoS。

本站 nodemailer 只用于 `lib/email.ts` 的弱口令提醒（`createTransport` + `sendMail`，调用面极小），影响有限，但凭据泄漏一条是真实风险，应升级。

**修复步骤**：

```bash
npm install nodemailer@^10.0.13
npm install -D @types/nodemailer@^10
npm audit --omit=dev        # 预期：0 个生产依赖漏洞
npm run build               # 本地确认编译通过
```

- `lib/email.ts` 使用的 API（`createTransport({host, port, secure, auth})`、`sendMail({from, to, subject, text, html})`)在 v10 中保持稳定，预计无需改代码；升级时对照官方 changelog 过一眼即可。
- **容器内的 node_modules 是构建时烧进去的**，改完必须 `docker compose build && docker compose up -d` 才在线上生效。
- 若配置了 SMTP，升级后触发一次弱口令提醒链路（或至少确认未配置时的静默降级路径不变）。

---

### F2【中】Docker 构建上下文带入私钥与备份

**现状**：`.dockerignore` 未排除 `.deploy-keys/`（部署私钥）、`backups/`（含口令哈希与全部私信的库备份）、`docs/`、`.claude/`、`.workbuddy-ai/`。而 `Dockerfile` 构建阶段执行 `COPY . .`——每次 `docker compose build`，这些文件都会进入构建上下文并被拷入 build 阶段镜像层。

**影响**：最终运行镜像不含这些文件（runner 阶段只拷贝 `.next`/`public` 等），但**构建缓存层里留有私钥与备份**。本站 2026-08-16 曾发生宿主机 root 失陷（见 `docs/security/incidents/`），届时构建缓存即成二次泄漏源；镜像缓存若被导出/推送同样泄漏。

**修复步骤**：

1. `.dockerignore` 追加：

```gitignore
# 私钥、备份与本地文档绝不进入构建上下文
.deploy-keys
backups
docs
.claude
.workbuddy-ai
.github
*.sqlite
*.sqlite-shm
*.sqlite-wal
.env.bak.*
```

2. 在服务器上清掉已受污染的旧缓存层：

```bash
docker builder prune -f
```

3. **轮换部署密钥**（建议执行，成本低）：私钥已长期存在于构建缓存中，按「视为可能已暴露」处理——生成新密钥对，更新 GitHub secret `DEPLOY_KEY` 与服务器 `~/.ssh/authorized_keys` 中对应行，废弃旧钥。

**验证**：`docker build` 成功、镜像内确认无上述文件（`docker run --rm <img> ls -la /app`）；GitHub Actions 部署链路（ssh-probe / set-ai-key）照常工作。

---

### F3【低】登录时序差异枚举用户名

**现状**：`lib/actions.ts:256`：

```ts
if (!row || !verifyPassword(password, row.password_hash)) {
```

用户名不存在时短路跳过 scrypt（约百毫秒量级），响应明显更快，可据此批量探测哪些用户名真实存在，配合社工提高撞库命中率。

**修复**：`lib/actions.ts` 模块顶部加一个哑哈希（`hashPassword` 已在该文件 import），失败分支前补一次等价计算：

```ts
/** 时序抹平：查无此人时也对哑哈希跑一遍 scrypt，使两种失败的响应耗时一致。 */
const DUMMY_HASH = hashPassword("schola-timing-equalizer");
```

```ts
  if (!row) verifyPassword(password, DUMMY_HASH); // 时序抹平，勿删
  if (!row || !verifyPassword(password, row.password_hash)) {
    // …原失败逻辑不变…
```

**验证**：对存在/不存在的用户名各发错误口令请求，响应时间差收敛到噪声范围内；`npm run e2e:register` 等登录相关回归通过。

---

### F4【低】会话 token 明文入库

**现状**：`lib/auth.ts:87-95` 把 cookie 里的原始 token 存入 `sessions.token`。数据库文件及 `update.sh` 落盘的每份备份一旦被读走（参照 F2 与 2026-08 事故背景），攻击者可直接拿现成会话冒充任何人，包括掌门。

**方案 B（推荐）：只存摘要 + 懒迁移，无人被登出**

表结构不变，只改值的形态。`lib/auth.ts`：

```ts
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** 会话小票只存 SHA-256 摘要：库文件/备份泄漏时不再直接等于有效会话。 */
export function sessionTokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

```ts
export function createSession(userId: number): string {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)").run(
    userId,
    sessionTokenDigest(token),   // ← 原为 token
    expireAt(SESSION_DAYS),
  );
  return token;
}

export function destroySession(token: string) {
  // 双条件兼容尚未懒迁移的旧明文行
  db.prepare("DELETE FROM sessions WHERE token = ? OR token = ?").run(
    sessionTokenDigest(token),
    token,
  );
}
```

```ts
export async function getSessionUser(): Promise<SafeUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const now = new Date().toISOString();
  let session = db
    .prepare("SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?")
    .get(sessionTokenDigest(token), now) as { user_id: number } | undefined;
  if (!session) {
    // 懒迁移：升级前按明文存的旧小票，命中即顺手改存摘要（幂等，无需停机）
    session = db
      .prepare("SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?")
      .get(token, now) as { user_id: number } | undefined;
    if (session) {
      db.prepare("UPDATE sessions SET token = ? WHERE token = ?").run(sessionTokenDigest(token), token);
    }
  }
  if (!session) return null;
  return lookupUser(session.user_id);
}
```

另有一处直接比对 token 的调用点必须同步——`lib/actions.ts:936`（改密保留当前会话）：

```ts
// requireLogin 已把当前会话懒迁移为摘要，此处按摘要排除即可
db.prepare("DELETE FROM sessions WHERE user_id = ? AND token IS NOT ?").run(
  me.id,
  sessionTokenDigest(token ?? "__none__"),
);
```

（`sessionTokenDigest` 需从 `lib/auth.ts` import 进 `actions.ts`；`scripts/incident-reset-access.mjs` 只整表 `DELETE`，不受影响。）

**方案 A（最简替代）**：部署摘要版后直接跑 `npm run security:reset-access` 清空全部会话，全员重登一次，然后不要写懒迁移分支。小站可接受，但会打扰所有在线用户——故推荐方案 B。

**验证**：登录 → 重启容器 → 刷新仍在线（懒迁移生效）；登出后旧 cookie 失效；改密后其他设备被踢；`sessions.token` 中不再出现 64 位明文 hex 以外的形态（新行应为 64 位 hex 摘要）。

---

### F5【低·加固】口令下限仅 6 位

**现状**：注册与改密只要求 ≥6 位（`lib/actions.ts:145`、`:929`），纯数字/重复串也能通过；弱口令提醒（`notifyWeakPassword`）只是事后通知，不拦截。

**修复**：下限提到 8 位，并拒绝纯数字口令。两处服务端检查改为：

```ts
if (password.length < 8 || password.length > 256) redirect(`/register?e=pass${roleTab}`);
if (/^\d+$/.test(password)) redirect(`/register?e=pass${roleTab}`);
```

```ts
if (next.length < 8 || next.length > 256) redirect(`/users/${enc(me.username)}?e=pwdlen`);
if (/^\d+$/.test(next)) redirect(`/users/${enc(me.username)}?e=pwdlen`);
```

**必须同步的用户文案（6 处，防前后端口径不一）**：

| 文件 | 行 | 现文案 |
|---|---|---|
| `lib/register-errors.ts` | 16 | `pass` → "密码至少 6 位。" |
| `app/register/register-form.tsx` | 45 | 客户端校验 `password.length < 6` |
| `app/register/register-form.tsx` | 350 | placeholder "至少 6 位；建议 12 位以上" |
| `app/users/[username]/change-password-form.tsx` | 33 | label "新口令（至少 6 位…）" |
| `app/users/[username]/change-password-form.tsx` | 49 | "新口令至少 6 位" |
| `lib/actions.ts` | 145 / 929 | 服务端阈值本身 |

`lib/password-strength.ts` 无需改动（评分口径已偏好 ≥8/≥12）。

**验证**：`npm run e2e:register`（注册全链路回归，含弱口令场景如有覆盖）；手工试 6 位口令被拒、8 位通过。

---

### F6【低·加固】`ADMIN_INVITE` 非常数时间比较

**现状**：`lib/actions.ts:176`、`:908` 用 `process.env.ADMIN_INVITE === invite` 比较管理者邀请码。字符串比较随首个差异字节提前返回，理论上构成时序侧信道。实用风险很低（网络抖动远大于单字节比较差），但修复成本同样极低。

**修复**：`lib/governance.ts` 增加助手（先定长哈希再比较，连长度差都不泄漏）：

```ts
import { createHash, timingSafeEqual } from "node:crypto";

/** 环境变量邀请码的常数时间比较：两侧各做一次 SHA-256 后比对定长摘要。 */
export function safeEnvInvite(code: string, expected: string | undefined): boolean {
  if (!expected || !code) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(code), digest(expected));
}
```

两处调用点替换：

```ts
// registerUser（原 176 行）
const valid = consumeInvite(invite, "admin") || safeEnvInvite(invite, process.env.ADMIN_INVITE);

// claimAdminAction（原 908 行）
const valid = consumeInvite(code, "admin") || safeEnvInvite(code, process.env.ADMIN_INVITE);
```

**验证**：`ADMIN_INVITE` 正确/错误/为空三种情形下注册管理者与自助就任路径行为不变。

---

### F7【低·运维】备份与服务器密钥备份文件的权限与清理

**现状**：

- `update.sh` 把库备份写进项目目录 `backups/`，文件含口令哈希与全部私信，目录权限未收紧；
- `scripts/set-ai-key.sh` 每次在服务器生成 `.env.bak.<stamp>`，其中含真实 SMTP/AI 密钥，**只增不删**。

**修复**：

1. `update.sh` 备份段收紧权限（`mkdir` 之后、写文件之前）：

```bash
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
umask 077   # 使本次会话内创建的备份文件为 600
```

2. 服务器上一次性清理并加保留策略（例：只留最近 3 份密钥备份、库备份保留 30 天）：

```bash
cd /opt/schola-haagen-dazs
ls -1t .env.bak.* 2>/dev/null | tail -n +4 | xargs -r rm -f
find backups/ -name 'schola-data-preupdate-*.sqlite' -mtime +30 -delete
chmod 700 backups/
```

3. 该清理可并入既有运维节奏（`update.sh` 或 CI 体检脚本）定期执行。

**验证**：`ls -la backups/` 文件权限 600；服务器 `.env.bak.*` 数量受控。

---

### F8【信息·排期可选】CSP `script-src 'unsafe-inline'`

**现状**：`next.config.mjs` 因 Next App Router 的 RSC 引导脚本需内联而放开 `'unsafe-inline'`（注释已列为待办）。本站没有任何用户 HTML 渲染路径（React 全量转义、`object-src 'none'`），实际风险很小。

**方案（建议单独排期，改动面较大）**：改用 per-request nonce——

1. 在 `middleware.ts` 生成 nonce（Edge 环境可用 `crypto.randomUUID()`），写入请求头 `x-nonce`，并在**响应**上输出含 `'nonce-<值>' 'strict-dynamic'` 的 CSP 头；
2. Next.js 检测到 CSP 头后会自动给自家内联脚本加同一 nonce；
3. 从 `next.config.mjs` 的 `headers()` 中移除 CSP（其余安全头保留），dev 分支继续放行 `'unsafe-eval'`；
4. 全量回归 `npm run e2e`（CSP 收紧最易误伤水合）。

收益是即使未来出现注入点也难以执行脚本；不紧急。

---

### F9【信息·可保持现状】登录退避占用请求线程

`lib/actions.ts:241-243`：同一用户名累计失败 ≥15 次后，后续每次尝试在请求内 `setTimeout` 等待 30–60 秒。这是注释写明的取舍（宁延迟不锁死账号，避免任何人锁他人的号）。可指出的副作用：受害者本人此时登录也会被拖慢 30–60 秒，且每个等待占住一条连接。

**可选优化**（不作为建议强制）：把等待移到「验证失败之后」再返回，正确口令永不延迟；或将上限从 60 秒降到 15 秒。若维持现状，无需改动。

---

## 三、已验证的安全基线（通过项）

以下各条线经审读确认**无需改动**：

- **SQL 注入**：全部参数化；唯一动态表名走固定白名单映射（`createReportAction`）。
- **XSS**：全站无 `dangerouslySetInnerHTML`/`eval`；`lib/md.tsx` 仅产出 React 文本节点；CSP 含 `object-src 'none'`、`frame-ancestors 'self'` 等纵深。
- **越权（IDOR）**：全部 Server Action 先 `requireLogin`/`requireAdmin`；未刊稿正文与附件同口径（仅作者/掌门，404 不泄漏存在性）；AI 调用在执行前对稿件状态二次复核。
- **文件上传**：扩展名白名单 + 魔数双校验、随机存储名 + 正则白名单 + 路径前缀校验、配额原子复核、HTML/SVG 永不入白名单、下载强制 `nosniff` 与白名单 Content-Type。
- **认证与会话**：scrypt + `timingSafeEqual`；设备桶/用户名全局桶/算式验证码三层爆破防线；注册蜜罐 + 验证码 + IP/全局限流；改密吊销其他会话；封禁即吊销全部会话；创始人保护完整。
- **CSRF**：middleware 强制 POST 带 Origin（封死无 Origin 绕过）+ cookie `SameSite=Lax` + Next 内建校验。
- **AI 调用**：密钥只在服务端 env；用户文本包标签并声明「材料非指令」；个人/全站双额度闸 + 并发闸；失败文案泛化不回吐上游细节。
- **密钥卫生**：Git 全历史（147 提交）扫描无明文密钥；`.env`/`data`/`backups`/`.deploy-keys` 均已 gitignore；CI 密钥经 GitHub secrets + stdin 下发，不进命令行与日志。
- **部署面**：容器只绑 `127.0.0.1`、非 root 运行、`/_next/image` 直接 404、UFW 仅放行 SSH、Cloudflare Tunnel 出向连接。
- **PII**：作者注册邮箱虽在 `getPaper` 对象中，但未渲染、未传入任何客户端组件（RSC 序列化面已核对）。

## 四、建议修复顺序与回归

1. **F2**（`.dockerignore` + `docker builder prune` + 轮换部署钥）——1 分钟改动，优先做；
2. **F1**（nodemailer 升级 + 重建镜像 + `npm audit --omit=dev` 清零）；
3. **F3**（时序抹平，两行）；
4. **F6**（常数时间比较，一个小助手函数）；
5. **F4**（会话摘要 + 懒迁移；上线后确认懒迁移日志/行为）；
6. **F5**（口令下限 + 6 处文案同步）；
7. **F7**（备份权限与清理，可并入运维节奏）；
8. **F8**（CSP nonce，单独排期）。

每项落地后运行全量回归：`npm run e2e`、`npm run e2e:register`、`npm run e2e:papers`、`npm run e2e:coins`、`npm run e2e:find-friend`、`npm run e2e:ai`，再 `docker compose build && docker compose up -d` 上线。

## 附录：审计覆盖范围

- 逐行审读：`lib/auth.ts`、`lib/actions.ts`、`lib/db.ts`、`lib/queries.ts`、`lib/ai.ts`、`lib/attachments.ts`、`lib/rate-limit.ts`、`lib/captcha.ts`、`lib/governance.ts`、`lib/coins.ts`、`lib/email.ts`、`lib/md.tsx`、`lib/scholar/sources.ts`（URL 构造）、`lib/username.ts`、`middleware.ts`、`next.config.mjs`、全部 `app/api/**` 路由、`app/papers/[id]/page.tsx`、`app/admin/page.tsx`、`Dockerfile`、`docker-compose.yml`、`deploy.sh`、`update.sh`、`scripts/set-ai-key.sh`、`.github/workflows/set-ai-key.yml`。
- 模式扫描：危险渲染/执行（`dangerouslySetInnerHTML`、`eval`、`new Function`、`child_process`）、会话表全部读写触点、密钥形态字符串。
- 工具扫描：`npm audit`（生产 + 开发依赖）、Git 全历史密钥扫描。
