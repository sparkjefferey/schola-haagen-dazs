# 沙藏学馆 · 对抗式安全测试报告（Adversarial Security Report）

> **范围提示**：本文件主要记录应用层对抗测试和修复建议，不作为宿主机 root 失陷入口的最终归因报告。涉及旧主机状态的描述须由离线磁盘证据复核。

> 编制：安全员（对抗式生成，模拟攻击者视角）
> 日期：2026-08-16（v3：新增第 7 节「高级威胁模型」；V1/V3/W3/W4 已修复并附回归记录）
> 背景：生产 VPS 昨日遭入侵（SSH 密钥被盗 → root shell 沦陷），本次以攻击者身份对本站进行
> 静态代码审计 + 本地沙箱动态攻击验证，产出本报告供修复 agent 与其他协作 agent 使用。
>
> **本报告中的 PoC 仅用于本站防御修复，测试均在本地沙箱（临时目录）完成，未触碰生产系统。**
>
> **威胁模型（v2 升级）**：对手为高水平黑客且配备 AI agent 辅助；**源码对其完全公开**
> （本仓库 GitHub 为 PUBLIC，见 §7.1）→ 报告假设对手拥有完整源码、可本地复现应用、
> 可自动化批量利用。口令复杂度不再纳入考虑（管理员将使用强口令，故 V2 降级为次要项，
> 但 V1 的锁定绕过对**所有**账号依旧无差别生效）。

---

## 1. 测试环境与方法

| 项 | 说明 |
|---|---|
| 应用 | Schola Haagen-Dazs（Next.js 15 App Router + better-sqlite3），本仓库当前代码 |
| 沙箱 | 复制到 `/var/folders/.../T/opencode/schola-sim/`，独立测试库（data/schola.db），种子账号 rector/sokrates/plato + 攻击测试账号 weak6、attacker1 |
| 运行模式 | `next build && next start`（**生产模式**，与 VPS 容器一致）；登录锁定用例另在 dev 模式复验 |
| 工具 | curl（multipart 表单直调 Server Action）、Playwright（真实 Chromium 渲染/水合/执行） |
| 范围 | 应用层（认证/授权/注入/XSS/CSRF/限速/越权/信息泄露）+ 主机层（失陷路径复盘） |

**Server Action 直调要点**：本站表单均为 `multipart/form-data` + `$ACTION_ID_<hash>` 隐藏字段；
攻击者可从公开页面 HTML 中抓取该字段，因此**所有表单型 Server Action 均可被脚本/跨站表单直接调用**。

---

## 2. 漏洞总览

| # | 严重度 | 漏洞 | 验证方式 | 状态 |
|---|---|---|---|---|
| V1 | 🔴 高 | 登录锁定可被 `X-Forwarded-For` 伪造绕过 → 在线暴力破解 | 动态复现 ×2 模式 | ✅ **已修复**（见「V1 修复记录」） |
| V2 | 🔴 高 | 口令策略过弱（最短 6 位、无复杂度）| 动态复现（123456 注册成功）| ✅ **已缓解**（软提示：注册/改密实时显示口令风险等级，弱口令仍可用但明确建议加强）|
| V3 | 🟠 中 | CSRF：无 `Origin` 头的请求绕过 Next 内置校验 | 动态复现（无 Origin 登录成功）| ✅ **已修复**（见「V3 修复记录」） |
| V4 | 🟠 中 | 用户名/账号状态枚举（注册/登录反馈差异）| 动态复现 | **未修复** |
| V5 | 🟠 中 | 阅读量可无限刷 → 学榜分可操纵 | 动态复现（25 刷 = +25 views）| ✅ **已修复**（每 IP×论文 10 分钟计 1 次）|
| V6 | 🟡 低 | 注册单 IP 限流可被 XFF 绕过（仅剩全局桶）| 静态 + 代码逻辑 | **未修复** |
| V7 | 🟡 低 | 会话 Cookie 无 `__Host-` 前缀、`Secure` 依赖可伪造头 | 静态 + 响应头确认 | **未修复** |
| V8 | 🟡 低 | CSP `script-src 'unsafe-inline'` 削弱 XSS 防线 | 静态（响应头确认）| **未修复** |
| V9 | 🟡 低 | dev 模式与 CSP 冲突（客户端水合失败）+ 生产跑 dev 的隐患 | 动态复现 | **未修复** |
| V10 | 🟡 低 | 部署密钥权限过重（=root 直通）且私钥躺在项目目录 | 静态 | **未修复** |
| V11 | 🟢 信息 | `/version` 公开完整 commit 哈希；消息页可枚举任意用户 ID/显示名 | 动态 | 低 |
| W1 | 🟠 中 | 僵尸账号资源耗尽（注册无验证码/邮箱，可 48 账号/时批量 → 审稿/检举/论坛洪泛）| 静态测算 + 机制验证 | ✅ **已缓解**（注册算式验证码 + 限流改 SQLite 持久化，重启不清零）|
| W2 | 🟠 中 | 未认证登录洪泛 = 同步 scrypt 阻塞事件循环（低配 VPS 上单点可全站 DoS）| 动态基准 + 代码分析 | ⚠️ 部分缓解（W4 已收窄输入，登录限流仍可被绕过 → 仍待修复）|
| W3 | 🟠 中 | 恢复脚本不清理攻击者植入的伪管理员账号（root 期写库 → 重装后仍可登录行使管理权）| 代码审读 | ✅ **已修复**（见 §8.5 修复记录） |
| W4 | 🟢 低 | `/login` 的 password 无长度上限（与注册/改密的 256 上限不一致）| 静态 | ✅ **已修复** |
| W5 | 🟢 低 | 仓库公开 → `.env.example` 暴露机制（ADMIN_INVITE 等）；`/version` 完整 commit 供 diff 挖洞 | 事实确认 | 建议改私有 |
| W6 | 🟢 低 | 学林检索全站无总速率 → 多账号放大 5x 外部 API 调用/服务器并发 | 静态 | ✅ **已修复**（`scholar:global` 120 次/10 分钟，仅缓存未命中计数，真人无感）|
| W7 | 🟢 确认 | git 历史无私钥/口令泄露；CI 已 SHA 固定+手动触发+拒绝 root+指纹校验；`x-pathname`/`x-client-ip` 中间件强制覆盖不可伪造 | 全历史扫描 + 动态 | — |

