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

echo ""
echo "=== 部署完成 🎉 ==="
echo "现在用浏览器打开：  http://<你的服务器IP>:3000"
echo "  - 首次上线请先在 .env 设置强 ADMIN_INVITE，用它注册管理员，随后清空并重启容器。"
echo "  - 想用 80 端口（网址不带 :3000）：编辑 docker-compose.yml 把 3000:3000 改成 80:3000，再跑 docker compose up -d"
echo "  - 以后更新代码： 先 git pull，再 bash update.sh"
