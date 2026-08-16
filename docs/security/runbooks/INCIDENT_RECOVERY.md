# Root 入侵后的恢复清单

> 本清单假定攻击者已经取得旧服务器的 root shell。旧系统只能用于取证，不能继续作为生产环境。

## 立即隔离

1. 使用一台确认安全的电脑登录云厂商控制台。
2. 在安全组/防火墙中阻断旧服务器的全部入站和出站流量；做不到时直接关机。
3. 创建系统盘和数据盘的完整快照，并标记为“受感染、禁止联网启动”。
4. 在 GitHub Actions 中保持部署工作流停用，不要向旧服务器发送新密钥。

## 从快照提取数据库

本项目的数据库位于 Docker 命名卷 `schola-data`，不是普通项目目录。将旧磁盘挂到救援系统后，查找：

```text
/var/lib/docker/volumes/*schola-data/_data/schola.db
/var/lib/docker/volumes/*schola-data/_data/schola.db-wal
/var/lib/docker/volumes/*schola-data/_data/schola.db-shm
```

应用停止后复制这三个文件（存在几个就复制几个）。不要从仍在运行的容器中只复制 `schola.db`，否则可能丢失 WAL 中的最近交易。

只恢复数据库和经过人工检查的纯文本业务资料。不要恢复旧系统的 `/root`、`.ssh`、Docker 镜像、容器、`node_modules`、`.next`、系统服务、定时任务或可执行文件。

## 重建同一台服务器

可以保留云服务器实例、套餐和公网 IP，但必须通过云厂商控制台使用官方镜像重装系统。

1. 创建非 root 的 `deploy` 用户，项目目录使用 `/srv/schola-haagen-dazs`。
2. 禁止 SSH root 登录和密码登录，只使用重新生成的 SSH 密钥。
3. 重新安装 Docker，从 GitHub 的已审查提交构建应用。
4. 将恢复的数据库放入新建的 `schola-data` 卷。
5. 在首次开放公网前执行访问吊销脚本：

```bash
docker compose run --rm schola node scripts/incident-reset-access.mjs \
  --db /app/data/schola.db --confirm-reset-access
```

脚本会先创建带时间戳的数据库备份，然后：

- 删除全部登录会话，强制所有用户重新登录；
- 吊销全部旧邀请码；
- 只保留 `rector` 的创始掌门标记；
- 执行数据库完整性检查并写入审计日志。

若 `rector` 口令未知或已被轮换（含彻底遗忘），在同一命令追加 `--reset-founder-password`：

```bash
# 模式一（推荐）：自动生成随机强口令，仅在终端打印一次，请立即抄录
docker compose run --rm schola node scripts/incident-reset-access.mjs \
  --db /app/data/schola.db --confirm-reset-access --reset-founder-password

# 模式二：现场指定强口令（12+ 位，含大小写/数字/符号至少三类）
docker compose run --rm schola node scripts/incident-reset-access.mjs \
  --db /app/data/schola.db --confirm-reset-access \
  --reset-founder-password '此处粘贴你自己生成的强口令'
```

口令**不会写入任何文件**（仓库公开，绝不可把口令存进项目或服务器文件），
只存在于你的终端输出或记忆中；抄录后请尽快登录后台再次改密。

## 必须轮换的凭据

- 云厂商账号密码、API 密钥和两步验证恢复码；
- GitHub 密码、SSH Keys、Personal Access Tokens、Deploy Keys、Webhooks 和已授权应用；
- GitHub Actions 的 `DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_KEY`；
- 新增 `DEPLOY_FINGERPRINT`，值为新服务器 SSH 主机公钥的 SHA256 指纹；
- 网站管理员密码、`ADMIN_INVITE`、`SCHOLAR_CORE_KEY` 和其他 `.env` 密钥。

所有新密钥必须在安全设备上生成，不能发送到或经过旧服务器。

## 恢复部署

部署工作流不再响应 push。完成重装、密钥轮换、数据库吊销和人工检查后，在 GitHub Actions 手动运行 `Manual Deploy (clean server only)`，并输入 `REBUILT`。

工作流会拒绝使用 `root` 作为部署用户，并校验新服务器的 SSH 主机指纹。

## 上线前检查

- GitHub `main` 分支已启用保护，至少禁止强制推送；
- 协作者、Deploy Keys、Webhooks、GitHub Apps 中没有陌生项目；
- 新服务器只开放必要端口，SSH 只允许可信来源；
- `rector` 已更换密码，所有管理员均重新验证；
- 首页、登录、注册、论文、私信和管理操作均已测试；
- 旧服务器保持断网，直到取证和通知工作结束。
