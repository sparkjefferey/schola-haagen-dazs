# Schola Häagen-Dazs · 沙藏学馆

由两位好友共立的学派网站（二版：会员制与门派治理）。复古希腊学院派风貌：羊皮纸纹理、廊柱、桂冠、卷轴与回纹；
功能含：学派介绍、学术论坛、论文库（投稿→掌门认证→刊印）、作者学榜、双身份注册登录（学者 / 管理者）、
管理者后台「燕京阁」（审稿、检举、邀请函、谕令、名册、审计）。

技术栈：Next.js 15（App Router）+ better-sqlite3（单文件数据库）+ 原生 SVG 纹饰。
字体（Cinzel / EB Garamond）已自托管于 `public/fonts/`（`scripts/fetch-fonts.py` 可重新拉取），站内零外部依赖，国内网络亦不会白屏。

## 安全文档

安全事件调查、持续日志、应用审计和重建手册统一收录在 [`docs/security/`](docs/security/README.md)。当前 root 失陷事件的正式报告以该目录标记的“当前正式调查报告”为准。

## 本地运行

```bash
npm install
# 如需演示数据，先在本机设置三个 SEED_*_PW 环境变量
npm run seed        # 可选：播种示范数据（学者、论文、论坛）
npm run dev         # http://localhost:3000
```

演示账户（由 `scripts/seed.mjs` 播种）：

- 管理者（创始掌门）`rector`、学者 `sokrates`、`plato` 等。
- 脚本不再提供默认口令；缺少 `SEED_ADMIN_PW`、`SEED_SOKRATES_PW`、`SEED_PLATO_PW` 或任一值少于 16 位时会拒绝播种。

## 端到端测试（Playwright）

```bash
# 终端 1：起测试站点（务必 COOL_DOWN_HOURS=0，否则新学者投稿被冷静期拦截）
COOL_DOWN_HOURS=0 npm run dev -p 3100        # 或：npm run build && npx next start -p 3100
# 终端 2：跑全链路（注册→发帖→投稿带附件→案头增删→格式拒收→审稿→刊印→附件下载→处置）
SEED_ADMIN_PW=同播种口令 npm run e2e
```

- 端口可用 `E2E_BASE_URL` 覆盖（默认 `http://localhost:3100`）。
- 须先 `npm run db:reset && npm run seed` 播种（三个 `SEED_*_PW`）。
- 连续多轮会触发注册限流（8 次/10 分钟），重置数据库或稍候再跑。

## 会员与门派治理（本版新增）

- **自由入学 / 凭函就任**：学者可在 `/register` 自由注册；管理者必须凭掌门签发的邀请函（`R-xxxx`，见燕京阁·徽章司）宣誓就任，或由站长预设 `ADMIN_INVITE` 环境变量。
- **掌门认证**：新学者投稿一律先入「审稿箱」，掌门放行后才刊印；放行同时授予作者「认证学者」印，此后直刊免审。
- **入派冷静期**：新入派者须满 24 小时方可著书（可用环境变量 `COOL_DOWN_HOURS=0` 在开发/测试中关闭）。
- **学籍治理**：燕京阁可封禁（附缘由、被封者所有页面转向 `/banned`）、除籍、恢复在籍、任免身阶、授/收认证印；创始掌门（root）不可被降阶、封禁或除籍。
- **检举**：论坛与论文旁设「检举」，掌门在检举信箱中认定（移除目标）或辩诬（销案）。
- **谕令**：掌门可颁行公告，示于全馆顶部。
- **审计日志**：注册、登录、发文、审稿、处置、铸帖等一切治理动作均留痕备查。
- **安全**：登录失败 5 次/15 分钟锁定、发文与发言限流、封禁即时生效。

## 功能一览

- **首府之户（/）**：学派要旨、最新论著/论坛/学榜首五席
- **学派志（/about）**：立学缘由、章程、两阶之制、分科之制
- **学术论坛（/forum）**：六大栏目、发帖/回帖、删帖（本人或管理者）、检举
- **论文库（/papers）**：分学科检索 + 全文检索；**多格式附件上传**（PDF/Word/PPT/Excel/图片/压缩包等，
  扩展名+魔数双校验，限 20MB/件、10 件/篇，可配）；写作支持 `##` 小标题、`>` 引语、`-` 列表、`**粗体**`；仅刊印之作示人
- **作者学榜（/ranking）**：学绩分 = 论著数 × 20 + 总阅读（仅计已刊之文）
- **学者名册（/users/用户名）**：个人论著（含待审/被打回稿的本人处置：弃稿、改稿重投）、认证徽记、封籍状态
- **入学（/register）**：学者自由注册；管理者凭「邀请函」
- **登学（/login）**：按身阶分别导向名册首页 / 燕京阁；失败与锁定均有回示
- **燕京阁（/admin，仅管理者）**：总览、掌门审稿箱、检举信箱、徽章司（邀请函）、谕令、学籍名册、审计日志