**未发现**（经验证安全）：SQL 注入（全参数化）、存储型 XSS（React 全转义）、越权访问后台（middleware+requireAdmin 双层）、
未邀请函注册管理员、未认证私信管理员、路径穿越、依赖漏洞（`npm audit` 0 漏洞）、SSRF（上游 URL 硬编码）、
未刊论文越权查看（`papers/[id]` 对非作者/非管理员未刊稿 404）、git 历史密钥泄露（W7）、
`x-pathname`/`x-client-ip` 头伪造、伪 root 持久化（DB 层 root 标记每次启动被 `repairSingleFounder` 归一化）。
**附注**：登录响应时序在本机（scrypt ~0.5ms）无法可靠区分账号存在与否，未将时序枚举列为漏洞；低配 VPS 上该信号会增强，可作为纵深项关注。

---

## 3. 漏洞详情

### V1 🔴 登录锁定可被 X-Forwarded-For 伪造绕过（暴力破解）—— ✅ 已修复

**位置**：
- `middleware.ts:16-23` — 客户端可自带头部：`x-forwarded-for` 存在即取第一段注入 `x-client-ip`
- `lib/actions.ts:49-59`（`clientIp()`）— 优先信任 `x-client-ip`
- `lib/auth.ts:29-48`（`isLocked`/`recordFailedAttempt`）— 锁定桶以 `(ip, username)` 为键

**根因**：锁定计数键里的 `ip` 完全由客户端可控（middleware 注释也承认"直连时客户端可伪造这两个头"）。
攻击者只需轮换 `X-Forwarded-For` 值，即可获得无限次尝试；同一用户名在不同伪造 IP 下各自独立计数。
Cloudflare 隧道下 `X-Forwarded-For` 由边缘**追加**真实 IP，取第一段仍是攻击者可控值，故**隧道模式同样可绕过**。

**动态证据（生产模式沙箱）**：
```
无 XFF：第 6 次错误口令 → /login?e=locked        （锁定生效）
旋转 XFF(5.5.5.1~7)：连续 7 次 → 全部 /login?e=bad （锁定从未触发）
已锁定的 rector 换 XFF 继续试探 → e=bad（继续可试）
```

**攻击链**：V1 + V2（弱口令）→ 对任意账号（含管理员）无限次在线爆破。
管理员改用强口令后，V1 仍是 P0：① 对普通学者账号无差别生效（站内大量 6 位口令注册用户；
② 为后续社工/定向攻击提供任意账号接管；③ 僵尸账号体系（W1）依赖注册，而锁定绕过使其
全自动批量注册+爆破成为可能。

**修复建议（P0）**：
1. 只信任可信代理注入的地址：直连时用 `connection remoteAddress`（Next 直连模式可用 `request.headers` 之外注入）；
   经 cloudflared 时改取 `cf-connecting-ip`（cloudflared 会设置该头且不可伪造）；XFF 一律取**最后一跳**而非第一段。
2. 锁定计数改为**按用户名全局累计**（跨 IP），或按 `ip` 与 `username` 双桶取并集；
   或引入失败次数全局计数器（防多 IP 僵尸网络，注册侧已有此思想）。
3. 附加：失败超阈值后加入递增退避（如 1s/2s/4s...），管理员账号强制 12+ 位复杂口令（见 V2）。

### V1 ✅ 修复记录（2026-08-16）

**已实施**：
1. `middleware.ts` — 可信客户端 IP 提取重写：优先 `CF-Connecting-IP`（Cloudflare 边缘写入，经
   cloudflared 不可伪造）；否则取 `X-Forwarded-For` **最后一项**（直连时 Next.js 服务端会把真实
   socket IP 追加到 XFF 末尾，客户端伪造段在前被忽略；实测 `::ffff:127.0.0.1` 正确入桶）；
   再退回 `x-real-ip` / `"local"`。
2. `lib/actions.ts loginAction` — 登录限流重构（SQLite 持久化，成功即清零）：
   - **设备桶** `login:ip:<指纹>`：同一真实 IP 累计 10 次失败 / 15 分钟 → 锁该设备 15 分钟
     （锁"设备"不锁"账号"，多用户名扫探也会触发）。
   - **用户名全局桶** `login:user:<username>`：全站同一用户名累计 15 次失败 / 15 分钟后，
     **不再锁死账号**（那会让任何人拿他人用户名错试 15 次即将其锁 15 分钟），改为每次
     尝试递增等待 30s/1m/2m/4m/1m（封顶 60s，`peekFixedWindow` 只读计数）：正常用户永远能
     登录（最多等 1 分钟），攻击者爆破速度上限约 60 次/小时；换 IP 轮换也无法绕开总量限制。
3. **验证码门（真人校验）**：同一 (IP, 用户名) 失败达 3 次（`CAPTCHA_FAILS`）后，继续尝试
   必须先答对一道本地生成的算式（`lib/captcha.ts`，无第三方依赖）：答案存 `rate_limit_windows`
   一次性使用（校验即删）、5 分钟过期、绑定用户名防跨账号复用。答错/不带验证码一律弹回
   验证码页。**只拦"正在狂试的那一方"**——受害者的设备无失败记录，登录全程不受影响。
   这一层把"并发批量喂错"的成本从"每次 8 秒"抬高到"每次先取题再答题"，
   并让既有 5 次单 IP 锁（MAX_FAILS）在验证码门之后仍正常生效。
4. `loginAction` password 截断至 256（与注册/改密一致，W4）。

**沙箱回归（生产模式重建后，全部 PASS）**：
```
无 Origin POST          → 403（V3）
同 IP 错 10 次          → 第 11 次 e=locked（设备锁）
5 用户名各错 2 次(10次) → 第 11 次 e=locked（设备锁跨用户名生效）
换设备同用户名错试      → e=bad（设备锁只锁设备，不锁账号）
15 台设备各错 1 次      → 第 16 次等待 30s 且仍 e=bad（全局桶退避而非锁账号）
超阈值后正确登录        → 成功（等 30s），成功后全局桶/设备桶清零
清零后再次错试          → 即时响应（无残留延迟）
第 1/2 次错密码         → e=bad；第 3 次起 → e=captcha&u=（验证码门）
答对验证码+正确密码     → 成功登录，全部计数清零
答对验证码+错密码       → 计数 +1 并弹回验证码页（计数 ≥3 期间每次都要证明）
不带/答错验证码         → 弹回验证码页，出新题
同一验证码二次使用      → 拒绝（一次性）
受害者本机登录          → 全程无验证码
答验证码累计 5 次失败   → 正确密码也被锁 15 分钟（MAX_FAILS 仍生效）
Playwright 真实浏览器    → 登录 ✓ → 投稿入库 /papers/1 ✓ → 游客读论坛 ✓
```

