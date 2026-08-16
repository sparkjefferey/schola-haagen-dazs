# 防「再被拿 root」· 纵深防御与检测

> 2026-08-15 主机 OS 被攻击者拿到 root（后门 `/opt/ops/sync.sh` 每 60s 重塞攻击公钥 + `schola-ops.service` + root crontab 互自愈）。
> 本节是「绝不能再次发生」的硬机制：分两层——**缩小被拿 root 的机会**（预防）+ **万一进来立刻被发现**（检测）。

---

## 一、预防：让攻击者连机会都没有（多数已落地）

| 防线 | 做法 | 状态 |
|---|---|---|
| 隐藏真实 IP / 关明文直连 | 应用只绑 `127.0.0.1:3000`，外部只走 Cloudflare Tunnel（HTTPS） | ✅ docker-compose 已改 |
| 应用不以 root 运行 | 容器内 `user:"node"`，Dockerfile 已 `chown node /app` | ✅ 已改 |
| 不挂 docker.sock | 应用容器无法借此变 host root | ✅ 从未挂载 |
| SSH 禁密码、仅密钥 | deploy.sh 5c 段 | ✅ 已加 |
| 防火墙只开 22 | UFW default deny，仅 allow 22 | ✅ 已加 |
| 依赖无 RCE | `npm audit` + 锁版本；不把用户输入拼进 shell/exec | ⚠️ 需每次更新跑 |
| 系统补丁 | `apt-get upgrade` 定期 | ⚠️ 手动/定时 |
| 非 root 日常管理 | 建 `schola` 用户 + sudo，禁 root 直登 | ➕ harden-host.sh |
| 部署密钥最小化 | authorized_keys 加 `command=` 限制只能跑部署 | ➕ 手动（见下） |

**关于"难度的真实位置"（不夸大）**：之前的灾难不是「应用被黑」，而是「应用被黑后一路升到 OS root」。
现在即使 Web 应用再被攻破，它也只跑在**非 root 容器**里、拿不到 docker.sock、真实 IP 还被 Tunnel 挡着——
这**显著抬高**了对方从"应用漏洞"变"宿主 root"的门槛，但**不是保险箱**：若攻击者手里有 0day、或偷到部署密钥/Cloudflare 令牌，仍可能直达宿主。
所以预防只是"加高墙"，真正的兜底见第三节（快照 + 离线日志）。

---

## 二、检测：进来也立刻暴露（本次最缺失的一环）

之前的后门能长期潜伏，是因为**没有任何监控**、且后门会自愈（手动检查看着是干净的）。
下面两个脚本补上这块：

### `scripts/monitor.sh` — 入侵绊线（Detection Tripwire）
每 15 分钟扫描，**两层**：

**第一层 签名式**（盯已知指纹，换密钥/改目录名即失效）：
- 攻击公钥指纹 `root@jefferey-dmit-hk` 是否重现于任何 `authorized_keys`
- `/opt/ops` 后门目录是否重建
- 可疑 systemd 单元（含 sync.sh / schola-ops / /opt/ops）
- SSH `PasswordAuthentication` 是否被悄悄重新打开、`PermitRootLogin` 是否被放宽

**第二层 行为式**（不依赖已知指纹，专门对付"高水平、会换马甲"的攻击者）：
- 关键路径（sshd 配置 / systemd / cron / /opt / root 的 ssh 目录 / sudoers）**完整性基线**，任何新增/改动/删除都报
- 不该监听的端口（除 sshd 端口与 `127.0.0.1:3000` 外，任何 `0.0.0.0`/`::` 监听即异常）
- 从 `/tmp`、`/dev/shm`、`/var/tmp`、`/opt/ops` 跑的进程（反弹 shell / 内存马常用藏身处）
- 新增 SUID/SGID 文件（提权常用）
- 新增内核模块（LKM rootkit 迹象）
- root 下出现非预期的交互式解释器（bash/sh/python/nc/socat…）