## 数据库

SQLite 单文件，位于 `data/schola.db`（已入 .gitignore）。本地重置：设置三个 `SEED_*_PW` 后运行 `npm run db:reset && npm run seed`。
论文附件存于 `data/attachments/`（同样入 .gitignore、随 Docker `schola-data` 卷持久化）；`update.sh` 仅备份数据库，
如需完整备份请连同 `data/attachments/` 一并拷贝。
注意：Vercel/Netlify 等 Serverless 平台的文件系统是临时的，**不适合**本架构；请用 VPS / Docker。

## 公网访问（当前方案：Cloudflare Tunnel 免费直通车）

零成本、零服务器、零备案（域名未备案也可用）：

```bash
npm run dev          # 终端 1：保持网站运行（Ctrl+C 前一直开着）
npm run public       # 终端 2：输出 https://xxxx.trycloudflare.com 即为公网地址
```

- 数据写入本地 `data/schola.db`，经隧道加密回传，不落第三方
- 把公网 URL 发给任何朋友即可访问（含手机）
- 无 Cloudflare 账号也可用（Quick Tunnel）

注意事项：
- 「临时通道」每次重启 URL 会变化；想长期固定地址请做下面两件事之一
- 本机需保持开机、终端 1/2 保持运行

### 长期固定域名（三选一）

1. **Cloudflare 命名隧道（免费）**：注册 cloudflare 账号 → 把域名 DNS 托管到 Cloudflare
   → `cloudflared tunnel login && cloudflared tunnel create schola` → 配置 ingress 指向
   localhost:3000 → 一条命令常驻后台，得到 `schola.你的域名`，免费 HTTPS。
2. **买一台 VPS 用 Docker**（本仓库已备好 Dockerfile + docker-compose）：域名国内需 ICP
   备案；教程见 docker-compose.yml。
3. **GitHub Pages 静态托管**：不适合本项目。本研究站是动态应用（登录/论坛/论文库/数据库），
   Pages 只能托管静态页面；GitHub 的职责是把源码放到仓库（`git init` → GitHub 新建私有库 →
   push），便于备份与协作，后续还能配 CI 自动构建发布。

### VPS 部署（备用方案，含备案数）

```bash
cp .env.example .env       # 填 ADMIN_INVITE（管理者邀请函），如 openssl rand -hex 8
docker compose up -d --build
```

公网生产环境不播种演示账号。先用 `ADMIN_INVITE` 注册管理员，然后清空该值并重启容器。

域名解析到 VPS，Nginx 反代 127.0.0.1:3000 + certbot HTTPS；国内域名需备案。

## 建议与后续方向（二版之后的清单)

1. **安全（已大半）**：演示账号改密、邀请码强制化、登录限速、封禁即时生效均已落地；剩余：密码找回/改密（P1）、CSRF 复核。
2. **论文功能**：版本修订历史、DOI/引用格式导出、~~附件上传（论文手稿 PDF）~~（已落地：多格式附件，见
   `lib/attachment-formats.ts` 白名单）、打回后逐条批注。
3. **内容**：markdown 所见即所得编辑器、标签系统、脚注。
4. **社交（P1）**：邮箱找回、头像上传、徽章（如「双球之勋」）、关注学者、评论通知、私信、信任等级。
5. **学榜完善**：引用数、评星、周榜月榜。
6. **迁移**：数据量大了再换 PostgreSQL（Prisma 等），保留 SQLite 作本地开发。
7. 更多复古细节：油纸斑驳噪点、卷首插画、拉丁文日期、共听喩（盖章系统）。

## 目录结构

```
app/            页面（App Router）
  api/          接口
  admin/        燕京阁
  forum/        论坛
  papers/       论文库
  ranking/      学榜
  users/        名册
components/     SVG 纹饰、徽章、头像等
lib/            db / auth / actions / queries / fmt / md
scripts/        种子与重置
docs/           文档
  deploy/      部署指南（DEPLOY.md）
  plans/       规划文档（微信绑定、周主题）
  design-refs/ 设计参考截图
  security/    安全文档中心（含 vendor/ 第三方技能包、reports/ 本地分析产物）
backups/       数据库备份（gitignored）
deploy.sh      一键部署（服务器上运行，勿移出根目录）
update.sh      更新脚本（CI 与服务器 command= 限制引用，勿移出根目录）
Dockerfile     VPS 部署
```