**残余风险（已接受）**：① 攻击者可对某用户持续错试使其登录被递增延迟拖慢，或答对算式后继续
爆破（每次限 1 次/分，**无法锁死账号**）；② `CF-Connecting-IP` 仅在「请求必经过 cloudflared」
的生产拓扑下不可伪造（本部署 Docker 仅绑 127.0.0.1 满足该前提）；③ 算式验证码防"脚本批量喂错"
有余、防"能解析页面并计算的人工攻击者"不足——那是 CAPTCHA 服务商（人机识别）的战场，本站
规模下算术题已把自动化成本抬高到不划算。

---

### 防脚本加固记录（2026-08-16，W1 缓解 + V5 修复）

**已实施**：
1. **注册验证码**（W1）：`app/register/page.tsx` 每次渲染生成一道算式（`lib/captcha.ts` 复用），
   客户端表单新增 `captcha_id`/`captcha_answer` 字段；`registerUser` 校验不过即 `e=captcha`。
   一次性 + 5 分钟过期，机器人无法预取囤积；真人注册多敲两个数字。
2. **注册限流持久化**（W1/W2 关联）：`reg:global`（8/10 分钟）与 `reg:<IP指纹>`（3/10 分钟）
   从**内存 Map** 改为 SQLite `consumeFixedWindow`——重启/重新部署不再清零，
   多实例天然共享（`lib/actions.ts` 删除内存版 `rateLimited`）。
3. **阅读量限速**（V5）：`incrementViewsAction` 增加 `view:<IP指纹>:<paperId>` 桶，
   每 IP×论文 10 分钟计 1 次；正常阅读无感，换号狂刷无法再刷高学榜分。
4. **检索全站总闸**（W6）：`/api/scholar/search` 在**缓存未命中**（真正打上游 API）时消耗
   `scholar:global`（120 次/10 分钟，`SCHOLAR_GLOBAL_RATE_LIMIT` 可调），多账号僵尸无法
   再放大外部调用成本；缓存命中不计数，真人无感。
5. **注册蜜罐**：注册表单加 `display:none` 的隐藏字段（人类不可见、无障碍友好），
   被填即视作机器走 `e=captcha` 流程；不记仇不封禁，触发者重试即自愈。
6. **口令风险等级提示**（V2 软提示版）：新增 `lib/password-strength.ts` 纯函数评分
   （字符类别 4 分 + 长度 ≥8/≥12/≥16 共 3 分 + 全同字符惩罚），注册与改密表单
   输入时实时显示"弱/中/强/极强"与建议文案（`components/password-strength-hint.tsx`）。
   **保持建议制不强制**：最低 6 位门槛不变，123456 仍可注册，但界面明确提示风险。

**沙箱回归（生产模式，全部 PASS）**：
```
注册页必含算式验证码
答错/不带验证码注册  → e=captcha 拒绝
答对验证码注册成功   → 跳转 /login?registered=
同一验证码二次使用   → 拒绝（一次性）
同 IP 第 4 次注册    → e=regrate（SQLite 持久化防刷）
新账号登录           → 正常
连刷论文详情页 10 次 → 阅读数只 +1（V5 修复）
蜜罐字段对真人不可见 → 填了即 e=captcha 拒绝；不填则正常注册
检索全站总闸         → 第 4 个新查询 429 + 友好提示（沙箱限额调 3 验证）
口令风险提示         → 123456=弱 / abc12345=中 / 12位混合=强 / 16位混合=极强；
                       弱口令仍可注册（建议制），改密页同样实时提示
```

---
---

### V2 🔴 口令策略过弱

**位置**：`lib/actions.ts:86`（注册 `password.length < 6`）、`lib/actions.ts:628`（改密同 6 位）、
`app/register/register-form.tsx:52`（`minLength={6}` 提示语"至少 6 位"）

**动态证据**：Playwright 真实浏览器注册 `weak6 / 123456`（6 位纯数字）→ `login?registered=weak6` 成功，随后 `weak6/123456` 登录成功。

**影响**：与 V1 组合成完整爆破链。仅 6 位数字 ≈ 10^6 组合，脚本毫秒级可扫完。

**修复建议（P0）**：注册/改密最小长度提到 12+ 位；管理员注册强制 16 位 + 复杂度（大小写/数字/符号）；
历史弱口令无法强制改（站内无找回），可在下轮公告 + 管理员单独改密。同时更新 `register-form.tsx` 的 `minLength` 与提示文案。

---

### V3 🟠 CSRF：无 `Origin` 头的请求绕过 Next.js 内置校验

**位置**：`lib/actions.ts` 全部 Server Action（无显式 Origin 校验，依赖 Next 内置）。
Next.js 15 内置 CSRF 校验规则：`Origin` 与 `Host` 不匹配 → 拒绝（500）；**缺失 `Origin` → 放行**。

**动态证据（生产模式）**：
```
POST /login  Origin: http://evil.com        → 500（被拦）
POST /login  Origin: null (sandbox iframe)  → 500（被拦）
POST /login  无 Origin 头                    → 303 → /（登录成功，可执行任意动作）
```

**触发条件**：旧版 WebView（微信/QQ 早期 X5 内核）、某些安全代理/沙箱 iframe 不发 `Origin` 头。
本项目明确面向微信/QQ WebView 用户，此条件并非空想。

**攻击链**（无 Origin 场景）：跨站表单（攻击者已从公开 HTML 抓取 `$ACTION_ID_`）可令受害者：
登出、发私信、删自己的帖/文、发帖；若受害者是管理员——封禁/恢复账号、退稿/录用/刊印论文、颁谕令、改文案。
其中"删帖/封号/退稿"等具破坏性。

**修复建议（P1）**：在 `lib/actions.ts` 增加显式校验（对每个入口或统一 helper）：
```ts
import { headers } from "next/headers";
export async function assertSameOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  if (origin && !new URL(origin).host.startsWith(h.get("host") ?? "")) throw new Error("CSRF");
  // 无 Origin 时按业务风险决定：破坏性动作强制要求 Origin 存在
}
```
至少对治理类动作（封禁/录用/刊印/删帖/删文/谕令）强制要求 `Origin` 且与 Host 一致。

### V3 ✅ 修复记录（2026-08-16）

**已实施**：`middleware.ts` 在 Next 内置 Origin 校验**之前**兜底：所有 `POST` 且缺失 `Origin`
头的请求直接 403（浏览器发起的任何 POST 都必带 `Origin`，同源/跨源皆然，因此不影响正常用户）。

