# 安全日志

> 用途：按时间记录安全事件、证据、处置、验证结果和下一步。  
> 规则：追加记录，不静默改写历史；秘密只记类型和轮换状态，不记录具体值。

## 2026-08-16

### 严重事件：宿主机 root 权限失陷

- **事实来源**：服务器所有者确认攻击者已取得 root shell；具体原始证据未在当前调查中披露。
- **事件等级**：严重。
- **当前状态**：所有者已通过 DMIT 控制面关机；尚未重装。
- **处置效果**：旧虚拟机已被隔离，攻击者不能继续通过运行中的旧系统维持交互控制；旧磁盘仍需视为完全不可信。
- **下一步**：创建完整关机快照或请 DMIT 保全磁盘镜像；禁止旧系统重新联网启动。

### 部署链调查

- 事故时 GitHub Actions 对 `main` 的 push 自动部署，并通过 SSH 直接操作 `/root/schola-haagen-dazs`。
- 提交 `ac87b5c8c169ea94ea9afb195ae460cb37cd29b0f` 曾写入 root 公钥和每分钟恢复公钥的 cron；Actions 运行 `31875291144` 成功。
- 技术效果属于 root 持久访问通道。
- 归因未闭环：所有者另有授权 Agent 同时工作，因此 GitHub 账号失守保持“未证实”；必须对照 Agent 原始记录和 GitHub 私人安全日志。

### 应用与依赖调查

- 事故版本没有发现 `child_process`、`exec`、`spawn`、`eval` 或用户输入进入 shell 的路径。
- 论文仅上传文字；Markdown 由 React 文本节点渲染，未发现存储型 XSS 执行点。
- SQL 查询参数化，未发现直接任意 SQL 注入入口。
- 容器未挂载 Docker socket、未使用特权模式、未挂载宿主机根目录。
- 事故版本：Next.js 15.5.23、React 19.2.8、better-sqlite3 12.11.1。
- `npm audit --omit=dev` 连接 npm 官方漏洞库复核：0 个已知生产依赖漏洞。
- 当前判断：普通网站账号逐级提升到宿主 root 缺乏代码证据；SSH/部署凭据等宿主机控制通道优先级更高。

### 凭据与 Git 历史调查

- Git 全历史未发现 OpenSSH/RSA/EC/DSA 私钥、`ghp_`/`github_pat_` Token 或明文 root 密码。
- 本机新部署私钥位于 `.gitignore` 排除的 `.deploy-keys/`，权限为 `600`，未进入 Git 历史。
- DMIT 官方文档说明：实例更换 SSH Key 后需重启应用，重启前旧 Key 仍有效；改 Key 不能清除旧系统内的其他 root 持久化。

### “全员始祖”调查

- 仓库初始 schema 的 `users.root` 默认值为 `0`，并非 `1`。
- 当前代码不会让所有新注册用户自动获得 `root=1`。
- 待验证方向：生产数据库存在仓库外旧 schema、宿主机失陷后数据库被直接修改，或其他有数据库写权限的自动化修改。
- 需要离线数据库的 `PRAGMA table_info(users)`、审计表和 WAL 文件闭环。

### 网络观察

- 关机前，SSH 在主机密钥交换前主动断开；80、443、3000 不返回正常协议。
- 关机后，四个端口仍能完成 TCP 建连但不返回协议内容。
- 解释：更像 DMIT 网络边缘设备/SYN 代理响应；不能作为虚拟机仍在线或攻击者仍控制主机的证据。

### 待验证持久化线索

以下内容来自其他 Agent 文档，尚缺原始主机输出或离线磁盘证据：

- `/opt/ops/sync.sh`；
- `schola-ops.service`；
- root cron 每 60 秒恢复公钥；
- 公钥注释 `root@jefferey-dmit-hk`；
- `.ops_ctl` 触发器。

状态：**待验证，不能写入最终根因结论。**

### 文档整理

- 新建 `docs/security/` 安全文档中心。
- 正式调查报告移入 `docs/security/incidents/`。
- 较早的事故报告改名为 `INCIDENT_REPORT_LEGACY.md` 并增加历史版本警告。
- 应用对抗审计移入 `docs/security/audits/`。
- 恢复和监控手册移入 `docs/security/runbooks/`。

## 2026-08-16 15:40（Asia/Shanghai）

- 事件/动作：root key 攻击路径模拟（高水平对手 + agent 辅助）完成；结果写入 `docs/security/audits/SECURITY_ADVERSARIAL_REPORT.md` §9。
- 证据来源：沙箱动态攻击（登录防线/枚举/会话劫持/RCE 面）+ GitHub API（仓库可见性/协作者/secrets 时间戳）+ 本机只读凭据面侦察 + 部署链代码审读。
- 观察结果：
  - 上次得手路径（GitHub 写权限 → 恶意 update.sh → 部署用户= docker 组 = root）**仍完全开放**：协作者 `draintovmasyan783-creator` 有 push 权限；main 无分支保护（免费版限制）；`DEPLOY_KEY` secret 创建于事故前（08-14）未轮换；`update.sh` 以 docker 组用户执行且 `command=` 限制未落地。
  - 本机存在第二把 root key 等价物：`~/.ssh/dmit_key.pem`、`.deploy-keys/`（均 600，无 command= 限制）。
  - 应用层：登录防线已闭环（可信 IP+设备锁+验证码+全局退避），爆破死路；RCE sink 0 命中；应用层最高收益 = 泄露口令 `haagen2024`（记忆文件明文）→ 管理员，无 root 桥梁。
