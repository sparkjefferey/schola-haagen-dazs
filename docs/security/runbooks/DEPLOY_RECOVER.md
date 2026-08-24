# 重装后恢复与加固清单（沙藏学馆）

> 适用场景：服务器 OS 已被攻击者拿到 root，已重装系统，**且保留了旧数据盘/快照**（生产库可恢复）。
> 目标：① 救回生产数据（40 用户 + 论坛 + 论文）；② 重装后假设一切秘密已泄露并轮换；③ 堵住攻击者拿 root 的入口。

---

## 步骤 0：新系统就绪
- 新系统（推荐 Ubuntu 22.04）装好，你能用重装时设的密钥/密码 SSH 登入。
- **确认你做的是「彻底重装」而非「重启旧系统」**：旧系统若只是重启，后门会 60 秒自愈、你仍被黑。重装 = 旧磁盘格式化、从干净镜像装新系统。
- 在 DMIT 控制台确认旧**快照**还在（这是救数据的来源）。

## 步骤 1：拉干净代码
```bash
cd /root
git clone <你的仓库地址> Schola-Haagen-Dazs
cd Schola-Haagen-Dazs
```
代码在 git 是干净的，已含本轮全部安全修复：root 收敛为仅创始人、CJK 用户名主页解码、应用只绑 127.0.0.1、非 root 运行。

## 步骤 2：从快照安全取回数据库（只读挂载，绝不中招）★重点
快照里**可能还带着攻击者的后门**，所以唯一的铁律是：
**绝不拿快照当系统盘启动；只把它当「第二块只读数据盘」挂上来，只拷一个数据库文件出来，然后立刻卸掉删掉。**

### 2.0 DMIT 控制台操作
- 找到你的快照 → 选 **「从快照创建云硬盘 / Create Volume from Snapshot」**。
  - ❌ 不要选「恢复 / Restore」——那会把旧（带毒）系统覆盖到新机器上，后门直接复活。
- 把这块新云硬盘 **附加(Attach) 到新虚拟机，作为数据盘（不是系统盘）**。记下 DMIT 分配的设备名（通常 `/dev/vdb`）。

### 2.1 新系统上：只读挂载 + 只拷一个文件
```bash
lsblk                                    # 确认挂上来的盘，例如 vdb（分区 vdb1）
sudo mkdir -p /mnt/oldsnap
sudo mount -o ro /dev/vdb1 /mnt/oldsnap  # ★ 关键：ro = 只读，盘里任何程序都无法执行/自改

# 找数据库（生产库在旧 Docker 卷里）
sudo find /mnt/oldsnap -name schola.db 2>/dev/null
#   典型结果：/mnt/oldsnap/var/lib/docker/volumes/schola-data/_data/schola.db

# （可选·取证，只读无害）确认快照里是否真有攻击者公钥
sudo grep -rl "root@jefferey-dmit-hk" /mnt/oldsnap 2>/dev/null

# 只拷这一个数据文件（连同 -wal / -shm 若有）
sudo mkdir -p /root/recover
sudo cp /mnt/oldsnap/var/lib/docker/volumes/schola-data/_data/schola.db /root/recover/
sudo cp /mnt/oldsnap/var/lib/docker/volumes/schola-data/_data/schola.db-wal /root/recover/ 2>/dev/null
sudo cp /mnt/oldsnap/var/lib/docker/volumes/schola-data/_data/schola.db-shm /root/recover/ 2>/dev/null

sudo umount /mnt/oldsnap
```
- 回到 DMIT 控制台 **卸载并删除那块快照盘**（别留着、也别再挂）。
- 数据库已安全落在 `/root/recover/schola.db`。

### 2.2 铁律（你怕的「一挂就被黑」只有这几种情况才会发生）
- ❌ 绝不用快照「恢复」成系统盘后启动 → 后门 60 秒自愈，等于没重装。
- ❌ 绝不对 `/mnt/oldsnap` 里的任何程序做 `chroot` / 执行 / 恢复 SSH 密钥或服务。
- ❌ 绝不拷贝旧盘的 SSH 配置、`systemd` 单元、`cron`、`authorized_keys`。
- ✅ **只读挂载 + 只拷 `schola.db` 这一个文件 = 安全**。SQLite 文件只是数据、不含可执行代码，攻击者后门无从激活，不可能借拷贝文件回到新系统。

## 步骤 3：把数据库放进新卷并轮换
1. 先正常跑一次 `docker compose up -d`，让新 `schola-data` 卷生成（此时是空库）。
2. `docker compose down` 停容器。
3. 把 `/root/recover/schola.db`（连同同目录的 `-wal`/`-shm` 若有）覆盖进新卷路径：
   `/var/lib/docker/volumes/schola-data/_data/`