**沙箱回归**：
```
curl 无 Origin POST /login        → 403
curl 带 Origin POST /login        → 303 → /（正常登录，不受影响）
Playwright 真实浏览器登录→投稿    → 全部成功（中间件不干扰正常 Action 链路）
```

**残余说明**：脚本类直调（curl）带 Origin 即可继续直调——那是"任意调用方"模型，非 CSRF 威胁模型；
CSRF 防御只针对浏览器跨站场景，已由「无 Origin→403 + Next 内置 Origin 不匹配→500」双层闭环。

---

### V4 🟠 用户名/账号状态枚举

**位置**：`lib/actions.ts:95-96`（注册已存在 → `?e=taken`）、`lib/actions.ts:140-142`（登录封禁 → `?e=banned`）

**动态证据**：注册 `rector` → `register?e=taken`；不存在用户名则进入密码流程（提示不同）。

**影响**：攻击者可枚举出全部已注册用户名（爆破目标清单、社会工程素材），并识别被禁账号。

**修复建议（P2）**：注册失败统一提示"用户名不可用或已被占用"；登录失败对"账号不存在/口令错误/已被封禁"
统一返回 `?e=bad`，把"已封禁"详情仅放在 `/banned` 页（需已登录被拒时才展示）。

---

### V5 🟠 阅读量无限刷 → 学榜分操纵

**位置**：`lib/actions.ts:531-540`（`incrementViewsAction`，仅排除作者本人，无任何限流）

**动态证据**：weak6 连续刷新论文 1 页面 25 次 → views 132→157（每次 +1）。学榜分 = 论文数×20 + 总阅读，
任意登录账号可用脚本把目标论文/目标作者刷上榜首，或把他人论文刷到数据失真。

**修复建议（P2）**：服务端按 `(user_id, paper_id)` 限流（如每 IP/账号 24h 只计 1 次，复用 `consumeFixedWindow`）；
更严格做法：只计匿名或首次访问。

---

### V6 🟡 注册单 IP 限流可被 XFF 绕过

**位置**：`lib/actions.ts:92-93` — `rateLimited("reg:global", 8, 600_000)` 与 `rateLimited("reg:${ip}", 3, ...)`
**问题**：① `ip` 来自可伪造的 `clientIp()`（同 V1 根因）；② 该函数用的是**内存版** `RATE_LIMITS` Map
（`lib/actions.ts:164-175`），与论坛/私信用的 SQLite 版 `limitAccountAction` 不一致，进程重启即清零。
**现状**：仅剩全局桶 8/10 分钟兜底（单实例下有效），多实例/重启后失效。
**修复建议（P2）**：注册限流并入 SQLite 版（`consumeFixedWindow("reg:global", ...)`），IP 桶改为可信 IP 或按指纹。

---

### V7 🟡 会话 Cookie：无 `__Host-` 前缀，`Secure` 依赖可伪造头

**位置**：`lib/auth.ts:120-134`（`setSessionCookie`）
**证据**：直连 HTTP 登录响应 `Set-Cookie: schola_session=...; Path=/; HttpOnly; SameSite=lax`（无 Secure）。
**现状风险**：生产已只绑 127.0.0.1 + Cloudflare 隧道（HTTPS）→ 风险低；但任何"明文 HTTP 直连 IP:3000"
的临时调试（README/DEPLOY_RECOVER 都提到过改回 `3000:3000` 的做法）都会让会话可被同网段嗅探。
**修复建议（P2）**：加 `__Host-` 前缀（要求 Secure + 无 Domain，本场景天然满足）；同时不再信任
`x-forwarded-proto`，改由可信代理注入（同 V1 方案），或在 `next.config.mjs` 强制 `headers` 补 `Strict-Transport-Security` 即可。

---

### V8 🟡 CSP `script-src 'unsafe-inline'`

**位置**：`next.config.mjs:11`
**现状**：React 全转义已验证挡住 XSS（见"验证过安全"节），`unsafe-inline` 目前无直接受害者；
但它是**单点失效开关**——未来任何一处引入 `dangerouslySetInnerHTML` / DOM sink 即被直接利用。
**修复建议（P2）**：给 Next 注入的 RSC 脚本上 nonce（Next 15 支持 `experimental.scriptProps` 或自建 nonce 中间件），
把 `script-src` 收紧为 `'self' 'nonce-...'`。

---

### V9 🟡 dev 模式与 CSP 冲突 + 生产跑 dev 的隐患

**动态证据**：dev 模式（`next dev`）下浏览器控制台报
`EvalError: ... 'unsafe-eval' is not an allowed source of script: script-src 'self' 'unsafe-inline'`，
**客户端组件全部无法水合**——注册表单变成原生 GET 提交（不生效），站点功能大面积失效。
**隐患**：README 的"公网访问（Cloudflare Tunnel）"方案就是 `npm run dev` 跑在**本机**（可接受），
但若有人在 VPS 上照此操作：① 站点半残；② dev 服务器暴露 `_next/webpack-hmr`、源码映射等攻击面；
③ `NODE_ENV` 非 production 时 Next 的 CSRF/缓存保护也不同。
**修复建议（P2）**：文档明确"VPS 只允许 `next build && next start`（Docker 已如此）；`npm run dev` 仅限本机"；
dev 本地调试时可在 next.config 按 `NODE_ENV` 放开 `unsafe-eval` 或在 dev 下关闭该 CSP 头。

---

### V10 🟡 部署密钥权限过重（=root 直通）

**位置**：`deploy.sh`（5a 写入 `~/.ssh/authorized_keys` 无 `command=` 限制；5c `PermitRootLogin prohibit-password`
**仍允许 root 用密钥登录**）、`.deploy-keys/dmit_deploy_ed25519`（私钥在项目目录，虽 gitignore 且 600）
**问题**：
1. GitHub Actions 的 `DEPLOY_KEY` 一旦泄露（GitHub 侧凭据泄露/工作流被篡改/仓库权限外扩）＝**直接 root shell**；
2. Mac 本地私钥长期躺在项目目录，若目录被同步/备份/共享，等同 root 直通；
3. `harden-host.sh` 第 3 步也提示了 `command=` 限制但未强制执行。
**修复建议（P2）**：
- 新建受限部署用户 `deploy`（无 sudo），authorized_keys 加前缀：
  `command="cd /srv/schola-haagen-dazs && git pull && bash update.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding ssh-ed25519 AAAA...`
- `sshd_config` 改为 `PermitRootLogin no`（彻底禁 root 直登，日常用 `schola` 用户 sudo）；
- 私钥移入 `~/.ssh/`（或密码管理器），项目目录不留；GitHub Secrets 在 Settings 页面开启
  "环境保护规则（Environment protection rules）"并要求协作者批准。

