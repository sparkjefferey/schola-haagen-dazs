# Root 权限失陷事件调查报告（证据分级版）

> 项目：Schola Häagen-Dazs（沙藏学馆）  
> 编制日期：2026-08-16（Asia/Shanghai）  
> 事件等级：严重 / 宿主机 root 权限失陷  
> 当前状态：旧服务器已由所有者通过 DMIT 控制面关机，尚未重装  
> 原则：将“攻击者已经取得 root shell”作为既定事实；对最初入口和 GitHub 归因分别调查，不用未验证材料填补证据缺口。
> 文档状态：当前事故调查的主要事实来源；后续离线取证结果应继续追加到本文件。

## 1. 执行摘要

服务器宿主操作系统的 root 权限已经失陷。当前最符合现有技术证据的初始入口是 SSH/部署凭据或其他可直接触达宿主机的控制通道，而不是普通网站账号通过应用代码逐级提升到 Linux root。

GitHub 是否失守尚未证实。可疑提交和 GitHub Actions 确实曾利用现有部署链以 root 身份修改服务器，但所有者同时运行着另一名具备仓库权限的 Agent，因此该提交可能是授权自动化行为。无论提交由谁创建，事故前的架构都存在同一项致命风险：任何可以修改 `main` 或部署工作流的主体，都能借 GitHub Actions 直接在服务器上执行 root 命令。

服务器已经关机，现阶段完成的是“隔离”，尚未完成“根除”。旧系统不得重新联网启动；下一步应先保全完整磁盘快照，再从官方干净镜像重装，只从离线快照提取数据库与日志。

## 2. 证据等级

本报告使用以下标记：

- **已确认**：有所有者确认、代码/提交记录、运行结果或官方平台记录支持。
- **高概率判断**：多项事实一致，但仍缺少旧主机离线日志或磁盘镜像闭环。
- **待验证线索**：来自其他 Agent 文档或现象，尚未由本次调查独立验证。
- **已降级/不支持**：现有代码或证据与该说法不相符。

## 3. 已确认事实

### 3.1 宿主机与处置状态

1. 所有者确认攻击者已经取得服务器 root shell；具体原始证据未向本次调查披露，但该事实不再被质疑。
2. 2026-08-16，所有者已通过 DMIT 控制面将旧服务器关机。
3. 旧系统尚未重装，磁盘仍可能保留登录记录、持久化文件和数据库证据。
4. 外部连接测试中，22 端口在 SSH 主机密钥交换之前主动断开；80、443、3000 端口也不返回正常应用层协议。关机后仍能建立 TCP 连接但同样无协议响应，说明这可能是 DMIT 网络边缘设备的响应，不能据此判断虚拟机仍在运行。

### 3.2 部署链具有直接 root 能力

事故时的 `.github/workflows/deploy.yml`：

- `push main` 自动触发部署；
- 使用 `DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_KEY` 登录服务器；
- 项目目录为 `/root/schola-haagen-dazs`；
- 部署命令直接在 root 环境执行。

因此，事故前的部署私钥、能够修改部署工作流的仓库权限，以及能够使用相关 GitHub Actions 凭据的自动化主体，都应视为“等价于服务器 root 权限”。

### 3.3 高风险工作流提交确实执行过

GitHub 公开记录显示：

- 提交 `ac87b5c8c169ea94ea9afb195ae460cb37cd29b0f` 修改部署工作流；
- 工作流会向 root 的 `authorized_keys` 写入注释为 `ops-sync@schola` 的公钥；
- 同时创建每分钟恢复该公钥的 cron 定时任务；
- GitHub Actions 运行 `31875291144` 执行成功，并输出 `deploy-init ok`；
- 随后 `main` 被回退，使该提交离开正常主线历史。

该行为在技术效果上属于 root 持久访问通道。但由于所有者另有授权 Agent 同时工作，创建者身份尚未完成归因，报告不再把它直接称为“攻击者提交”。

相关公钥指纹：

```text
SHA256:4OA86CslkfOT9uNy4G2T4e1g6yIGgr4vN/drAYH5NAQ
```

### 3.4 事故版本的应用代码未发现常规宿主机提权入口

对事故时版本 `1b9c89c` 的静态核验结果：

- 没有 `child_process`、`exec`、`spawn`、`eval` 或将用户输入交给 shell 的代码；
- 论文仅接收文字，没有文件上传；
- Markdown 渲染使用 React 文本节点，不使用 `dangerouslySetInnerHTML`；
- SQL 查询使用参数绑定，未发现可直接执行任意 SQL 的注入点；
- 学术检索的上游 URL为固定地址，未发现由用户指定目标地址的 SSRF 入口；
- 容器没有挂载 `/var/run/docker.sock`，没有特权模式，也没有挂载宿主机根目录；
- 事故版本容器虽然以容器内 root 运行，但容器 root 不自动等于宿主机 root；还需要容器运行时、内核漏洞或错误挂载才能逃逸。

