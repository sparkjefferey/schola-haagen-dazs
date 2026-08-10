#!/usr/bin/env bash
# ============================================================
#  沙藏学馆 · 更新脚本（改了代码后，在服务器项目目录里跑）
#  用法： bash update.sh
#  前提：代码是用 git clone 拉下来的（这样 git pull 才有效）。
#        若是 scp 上传的，请重新 scp 覆盖后直接 bash deploy.sh。
# ============================================================
set -e
cd "$(dirname "$0")"

echo "=== 沙藏学馆 更新开始 ==="

# 拉取最新代码（仅在是 git 仓库时）
if [ -d .git ]; then
  echo ">> 拉取最新代码..."
  git pull
else
  echo ">> 不是 git 仓库，跳过 git pull（请确认已手动更新了代码文件）"
fi

echo ">> 重新构建并重启容器..."
docker compose build
docker compose up -d

echo ""
echo "=== 更新完成 ✅ ==="
echo "访问： http://<你的服务器IP>:3000"
