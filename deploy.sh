#!/usr/bin/env bash
# ============================================================
#  沙藏学馆 · 一键部署脚本（在新租的香港服务器上运行）
#  用法：先把本项目代码弄到服务器（git clone 或 scp 上传），
#        cd 进项目目录，然后： bash deploy.sh
# ============================================================
set -e

echo "=== 沙藏学馆 一键部署开始 ==="

# 1) 装 docker（若系统里还没有）
if ! command -v docker >/dev/null 2>&1; then
  echo ">> 未检测到 docker，正在自动安装（需要 root 权限，可能要你输密码）..."
  curl -fsSL https://get.docker.com | sh
  # 让当前用户免 sudo 跑 docker（可选，重新登录后生效）
  if [ -n "$SUDO_USER" ]; then
    usermod -aG docker "$SUDO_USER" 2>/dev/null || true
  fi
  echo ">> docker 安装完成"
else
  echo ">> docker 已存在，跳过安装"
fi

# 2) 确保 docker compose 可用
if ! docker compose version >/dev/null 2>&1; then
  echo "!! docker compose 不可用，请检查 docker 安装。"
  exit 1
fi

# 3) 构建镜像并后台启动
echo ">> 构建镜像并启动容器（首次稍慢，要联网下载依赖）..."
docker compose build
docker compose up -d

# 4) 生产环境不自动播种演示账号。
#    如需本地演示数据，请手动提供三个 SEED_* 口令后运行 npm run seed。
echo ">> 已跳过演示账号播种（生产安全默认）"

# 5) 安全加固（重装后必做，顺序敏感：先放密钥，再禁密码，避免锁死自己）
echo ">> 安全加固：部署公钥 + 防火墙 + SSH + Cloudflare Tunnel"

# 5a) 把新部署公钥写进 authorized_keys（用法： DEPLOY_PUBKEY="ssh-edd25519 AAAA... " bash deploy.sh）
if [ -n "${DEPLOY_PUBKEY:-}" ]; then
  mkdir -p ~/.ssh && chmod 700 ~/.ssh
  grep -qxF "${DEPLOY_PUBKEY}" ~/.ssh/authorized_keys 2>/dev/null || echo "${DEPLOY_PUBKEY}" >> ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys
  echo ">> 已写入部署公钥到 ~/.ssh/authorized_keys"
else
  echo "!! 未提供 DEPLOY_PUBKEY，跳过写入（请确保你已有其它密钥能登入，否则下一步禁用密码会锁死）"
fi

# 5b) 防火墙：默认拒绝入站，仅放行 SSH(22)。Cloudflared 是出向连接，无需开放 80/443 入站。
if command -v ufw >/dev/null 2>&1; then
  ufw --force default deny incoming
  ufw --force default allow outgoing
  ufw --force allow 22/tcp
  ufw --force enable
  echo ">> UFW 已启用：仅放行 SSH(22) 入站"
else
  echo "!! 未检测到 ufw，跳过（请改用云厂商安全组，仅开放 22 入站）"
fi

# 5c) 关闭 SSH 密码登录（仅允许密钥）。必须在 5a 之后执行！
if [ -n "${DEPLOY_PUBKEY:-}" ]; then
  sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
  sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
  systemctl restart sshd 2>/dev/null || service ssh restart 2>/dev/null || true
  echo ">> SSH 已禁用密码登录，仅允许密钥"
else
  echo "!! 未提供 DEPLOY_PUBKEY，跳过禁用密码（请手动确认已放好密钥后再禁密码）"
fi

# 5d) 装 Cloudflare Tunnel，把本地 127.0.0.1:3000 收口为免费 HTTPS（隐藏真实 IP + 口令不再明文）
if ! command -v cloudflared >/dev/null 2>&1; then
  echo ">> 正在安装 cloudflared（需联网）..."
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb \
    && dpkg -i /tmp/cloudflared.deb 2>/dev/null || (apt-get update && apt-get install -y /tmp/cloudflared.deb)
fi
if command -v cloudflared >/dev/null 2>&1; then
  cat > /etc/systemd/system/cloudflared-schola.service <<'EOF'
[Unit]
Description=Cloudflare Tunnel for Schola
After=network.target docker.service
Requires=docker.service

[Service]
ExecStart=/usr/bin/cloudflared tunnel --url http://127.0.0.1:3000 --no-autoupdate
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now cloudflared-schola
  echo ">> Cloudflared 已设为开机自启（quick tunnel）。稍候用下面命令看 HTTPS 地址："
  echo "   journalctl -u cloudflared-schola --no-pager -n 30 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com'"
  echo "   注：quick tunnel 地址重启会变；要稳定地址需免费 CF 账号跑一次 'cloudflared login' 建 named tunnel（交互式）。"
else
  echo "!! cloudflared 安装失败，应用仅本地 127.0.0.1:3000 可达；请手动排查网络或先用临时 0.0.0.0:3000 调试。"
fi

echo ""
echo "=== 部署完成 🎉 ==="
echo "访问地址：  Cloudflare Tunnel 给的 https://xxxx.trycloudflare.com（看上面命令输出）"
echo "  - 应用已只绑 127.0.0.1:3000，明文直连 IP:3000 已关闭，外部只走 Tunnel。"
echo "  - 首次上线请先在 .env 设置强 ADMIN_INVITE，用它注册管理员，随后清空并重启容器。"
echo "  - 以后更新代码： 先 git pull，再 bash update.sh"