---

### V11 🟢 信息暴露（低）

- `/version` 页 + `/version.json` 公开**完整 commit 哈希**与 GitHub 链接 → 攻击者可精确比对线上代码版本、
  定位未公开修复（0-day 窗口分析）。建议只显示 7 位短哈希，或登录后可见。
- `/messages?with=<id>` 允许任意登录用户枚举任意用户 ID 与显示名（页面从 DB 直查该用户资料）。
  与 `/users/<name>` 公开页信息等价，但配合 ID 顺序可直接爬全站成员名册。低风险，可接受。

---

## 4. 主机层：昨日失陷复盘与现存缺口

### 4.1 失陷路径推断（基于仓库内取证线索）
已知事实：攻击公钥指纹 `DERLxCN6MRokchXQNQPJhN8TsInhv56xYmRUdr7VpDM9`（注释 `root@jefferey-dmit-hk`）
出现在 authorized_keys；后门目录 `/opt/ops`、`sync.sh` 等痕迹；重装后已清除。
最可能路径（按概率排序，无法从仓库完全断定）：
1. **SSH 弱口令暴力破解**：旧系统若 `PasswordAuthentication yes` + 弱 root 口令/弱部署口令 →
   爆破成功后直接以 root 或 sudo 用户落地，写入公钥建立持久化（当前 deploy.sh 已禁密码，堵死此口）；
2. **部署密钥泄露**：旧 `github-actions-deploy` 密钥若曾入库/泄露 → 该密钥在 authorized_keys 中
   = 任意时刻远程 root（V10 问题在旧系统同样存在）；
3. Web 应用 RCE：**本次全量审计未发现**（无 exec/eval/动态 require、SQL 全参数化、无文件上传），排除概率较高；
4. 容器/Docker 暴露：无 TCP 暴露、无特权容器迹象，排除概率高。

### 4.2 现有防护（重装后已落地，保持）
- SSH 禁密码 + `PermitRootLogin no`（harden-host.sh）｜UFW 仅开 22｜应用只绑 127.0.0.1
- 容器内非 root（node 用户）｜Cloudflare Tunnel 收口 HTTPS（隐藏真实 IP）
- `monitor.sh` 绊线（攻击公钥指纹/后门路径/SSH 放宽检测 + 完整性基线）15 分钟 cron
- AIDE/rkhunter（harden-host.sh 安装）、根用户收敛唯一创始掌门、DB 完整性/会话吊销脚本
- 恢复清单（[`../runbooks/INCIDENT_RECOVERY.md`](../runbooks/INCIDENT_RECOVERY.md) / [`../runbooks/DEPLOY_RECOVER.md`](../runbooks/DEPLOY_RECOVER.md)）已形成文档；仍须在干净新系统验证

### 4.3 现存缺口（建议近期补齐）
| 缺口 | 建议 |
|---|---|
| **仓库为 PUBLIC（源码公开）** | 转私有（§7.1）：源码+历史+基础设施配置全部暴露，是一切后续攻击的弹药库 |
| 部署密钥无 `command=` 限制、root 可密钥登录 | 见 V10（P2） |
| 无 fail2ban | SSH 爆破兜底（即便禁密码，还能拦无效用户枚举/防未来回归） |
| 无 unattended-upgrades | 开启安全更新自动安装（Ubuntu unattended-upgrades） |
| 无离线日志 | root 可抹 `/var/log`；把 auth.log/应用日志 rsync 到独立日志机或对象存储 |
| 离线备份未落地 | `BACKUP_TARGET` 是可选参数；建议启用每日 rsync 备份 + DMIT 定时快照 |
| quick tunnel URL 无访问控制 | 知晓 URL 即可访问全站（含管理入口）。建议升级 named tunnel + Access 策略，或至少定期轮换 |
| Docker 镜像不自动更新 | 定期 `docker compose pull && up -d`（update.sh 手动）；镜像哈希固定可查 |
| 恢复脚本不清理伪管理员 | 见 W3（P1） |

---

## 5. 已验证安全（防御纵深盘点，供回归测试基线）

| 项 | 验证结果 |
|---|---|
| SQL 注入 | 用户名/搜索/路由注入 payload（`' OR 1=1--`、`; DROP TABLE`）全部被参数化拦截，无 SQL 错误泄露 |
| 存储型 XSS | `<script>`/`<img onerror>`/`<svg onload>`/`javascript:` 等 payload 发帖后**原样转义展示**，无执行（React 默认转义 + markdown 渲染器纯文本） |
| 后台越权 | 无会话访问 `/admin` → 307 `/login?e=auth`；所有治理 action 均有 `requireAdmin` |
| 管理员注册 | 无邀请函 `role=admin` 注册被拒（`consumeInvite` 原子扣减 + `ADMIN_INVITE` 双通道） |
| 私信管理员防线 | 未认证学者向管理员发私信 → `e=admin_gate` 拦截（三层：endorsed / 互证 / 管理员先发） |
| API 鉴权 | `/api/scholar/search` 未登录 → 401；按账号限流 + 响应头 X-RateLimit-* |
| 路径穿越 | `/users/..%2f..%2fetc`、双重编码穿越 → 全部 404 |
| 会话管理 | HttpOnly + SameSite=lax；封禁即时吊销全部会话；改密吊销其余会话 |
| 口令存储 | scrypt + 随机盐 + `timingSafeEqual` 恒时比较 |
| 依赖 | `npm audit` 0 漏洞（含 dev 全量） |
| 邀请码 | 48bit 随机熵在线不可爆破；`consumeInvite` 单条 SQL 原子扣减防并发超发 |
| 安全头 | CSP/frame-ancestors 'self'/X-Frame-Options DENY/nosniff/Referrer-Policy 齐全 |

---

## 6. 修复优先级路线图

| 优先级 | 事项 | 对应 |
|---|---|---|
| **P0（本周）** | ① ~~登录限流改用不可伪造标识~~ ✅ 已修复 ② 口令策略 12+ 位并更新前端提示 ③ 强制管理员口令 16+ 位（存量管理员公告改密） | V1✅ V2 |
| **P1（两周内）** | ~~治理类 Server Action 显式 Origin 校验~~ ✅ 已修复（中间件全局兜底）；剩余：W1 注册接验证码/邀请制 + 全站投稿总速率、W2 登录洪泛缓解（登录前廉价预校验/代理层限流） | V3✅ W1 W2 |
| **P2（本月）** | 注册反馈统一防枚举；阅读量限流；注册限流入 SQLite；`__Host-` cookie；CSP nonce；dev 模式文档约束；部署密钥 `command=` 限制 + `PermitRootLogin no` + 私钥移出项目目录；fail2ban；离线日志/备份；仓库转私有 | V4-V10, W5 |
| **P3（持续）** | `/version` 短哈希；消息页 ID 枚举收敛；学林检索全站总速率；定期重跑本报告动态用例作回归 | V11, W6 |