事故版本依赖为 Next.js 15.5.23、React 19.2.8、better-sqlite3 12.11.1。2026-08-16 重新连接 npm 官方漏洞库执行 `npm audit --omit=dev`，生产依赖已知漏洞为 0。Next.js 官方 2026 年 7 月安全发布要求 15.5.x 至少升级到 15.5.21，事故版本高于该修复版本。

### 3.5 Git 历史未发现常见私密凭据

全历史扫描未发现：

- OpenSSH/RSA/EC/DSA 私钥正文；
- `ghp_` 或 `github_pat_` 格式的 GitHub Token；
- 明文 root 密码；
- 明文 GitHub Actions `DEPLOY_KEY`。

本机存在的部署私钥位于被 `.gitignore` 排除的 `.deploy-keys/`，文件权限为 `600`，没有进入 Git 历史。其指纹为：

```text
SHA256:PTrbxKQokVPQDvpndGzlYBhg2zqwCx1pElOQ/x1sh4w
```

它与 `ops-sync@schola` 公钥以及其他文档记录的公钥均不相同。

### 3.6 “全员始祖”不是当前仓库代码的正常结果

仓库从初始提交起，`users.root` 的 schema 默认值就是 `0`；初始化代码只会把最早用户设置为 `root=1`。注册逻辑此前虽然没有显式写 `root`，但数据库默认值仍为 `0`。

因此，现有代码不支持“每个新注册账号因默认值为 1 自动成为始祖”的说法。全员 `root=1` 更可能来自：

1. 生产数据库存在未进入仓库的旧 schema；或
2. 宿主机 root 失守后，攻击者直接修改 SQLite 数据库；或
3. 其他拥有数据库写权限的脚本/Agent 修改了生产库。

需要从关机后的离线数据库执行 `PRAGMA table_info(users)` 并检查审计记录，才能最终区分。

## 4. 高概率初始入口

### 4.1 SSH 或部署凭据泄露——高概率

理由：

- 事故部署账号直接是 root；
- 部署私钥等价于 root shell；
- GitHub Actions 持有该私钥并可执行任意远程脚本；
- 旧服务器中的 `authorized_keys`、旧备份、另一台设备、Agent 环境或历史部署工具都可能保存过可用凭据；
- DMIT 官方说明，更换实例 SSH Key 后需要重启才能应用，重启前旧 Key 仍有效。此次关机前并未重装旧系统，因此改密码/改 Key 不能根除其他持久化。

仍需从离线 `auth.log`、`journal`、`wtmp/btmp`、`authorized_keys` 与 GitHub Actions 审计记录确认具体来源。

### 4.2 DMIT 控制面账号或会话失守——中等概率，未验证

如果攻击者得到 DMIT 登录会话、密码、API 凭据或两步验证恢复码，可以通过带外控制台、密钥更换或系统操作直接接触实例。需要检查 DMIT 账户登录、控制台、改密钥、重装和工单记录。

### 4.3 Web RCE 后容器逃逸——较低概率，但高级攻击下不能完全排除

应用代码与已知依赖漏洞暂未提供常规 RCE 入口，容器也未暴露 Docker socket。若该路径成立，需要同时存在尚未公开的 Next.js/Node/Docker/内核漏洞或宿主机错误配置。旧磁盘的内核、Docker 版本、容器配置与日志是决定性证据。

### 4.4 网站管理员逐级提权到 Linux root——当前不支持

网站的 `role=admin` 和 `root=1` 都只是 SQLite 中的业务权限字段，不是 Linux 用户或 sudo 权限。代码没有从管理后台执行系统命令、写宿主机文件或控制 Docker 的桥梁。因此普通账号、管理员账号或“始祖”身份本身不能解释宿主机 root shell。

## 5. GitHub 归因结论

### 已确认

- GitHub 控制面曾被用于执行一条具备 root 持久化效果的部署。
- 当时 `main` 未启用分支保护，push 即部署，且部署账号为 root。
- GitHub 展示的 actor/author 为所有者账号，但这只能证明某个有效账号会话、Token、SSH Key、GitHub App 或授权 Agent 代表该账号操作，不能证明具体操作者身份。

### 尚未确认

- GitHub 密码、登录会话、PAT、SSH Key 或 GitHub App 是否被攻击者窃取；
- `ac87b5c` 是否由攻击者、授权 Agent 或被提示注入误导的 Agent 创建；
- `maint/server-sync` 分支创建、删除和主线回退是否属于 Agent 的正常工作流。

### 当前定性

“GitHub 已失守”应保持为未证实；“GitHub/自动部署架构可以直接授予服务器 root”则是已确认的高风险设计缺陷。二者不能混为一谈。

## 6. 待验证的持久化线索

其他 Agent 生成的文档声称发现：

- `/opt/ops/sync.sh`；
- `schola-ops.service`；
- root crontab 每 60 秒恢复公钥；
- 公钥注释 `root@jefferey-dmit-hk`；
- 可能存在 `.ops_ctl` 触发器。

本次调查尚未取得产生这些结论的原始服务器命令输出、文件哈希或离线磁盘证据，因此这些内容必须标记为**待验证线索**，不能写成已确认事实。关机后的磁盘快照应重点检查这些路径和标识。