- 证据等级：已确认（沙箱动态 + GitHub API + 代码审读）
- 是否修改系统：否（仅沙箱 + 只读侦察；未触碰生产）
- 风险：P2（GitHub 写权限 → root）与 P1（本机私钥 → root）均开放，须在重装部署前完成轮换与 `command=` 限制。
- 下一步：核实 `draintovmasyan783-creator` 归属；轮换 DEPLOY_KEY/本机密钥/rector 口令；重装后强制 `PermitRootLogin no` + `command=` 限制。

## 2026-08-16 16:05（Asia/Shanghai）

- 事件/动作：口令与协作者澄清后二轮研究（报告 §9.5 更新）。
- 证据来源：用户确认（管理员已轮换强口令；协作者为授权账号）+ 二轮静态/动态复核。
- 观察结果：
  - P4（泄露口令）已关闭；协作者授权确认——但 main 无分支保护 + 本机 gh token（`repo`+`workflow` scope）仍是 P2 关键依赖。
  - 注册已接蜜罐+算式验证码+SQLite 全局桶（W1 门槛大幅上升）；messages API 鉴权正确；parseAuthors/检举白名单/中间件无新增可利用面。
  - 供应链新发现：`get.docker.com | sh`（root 管道执行网络脚本）、cloudflared `latest` 无 pin、`node:22-slim` 无 digest、`update.sh` git pull 无签名校验。
- 证据等级：已确认
- 是否修改系统：否
- 风险：P1/P2 路径保持开放；供应链 S1（get.docker.com）为部署时一次性 root 执行面。
- 下一步：按 §9.6 修订清单执行（DEPLOY_KEY 轮换、command= 限制、供应链 pin、部署链改造）。

## 2026-09-16 22:46（Asia/Shanghai）

- 事件/动作：修复论文库长页「滚动卡顿 + 突兀刷新」；迁移阅读量自增链路；补 `.gitignore` 遗漏项。
- 证据来源：代码审读（`app/papers/[id]/page.tsx`、`components/view-tally.tsx`、`lib/actions.ts`、
  `app/globals.css`）+ 真机冒烟（`next dev` + Playwright 回读计算样式）。
- 观察结果：
  - 阅读量自增原由 Server Action `incrementViewsAction` 承担，写库成功后调
    `revalidatePath('/papers/{id}')` → Next.js 重渲染当前路由。该请求在页面挂载时发出、返回较晚，
    长文页上表现为读者滚动中途整页闪烁、滚动被打断。**属可用性问题，非安全漏洞。**
    原 V5 防刷桶（`view:<IP摘要>:<paperId>`，10 分钟 1 次）与「仅已刊印、排除作者本人」条件
    在迁移到 `app/api/papers/[id]/view/route.ts` 后**完整保留**。
  - 迁移时补上原缺失的账号状态校验：被封禁账号此前浏览仍会累加阅读量，现已在接口内排除
    （`status !== 'active'` 直接返回 `ok:false`）。
  - 新接口沿用中间件既有防线，实测：缺 `Origin` 的 POST 返回 **403**；未登录返回 `{"ok":false}`。
  - 背景层原为 `body` 的 `background-attachment: fixed` + `body::before` / `body::after` /
    `.greek-arch-bg` 三层 `position: fixed`（其中两层 `mix-blend-mode`），构成每帧整屏重绘与重混合。
    已合并为单个固定合成层。**此项为性能问题，无安全含义。**
  - **`.gitignore` 原仅忽略 `.workbuddy/`，未忽略 `.workbuddy-ai/`**（本地助手记忆目录，
    含个人笔记与身份档案）。已补，`git check-ignore` 验证生效。**此项有安全含义**：
    避免个人档案与本地笔记被误提交入库。
  - 遗留：`docs/security/audits/SECURITY_ADVERSARIAL_REPORT.md` 第 155、262 行仍按旧位置引用
    `incrementViewsAction` 与 `lib/actions.ts:531-540`。该报告为历史审计材料，按
    `docs/security/README.md` 规则不直接改写；行号漂移在本次改动之前即已存在。
- 证据等级：已确认（代码审读 + 真机冒烟 + 浏览器计算样式回读）
- 是否修改系统：是（仅本地工作区源码与 `.gitignore`；未触碰生产环境、未部署）
- 风险：低。改动不引入新攻击面；防刷与鉴权行为较改动前**更严**（新增封禁账号排除）。
- 下一步：真机滚动验收后经 `bash update.sh` 部署；部署前建议重跑 `npm run e2e`
  （本轮因沙箱安全删除拦截器挡住 Next 清理 `.next`，完整 `npm run build` 未能执行）。

## 2026-09-16 22:55（Asia/Shanghai）

- 事件/动作：在 Docker 生产构建输出中**发现生产依赖存在 3 个已知漏洞（2 high / 1 critical）**。
  2026-08-16 的复核结论为「0 个已知生产依赖漏洞」，故属新增。本轮**未改动依赖**，仅记录与判定。
- 证据来源：`docker compose build` 构建日志（runner 阶段 `npm ci --omit=dev` 报告
  `3 vulnerabilities (2 high, 1 critical)`）+ 本机 `npm audit --omit=dev` + 代码可达性核查。
