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