---

## 7. 高级威胁模型（v2）：源码公开 + AI agent 辅助的对手

### 8.1 前提：仓库公开 = 对手拥有完整源码

`git remote -v` 确认远程为 `github.com/sparkjefferey/schola-haagen-dazs`，且经 GitHub API 核实
**仓库为 PUBLIC**。这意味着对手（昨日攻击者或任何关注者）：

- 可随时克隆全部源码与历史，**本地离线复现本站**（含攻击所需的全部 `$ACTION_ID_*`、路由、DB schema）；
- 每次部署后可在 1 小时内对新 commit 做 diff 挖掘漏洞（`/version` 页还能确认线上版本与仓库差距）；
- 无需黑盒探测，直接针对 §3 全部发现做精确利用与自动化。

**结论**：一切"靠隐藏"的防御均无效（邀请函格式、路由命名、Action ID、封禁逻辑等）。
本报告所有漏洞均应视为"源码在手"前提下的可利用率。

**动态/事实核查（W7，确认安全）**：
- 全历史扫描（`git rev-list --all` + `git grep`）无 `PRIVATE KEY`、无真实 `.env`、无口令入库；`.deploy-keys/` 自提交起即被 `.gitignore` 覆盖，历史中无该目录任何文件；
- CI 双工作流均固定完整 commit SHA（codeql.yml 用 `pull_request` 而非 `pull_request_target`，无 secret 泄露面；deploy.yml 仅 `workflow_dispatch` 手动触发 + `REBUILT` 输入守卫 + 拒绝 root + 指纹校验）；
- `.next` 生产构建无源码映射文件（仅 Next 内部 edge-runtime map）；
- 动态表名（`createReportAction`）走白名单映射；`x-pathname`/`x-client-ip` 请求头被中间件强制覆盖，伪造注入测试返回中间件真实值（安全）。

### 8.2 对手会如何用 agent 自动化攻击（推演）

1. **批量僵尸账号**：破解 V1 后自动化注册+登录；用 W1 经济模型（§7.3）在数小时内获得
   数十个活跃账号 → 用于刷榜（V5）、审稿/检举/私信洪泛、私信钓鱼管理员。
2. **会话劫持链**：爆破任一普通账号 → 查看其互证网/消息 → 社工或 CSRF（V3，微信/QQ 旧 WebView）→
   升级为管理员会话 → 行使治理权（封号/退稿/删帖/看审计）。
3. **对管理员的定向攻击**：锁定的绕过使管理员账号口令仍可被试探；配合社工信息（名册页
   展示 motto/display_name/created_at）构造字典。
4. **DoS 组合拳**：登录洪泛（W2）+ 学林检索多账号放大（W6）+ 注册洪泛（W1），单点即可打瘫低配 VPS。
5. **post-root 持久化**：若再次取得 root，先植入伪管理员（W3）再清除痕迹——恢复脚本若漏跑/跑错，门户洞开。

### 8.3 W1 僵尸账号资源耗尽（🟠 中）

**机制**（静态 + 已验证）：注册全局桶 `rateLimited("reg:global", 8, 600_000)` 为**内存版**
（`lib/actions.ts:164-175`，进程重启清零），单 IP 桶 3 个/10 分钟可被 XFF 绕过（V6 同根因）。
推算上限：8 账号/10min × 6 批/时 ≈ **48 账号/小时**；每账号 5 稿/时 → **审稿箱 240 稿/时**，
外加论坛刷屏、检举洪泛（每账号 5 检举/日）。无验证码、无邮箱验证、无邀请门槛（学者通道）。

**影响**：管理员人工审稿被工作量淹没（拒绝服务的一种）；论坛公信力受损；垃圾信息污染审计流。

**修复建议（P1）**：
- 注册增加验证码/人机校验（或改为凭 scholar 邀请函入学）；
- 全局注册桶改 SQLite（`consumeFixedWindow`）；
- 全站新增投稿/发帖总速率（如每 10 分钟全站 ≤ N 稿），与个人额度取并集；
- 检举额度按全站当日总量再加一层。

### 8.4 W2 未认证登录洪泛 = 事件循环阻塞 DoS（🟠 中）

**机制**：`loginAction`（`lib/actions.ts:124-148`）对任意未认证请求执行**同步** `scryptSync`，
且 password **无长度上限**（注册/改密上限 256，登录没有）；V1 的锁定绕过使攻击者不被任何限流挡在门外。
沙箱（M 系 Mac，scrypt ~0.5ms）实测 30 并发无明显劣化；但生产为低配 VPS（DMIT 入门款），
单核 scryptSync 约 20-100ms，**20-50 并发即可长时间占满事件循环**，全站页面/动作全部阻塞。
（本机无法复现 VPS 效果，按 scrypt 成本线性外推为条件性高危。）

**修复建议（P1）**：
- `loginAction` 对 password 设长度上限（如 256，与注册一致）；
- 登录前增加廉价预校验（失败后递增退避或滑动验证）；真正的防线是 V1 修复（不可伪造客户端标识 + 全局桶）；
- 代理层（cloudflared 前的 Access / WAF）对 /login 加每来源限速。

### 8.5 W3 恢复流程缺口：伪管理员账号未被清理（🟠 中）

**机制**（代码审读）：`scripts/incident-reset-access.mjs` 只做：清会话、作废邀请函、收敛 root 标记、
完整性检查。**不枚举、不降权 `role='admin'` 账号，不改密**。攻击者 root 期只需
`INSERT INTO users (username, password_hash, role, ...) VALUES ('ghost', '<他知口令的hash>', 'admin', ...)`
（或改任一现有账号 role='admin'），重装恢复后即可凭已知口令登录行使管理权
（无法动创始人，但可封号/退稿/删帖/颁谕令/读审计——足以造成新一轮破坏）。
[`../runbooks/DEPLOY_RECOVER.md`](../runbooks/DEPLOY_RECOVER.md) 要求“重置 rector 及任何 admin 密码”是**人工步骤**，脚本未强制。

**修复建议（P1）**：
- 脚本在清根后**列出全部 admin 账号**并强制全部管理员改密（或一键降权为 scholar、只保留 rector）；
- 恢复清单改为：脚本输出必须人工确认的账号清单后才能继续上线。