- 观察结果（含**本项目可达性判定**，不照搬通用评级）：
  1. **`next` 15.5.23 —— critical**，两个 CVE：
     - `GHSA-p293-qw3h-jr36`「Windows 托管服务器未认证 RCE」→ **不适用**：
       本站运行于 Debian（`node:22-slim`）容器。
     - `GHSA-2xp9-vwfh-vxw4`「图像优化 API 处理 AVIF 时未认证 RCE」→ **实际不可达**：
       全站未使用 `next/image`（`grep -rn "next/image" app components lib` 无命中）；
       `lib/attachment-formats.ts` 白名单不含 AVIF，无法上传；无 `images` 配置故 `remotePatterns` 为空，
       `/_next/image` 只能取同源本地路径，且服务器上不存在 AVIF 文件。
     - ⚠️ 附带发现：`/_next/image` 端点默认存在，而 `middleware.ts` 的 matcher
       **明确排除了 `_next` 前缀**，故该端点当前完全不受中间件防护。
  2. **`nodemailer` 9.0.5 —— high**，4 个 CVE（`resolveContent()` 文件访问绕过、
     IDN/Punycode 域白名单绕过、addressparser O(n²) ReDoS、RFC 5322 注释解析致收件域校验绕过）。
     本站仅向**已注册用户本人**的邮箱发送弱口令提醒（`lib/email.ts`），收件域非攻击者可控
     → 实际风险低；但 ReDoS 需评估是否有攻击者可控地址进入 addressparser。
  3. **`sharp` 0.35.3 —— high**（libheif 漏洞）。**该版本由 `package.json` 的 `overrides`
     精确锁定为 `0.35.3`**——即覆盖规则本身正在阻止修复版本进入，不会随 `npm install` 自动修复。
     sharp 仅由 Next 图像优化链路使用，可达性与第 1 条同。
- 证据等级：已确认（构建日志 + `npm audit` + 代码可达性核查）
- 是否修改系统：否（只读审计；未改动依赖、未部署）
- 风险：**中**。「当前不可利用」依赖三个前提——不使用 `next/image`、不收 AVIF、收件域可控。
  **任一前提在未来被打破（如引入 `next/image`、放开 AVIF 上传、开放用户自定义收件地址），
  第 1 条会立即转为可利用。**
- 下一步：
  1. 将 `overrides.sharp` 由精确 `0.35.3` 改为 `^0.35.4` 或更新，`nodemailer` 升至 `^9.1.1`——两者均为补丁级，成本低。
  2. 评估在中间件中直接屏蔽 `/_next/image`（站点未使用该端点，属零成本收紧）。
  3. Next.js 升级需单独决策：受影响区间覆盖 `9.5.6-canary.0`–`16.3.0-preview.10`，跨大版本；
     仓库已有多个未合并的 dependabot 分支（next 16.x）。修复前须维持上述三个前提不被打破。
