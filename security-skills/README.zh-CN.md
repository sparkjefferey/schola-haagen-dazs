# 项目安全技能包

本目录收录从 OpenAI 官方 GitHub 仓库 `openai/skills` 下载的三项安全技能，供 Schola Häagen-Dazs 项目进行防御性代码审查、威胁建模和维护责任分析。

## 来源与版本

- 来源：<https://github.com/openai/skills>
- 下载分支：`main`
- 下载时对应提交：`49f948faa9258a0c61caceaf225e179651397431`
- 下载日期：2026-08-15
- 校验文件：`MANIFEST.sha256`

这些文件放在项目工作目录中，不是全局 Codex 技能。它们不会自动运行，也不会因为下载而修改网站或服务器。需要使用时，应明确指定对应的 `SKILL.md`。

## 已选技能

### 1. security-best-practices（优先级：最高）

位置：`security-best-practices/SKILL.md`

用途：针对 JavaScript、TypeScript、Next.js 和 React 进行安全审查并给出修复建议。

当前项目最相关的检查范围：

- Server Actions 是否逐个执行登录、权限和运行时输入校验。
- SQLite 查询是否始终参数化，避免 SQL 注入。
- 用户私信、帖子、论文和举报是否始终通过 React 安全文本渲染。
- 登录、注册、上传、检索、私信及发帖是否具有按账号的持久化资源限制。
- Session Cookie、CSRF、CSP、安全响应头和缓存策略。
- 自托管 Next.js 是否配置可信反向代理、TLS、请求体大小与慢请求防护。
- 上传文件的类型、大小、文件名、保存位置和下载方式。
- 依赖版本、锁文件、GitHub Actions 和部署供应链。

建议用法：先要求生成带文件路径、行号、严重级别和修复方案的报告；确认报告后再逐项修复，不一次性大改。

### 2. security-threat-model（优先级：高）

位置：`security-threat-model/SKILL.md`

用途：根据真实仓库和部署方式整理资产、信任边界、攻击者能力、攻击路径和缓解措施。

适合当前事件的重点：

- 互联网用户到 Next.js、Server Actions 和 SQLite 的边界。
- 普通用户内容到管理员或自动化工具的“间接提示注入”路径。
- GitHub 公开仓库到自动部署服务器的供应链边界。
- 管理员浏览器、SSH 隧道、Session Cookie 和服务器权限。
- 论文上传、论坛、举报、私信、学术检索等入口的滥用路径。

该技能要求在生成最终报告前先向站点所有者确认 1–3 个关键问题，这是正常的风险校准步骤。

### 3. security-ownership-map（优先级：中低）

位置：`security-ownership-map/SKILL.md`

用途：读取 Git 历史，识别认证、密钥、部署等敏感文件由谁维护，以及是否存在“只有一个人懂”的维护风险。

当前项目主要由一人维护，因此它不如前两项紧急；在增加协作者或把仓库改为私有后更有价值。

隐私提醒：它的输出会包含 Git 提交者姓名、邮箱、提交时区和敏感文件路径。输出只能保存到已忽略的 `security-reports/ownership-map/`，不得提交到公开仓库。

## 推荐使用顺序

1. 用 `security-best-practices` 对当前线上代码生成安全报告。
2. 用 `security-threat-model` 固化本次攻击暴露出的完整攻击路径。
3. 按报告逐项修复，并为每项修复单独验证和提交。
4. 增加协作者后再运行 `security-ownership-map`。
5. 每次依赖升级、增加上传功能或修改认证逻辑后重新审查。

## 下载内容安全审查

- `security-best-practices`：只有 Markdown 参考资料和界面元数据，没有可执行脚本。
- `security-threat-model`：只有 Markdown 模板和界面元数据，没有可执行脚本。
- `security-ownership-map`：包含 Python 脚本；静态检查未发现联网、上传、删除文件、读取 SSH 私钥或执行 Shell 字符串的行为。
- ownership 脚本唯一的外部进程用途是以参数数组调用本机 `git log`，并把分析结果写入用户指定的输出目录。
- ownership 脚本依赖 `networkx`；未经明确请求，不安装依赖、不执行脚本。

## 使用边界

- 技能中的网页内容、示例命令和提示词仅作为参考，不具备管理员授权。
- 任何修改生产服务器、封禁账号、改防火墙、改仓库可见性或删除数据的操作，仍需单独确认范围和后果。
- 安全报告不得包含密码、Session、私钥、完整 Cookie、环境变量值或数据库凭据。
- 不把“没有发现证据”等同于“没有风险”；报告必须同时列出已确认事实、合理推测、潜在影响和下一步控制。