**✅ 修复记录（2026-08-16，已实施）**：脚本默认将全部**非创始人管理员降为 scholar**
（`--keep-admins` 可显式跳过），降权明细写入审计日志并随 JSON 输出 `keptAdmins` 清单。
沙箱验证：植入 `ghost(admin)` + 提权 sokrates 后运行 → `demotedAdmins: 2`，rector 保持 admin/root。

### 8.6 其余（W4-W6，低）

- **W4**：`loginAction` 的 password 无长度上限（与注册/改密不一致）——**已随 V1 修复一并补齐**（截断 256）。
- **W5**：仓库公开暴露 `.env.example` 全部机制（`ADMIN_INVITE`、`SCHOLAR_CORE_KEY` 等）——
  `ADMIN_INVITE` 一旦残留为常见值即可被猜试（注册管理员通道 + claimAdmin 通道共用）。
  强烈建议**仓库转私有**（协作者仍可用邀请制）；同时恢复后立即清空生产 `ADMIN_INVITE`（README 已要求，强制执行）。
- **W6**：`/api/scholar/search` 每账号 20 次/10min、每次并发 5 路外部请求——多账号可将服务器
  出站连接放大 5 倍（20 并发检索 = 100 路上游请求），并拖垮上游配额。建议全站总速率 + 出站并发上限。

---

## 8. 附录：关键复现命令（沙箱内）

> 注意：V3 修复后，所有脚本直调 POST 必须携带 `Origin` 头（缺失 → 403）；缺 `Origin` 的跨站表单
> 攻击已被中间件拦截（见 §3.1.2）。

```bash
# 环境：next build && next start，测试库播种
# 提取表单 Action ID（表单为 multipart/form-data）
AID=$(curl -s http://127.0.0.1:3000/login | grep -oE '\$ACTION_ID_[a-f0-9]+' | head -1)

# V1（已修复）回归：同 IP 第 6 次锁定；旋转 XFF 时全局桶第 16 次起锁定
for i in $(seq 1 20); do
  curl -s -o /dev/null -w '%{redirect_url}\n' -H 'Origin: http://127.0.0.1:3000' \
    -H "X-Forwarded-For: 10.0.0.$i" -X POST http://127.0.0.1:3000/login \
    -F "$AID=" -F 'username=target' -F 'password=wrong'   # #1-#15 → e=bad, #16+ → e=locked
done

# V3（已修复）回归：无 Origin 头 POST → 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/login \
  -F "$AID=" -F 'username=weak6' -F 'password=123456'    # → 403

# V3 修复前复现（历史）：带 Origin 正常登录成功
curl -s -o /dev/null -w '%{redirect_url}\n' -H 'Origin: http://127.0.0.1:3000' \
  -X POST http://127.0.0.1:3000/login -F "$AID=" -F 'username=weak6' -F 'password=123456'  # → 303 /

# V4 复现：用户名枚举
# 注册已存在用户名 → register?e=taken

# V5 复现：刷阅读量（任意登录用户）
for i in $(seq 1 25); do curl -s -o /dev/null -b "schola_session=$S" http://127.0.0.1:3000/papers/1; done

# W3（已修复）回归：恢复脚本清理伪管理员
# node scripts/incident-reset-access.mjs --confirm-reset-access --db <db>  # 非创始人 admin 全部降权
```

---

*报告结束。修复后可再次运行本报告第 5 节回归清单与第 8 节复现命令确认闭环。*

---

## 9. Root Key 攻击路径模拟（2026-08-16 追加：高水平对手 + agent 辅助，目标 = 服务器 root）

> 依据 `docs/security/incidents/ROOT_INCIDENT_INVESTIGATION_2026-08-16.md` 与 `SECURITY_LOG.md`：
> 上次得手路径 = GitHub 写权限 → push 自动部署 → Actions 以 root SSH → 写 authorized_keys + cron 持久化。
> 本次以同水平对手重演攻击，重点验证「root key 获取路径」在当前状态下是否仍开放。

### 9.1 模拟攻击者侦察结果

**GitHub 侧（已核实的现状）**：
- 仓库已转 **PRIVATE**（✅ 上轮建议已执行）；
- 协作者 2 人：`sparkjefferey`(push) 与 **`draintovmasyan783-creator`(push:true)** —— ⚠️ 需核实是否为授权账号；
- **main 无分支保护**（GitHub 免费版不支持，API 返回 403）→ 有写权限者可直接 push / 强推 / 篡改 workflow；
- Actions secrets：`DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_KEY`，**创建于 2026-08-14，早于事故（08-15/16）→ 视为事故前凭据，必须轮换**。

**本机凭据面（模拟攻击者读本机可得）**：
- `~/.ssh/dmit_key.pem`（600，root 私钥，记忆文件记载曾 `ssh -i ~/.ssh/dmit_key.pem root@191.223.209.116` 直连）；
- `.deploy-keys/dmit_deploy_ed25519`（600，部署私钥 = root 等价物，见 V10）；
- `~/.config/gh/hosts.yml`（gh 登录态，可能含仓库写权限 token）；
- `.workbuddy/memory/*.md` **明文泄露**：服务器 IP `191.223.209.116`、管理员口令 `rector/haagen2024`、部署商/流程细节；
- `data/schola.db`（本地库 7 用户 14 会话——非生产库，但本机泄露 = 全量会话劫持）。

**应用层（本轮动态复核）**：
- 登录防线已闭环：可信 IP（中间件）→ 设备锁（10 次/设备）→ 算式验证码（3 次失败后）→ 单 IP 桶 → 每用户全局退避（15 次后 30s→60s 递进，且不再锁死账号）→ 爆破死路；
- RCE sink 复查：`dangerouslySetInnerHTML` / `child_process` / `exec*` / `eval` / `Function(` 全库 **0 命中**；
- 验证码为 `a+b` 算式（页面可抓题）→ 脚本可自动解题，对"高水平对手"只是减速带。

### 9.2 得手路径矩阵