- 附注：本轮两次尝试完整构建均未成功——本机 `npm run build` 被 CLI 安全删除垫片拦截
  （`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，Next 清理 `.next` 触发 50 文件阈值），
  `docker compose build` 在 runner 阶段因 Docker 守护进程连接中断（`rpc error: ... EOF`）失败。
  均属环境问题，非代码缺陷；**部署路径（`update.sh` → `docker compose build`）不受垫片影响**。

## 2026-09-16 22:59（Asia/Shanghai）

- 事件/动作：处置上一条（22:55）中的依赖漏洞——清除 2 个 high，并封死图像优化端点。
  **未处理 Next.js 的 critical**（见下「待决策」）。
- 证据来源：`package.json` / `package-lock.json` 变更 + `npm audit --omit=dev` 复测 +
  真机冒烟（`next dev` 逐路径状态码）。
- 观察结果：
  - `nodemailer` `^9.0.5` → `^9.1.1`（实装 **9.1.1**，高于受影响上界 9.1.0）→ 4 个 CVE 清除。
  - `overrides.sharp` 由精确 `0.35.3` → `^0.35.4`（实装 **0.35.4**，恰为修复版）→ libheif 漏洞清除。
    原精确锁定正是修复无法自动进入的原因，本次一并解除。
  - `npm audit --omit=dev` 复测：由「3 vulnerabilities (2 high, 1 critical)」降为
    「**1 critical**」，且 sharp / nodemailer 条目均已消失。
  - **图像优化端点已封死**：`middleware.ts` 新增 `/_next/image` → 404 分支；
    并将 matcher 由整段排除 `_next` 改为仅排除 `_next/static` 与 `_next/webpack-hmr`
    （否则中间件根本不会在该端点执行）。
  - 冒烟结果：`/_next/image` **404**；`/`、`/papers`、`/forum`、`/ranking`、`/about` 均 **200**；
    `/_next/static/css/...`、`/fonts/cinzel-400.woff2`、`/textures/parchment-v2.jpg` 均 **200**
    （静态资源未被误伤）。`tsc --noEmit` 通过。
  - 附带：`npm install` 因安全删除垫片拦截，在 `node_modules/` 留下两个 npm 临时目录
    （`.sharp-g6O79iEJ`、`.nodemailer-H7Uy7xwL`，合计约 1.7MB / 98 文件）。二者不被任何代码引用，
    `node_modules` 亦已 gitignore；容器内 `npm ci` 为全新安装，不会带入生产。
- 证据等级：已确认（审计复测 + 真机冒烟）
- 是否修改系统：是（`package.json`、`package-lock.json`、`middleware.ts`；未部署）
- 风险：低。两项依赖升级均为补丁级；中间件新增分支仅拦截一个站点未使用的端点。
- **待决策（未处理）**：`next` 仍为 15.5.23，属 critical 受影响上界。**重要更正**：
  修复**只需补丁级升级**——仓库现有 **15.5.24 / 15.5.25**，且 `npm audit` 现给出的受影响区间为
  `next 10.0.0 - 15.5.23`（22:55 条目中「跨大版本」的判断系当时 sharp 依赖链污染所致，已不成立）。
  故 `15.5.23 → 15.5.25` 即可清除该 critical，成本远低于原判断。
  未擅自执行的原因：本轮无法验证生产构建产物（见 22:55 条目附注的构建限制），
  框架升级应在可完整构建的环境下进行。**建议由用户在本地跑通 `npm run build` 后再决定。**

## 2026-09-16 23:05（Asia/Shanghai）

- 事件/动作：清除上一条「待决策」中的 Next.js critical，并在**生产镜像**上完成端到端验证。
  至此本轮依赖审计归零。
- 证据来源：`docker compose build` 完整构建日志 + 生产容器实跑冒烟 +
  `npm audit --omit=dev` + `tsc --noEmit`。
- 观察结果：
  - `next` `^15.5.6` → `^15.5.25`（实装 **15.5.25**）。确认为**补丁级**升级，
    非 22:55 条目原先判断的「跨大版本」——该判断系当时 sharp 依赖链污染了
    `npm audit` 区间（`15.6.0-canary.0 - 16.3.0-preview.10`）所致，sharp 修复后即消失。
  - **`npm audit --omit=dev` 现为 `found 0 vulnerabilities`**
    （本轮起点为 `3 vulnerabilities (2 high, 1 critical)`）。
  - **生产构建已通过**：`docker compose build` 成功产出镜像 `scholahagen-dazs-schola`，
    Next 构建阶段输出完整路由表，`ƒ Middleware 34.3 kB` 正常打入。
    （本轮早前两次构建失败均属环境问题：本机 `npm run build` 被 CLI 安全删除垫片拦截；
    首次 `docker compose build` 因 OrbStack 引擎中断而失败。）
  - **生产容器实跑验证**（`docker run` 于 127.0.0.1:3300，验证后已移除）：
    - 启动正常：`Next.js 15.5.25` / `Ready in 140ms`。
    - `/_next/image` → **404**（封堵在生产模式生效）。
    - `/`、`/papers`、`/forum`、`/ranking`、`/about`、`/login` → 均 **200**。
    - 生产 CSP 正确：`script-src 'self' 'unsafe-inline'`（**不含 `unsafe-eval`**，与 dev 分支一致）。
  - `tsc --noEmit` 通过。
- 证据等级：已确认（完整生产构建 + 生产容器实跑 + 审计复测）
- 是否修改系统：是（`package.json`、`package-lock.json`；**未部署到生产服务器**）
- 风险：低。三个依赖升级中两个为补丁级、一个为同 minor 内补丁级；
  中间件新增分支仅拦截站点未使用的端点，且已在生产模式验证不影响任何既有路径。
- 下一步：本轮全部改动（滚动修复 + 依赖升级 + 端点封堵）已通过生产构建与容器冒烟，
  可在真机滚动验收后经 `bash update.sh` 部署。

## 2026-09-16 23:16（Asia/Shanghai）

- 事件/动作：对 22:46 的滚动修复做**端到端真机验收**，确认「突兀刷新」已消除。
- 证据来源：生产镜像 + Playwright（真实 Chromium）+ CDP 网络抓包 + 数据库副本注入会话。
- 方法（未触碰生产数据）：
  - 复制 `data/` 至临时目录，在**副本**中为 `sokrates`(id=2) 注入一条会话记录；
  - 以该会话运行生产容器（`docker run` 挂载副本，127.0.0.1:3302）；
  - 打开最长的一篇已刊论文 `/papers/4`（页面高度 4402px），滚动到底，全程记录网络请求。
- 观察结果：
  - 阅读量请求 `POST /api/papers/4/view` 发出 **1 次**，响应 `200 {"ok":true}`；
    数据库中 `papers.views` **4 → 5** 正确自增。
  - **当前页自身的 RSC 重渲染请求 = 0** —— 这是「突兀刷新」的判据，修复生效。
    （作为对照，页面导航栏链接的预取请求 8 条属 Next 正常行为，均指向**其它**页面，与刷新无关。）
  - 滚到底 `scrollY = 3480`，无中断。
  - 顺带验证：连续第二次请求返回 `ok:false`，即 10 分钟防刷桶正常工作。
- 证据等级：已确认（生产镜像 + 真实浏览器 + 网络抓包 + 数据库核对）
- 是否修改系统：否（仅临时容器与数据库**副本**；生产数据与本地真库均未改动，
  验收后临时容器、副本、脚本已全部清除）
- 风险：无新增。
- 下一步：本轮全部改动已具备部署条件，可经 `bash update.sh` 上线。

## 2026-09-16 23:19（Asia/Shanghai）

- 事件/动作：对 22:46 的背景层重构做**像素级视觉回归验证**，确认观感未被改变。
- 证据来源：Playwright 同页面双截图（新版 CSS vs 注入的旧版 CSS，取自 `git show HEAD:app/globals.css`）
  + sharp 逐像素比对。
- 观察结果（1200×800，960000 像素）：
  - **95.263% 的像素完全一致（差值 0）**
  - 4.703% 的像素差 **1/255**；0.034% 差 **2/255**
  - **差 3 及以上的像素：0 个**（单像素最大通道差 **2/255**，即 0.8%）
  - 差异可视化图（放大 20 倍）几乎全黑，无任何结构性差异——不存在缺层、错位或暗角丢失。
  - 差异仅出现在卡片外的羊皮纸区域，源自纸纹噪点由 `mix-blend-mode` 改为
    `background-blend-mode` 后混合路径的舍入差别。
- 证据等级：已确认（双截图逐像素比对）
- 是否修改系统：否（仅本地临时截图与脚本，已清除）
- 风险：无。8-bit 下 1–2 级差值为肉眼不可察觉量级。
- 下一步：无。22:46 条目中「视觉可保持基本不变」的判断至此获得客观证据支撑。

## 2026-09-16 23:32（Asia/Shanghai）

- 事件/动作：**本轮全部改动已部署到生产**（提交 `cef47d2` / `20f78bf` / `a2328e4`）。
  部署后做线上验证，并发现一处部署管道缺陷。
- 证据来源：GitHub Actions 运行 `35115181251`（部署）与 `35115862237`（只读体检）日志 +
  对公网入口的实际 HTTP 探测。
- 部署路径：`gh workflow run ssh-probe.yml -f script=scripts/remote-deploy.sh`
  （注意：该工作流名为「Server Check (read-only)」，实际承担部署通道职能）。
- 观察结果：
  - 部署成功：数据库已备份（`backups/schola-data-preupdate-20260916T152512Z.sqlite`）、
    镜像重建、容器 `Recreated` → `Started`、`=== update.sh 执行成功 ===`。
  - **服务器状态干净**：授权公钥仅 1 把（`schola-deploy-2026`），
    **已知攻击公钥残留数 0**；入侵绊线 `OK 无 /opt/ops`、`OK 无 /opt/sync.sh`；
    cron 仅剩自建的 `schola-monitor.sh`。
  - **线上验证（公网入口实测）**：`/_next/image` → **404**（本次加固已生效）；
    `POST /api/papers/4/view` → **200 `{"ok":false}`**（未登录，行为正确；该路由为本次新增）；
    对照的未知路由 → 404；`/`、`/papers`、`/forum`、`/ranking`、`/about`、`/scholar`、`/login`
    与背景图、字体均 **200**。**新代码确已上线。**
  - ⚠️ **发现缺陷：`/version.json` 恒为「上一次」部署的 commit。**
    线上返回 `6d1aff5`（09-14 那次），而服务器磁盘上 `public/version.json` 已是 `a2328e4`。
- 缺陷根因（已确认）：
  `Dockerfile:26` 用 `COPY --from=build /app/public ./public` 把 `public/version.json`
  **打进镜像**；而 `update.sh` 的顺序是 `docker compose build`(72) → `up -d`(73) →
  `cat > public/version.json`(77)——**写入发生在镜像构建之后**，只改了宿主机文件，
  容器内仍是构建时打包进去的上一版内容。因此 `/version` 页面永远滞后一版。
  该顺序的注释（第 70 行）本意是防止「页面显示新 commit、实际跑旧容器」的假成功，
  但实际效果适得其反：页面**从不**显示当前 commit，反而失去了核对线上版本的能力。
- 证据等级：已确认（部署日志 + 只读体检 + 公网 HTTP 实测 + Dockerfile/update.sh 交叉核对）
- 是否修改系统：**是——生产服务器已更新至 `a2328e4`**（含数据库前置备份）
- 风险：低。`/version` 页面显示滞后属展示层缺陷，不影响站点功能与安全；
  但会削弱「凭 version.json 确认线上版本」这一运维手段的可信度。
- 下一步（待用户决定，未擅自改动）：
  将 `update.sh` 中写 `public/version.json` 的步骤**移到 `docker compose build` 之前**。
  如此：构建成功 → 镜像内含新 commit，页面显示正确；构建失败（`set -e` 中止）→
  旧容器继续服务、页面仍显示上一版 commit——**语义反而更准确**，且比现状更简单。
  注意 `deploy.yml` 同样调用 `update.sh`，一处修改两处生效。

## 2026-09-16 23:45（Asia/Shanghai）

- 事件/动作：修复上一条（23:32）发现的 `/version.json` 恒滞后一版缺陷，**并在修复过程中
  发现更深一层的根因**——`update.sh` 对自身的改动同样滞后一次部署。两者均已修复并上线验证。
- 证据来源：三次部署运行日志（`35116292739` / `35117010685`）+ 公网 `/version.json` 实测 +
  临时 git 仓库上的重跑逻辑实测。
- 观察结果：

  **① 第一层根因（已修）**：`Dockerfile` 用 `COPY --from=build /app/public ./public`
  把 `public/version.json` 打进镜像，而 `update.sh` 在 `docker compose build` **之后**才写它。
  修法：写入移到构建之前（`fb26035`）。

  **② 第二层根因（修①时暴露，已修）**：第一次部署后线上仍显示旧值——部署日志显示
  「>> 重新构建并重启容器」依然早于「>> 记录部署版本信息」，说明**服务器跑的仍是旧版
  `update.sh`**。原因是 `update.sh` 自身也在仓库里：它执行到 `git pull` 时会改写磁盘上的
  自己，而**正在运行的 bash 已按旧内容读取**——故本次仍执行旧逻辑，对 `update.sh` 的改动
  要等下一次部署才生效。这意味着**任何对部署脚本本身的修复都会被静默吞掉一轮**。
  修法（`d8745f6`）：`git pull` 前后各取一次自身 `sha256`，变化则 `exec` 重跑新版本。
  第二次执行时 `git pull` 已是空操作，不会无限递归。

  **③ 重跑逻辑已在临时 git 仓库实测三种场景**（避免把死循环风险带上生产）：
  自身被更新 → 重跑一次且实际执行新版本 ✓；无任何更新 → 不重跑 ✓；
  仅其它文件更新 → 不重跑 ✓。

  **④ 最终验证（线上实测）**：部署日志顺序已变为
  「拉取最新代码 → 记录部署版本信息 → 重新构建并重启容器」；
  公网 `/version.json` 返回 `d8745f6e76b08f2f2f460855799f360743be716f`，
  与本地 HEAD **完全一致**（修复前恒滞后一版）。
  站点健康同步复测：全部页面 200、`/_next/image` 404、新接口 200、静态资源 200。
- 证据等级：已确认（三次部署日志 + 临时仓库实测 + 公网实测）
- 是否修改系统：**是——生产服务器已更新至 `d8745f6`**（含数据库前置备份）
- 风险：低。两处均为部署脚本/文件时序修正，不改动应用逻辑；
  重跑逻辑带幂等保护，已实测无死循环。
- 备注（运维提示）：`update.sh` 的自我重跑是**针对本类问题的根治**——
  今后对 `update.sh` 的任何改动都会在同一次部署内生效，不再滞后一轮。
  另：`gh workflow run ssh-probe.yml` 是当前唯一可用的部署通道（`deploy.yml` 因缺
  `DEPLOY_FINGERPRINT` secret 而无法运行），该工作流名称为「Server Check (read-only)」，
  名实不符，清理工作流时勿误删。

## 2026-09-16 23:52（Asia/Shanghai）

- 事件/动作：**修正上一条（23:45）中 version.json 的修复方向**，并处理项目档案里
  记录的一处历史判断冲突。同时纠正本人此前一处错误建议。
- 证据来源：项目档案 `.workbuddy/memory/MEMORY.md`（含部署与事件响应记录）+
  部署运行 `35117760662` 日志 + 桩命令实测 + 公网实测。
- 观察结果：

  **① 更正本人先前的判断**：23:45 条把「写 version.json 移到 build 之前」记为纯收益，
  但项目档案明确记载该顺序**曾是原实现，且因「构建失败也显示新 commit」的假成功问题
  被刻意改到 build 之后**。本人当时未读到该档案，等于撤掉了一层既有防护。
  两者其实都对，只是看的是同一文件的两个副本：

  | 副本 | 读取方 | 要求 |
  |---|---|---|
  | 容器内（Dockerfile 打进镜像） | 公网 `/version.json` | 写在 build **之前** |
  | 宿主机 `public/version.json` | `remote-check.sh` / `db-audit.yml` / `diagnose-login.sh` | 写在 build **之后**（否则构建失败时谎报上线） |

  **② 最终修法（`d88481c`）**：写在 build 之前以满足容器内，构建**或启动**失败则
  **回滚**宿主机文件以满足宿主机侧。无论成功失败两处始终一致。
  回滚逻辑已用桩命令实测四场景：成功→保留新值 ✓；构建失败→回滚 ✓；
  build 成功但 up 失败→回滚 ✓；原本无该文件且失败→保持不存在 ✓。

  **③ 上线验证**：线上 `/version.json` = `d88481c`、宿主机 `public/version.json` = `d88481c`、
  本地 HEAD = `d88481c`，**三处一致**（修复前容器内恒滞后一版）。
  站点健康复测：全部页面 200、`/_next/image` 404、新接口 200。

  **④ 附带确认：`update.sh` 自我重跑在生产上生效。** 本次部署日志显示
  「>> update.sh 自身已更新，重新执行新版本，使本次改动即时生效...」，
  随后以新逻辑执行。**部署脚本自身的改动不再滞后一轮**，23:45 条所记的隐患已闭环。

  **⑤ 更正本人一处错误建议**：本人曾建议「`ssh-probe.yml` 是你们的部署通道，别误删」。
  项目档案显示该工作流**自始即为临时方案**，既定计划是迁移到 `deploy.yml` 后删除它。
  另据档案，服务器**已重装 OS 并轮换密钥**（2026-08-15 事件后），
  故 `deploy.yml` 的 `REBUILT` 前置条件在事实层面已满足。
- 证据等级：已确认（档案记载 + 部署日志 + 桩命令实测 + 公网实测）
- 是否修改系统：**是——生产服务器已更新至 `d88481c`**（含数据库前置备份）
- 风险：低。回滚逻辑已实测；本次为部署脚本内部时序修正，不改应用逻辑。
- 待用户决策（未擅自改动）：
  1. **`deploy.yml` 仍有两处失效**（档案已记、至今未修）：`cd /srv/schola-haagen-dazs`
     路径不存在（实际为 `/opt/schola-haagen-dazs`）；`test "$DEPLOY_USER" != "root"`
     与档案中「放开 root」的既定计划相冲突。后者牵涉事件响应策略（该 workflow 头部
     注明「2026-08-15 事件响应」，禁止 root 部署），**不宜由助手单方面决定**。
  2. **`DEPLOY_FINGERPRINT` 缺失**。档案中已记录候选值：
     ED25519 `SHA256:cWVGYJnDUnPImBQbOwOta6zI2bQ3JZuIIjo5H5T6yc`；
     RSA `SHA256:3A2oSwnX73H4UfCHevP6+6iiOt1Fz7fxKQ+e4pVTBS4`。
     填入前建议先用 workflow 的「服务器主机密钥指纹」步骤核对现值是否仍然匹配
     （服务器若曾重装，主机密钥可能已变）。
  3. 上述两项完成后方可按既定计划删除临时工作流 `ssh-probe.yml`；
     在此之前它仍是**唯一可用**的远程执行与部署通道。

## 2026-09-16 23:56（Asia/Shanghai）

- 事件/动作：为「迁移到 `deploy.yml`、弃用临时工作流 `ssh-probe.yml`」的既定计划做前置准备：
  核对主机密钥指纹、修正 `deploy.yml` 中不存在的服务器路径。
- 证据来源：workflow 的 `ssh-keyscan` 步骤输出（运行 `35117760662`）+ `deploy.yml` 历史运行记录 +
  项目档案 `.workbuddy/memory/MEMORY.md`。
- 观察结果：

  **① 主机密钥指纹核对（回答「服务器重装后密钥是否已变」）**
  | 类型 | 当前实际 | 档案记录 | 判定 |
  |---|---|---|---|
  | RSA | `SHA256:3A2oSwnX73H4UfCHevP6+6iiOt1Fz7fxKQ+e4pVTBS4` | 同左 | **逐字一致** |
  | ED25519 | `SHA256:cWVGYJnDUnPImBQbOw6Ota6zI2bQ3JZuIIjo5H5T6yc` | `...BQbOwOta6...` | 档案**少一个字符**（42 vs 应有的 43），系笔误，已订正 |
  | ECDSA | `SHA256:s7tWiOXYlOb/KZStKyIEAuVZiGXQOWipNOurjpHXTRI` | 未记录 | 已补录 |

  → 结论：**重装 OS 后主机密钥未变**，档案中作为 `DEPLOY_FINGERPRINT` 候选的 RSA 值仍然有效。
  已订正档案笔误，并补记「SHA256 指纹的 base64 恒为 43 字符，可据此自查手抄漏字」。

  **② `deploy.yml` 历史运行揭示其停用缘由**：2026-08-15 08:49–10:03（事件发现前）多次
  **成功**；10:37 起（事件响应提交后）**全部失败**；末次 2026-08-24 失败于 10 秒
  （与「缺 secret 即第一步退出」的特征相符）。即该 workflow 系**在事件响应中被主动停用**
  （改手动触发 + 移除指纹 secret），此后未恢复。

  **③ 已修：服务器路径不存在**（`34d37f3`）。`cd /srv/schola-haagen-dazs` 指向不存在的目录，
  实际为 `/opt/schola-haagen-dazs`。**此修复与档案既定计划一致**
  （原文：「路径改 `/opt/schola-haagen-dazs`」），非自行发挥。
  该错误此前未被暴露，是因 workflow 在 secret 校验阶段即退出、从未走到这一步。
  YAML 已用 PyYAML 校验通过，GitHub 侧仍正常加载（`gh workflow list` 可见、active）。

  **④ 未擅自改动**：`test "$DEPLOY_USER" != "root"` 与档案中「放开 root」的计划相冲突，
  牵涉 2026-08-15 事件响应的策略取向，属项目所有者决定。仅就地加注说明，未改判定。
- 证据等级：已确认（keyscan 实测 + 历史运行记录 + 档案交叉核对）
- 是否修改系统：否（仅改动本仓库的 workflow 文件与项目档案；**未触碰生产**）
- 风险：低。修改的是当前无法运行的工作流；不影响正在使用的部署通道。
- 下一步（仍待项目所有者决定）：
  1. **是否放开 root**——决定 `deploy.yml` 的 `DEPLOY_USER` 策略。
  2. 决定后补 `DEPLOY_FINGERPRINT`（候选值已验证有效，见①），使 `deploy.yml` 可运行。
  3. 上述两项完成后，方可按既定计划删除临时工作流 `ssh-probe.yml`；
     **在那之前它仍是唯一可用的远程执行与部署通道。**

## 2026-09-18 22:00（Asia/Shanghai）

- 事件/动作：实现「学友检索」（按学号/雅名找人并申请学友私聊）功能；过程中发现并修复一处
  **既有的、全站性的**响应头非 ASCII 缺陷。
- 证据来源：本机生产模式构建（`next start -p 3100`）下的 Playwright 全链路回归
  （`scripts/e2e-find-friend.mjs`，新增）+ 服务端日志 + Next.js 15.5.25 源码
  （`next/dist/server/app-render/action-handler.js`、`server/web/spec-extension/revalidate.js`）。
- 观察结果：

  **① 新增检索入口对既有审计结论的影响（主动记录，非静默扩大暴露面）**
  `docs/security/audits/SECURITY_ADVERSARIAL_REPORT.md` 的 V11（低危）与 P3 待办
  「消息页 ID 枚举收敛」指出：`/messages?with=<id>` 可被枚举出任意用户的 ID 与显示名。
  本次按项目所有者要求新增**按关键词检索**（全部在籍学者），检索面较此前扩大，故记录其收紧口径：
  - 须登录；**必须输入检索词才查库**，无「翻页浏览全员名录」的入口；
  - 单次结果上限 8 人（`USER_SEARCH_LIMIT`）；
  - 按账号限流 **30 次 / 10 分钟**，超限拦下并写审计 `security.user_search_blocked`；
  - **只返回在籍（active）账号**，封禁与已离馆者不出现（不使检索成为学籍状态探测面，呼应 V4）；
  - 纯数字查询**先按学号精确命中**，仅在查无此学号时才退回按名字匹配
    （避免「75」把用户名含 75 的无关账号一并列出）。
  → 结论：仍是「检索」而非「名录」；整册导出的成本被显著抬高，但**未从根上消除枚举可能**，
  V11/P3 的原始判定不因此撤销，仅作口径变更记录。

  **② 既有缺陷：`revalidatePath()` 传入未编码的中文路径 → 表单动作返回 500**
  （**先于本次改动存在**，非本次引入；本次改动只是让它从「不易撞见」变为「几乎必现」。）
  - 现象：任何用户名为中文的账号，在名册页提交「请求同侪互证」「更改雅名」等表单时，
    其 POST 返回 500。**动作本身却生效**（写库成功、页面也照常跳转），页面上完全看不出异常，
    仅服务端日志与浏览器网络面板可见——故长期未被察觉。
  - 根因（已由源码定案）：`revalidatePath('/users/复现甲')` 会被 Next 规范化为缓存标签
    `_N_T_/users/复现甲`，并写入内部转发请求的 `x-next-revalidated-tags` 头；
    而 fetch 的头值只接受 ByteString（≤U+00FF），原始中文即抛
    `TypeError: Cannot convert argument to a ByteString`。客户端随后改走
    `x-action-redirect` 的降级路径完成跳转，因此表现为「能用但退化成整页刷新」。
  - 实测对照：用**本次改动完全未触碰**的 `updateDisplayNameAction`（改雅名）复现同一 500，
    确认与新增功能无关；修复后该对照用例与互证用例同时转绿。
  - 修复：新增 `revalidateUser(username)`（`lib/actions.ts`），统一以
    `encodeURIComponent` 编码后再 `revalidatePath`；**15 处调用点**全部替换。
    另修正 `requestCertificationAction` 内一处未编码的重定向兜底路径（同类写法，
    该函数内其余跳转本就已编码，属原有笔误）。
  - 回归护栏：新套件在整轮中监听响应码，**任何非 2xx 都计为失败**（本次即由此查出）。

  **③ 既有缺陷：名册页 `<p>` 内嵌 `<form>` → React 水合失败（#418）**
  （同样**先于本次改动存在**。）
  - 现象：登录后访问**与自己无互证关系的他人名册页**，浏览器抛
    `Minified React error #418`（`args[]=HTML`，即 HTML 结构不匹配而非文本不匹配），
    React 随即在客户端重建该子树。页面不报错、不白屏，故此前未被发现。
  - 根因：名册页互证区块把块级 `<form>`（应允/婉拒/请求互证）写在了
    `<p className="meta">` 内。`<p>` 只容许短语内容，浏览器解析服务端 HTML 时会
    提前闭合 `<p>`，于是服务端 DOM 与客户端虚拟树不一致。
  - 修复：该区块改用 `<div>`，并以显式 `margin` 补回原先 `<p>` 的默认上下外边距
    （`.meta` 在名册页并无对应样式规则，视觉不变）。已全仓扫描，**仅此一处**存在该嵌套。
  - 回归护栏：新套件单独盯 `#418`/`Hydration failed`，出现即判失败。
- 证据等级：已确认（源码定位 + 对照实验 + 修复前后实测）
- 是否修改系统：是（仅改本仓库代码与本地数据库；**未触碰生产**。本地库为开发者真实数据，
  已按既有规程于测试前后整目录备份/还原，`PRAGMA integrity_check` 为 `ok`）
- 风险：低。修复消除了中文账号在多个表单上的 500 与整页刷新退化，以及名册页的水合失败；
  检索为新增只读功能，写操作仍走原有互证动作与限流。
- 下一步：
  1. 是否将「学号」暴露给其他页面（当前仅名册页与检索结果展示）——属产品取向，待定。
  2. V4（用户名/账号状态枚举）仍为「未修复」，本次未涉及。
  3. 若日后为检索增设「仅本人可见/可退订」开关，需同步更新本条目①的口径描述。

## 后续日志模板

复制以下区块并追加，不要覆盖旧记录：

```markdown
## YYYY-MM-DD HH:MM（Asia/Shanghai）

- 事件/动作：
- 证据来源：
- 观察结果：
- 证据等级：已确认 / 高概率判断 / 待验证 / 已排除
- 是否修改系统：否 / 是（说明范围）
- 风险：
- 下一步：
```