**诚实的局限**：rootkit 可通过 LD_PRELOAD、可加载内核模块隐藏进程/端口/模块，行为式检测**只能缩短"被发现的时间"，不能保证 100% 拦住**。
真正的底牌是 **DMIT 定时快照回滚 + auth.log 离线转发**（第三节）——本机被篡改也不影响这两条。

触发则写 `/var/log/schola-security.log`，并可选推 `ALERT_WEBHOOK`、可选 `AUTO_SHUTDOWN=1` 直接关机。

### `scripts/harden-host.sh` — 新主机一次性加固（deploy.sh 之后跑一次）
- 建非 root 管理员、禁 root 直登、SSH 禁密码
- 可选改 SSH 端口
- 装 AIDE 文件完整性基线、rkhunter rootkit 扫描
- 装入 monitor.sh 到 cron
- 设每日**离线**数据库备份（与受陷主机解耦）

### 用法
```bash
# 在新系统、deploy.sh 跑完且数据恢复后，执行一次：
ADMIN_USER=schola SSH_PORT=2222 ALERT_WEBHOOK="https://你的告警webhook" BACKUP_TARGET="user@备份机:/path" \
  bash scripts/harden-host.sh
```
（环境变量都可空；`SSH_PORT`/`ALERT_WEBHOOK`/`BACKUP_TARGET` 不填则跳过对应项。）

### 部署密钥最小化（手动一步）
编辑 `~/.ssh/authorized_keys`，给部署公钥加前缀，使其**只能跑部署、拿不到交互 shell**：
```
command="cd /root/Schola-Haagen-Dazs && git pull && bash update.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... schola-deploy-2026
```

---

## 三、剩下的两条「离线兜底」（最抗篡改）

1. **DMIT 定时快照**：保留一个已知干净的系统基线，疑似被入侵直接回滚，不必从零重装。
2. **日志转发到独立日志机**：root 能改本机 `/var/log`，把 `auth.log` 实时转发到另一台机器，日志才可信、才追得到源头。

---

## 三·五、当前仍未闭合的缺口（必须正视）

| 缺口 | 说明 | 谁负责 |
|---|---|---|
| 🔴 **入口未查明** | 攻击者怎么拿的 root（SSH 密钥泄露？Web RCE？还是之前 root 列 bug 接成的提权链？）至今没查清。不堵入口，新系统装好还会被再来 | 新系统起来后必须查（auth.log 离线件 + `npm audit` + 审 `lib/actions.ts` 有无拼 shell） |
| 🔴 **真实主机尚未重建验证** | 上述脚本/配置都已写好推上仓库，但**还没在真机上跑过**；"非 root 容器、localhost 绑定"等只验证过 compose 文件，未验证运行态 | 你重装完按 `DEPLOY_RECOVER.md` 执行并反馈，我才能确认真生效 |
| 🟠 **秘密轮换未实际执行** | "假设一切已泄露"只是方针；DB 口令、Cloudflared 令牌、部署密钥、用户会话的**实际轮换**要在恢复时做（清 sessions + 重置口令 + 新隧道令牌） | 恢复流程里执行 |
| 🟠 **部署密钥仍可能暴露** | 旧 `github-actions-deploy` 公钥当时在受陷主机 authorized_keys；若自动部署链路还在用旧私钥，需在新系统重新生成 | 新系统重新生成部署密钥对 |

**结论**：架构和工具已就位（这是实打实做对的部分），但"做完"= 重建 + 查入口 + 轮换秘密 + 实测运行态，目前只完成了第一步的准备。

## 四、如果绊线再次触发

1. 立刻关机（或 `AUTO_SHUTDOWN` 已自动关）。
2. 从 DMIT 快照回滚到干净基线，或按 `DEPLOY_RECOVER.md` 重建。
3. 查离线 `auth.log` 找入口 IP / 时间。
4. 复盘：是 SSH、Web RCE、还是提权链？补对应防线后再上线。