| # | 路径 | 可行性 | 得手点 | 当前状态 |
|---|---|---|---|---|
| P1 | 本机凭据 → SSH root | 🔴 高 | `~/.ssh/dmit_key.pem` 或 `.deploy-keys/` 私钥 → `PermitRootLogin prohibit-password`（允许密钥登录）+ 部署密钥无 `command=` 限制 | **开放** |
| P2 | GitHub 写权限 → 恶意 `update.sh` → 部署 | 🔴 高 | 协作者已确认授权；但 main 无分支保护 + 本机 gh token 有 `repo`+`workflow` scope → 任一 GitHub 会话失守（钓鱼/PAT 泄露/本机失守）→ 服务器 `git reset --hard origin/main && bash update.sh` → 部署用户**必须在 docker 组** = root 等价 | **开放**（依赖 GitHub 会话安全）|
| P3 | GitHub 写权限 → 恶意 `deploy.yml` → CI | 🟠 中 | CI 持有 `DEPLOY_KEY`（事故前 secret，未轮换则=旧 root key）| 依赖 P2 同源 |
| P4 | 泄露口令 → 管理员（应用层封顶）| ✅ 已排除 | `haagen2024` 仅本地旧库残留；**管理员已轮换强口令** | 已关闭 |
| P5 | 应用层 → root key | ❌ 低 | 无 RCE / 文件读取 / SSRF → 无法越过非 root 容器 | 已排除 |
| P6 | 供应链投毒 | ❌ 低 | npm registry 上游被控（超出本项目可控范围）| 低概率 |

### 9.3 动态攻击记录（沙箱）

```
攻击 1 泄露口令利用：将 rector 口令置为记忆文件泄露值 haagen2024 → 登录 → 303 /admin →
      名册/审计/谕令 全权限 ✅（应用层得手，封顶于应用层）
攻击 2 横向弱口令：V4 枚举（register?e=taken）可用；每用户名 15 次/15min + 验证码门槛 +
      单设备 10 次预算 → 单点爆破不可行；僵尸网络可缓慢横向，命中率取决于弱口令密度
攻击 3 会话劫持：读 DB sessions 表 → 直接用 token 访问 /admin ✅（DB 可读 = 全量会话）
攻击 4 RCE 面：grep 全库危险 sink = 0 命中；验证码可脚本自动解题
```

### 9.4 结论

1. **上次得手路径（P2：GitHub 写权限 → 部署链 → root）当前仍完全开放**——只要任何一个
   有写权限的 GitHub 会话（协作者账号 / 被盗 token / gh 缓存）落入对手，下一次手动部署
   = 宿主机 root shell（恶意 `update.sh` 在 docker 组用户下执行）。
2. **本机私钥（P1）是第二把 root key 等价物**：`.deploy-keys/` 与 `~/.ssh/dmit_key.pem`
   权限 600 但任何本机代码执行即可读取；部署密钥无 `command=` 限制且 root 允许密钥登录。
3. 应用层到 root key 无路径（本轮修复 + 后续加固有效）；应用层最高收益 = 泄露口令/会话劫持
   拿到管理员（无法越出容器）。
4. **核心根因 = 凭据管理与部署链信任，而非应用代码。**

### 9.5 二轮研究结果（口令/协作者澄清后）

**状态更新（用户确认）**：
- P4（泄露口令）已关闭：`haagen2024` 仅本地旧库残留，管理员已轮换强口令；
- 协作者 `draintovmasyan783-creator` 为授权账号——但 **main 无分支保护** + 本机 gh token
  持 `repo`+`workflow` scope 的事实不变：**GitHub 会话安全 = P2 路径的关键依赖**。

**新增研究（供应链与部署链，本轮确认）**：

| # | 项 | 风险 | 现状 | 建议 |
|---|---|---|---|---|
| S1 | `deploy.sh:14` `curl https://get.docker.com \| sh` | 🔴 以 root 执行网络脚本（DNS/内容投毒 = root shell）| 未 pin | 固定官方 URL 镜像 + 校验签名，或改 apt 官方仓库安装 |
| S2 | `deploy.sh:76` cloudflared 取 `releases/latest` deb | 🟠 上游发布被投毒 = root 安装恶意包 | 未 pin 版本/hash | pin 到具体版本 + 校验 SHA-256 |
| S3 | `Dockerfile` `node:22-slim` 无 digest | 🟡 基础镜像标签漂移（上游被投毒）| 未 pin | 固定 digest（`node:22-slim@sha256:...`）|
| S4 | `update.sh` `git pull` 无签名校验 | 🔴 仓库被 push 恶意内容（自己人账号被钓鱼同样成立）→ 服务器执行 | 未验证 | 部署时校验提交 GPG 签名，或 CI 构建镜像 + 服务器只 `docker pull` 固定 digest |
| S5 | 本机 gh token（`repo`+`workflow`）| 🔴 本机失守 = GitHub 写权限 = P2 全部能力 | keyring 存放 | 最小权限 token、定期轮换、失守预案（立即撤销）|
| S6 | 本机 `data/schola.db`（7 用户 14 会话）| 🟡 本机泄露 = 本地账号会话劫持 | 明文 | 会话清理/加密（macOS FileVault 已加密则缓解）|

**应用层二轮复核（结论：无新增可利用面）**：
- 注册已接**蜜罐 + 算式验证码 + SQLite 全局桶（8/10min）+ 单 IP 桶（3/10min）**——W1 僵尸账号
  门槛大幅上升（脚本需自动解题 + 多 IP），从"无门槛"降为"需算力"；
- `/api/messages/unread` 鉴权正确（无会话返回 0）；`parseAuthors` JSON 解析 try/catch + 字段
  slice/类型强制，无原型污染面；检举 `targetTables` 白名单；中间件 matcher 无 Action 盲区。

### 9.6 堵漏清单（修订版）

**P0（部署前必须完成）**：
1. 轮换 `DEPLOY_KEY` secret（创建于事故前 = 视为已泄露），新服务器用全新密钥对；
2. 服务器重装后强制执行 `PermitRootLogin no` + 部署公钥加 `command=` 限制
   （`harden-host.sh` 目前只注释提示，不自动执行——需落地）；
3. 本机：`~/.ssh/dmit_key.pem` 删除或移入加密存储；`.deploy-keys/` 移出项目目录（V10）；
   轮换 gh token（事故后未轮换）；清空生产 `ADMIN_INVITE`（W5）。

**P1（两周内）**：
4. 部署链改造：CI 构建镜像 push registry（pin digest）+ 服务器只 `docker pull`（部署用户
   无需 docker 组）；或保留 git 部署但校验提交 GPG 签名；
5. 供应链 pin：`get.docker.com | sh` 替换为固定源+校验；cloudflared pin 版本+hash；
   `node:22-slim` pin digest；
6. 定期审计 GitHub 安全日志（登录地点/设备/新 PAT）；清理 `.workbuddy/memory/` 中 IP/口令明文。

**P2**：V4 枚举收敛、V5 刷榜、main 保护（免费版可用「CODEOWNERS 评审要求」+「2FA 强制」部分替代）。
