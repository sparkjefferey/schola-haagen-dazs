#!/usr/bin/env bash
# ============================================================
#  沙藏学馆 · 新主机一次性加固（在 deploy.sh 之后跑一次）
#  目标：把「再被拿 root」的概率压到最低 + 布防入侵检测。
#  ⚠️ 只跑一次；重复跑会重复写 crontab，请手动清理或用前先 crontab -l 检查。
#  配置（环境变量，可空）：
#    ADMIN_USER      非 root 管理员用户名（默认 schola）
#    SSH_PORT        改 SSH 端口（可选，减少扫描噪声）
#    ALERT_WEBHOOK   入侵告警 webhook（monitor.sh 用）
#    BACKUP_TARGET   离线 DB 备份目标，如 user@backuphost:/path（rsync）
# ============================================================
set -e
ADMIN_USER="${ADMIN_USER:-schola}"
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"

echo "=== 主机加固开始 ==="

# 1) 建非 root 管理员，并禁止 root 直接 SSH 登录
if ! id "$ADMIN_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$ADMIN_USER"
fi
usermod -aG sudo "$ADMIN_USER"
# 把当前会话的密钥也带给新用户（若当前是 root 且已有 authorized_keys）
if [ -f /root/.ssh/authorized_keys ]; then
  install -d -m700 -o "$ADMIN_USER" -g "$ADMIN_USER" /home/$ADMIN_USER/.ssh
  cp /root/.ssh/authorized_keys /home/$ADMIN_USER/.ssh/authorized_keys
  chown -R $ADMIN_USER:$ADMIN_USER /home/$ADMIN_USER/.ssh
  chmod 600 /home/$ADMIN_USER/.ssh/authorized_keys
fi
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config

# 2) 可选：改 SSH 端口（记得同时开 UFW）
if [ -n "${SSH_PORT:-}" ]; then
  sed -i "s/^#\?Port .*/Port ${SSH_PORT}/" /etc/ssh/sshd_config
  ufw allow ${SSH_PORT}/tcp
fi
systemctl restart sshd
echo ">> SSH：禁用密码、禁止 root 直登；日常用 $ADMIN_USER 登录"

# 3) 部署密钥最小化（手动步骤，提示）：
#    在 ~/.ssh/authorized_keys 里给部署公钥加前缀，使其只能跑部署、拿不到 shell：
#    command="cd /root/Schola-Haagen-Dazs && git pull && bash update.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding ssh-ed25519 AAAA... deploy
echo ">> 提示：部署公钥建议加 command= 限制（见 SECURITY_MONITORING.md）"

# 4) 文件完整性基线（AIDE）：日后可定时 aide --check 发现被篡改的文件
if command -v aide >/dev/null 2>&1 || apt-get update >/dev/null 2>&1 && apt-get install -y aide >/dev/null 2>&1; then
  aideinit --yes >/dev/null 2>&1 || true
  echo ">> AIDE 文件完整性基线已初始化（/var/lib/aide）"
fi

# 5) rootkit 扫描
if apt-get install -y rkhunter >/dev/null 2>&1; then
  rkhunter --update >/dev/null 2>&1 || true
  rkhunter --check --sk >/dev/null 2>&1 || true
  echo ">> rkhunter 已安装并跑过一轮"
fi

# 6) 布防入侵检测（monitor.sh 每 15 分钟）
install -m755 "$(dirname "$0")/monitor.sh" /usr/local/bin/schola-monitor.sh
( crontab -l 2>/dev/null; echo "*/15 * * * * ALERT_WEBHOOK='${ALERT_WEBHOOK}' /usr/local/bin/schola-monitor.sh" ) | crontab -
echo ">> 入侵绊线已装入 cron（每 15 分钟扫描攻击指纹/后门路径/SSH 放宽）"

# 7) 离线数据库备份（与受陷主机解耦，防数据随主机一起没）
if [ -n "${BACKUP_TARGET:-}" ]; then
  ( crontab -l 2>/dev/null; echo "0 4 * * * rsync -az /var/lib/docker/volumes/schola-data/_data/schola.db ${BACKUP_TARGET}/schola-\$(date +\\%F).db" ) | crontab -
  echo ">> 已设每日离线备份到 ${BACKUP_TARGET}"
fi

echo "=== 主机加固完成 ==="
echo "仍强烈建议：① DMIT 控制台开定时快照（保留干净基线，随时回滚）；"
echo "               ② 把 /var/log/auth.log 转发到独立日志机（root 可改本机日志，离线日志才可信）。"