4. `docker compose up -d` 重新拉起。
> ⚠️ 务必先停容器再拷文件，拷完再起，否则 WAL 可能覆盖/损坏。

## 步骤 4：假定数据库已被攻击者读过 → 轮换
连进容器（或临时起 sqlite 客户端）执行：
```sql
DELETE FROM sessions;   -- 作废所有人登录态，攻击者手里任何会话全部失效
```
然后**重置管理员（rector 及任何 admin）密码**为新的强密码（站内无自助找回，需后台改或直连 DB）。
> 用户密码本身是 scrypt 哈希+盐，攻击者不能直接反解；但整库可读，视为潜在泄露 → 上线后公告用户自行改密，至少管理员必须换。

## 步骤 5：用新密钥部署（图方便版）
在本项目目录执行（把新公钥通过环境变量传进去）：
```bash
DEPLOY_PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILWMQ8Cqw9mDTPjFhvPNbSygRzqCB/q9KpM4bq8zHyJl schola-deploy-2026" bash deploy.sh
```
`deploy.sh` 会自动依次：
1. 装 docker → 构建 → 起容器（**只绑 127.0.0.1:3000、非 root 运行**）
2. 写入新部署公钥到 `~/.ssh/authorized_keys`
3. 防火墙（ufw）默认拒入站、**仅放行 SSH(22)**
4. **禁用 SSH 密码登录**（仅允许密钥）—— 这一步在写密钥之后，不会锁死你
5. 安装 Cloudflare Tunnel，把本地 3000 收口为免费 HTTPS

新私钥在你的 Mac（沙箱写不进 `~/.ssh`，落在项目里）：
```
/Users/jefferey/Documents/Schola Häagen-Dazs/.deploy-keys/dmit_deploy_ed25519
```
重装完在 Mac 上把它移进 `~/.ssh` 并赋权即可用：
```bash
mv '/Users/jefferey/Documents/Schola Häagen-Dazs/.deploy-keys/dmit_deploy_ed25519' ~/.ssh/ \
  && chmod 600 ~/.ssh/dmit_deploy_ed25519
# SSH 时指定： ssh -i ~/.ssh/dmit_deploy_ed25519 user@host
```

> ⚠️ 若你用 GitHub Actions 自动部署：旧密钥 `github-actions-deploy` 曾躺在服务器 authorized_keys 里（已被重装清除）。重装后需在仓库 Settings → Deploy keys **重新生成一对**，把新公钥加回服务器（同上 DEPLOY_PUBKEY 机制或手动追加）。

## 步骤 6：拿到 Tunnel 地址，转告访客
```bash
journalctl -u cloudflared-schola --no-pager -n 30 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com'
```
把这个 **https** 地址发给朋友，替代旧的 `IP:3000`。
> quick tunnel 地址**重启 cloudflared/服务器会变**；要稳定地址需免费 CF 账号跑一次 `cloudflared login` 建 named tunnel（交互式，AI 不能 headless 完成）。

## 步骤 7（最关键）：堵入口 —— 查清攻击者怎么拿的 root
重装只是把攻击者清出场；入口不堵，新系统还会被再来一遍。重点排查：
1. **SSH**：旧系统是否弱口令/泄露密钥？新系统已禁密码+仅新密钥，基本堵死。仍建议看 `/var/log/auth.log` 此前暴力尝试来源 IP。
2. **Web 应用 RCE**：Node/Next.js 是否有命令执行面？重点审 `lib/actions.ts` 等是否把用户输入拼进 shell/exec；并跑 `npm audit` 确认依赖无 RCE 级 CVE。
3. **提权链**：之前 root 列 bug（全员 root）若结合某写文件/RCE 点，可从应用层升到系统层。该 bug 已修，但要确认没有别的「应用内高权限 + 写文件点」组合。
4. **其它暴露面**：除 22/3000 外还有没有别的服务（redis/mysql/面板）在跑？新系统默认只开 22，已收紧。

## 步骤 8：监控攻击公钥是否重现
把这条指纹记死，上线后定期 `grep` `authorized_keys` 与 systemd/cron：
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDERLxCN6MRokchXQNQPJhN8TsInhv56xYmRUdr7VpDM9 root@jefferey-dmit-hk
```
若出现 → 说明入口没堵住，立刻关机复查，回到步骤 7。

## 回滚 / 调试
- 本机临时直连验证：把 `docker-compose.yml` 的 `127.0.0.1:3000:3000` 改回 `3000:3000` 再 `docker compose up -d`，验证完**务必改回**。
- 一切以「root 曾沦陷」为前提：**所有秘密轮换一遍**，别偷懒只改密码。