## 7. 当前处置状态与风险

### 已完成

- 旧服务器已从 DMIT 控制面关机；
- 已阻止攻击者继续通过该虚拟机读取数据、维持交互 shell 或利用服务器攻击第三方；
- 已保留旧磁盘，尚未重装破坏证据；
- 本地代码、Git 历史、事故部署配置与依赖已经完成第一轮只读核验。

### 尚未完成

- 尚未创建或确认完整磁盘快照；
- 尚未从离线镜像提取主机日志和数据库；
- 尚未最终确定 root 的最初入口；
- 尚未确认 `/opt/ops` 等持久化线索；
- 尚未轮换所有服务器相关秘密与网站会话；
- 尚未从干净系统重建；
- 尚未验证远程 GitHub Auto Deploy 已实际停用和 `main` 已受保护。

## 8. 关机后的取证顺序

1. 保持旧实例关机，不再启动旧操作系统。
2. 通过 DMIT 创建完整系统盘快照，标记为：

   ```text
   compromised-2026-08-16-do-not-boot
   ```

3. 如果套餐没有快照功能，联系 DMIT，请其在不启动实例的情况下保存完整磁盘镜像。
4. 将快照只读挂载到救援系统或独立取证主机，提取：

   - `/var/log/auth.log*`、journal、`wtmp`、`btmp`、`lastlog`；
   - `/root/.ssh/authorized_keys` 及全部用户的 `authorized_keys`；
   - `/etc/ssh/`、`/etc/pam.d/`、`/etc/sudoers*`；
   - `/etc/systemd/system/`、systemd generators、全部 timers；
   - `/etc/cron*`、`/var/spool/cron/`、`at` 任务；
   - `/opt/`、`/usr/local/bin/`、`/tmp/`、`/var/tmp/`、`/dev/shm/` 的元数据；
   - `/etc/ld.so.preload`、内核模块和启动文件；
   - Docker daemon 配置、容器 metadata、镜像与容器日志；
   - SQLite 数据库 `schola.db`、`schola.db-wal`、`schola.db-shm`。

5. 对所有提取文件计算 SHA-256，并保留原始时间戳；不要直接在快照中编辑或删除。

## 9. 恢复与防复发要求

1. 使用 DMIT 官方 Ubuntu 24.04 LTS 镜像重装，不从旧系统快照恢复启动。
2. 建立非 root 管理用户和独立部署用户，禁止 root SSH 登录和密码登录。
3. 部署密钥不得获得交互 shell、sudo、端口转发或代理转发能力。
4. 应用仅绑定 `127.0.0.1`，容器使用非 root 用户，删除不必要 capabilities，并保持不挂载 Docker socket。
5. 自动部署不得由普通 push 直接触发；生产部署需要人工批准、主机指纹校验和受保护环境。
6. 轮换 DMIT、GitHub、部署 SSH、网站管理员、邀请码、学术 API Key 与其他 `.env` 秘密。
7. 恢复数据库后删除全部 sessions、吊销旧邀请码、核验管理员名单，并只保留唯一创始人。
8. 将认证日志实时转发到独立系统；建立离线数据库备份和已知干净的系统快照。
9. 上线前验证 GitHub `main` 分支保护、禁止强推、Actions 权限与所有协作者/应用/Token。

## 10. 现阶段结论

服务器 root 失陷是既定事实，关机隔离是正确且必要的。现有证据不支持把普通恶意注册、网站管理员权限或当前仓库代码直接认定为宿主机 root 的来源。最值得优先验证的是旧 SSH/部署凭据与其他宿主机控制通道。

GitHub 账号失守仍未证实，但“仓库写权限 + push 自动部署 + root SSH”构成了无需传统提权漏洞即可取得服务器 root 的危险信任链。即使可疑提交最终确认来自授权 Agent，这套设计仍必须移除。

最终根因只能由关机后的离线磁盘、DMIT 账户日志、GitHub 私人安全日志和另一 Agent 的原始任务记录共同闭环。在此之前，报告不会把任何单一路径伪装成已经证实的答案。

## 11. 参考资料

- DMIT：更换 SSH Key 后需重启应用，重启前旧 Key 仍有效  
  <https://docs.dmit.io/guide/sshkeys/apply-ssh-key>
- DMIT：默认禁止远程 root 密码登录，可通过控制面 Console 登录  
  <https://docs.dmit.io/guide/faq/instance>
- Next.js：2026 年 7 月安全发布，15.5.x 修复版本为 15.5.21  
  <https://nextjs.org/blog>
- Docker：容器与宿主机权限边界及 Docker daemon 风险  
  <https://docs.docker.com/engine/security/>
- GitHub：分支保护  
  <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>
- GitHub：查看账户安全日志  
  <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/reviewing-your-security-log>

---

本报告只记录当前能够支持的事实与推断。取得离线磁盘证据后，应增加文件哈希、时间线、登录源 IP、持久化机制和最终根因章节，并保留本版本作为调查过程记录。
